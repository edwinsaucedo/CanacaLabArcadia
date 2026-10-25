'use strict';
// Pruebas de lo que CanacaLabArcadia hace sola: juegos de Drive en la biblioteca, bajar y jugar,
// updates/DLC de Switch, configuracion de Eden, firmware de PS3, disco duro de Xbox y el piloto automatico.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const { CloudService } = require('../src/main/cloud');
const { scanLibrary } = require('../src/main/scanner');
const nsp = require('../src/main/nsp');
const sw = require('../src/main/switchsetup');
const fw = require('../src/main/firmware');
const { Autopilot } = require('../src/main/autopilot');
const emus = require('../src/main/emulators');

const catalog = loadCatalog();
const FOLDER = '1FakeFolderIdParaPruebas_abcdefgh';
const fakeExe = path.join(__dirname, 'fake-rclone.js');
fs.chmodSync(fakeExe, 0o755);
try { fs.chmodSync(require('7zip-bin').path7za, 0o755); } catch { /* ok */ }

// .nsp minimo: cabecera PFS0 con un ticket "<rights id>.tik" y un .nca.
function fakeNsp(titleId) {
  const names = [`${titleId.toLowerCase()}0000000000000005.tik`, 'aabbccddeeff00112233445566778899.nca'];
  const strings = Buffer.from(names.join('\0') + '\0');
  const head = Buffer.alloc(16);
  head.write('PFS0', 0, 'ascii');
  head.writeUInt32LE(names.length, 4);
  head.writeUInt32LE(strings.length, 8);
  const table = Buffer.alloc(24 * names.length);
  let off = 0;
  names.forEach((n, i) => {
    table.writeUInt32LE(off, i * 24 + 16);
    off += Buffer.byteLength(n) + 1;
  });
  return Buffer.concat([head, table, strings, Buffer.alloc(64)]);
}

test('Switch: title ID del nombre o del ticket; base, update y DLC', () => {
  assert.equal(nsp.titleIdFromName('Super Smash Bros. Ultimate [01006A800016E000][v0].nsp'), '01006A800016E000');
  assert.equal(nsp.kindOfTitleId('01006A800016E000'), 'base');
  assert.equal(nsp.kindOfTitleId('01006A800016E800'), 'update');
  assert.equal(nsp.kindOfTitleId('01006A800016F001'), 'dlc');
  assert.equal(nsp.baseTitleId('01006A800016E800'), '01006A800016E000');
  assert.equal(nsp.baseTitleId('01006A800016F00A'), '01006A800016E000');
  const dir = h.tmpDir('nsp-');
  const f = path.join(dir, 'actualizacion sin nombre.nsp');
  fs.writeFileSync(f, fakeNsp('01006A800016E800'));
  assert.equal(nsp.titleIdFromNsp(f), '01006A800016E800');
  assert.equal(nsp.classifySwitchFile(f).kind, 'update');
  assert.equal(nsp.classifySwitchFile(path.join(dir, 'Juego [UPD].nsp'), { readHeader: false }).kind, 'update');
  assert.equal(nsp.classifySwitchFile(path.join(dir, 'Juego [v196608].nsp'), { readHeader: false }).kind, 'update');
  assert.equal(nsp.classifySwitchFile(path.join(dir, 'Juego (DLC Pack).nsp'), { readHeader: false }).kind, 'dlc');
  assert.equal(nsp.classifySwitchFile(path.join(dir, 'Juego.xci'), { readHeader: false }).kind, 'base');
});

test('Switch: la biblioteca muestra solo el juego, no sus updates ni DLC', () => {
  const root = h.tmpDir('biblio-');
  const sw = path.join(root, 'roms', 'switch');
  fs.mkdirSync(path.join(sw, 'Smash'), { recursive: true });
  fs.writeFileSync(path.join(sw, 'Smash', 'Super Smash Bros. Ultimate [01006A800016E000][v0].nsp'), fakeNsp('01006A800016E000'));
  fs.writeFileSync(path.join(sw, 'Smash', 'Super Smash Bros. Ultimate [01006A800016E800][v1966080].nsp'), fakeNsp('01006A800016E800'));
  fs.writeFileSync(path.join(sw, 'Smash', 'Joker.nsp'), fakeNsp('01006A800016F001'));
  fs.writeFileSync(path.join(sw, 'Mario Kart 8 Deluxe.xci'), Buffer.alloc(64));
  const lib = scanLibrary(root, { extraRomDirs: {} }, catalog);
  assert.deepEqual(lib.switch.map((g) => g.title), ['Mario Kart 8 Deluxe', 'Super Smash Bros. Ultimate']);
});

test('Switch: en la nube los updates y DLC viajan con su juego', () => {
  const f = (name, size) => ({ key: `file:${name}`, name, kind: 'files', files: [name], size });
  const bases = nsp.attachSwitchExtras([
    f('Super Smash Bros. Ultimate [01006A800016E000][v0].nsp', 100),
    f('Super Smash Bros. Ultimate [01006A800016E800][v1966080].nsp', 10),
    f('Super Smash Bros. Ultimate [01006A800016F001][v0].nsp', 5),
    f('Zelda [UPD].nsp', 3),
    f('Zelda.nsp', 50),
    f('Huerfano [0100AAAABBBB0800][v1].nsp', 1)
  ]);
  assert.deepEqual(bases.map((b) => [b.name, b.extras.length]), [
    ['Super Smash Bros. Ultimate [01006A800016E000][v0].nsp', 2],
    ['Zelda.nsp', 1]
  ]);
});

test('Eden: contenido externo, carpeta de juegos y control del jugador 1, sin pisar lo tuyo', () => {
  const root = h.tmpDir('biblio-');
  const emuDir = path.join(root, 'emulators', 'eden');
  fs.mkdirSync(path.join(emuDir, 'user'), { recursive: true });
  const exe = path.join(emuDir, 'eden.exe');
  fs.writeFileSync(exe, '');
  const pad = { vid: 0x045e, pid: 0x0b13, ver: 0x0515, sub: 1 };
  assert.equal(sw.sdlXInputGuid(pad), '030000005e040000130b000015057801');

  const r1 = sw.prepareEdenConfig({ exe, dataRoot: root, pad });
  assert.equal(r1.changed, true);
  const ini = fs.readFileSync(r1.file, 'utf8');
  const romDir = path.resolve(root, 'roms', 'switch').replace(/\\/g, '/');
  assert.equal(sw.iniGet(ini, 'UI', 'Paths\\external_content_dirs\\size'), '1');
  assert.equal(sw.iniGet(ini, 'UI', 'Paths\\external_content_dirs\\1\\path'), romDir);
  assert.deepEqual(sw.iniArray(ini, 'UI', 'Paths\\gamedirs').map((d) => d.path), ['SDMC', 'UserNAND', 'SysNAND', romDir]);
  assert.equal(sw.iniGet(ini, 'Data%20Storage', 'ext_content_from_game_dirs'), 'true');
  assert.equal(sw.iniGet(ini, 'Data%20Storage', 'ext_content_from_game_dirs\\default'), 'false');
  assert.equal(sw.iniGet(ini, 'Controls', 'player_0_button_a'), '"engine:sdl,port:0,guid:030000005e040000130b000015057801,button:1"');
  assert.equal(sw.iniGet(ini, 'Controls', 'player_0_button_a\\default'), 'false');
  assert.match(sw.iniGet(ini, 'Controls', 'player_0_lstick'), /axis_x:0,axis_y:1/);
  assert.match(sw.iniGet(ini, 'Controls', 'player_0_button_zr'), /axis:5,threshold:0\.500000/);

  // Segunda vez, mismo control: nada cambia.
  const r2 = sw.prepareEdenConfig({ exe, dataRoot: root, pad, state: r1.controls });
  assert.equal(r2.changed, false);
  let state = r1.controls;

  // La Ally X: el GUID calculado es el mismo que Eden guardo de verdad en la Ally X real.
  const ally = { vid: 0x0b05, pid: 0x1b4c, ver: 2, sub: 1 };
  assert.equal(sw.sdlXInputGuid(ally), '03000000050b00004c1b000002007801');

  // Abres con la Ally: el jugador 1 pasa a la Ally.
  const r3 = sw.prepareEdenConfig({ exe, dataRoot: root, pad: ally, state });
  state = r3.controls || state;
  assert.match(fs.readFileSync(r3.file, 'utf8'), /guid:03000000050b00004c1b000002007801,button:1/);

  // La configuras a mano en Eden (por ejemplo, A y B al reves) ...
  const file = r3.file;
  fs.writeFileSync(file, sw.iniSetMany(fs.readFileSync(file, 'utf8'), 'Controls', {
    player_0_button_a: '"engine:sdl,port:0,guid:03000000050b00004c1b000002007801,button:0"',
    player_0_button_b: '"engine:sdl,port:0,guid:03000000050b00004c1b000002007801,button:1"'
  }));
  // ... y la vuelves a usar: se respeta y queda recordada para ese control.
  const r4 = sw.prepareEdenConfig({ exe, dataRoot: root, pad: ally, state });
  state = r4.controls || state;
  assert.equal(sw.iniGet(fs.readFileSync(file, 'utf8'), 'Controls', 'player_0_button_a'), '"engine:sdl,port:0,guid:03000000050b00004c1b000002007801,button:0"');
  assert.ok(state.perfiles['03000000050b00004c1b000002007801'], 'se recuerda tu configuracion de la Ally');

  // Abres con el control de Xbox: jugador 1 = Xbox (automatico) ...
  const r5 = sw.prepareEdenConfig({ exe, dataRoot: root, pad, state });
  state = r5.controls || state;
  assert.match(fs.readFileSync(file, 'utf8'), /guid:030000005e040000130b000015057801,button:1/);
  // ... y al volver a la Ally regresa tu configuracion a mano, no la automatica.
  const r6 = sw.prepareEdenConfig({ exe, dataRoot: root, pad: ally, state });
  state = r6.controls || state;
  assert.equal(sw.iniGet(fs.readFileSync(file, 'utf8'), 'Controls', 'player_0_button_a'), '"engine:sdl,port:0,guid:03000000050b00004c1b000002007801,button:0"');
  assert.match(r6.info, /guardaste en Eden/);

  // Si Eden se reinstala (vuelve al teclado) y no se sabe que control es: se usa el ultimo que funciono.
  fs.writeFileSync(file, '[Controls]\nplayer_0_button_a\\default=true\nplayer_0_button_a="engine:keyboard,code:67,toggle:0"\n');
  const r7 = sw.prepareEdenConfig({ exe, dataRoot: root, pad: null, state });
  assert.match(r7.info, /sin identificar: se usa el ultimo/);
  assert.equal(sw.iniGet(fs.readFileSync(file, 'utf8'), 'Controls', 'player_0_button_a'), '"engine:sdl,port:0,guid:03000000050b00004c1b000002007801,button:0"');
});

test('Eden: respeta un qt-config.ini existente y no duplica la carpeta', () => {
  const root = h.tmpDir('biblio-');
  const emuDir = path.join(root, 'emulators', 'eden');
  fs.mkdirSync(path.join(emuDir, 'user', 'config'), { recursive: true });
  const exe = path.join(emuDir, 'eden.exe');
  fs.writeFileSync(exe, '');
  const file = path.join(emuDir, 'user', 'config', 'qt-config.ini');
  fs.writeFileSync(file, [
    '[Controls]', 'player_0_button_a\\default=true', 'player_0_button_a="engine:keyboard,code:67,toggle:0"', '',
    '[UI]', 'theme=default', 'Paths\\gamedirs\\1\\path=SDMC', 'Paths\\gamedirs\\1\\deep_scan=false', 'Paths\\gamedirs\\1\\expanded=true',
    'Paths\\gamedirs\\2\\path=D:/Switch', 'Paths\\gamedirs\\size=2', ''
  ].join('\r\n'));
  sw.prepareEdenConfig({ exe, dataRoot: root, pad: null });
  const ini = fs.readFileSync(file, 'utf8');
  assert.match(ini, /\r\n/, 'conserva los fines de linea de Windows');
  assert.equal(sw.iniGet(ini, 'UI', 'theme'), 'default');
  assert.deepEqual(sw.iniArray(ini, 'UI', 'Paths\\gamedirs').map((d) => d.path), ['SDMC', 'D:/Switch', path.resolve(root, 'roms', 'switch').replace(/\\/g, '/')]);
  assert.equal(sw.iniGet(ini, 'Controls', 'player_0_button_a'), '"engine:keyboard,code:67,toggle:0"', 'sin control conectado no toca los botones');
  const again = sw.prepareEdenConfig({ exe, dataRoot: root, pad: null });
  assert.equal(again.changed, false);
});

function fakeDrive() {
  const drive = h.tmpDir('drive-');
  const root = path.join(drive, FOLDER);
  const put = (rel, buf) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  };
  put('PS2/Okami (USA).iso', h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_215.15;1' }));
  put('PS2/Ico (USA).iso', h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SCUS_971.13;1' }));
  put('Neo Geo/mslug.zip', h.buildZip(['201-p1.p1', '201-c1.c1']));
  put('Nintendo Switch/Super Smash Bros. Ultimate [01006A800016E000][v0].nsp', fakeNsp('01006A800016E000'));
  put('Nintendo Switch/Super Smash Bros. Ultimate [01006A800016E800][v1966080].nsp', fakeNsp('01006A800016E800'));
  put('PS4/CUSA00900/eboot.bin', Buffer.alloc(64));
  put('PS4/CUSA00900/sce_sys/param.sfo', h.buildSfo({ TITLE: 'Bloodborne', TITLE_ID: 'CUSA00900' }));
  put('BIOS/scph5501.bin', Buffer.alloc(32));
  put('BIOS/mcpx_1.0.bin', Buffer.alloc(512));
  put('PC/juego.exe', Buffer.alloc(8));
  put('Arcade/Copia de kof2002.zip', h.buildZip(['265-p1.p1']));
  return drive;
}

async function connectedCloud() {
  process.env.FAKE_DRIVE = fakeDrive();
  const dataRoot = h.withCloudFolder(h.tmpDir('biblio-'));
  const cloud = new CloudService({ getDataRoot: () => dataRoot, getCatalog: () => catalog, getRcloneExe: () => fakeExe, extract: (a, d) => emus.extractArchive(a, d) });
  await cloud.connectAccount({});
  return { cloud, dataRoot };
}

const waitDone = (cloud, n) => new Promise((resolve) => {
  const got = [];
  cloud.on('done', (d) => { got.push(d); if (got.length === n) resolve(got); });
});

test('nube: tus juegos de Drive aparecen en la biblioteca antes de bajarlos', async () => {
  const { cloud, dataRoot } = await connectedCloud();
  assert.equal(cloud.connected(), true);
  await cloud.buildIndex();
  assert.ok(fs.existsSync(path.join(dataRoot, 'config', 'nube-indice.json')), 'la lista se guarda para abrir sin internet');
  const games = cloud.cloudGames();
  assert.deepEqual(games.ps2.map((g) => g.title), ['Ico', 'Okami']);
  assert.equal(games.neogeo[0].title, 'Metal Slug', 'nombre real del juego de arcade');
  assert.equal(games.switch.length, 1, 'el update no sale como juego');
  assert.equal(games.switch[0].title, 'Super Smash Bros. Ultimate');
  assert.equal(games.switch[0].extras, 1);
  assert.equal(games.ps4[0].folderGame, true);
  assert.equal(games.bios, undefined, 'los BIOS no son juegos');
  assert.ok(games.ps2.every((g) => g.cloud && g.id.includes('|')));

  // Al abrir CanacaLabArcadia: los BIOS se bajan solos.
  const bg = cloud.backgroundJobs();
  assert.deepEqual(bg.map((j) => j.name).sort(), ['mcpx_1.0.bin', 'scph5501.bin']);
  const biosDone = waitDone(cloud, 2);
  cloud.enqueue(bg);
  await biosDone;
  assert.ok(fs.existsSync(path.join(dataRoot, 'bios', 'mcpx_1.0.bin')));
  assert.equal(cloud.backgroundJobs().length, 0);
});

test('nube: A sobre un juego de Drive lo baja primero en la fila (con su update) y desaparece de la nube', async () => {
  const { cloud, dataRoot } = await connectedCloud();
  await cloud.buildIndex();
  const games = cloud.cloudGames();
  // Ya hay algo bajando y algo en fila: el que quieres jugar pasa al frente.
  const okami = games.ps2.find((g) => g.title === 'Okami');
  const ico = games.ps2.find((g) => g.title === 'Ico');
  const smash = games.switch[0];
  const done = waitDone(cloud, 3);
  cloud.enqueue([cloud.jobFor(cloud.cloudUnits().find((c) => c.id === okami.id)), cloud.jobFor(cloud.cloudUnits().find((c) => c.id === ico.id))]);
  const r = cloud.playJob(smash.id);
  assert.equal(r.system, 'switch');
  assert.equal(cloud.snapshot().pending[0].id, smash.id, 'el juego que pediste va primero');
  const all = await done;
  const played = all.find((d) => d.id === smash.id);
  assert.equal(played.ok, true);
  assert.equal(played.play, true);
  assert.equal(played.files.length, 2, 'juego + update');
  assert.ok(fs.existsSync(path.join(dataRoot, 'roms', 'switch', 'Super Smash Bros. Ultimate [01006A800016E800][v1966080].nsp')));
  const after = cloud.cloudGames();
  assert.equal((after.switch || []).length, 0);
  assert.equal((after.ps2 || []).length, 0);
  // Arcade: "Copia de kof2002.zip" (copia hecha en Drive) queda como kof2002.zip, que es como lo busca MAME/FBNeo.
  const kof = games.mame.find((g) => g.rawName === 'Copia de kof2002');
  assert.equal(kof.title, 'The King of Fighters 2002');
  cloud.playJob(kof.id);
  await waitDone(cloud, 1);
  assert.ok(fs.existsSync(path.join(dataRoot, 'roms', 'mame', 'kof2002.zip')));
  assert.equal(fs.existsSync(path.join(dataRoot, 'roms', 'mame', 'Copia de kof2002.zip')), false);
  assert.equal((cloud.cloudGames().mame || []).length, 0, 'ya no sale como pendiente');
  // Juego en carpeta (PS4): se baja con el nombre de su carpeta.
  const ps4 = cloud.playJob(games.ps4[0].id);
  const d2 = await waitDone(cloud, 1);
  assert.equal(d2[0].path, 'CUSA00900');
  assert.ok(fs.existsSync(path.join(dataRoot, 'roms', 'ps4', 'CUSA00900', 'eboot.bin')), ps4.name);
});

test('nube: si llega un update nuevo a Drive de un juego que ya tienes, se baja solo', async () => {
  const { cloud, dataRoot } = await connectedCloud();
  await cloud.buildIndex();
  const sw2 = path.join(dataRoot, 'roms', 'switch');
  fs.mkdirSync(sw2, { recursive: true });
  fs.writeFileSync(path.join(sw2, 'Super Smash Bros. Ultimate [01006A800016E000][v0].nsp'), fakeNsp('01006A800016E000'));
  const jobs = cloud.backgroundJobs().filter((j) => j.system === 'switch');
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].name, /updates y DLC/);
  assert.equal(jobs[0].files.length, 1);
});

test('Switch: updates y DLC sin title ID en el nombre (comprimidos .7z/.rar, "99 DLCs") se unen al juego', () => {
  const units = [
    'Super Smash Bros. Ultimate (World) (Base Game).7z', 'Super Smash Bros Ultimate Update v13.0.2.7z', 'Super Smash Bros Ultimate 99 DLCs.rar',
    'Mario Kart 8 Deluxe.nsp', 'Mario Kart 8.nsp', 'Mario Kart 8 Deluxe DLC.nsp', 'Mario Kart 8 DLC.nsp', 'Pokemon Violet (USA).xci'
  ].map((name) => ({ key: name, name, kind: 'files', files: [name], size: 1 }));
  units.push({ key: 'dir', name: 'Pokemon Violet DLC', kind: 'dir', files: ['Pokemon Violet DLC/dlc1.nsp'], size: 1 });
  const out = nsp.attachSwitchExtras(units);
  const by = Object.fromEntries(out.map((b) => [b.name, b.extras.map((x) => `${x.kind}:${x.name}`)]));
  assert.deepEqual(Object.keys(by).sort(), ['Mario Kart 8 Deluxe.nsp', 'Mario Kart 8.nsp', 'Pokemon Violet (USA).xci', 'Super Smash Bros. Ultimate (World) (Base Game).7z']);
  assert.deepEqual(by['Super Smash Bros. Ultimate (World) (Base Game).7z'], ['update:Super Smash Bros Ultimate Update v13.0.2.7z', 'dlc:Super Smash Bros Ultimate 99 DLCs.rar']);
  assert.deepEqual(by['Mario Kart 8 Deluxe.nsp'], ['dlc:Mario Kart 8 Deluxe DLC.nsp'], 'el nombre mas largo gana');
  assert.deepEqual(by['Mario Kart 8.nsp'], ['dlc:Mario Kart 8 DLC.nsp']);
  assert.deepEqual(by['Pokemon Violet (USA).xci'], ['dlc:Pokemon Violet DLC'], 'una carpeta de DLC no es un juego');
  assert.equal(nsp.kindFromWords('Juego 99 DLCs.rar'), 'dlc');
  assert.equal(nsp.kindFromWords('Juego (Actualización 1.2).zip'), 'update');
  assert.equal(nsp.kindFromWords('Super Smash Bros. Ultimate (World) (Base Game).7z'), null);
});

test('nube: Smash con su update .7z y sus DLC .rar se baja junto, se descomprime y no se vuelve a bajar', async () => {
  const drive = h.tmpDir('drive-');
  const sw = path.join(drive, FOLDER, 'Nintendo Switch');
  fs.mkdirSync(sw, { recursive: true });
  fs.writeFileSync(path.join(sw, 'Super Smash Bros. Ultimate (World) (Base Game).7z'), Buffer.alloc(64, 1));
  fs.writeFileSync(path.join(sw, 'Super Smash Bros Ultimate Update v13.0.2.7z'), Buffer.alloc(32, 2));
  fs.writeFileSync(path.join(sw, 'Super Smash Bros Ultimate 99 DLCs.rar'), h.buildRar({ 'Super Smash Bros Ultimate DLC [01006A800016F001].nsp': fakeNsp('01006A800016F001') }));
  process.env.FAKE_DRIVE = drive;
  const dataRoot = h.withCloudFolder(h.tmpDir('biblio-'));
  const unpacked = [];
  const cloud = new CloudService({
    getDataRoot: () => dataRoot, getCatalog: () => catalog, getRcloneExe: () => fakeExe,
    // .7z simulado (no es un 7z real); el .rar si se descomprime de verdad.
    extract: (a, d) => { unpacked.push(path.basename(a)); return /\.rar$/i.test(a) ? emus.extractArchive(a, d) : Promise.resolve(d); }
  });
  await cloud.connectAccount({});
  await cloud.buildIndex();
  const games = cloud.cloudGames().switch;
  assert.equal(games.length, 1, 'solo el juego, sin los DLC ni el update');
  assert.equal(games[0].title, 'Super Smash Bros. Ultimate');
  assert.equal(games[0].extras, 2);
  const done = waitDone(cloud, 1);
  cloud.playJob(games[0].id);
  const [d] = await done;
  assert.equal(d.ok, true);
  assert.equal(d.files.length, 3, 'juego + update + DLC');
  assert.deepEqual(unpacked.sort(), ['Super Smash Bros Ultimate 99 DLCs.rar', 'Super Smash Bros Ultimate Update v13.0.2.7z', 'Super Smash Bros. Ultimate (World) (Base Game).7z']);
  const dest = path.join(dataRoot, 'roms', 'switch');
  assert.ok(fs.existsSync(path.join(dest, 'Super Smash Bros Ultimate DLC [01006A800016F001].nsp')), 'el DLC sale del .rar');
  assert.equal(fs.existsSync(path.join(dest, 'Super Smash Bros Ultimate 99 DLCs.rar')), false, 'el comprimido se borra');
  assert.equal((cloud.cloudGames().switch || []).length, 0);
  assert.equal(cloud.backgroundJobs().filter((j) => j.system === 'switch').length, 0, 'lo ya descomprimido no se vuelve a bajar');
});

test('PS3: enlace del firmware desde la lista oficial de Sony y descarga validada', async () => {
  const list = 'Dest=84;CompatibleSystemSoftwareVersion=4.9100-;\nDest=84;ImageVersion=0001000f;SystemSoftwareVersion=4.9200;CDN=http://dus01.ps3.update.playstation.net/update/ps3/image/us/2025_0101_abc/PS3UPDAT.PUP;CDN_Timeout=30;\n';
  assert.equal(fw.pupUrlFromList(list), 'http://dus01.ps3.update.playstation.net/update/ps3/image/us/2025_0101_abc/PS3UPDAT.PUP');
  const pup = Buffer.concat([Buffer.from('SCEUF\0\0\0'), Buffer.alloc(101 * 1024 * 1024)]);
  const asked = [];
  const fakeFetch = async (url) => {
    asked.push(url);
    if (/updatelist/.test(url)) return new Response(list);
    return new Response(pup, { headers: { 'content-length': String(pup.length) } });
  };
  const root = h.tmpDir('biblio-');
  const got = await fw.downloadPs3Firmware(root, { fetchImpl: fakeFetch });
  assert.equal(got, path.join(root, 'bios', 'PS3UPDAT.PUP'));
  assert.ok(fw.isPup(got));
  assert.match(asked[1], /2025_0101_abc/);
  // Si Sony no responde: la version conocida.
  assert.equal(await fw.ps3PupUrl(async () => { throw new Error('sin red'); }), fw.PS3_PUP_FALLBACK);
  // Algo que no es un firmware no se guarda.
  const bad = h.tmpDir('biblio-');
  await assert.rejects(fw.downloadPs3Firmware(bad, { fetchImpl: async (u) => new Response(/updatelist/.test(u) ? list : 'html de error') }), /no es un firmware/);
  assert.equal(fs.existsSync(path.join(bad, 'bios', 'PS3UPDAT.PUP')), false);
});

test('PS3: RPCS3 instala el firmware y se cierra solo', { skip: process.platform === 'win32' }, async () => {
  const dir = h.tmpDir('rpcs3-');
  const exe = path.join(dir, 'rpcs3.exe');
  // RPCS3 falso: crea los archivos del firmware, escribe su log y se queda abierto (como el real).
  fs.writeFileSync(exe, `#!/bin/sh
mkdir -p "${dir}/dev_flash/vsh/module" "${dir}/dev_flash/vsh/etc"
echo "$@" > "${dir}/args.txt"
sleep 0.3
touch "${dir}/dev_flash/vsh/module/vsh.self"
echo 4.92 > "${dir}/dev_flash/vsh/etc/version.txt"
echo "S SYS: Successfully installed PS3 firmware version 4.92." > "${dir}/RPCS3.log"
sleep 30
`);
  fs.chmodSync(exe, 0o755);
  const t0 = Date.now();
  const r = await fw.installPs3Firmware({ exe, pup: '/tmp/PS3UPDAT.PUP', pollMs: 100, closeWaitMs: 300 });
  assert.equal(r.installed, true);
  assert.ok(Date.now() - t0 < 10000, 'no espera a que lo cierres');
  assert.match(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8'), /--installfw \/tmp\/PS3UPDAT\.PUP/);
  const gui = fs.readFileSync(path.join(dir, 'GuiConfigs', 'CurrentSettings.ini'), 'utf8');
  assert.match(gui, /\[main_window\]/);
  assert.match(gui, /infoBoxEnabledWelcome=false/);
  assert.match(gui, /infoBoxEnabledInstallPUP=false/);
});

test('Xbox: el disco duro en blanco se baja solo', async () => {
  const root = h.tmpDir('biblio-');
  let url = null;
  const zip = h.buildZip(['x']);
  const hdd = await fw.downloadXboxHdd(root, {
    fetchImpl: async (u) => { url = u; return new Response(zip); },
    extract: async (archive, dest) => {
      assert.ok(fs.existsSync(archive));
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'xbox_hdd.qcow2'), Buffer.alloc(1024));
    }
  });
  assert.equal(url, fw.XBOX_HDD_URL);
  assert.equal(path.basename(hdd), 'xbox_hdd.qcow2');
  assert.equal(fs.existsSync(path.join(root, 'bios', 'xbox_hdd.qcow2.zip')), false, 'no deja el .zip');
});

test('piloto automatico: instala lo que falta para tus consolas, espera si estas jugando y no repite portadas', async () => {
  const root = h.tmpDir('biblio-');
  const installed = new Set(['retroarch']);
  const calls = [];
  let playing = true;
  const library = { ps2: [{ id: 'a', title: 'Okami', rawName: 'Okami (USA)', cover: null }], snes: [{ id: 'b', title: 'Mario', rawName: 'Super Mario World (USA)', cover: null }] };
  const cloudGames = { xbox: [{ id: 'c', title: 'Halo', rawName: 'Halo (USA)', cloud: true }], ps3: [{ id: 'd', title: 'Demon', rawName: 'Demon', folderGame: true }] };
  const statuses = [];
  const ap = new Autopilot({
    getDataRoot: () => root,
    getCatalog: () => catalog,
    getLibrary: () => library,
    cloud: { connected: () => false, cloudGames: () => cloudGames },
    resolve: (sys) => {
      const ref = catalog.byId[sys].emulators[0];
      if (!installed.has(ref.emu)) return { ready: false, missing: [{ emu: ref.emu, what: 'emulador' }] };
      if (sys === 'snes' && !installed.has('core:snes9x')) return { ready: false, missing: [{ emu: 'retroarch', core: ref.core, what: 'nucleo' }] };
      return { ready: true };
    },
    hasRclone: () => true,
    install: async (id) => { calls.push(id); installed.add(id); },
    installCore: async (core) => { calls.push(`core:${core}`); installed.add('core:snes9x'); },
    isPlaying: () => playing,
    sleep: async () => { playing = false; },
    needsXboxHdd: () => true,
    downloadXboxHdd: async () => calls.push('xbox-hdd'),
    needsPs3Pup: () => true,
    downloadPs3Pup: async () => calls.push('ps3-pup'),
    fetchCovers: async (items) => { calls.push(`portadas:${items.length}`); return { found: 1, misses: ['ps2/Okami (USA)'] }; }
  });
  ap.on('status', (s) => statuses.push(s));
  await ap.run('inicio');
  assert.deepEqual(calls.filter((c) => !c.startsWith('portadas')).sort(), ['core:snes9x', 'pcsx2', 'rpcs3', 'xbox-hdd', 'ps3-pup', 'xemu'].sort());
  assert.ok(statuses.some((s) => s.label === 'Instalando PCSX2'));
  assert.equal(statuses[statuses.length - 1].busy, false);
  // Segunda vez: ya esta todo; la portada que no existe no se vuelve a pedir.
  calls.length = 0;
  await ap.run('inicio');
  assert.deepEqual(calls.filter((c) => !c.startsWith('portadas')), ['xbox-hdd', 'ps3-pup']);
  assert.ok(calls.includes('portadas:1') || calls.includes('portadas:2'));
  assert.ok(!calls.includes('portadas:3'));
});
