'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const { scanLibrary, parseName } = require('../src/main/scanner');
const { buildImportPlan, executeImport } = require('../src/main/importer');
const { ensureLibraryFolders, retroarchAppendConfig, ensureDolphinProfiles } = require('../src/main/configs');
const { resolveForSystem } = require('../src/main/emulators');
const { buildCommand, GameSession } = require('../src/main/launcher');
const { ComboWatcher, BTN } = require('../src/main/xinput');
const { DEFAULT_SETTINGS } = require('../src/main/store');

const catalog = loadCatalog();
const settings = { ...DEFAULT_SETTINGS };

test('catalogo: todas las consolas pedidas existen y apuntan a emuladores validos', () => {
  const want = ['mame', 'neogeo', 'xbox', 'xbox360', 'psp', 'ps2', 'ps3', 'ps4', 'nes', 'n64', 'wii', 'switch'];
  for (const id of want) assert.ok(catalog.byId[id], `falta ${id}`);
  assert.ok(catalog.systems.length >= 18);
});

test('parseName separa titulo, region y disco', () => {
  const r = parseName('Final Fantasy VII (USA) (Disc 2) [!]');
  assert.equal(r.title, 'Final Fantasy VII');
  assert.equal(r.region, 'USA');
  assert.equal(r.disc, 2);
  assert.equal(parseName('Metroid Prime (Europe) (En,Fr,De)').region, 'Europa');
});

test('escaneo: oculta .bin de un .cue, discos de un .m3u, BIOS de Neo Geo y lee nombres de arcade', () => {
  const root = h.tmpDir();
  ensureLibraryFolders(root, catalog);
  const r = (sys, name, buf = Buffer.alloc(4)) => fs.writeFileSync(path.join(root, 'roms', sys, name), buf);
  r('ps1', 'FF7 (USA) (Disc 1).bin');
  r('ps1', 'FF7 (USA) (Disc 1).cue', 'FILE "FF7 (USA) (Disc 1).bin" BINARY\n TRACK 01 MODE2/2352\n');
  r('ps1', 'FF7 (USA) (Disc 2).cue', 'FILE "FF7 (USA) (Disc 2).bin" BINARY\n');
  r('ps1', 'FF7 (USA).m3u', 'FF7 (USA) (Disc 1).cue\nFF7 (USA) (Disc 2).cue\n');
  r('neogeo', 'neogeo.zip');
  r('neogeo', 'mslug.zip');
  r('neogeo', 'kof98.zip');
  r('snes', 'Super Mario World (USA).sfc');
  r('n64', 'leeme.txt');
  fs.mkdirSync(path.join(root, 'roms', 'ps4', 'CUSA00900', 'sce_sys'), { recursive: true });
  r('ps4', 'CUSA00900/eboot.bin');
  r('ps4', 'CUSA00900/sce_sys/param.sfo', h.buildSfo({ TITLE: 'Bloodborne', TITLE_ID: 'CUSA00900' }));

  const lib = scanLibrary(root, settings, catalog);
  assert.deepEqual(lib.ps1.map((g) => g.title), ['FF7']);
  assert.ok(lib.ps1[0].path.endsWith('.m3u'));
  assert.deepEqual(lib.neogeo.map((g) => g.title).sort(), ['Metal Slug', "The King of Fighters '98"]);
  assert.equal(lib.snes[0].region, 'USA');
  assert.equal(lib.n64.length, 0);
  assert.equal(lib.ps4[0].title, 'Bloodborne');
  assert.ok(lib.ps4[0].launch.endsWith('eboot.bin'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('importador: detecta, mueve acompanantes y no duplica', async () => {
  const src = h.tmpDir();
  const root = h.tmpDir();
  ensureLibraryFolders(root, catalog);
  fs.writeFileSync(path.join(src, 'Okami.iso'), h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_215.15;1' }));
  fs.writeFileSync(path.join(src, 'Spyro (USA).bin'), h.toRawMode2(h.buildIso9660({ 'SYSTEM.CNF': 'BOOT = cdrom:\\SCUS_942.28;1' })));
  fs.writeFileSync(path.join(src, 'Spyro (USA).cue'), 'FILE "Spyro (USA).bin" BINARY\r\n TRACK 01 MODE2/2352\r\n');
  fs.writeFileSync(path.join(src, 'Melee.rvz'), h.rvz(1));
  fs.writeFileSync(path.join(src, 'notas.txt'), 'x');

  const plan = buildImportPlan([src]);
  const bySys = Object.fromEntries(plan.map((p) => [p.name, p.system]));
  assert.deepEqual(bySys, { 'Okami.iso': 'ps2', 'Spyro (USA).cue': 'ps1', 'Melee.rvz': 'gamecube' });

  const res = await executeImport(root, plan, { move: false });
  assert.equal(res.added.length, 3);
  assert.ok(fs.existsSync(path.join(root, 'roms', 'ps1', 'Spyro (USA).bin')), 'el .bin debe viajar con su .cue');
  const again = await executeImport(root, plan, { move: false });
  assert.equal(again.skipped.length, 3, 'si ya existe con el mismo tamano, no se duplica');

  const lib = scanLibrary(root, settings, catalog);
  assert.equal(lib.ps2.length, 1);
  assert.equal(lib.ps1.length, 1);
  assert.equal(lib.gamecube.length, 1);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

function fakeInstall(root, emuId, exeName, extra = []) {
  const dir = path.join(root, 'emulators', emuId, 'sub');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exeName), '');
  for (const e of extra) {
    fs.mkdirSync(path.dirname(path.join(dir, e)), { recursive: true });
    fs.writeFileSync(path.join(dir, e), '');
  }
  return path.join(dir, exeName);
}

test('resolucion de emulador y armado de comando por consola', () => {
  const root = h.tmpDir();
  let st = resolveForSystem(root, settings, catalog, 'ps2');
  assert.equal(st.ready, false);
  assert.match(st.reason, /PCSX2/);

  fakeInstall(root, 'pcsx2', 'pcsx2-qt.exe');
  st = resolveForSystem(root, settings, catalog, 'ps2');
  assert.equal(st.ready, true);
  const game = { path: 'D:\\Juegos PS2\\Okami (USA).iso', launch: 'D:\\Juegos PS2\\Okami (USA).iso' };
  const cmd = buildCommand({ catalog, settings, resolved: st, game, configDir: path.join(root, 'config') });
  assert.deepEqual(cmd.args, ['-batch', '-nogui', '-fullscreen', '--', 'D:\\Juegos PS2\\Okami (USA).iso']);

  // RetroArch sin nucleo -> no listo; con nucleo -> listo y -L apunta al dll.
  fakeInstall(root, 'retroarch', 'retroarch.exe');
  st = resolveForSystem(root, settings, catalog, 'n64');
  assert.equal(st.ready, false);
  assert.match(st.reason, /núcleo/);
  fakeInstall(root, 'retroarch', 'retroarch.exe', ['cores/mupen64plus_next_libretro.dll']);
  st = resolveForSystem(root, settings, catalog, 'n64');
  assert.equal(st.ready, true);
  const n64 = buildCommand({ catalog, settings, resolved: st, game: { path: 'C:\\r\\Zelda.z64' }, configDir: 'C:\\CanacaLabArcadia\\config' });
  assert.equal(n64.args[0], '-f');
  assert.ok(n64.args[2].endsWith('mupen64plus_next_libretro.dll'));
  assert.equal(n64.args[3], 'C:\\r\\Zelda.z64');
  assert.equal(n64.args[4], '--appendconfig=C:\\CanacaLabArcadia\\config\\retroarch-arcadia.cfg');

  // Switch: Eden tiene prioridad, Ryujinx como alternativa, y se puede elegir el predeterminado.
  fakeInstall(root, 'ryujinx', 'Ryujinx.exe');
  assert.equal(resolveForSystem(root, settings, catalog, 'switch').emu, 'ryujinx');
  fakeInstall(root, 'eden', 'eden.exe');
  assert.equal(resolveForSystem(root, settings, catalog, 'switch').emu, 'eden');
  const pref = { ...settings, defaultEmu: { switch: 'ryujinx' } };
  assert.equal(resolveForSystem(root, pref, catalog, 'switch').emu, 'ryujinx');

  // PS3 usa el EBOOT.BIN de la carpeta del juego.
  fakeInstall(root, 'rpcs3', 'rpcs3.exe');
  const ps3 = buildCommand({
    catalog, settings, resolved: resolveForSystem(root, settings, catalog, 'ps3'),
    game: { path: 'C:\\ps3\\BLUS30443', launch: 'C:\\ps3\\BLUS30443\\PS3_GAME\\USRDIR\\EBOOT.BIN' }, configDir: 'x'
  });
  assert.deepEqual(ps3.args, ['--no-gui', '--fullscreen', 'C:\\ps3\\BLUS30443\\PS3_GAME\\USRDIR\\EBOOT.BIN']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('configs: RetroArch y perfiles de Dolphin (sin pisar cambios del usuario)', () => {
  const root = h.tmpDir();
  const cfg = fs.readFileSync(retroarchAppendConfig(root), 'utf8');
  assert.match(cfg, /input_joypad_driver = "sdl3"/);
  assert.match(cfg, /system_directory = ".*bios"/);
  const exe = fakeInstall(root, 'dolphin', 'Dolphin.exe');
  const first = ensureDolphinProfiles(exe);
  assert.deepEqual(first, { gcpad: true, wiimote: true, ini: true });
  const gc = fs.readFileSync(path.join(path.dirname(exe), 'User', 'Config', 'GCPadNew.ini'), 'utf8');
  assert.match(gc, /Device = XInput\/0\/Gamepad/);
  assert.ok(fs.existsSync(path.join(path.dirname(exe), 'portable.txt')));
  assert.deepEqual(ensureDolphinProfiles(exe), { gcpad: false, wiimote: false, ini: false });
  fs.rmSync(root, { recursive: true, force: true });
});

test('combo View + Menu sostenido cierra el juego (lector simulado)', () => {
  let buttons = 0;
  const w = new ComboWatcher({ holdMs: 1000, reader: (i) => (i === 0 ? { wButtons: buttons } : null) });
  let fired = 0;
  w.on('combo', () => fired++);
  buttons = BTN.BACK;
  assert.equal(w.tick(0), false);
  buttons = BTN.BACK | BTN.START;
  w.tick(100);
  w.tick(900);
  assert.equal(fired, 0, 'aun no pasa 1 segundo');
  w.tick(1150);
  assert.equal(fired, 1);
  w.tick(3000);
  assert.equal(fired, 1, 'no se repite mientras se mantiene');
  buttons = 0;
  w.tick(3100);
  buttons = BTN.BACK | BTN.START;
  w.tick(3200);
  w.tick(4300);
  assert.equal(fired, 2);
});

test('sesion de juego: inicia, registra y termina', async () => {
  const s = new GameSession();
  const ended = new Promise((res) => s.once('ended', res));
  s.start({ exe: process.execPath, args: ['-e', 'setTimeout(()=>{}, 50)'], cwd: process.cwd() }, { id: 'abc', title: 'Prueba' });
  assert.equal(s.running, true);
  const r = await ended;
  assert.equal(r.game.id, 'abc');
  assert.equal(s.running, false);

  const s2 = new GameSession();
  const ended2 = new Promise((res) => s2.once('ended', res));
  s2.start({ exe: process.execPath, args: ['-e', 'setInterval(()=>{}, 1000)'], cwd: process.cwd() }, { id: 'larga' });
  s2.stop();
  const r2 = await ended2;
  assert.equal(r2.forced, true);
});
