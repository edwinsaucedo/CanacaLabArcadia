'use strict';
// Prueba de humo del proceso principal con un Electron simulado: arranque, biblioteca,
// importar, lanzar un "emulador" falso, tiempo jugado y favoritos, todo por los mismos canales IPC que usa la interfaz.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const h = require('./helpers');

const userDataDir = h.tmpDir('userdata-');
process.env.ARCADIA_TEST_OFFLINE = '1';
const handlers = {};
const sent = [];
const fakeWin = {
  webContents: { send: (ch, p) => sent.push([ch, p]), setWindowOpenHandler() {}, on() {} },
  once(ev, fn) { if (ev === 'ready-to-show') fn(); },
  show() {}, focus() {}, restore() {}, minimize() {}, setAlwaysOnTop() {},
  isMinimized: () => false, isDestroyed: () => false, isFullScreen: () => false, setFullScreen() {},
  loadFile() {}
};
const fakeElectron = {
  app: {
    getPath: (k) => (k === 'home' ? userDataDir : userDataDir),
    getVersion: () => '1.0.0',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on() {},
    quit() {}
  },
  BrowserWindow: function BrowserWindow() { return fakeWin; },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal() {}, openPath: async () => '', showItemInFolder() {} },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { fetch: async () => null },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron;
  return origLoad.call(this, request, ...rest);
};

const invoke = async (ch, ...args) => {
  const r = await handlers[ch]({}, ...args);
  if (!r.ok) throw new Error(`${ch}: ${r.error}`);
  return r.data;
};

test('flujo completo: biblioteca nueva, agregar, jugar, favorito', async () => {
  require('../src/main/main.js');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(handlers['app:init'], 'registro IPC');

  const first = await invoke('app:init');
  assert.equal(first.settings.dataRoot, path.join(userDataDir, 'CanacaLabArcadia'), 'primera vez: biblioteca por defecto sin preguntar');
  assert.ok(fs.existsSync(path.join(userDataDir, 'CanacaLabArcadia', 'roms', 'ps2')));
  assert.ok(first.catalog.systems.length >= 18);

  const root = h.tmpDir('biblio-');
  const chosen = await invoke('folder:chooseRoot', root);
  assert.equal(chosen.settings.dataRoot, root);
  assert.ok(fs.existsSync(path.join(root, 'roms', 'ps2', 'LEEME.txt')));
  assert.ok(fs.existsSync(path.join(root, 'config', 'retroarch-arcadia.cfg')));

  // Agregar un juego de PS2 arrastrado desde otra carpeta.
  const src = h.tmpDir('usb-');
  fs.writeFileSync(path.join(src, 'Okami (USA).iso'), h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_215.15;1' }));
  const plan = await invoke('import:plan', [src]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].system, 'ps2');
  const imp = await invoke('import:execute', plan, false);
  assert.equal(imp.report.added.length, 1);
  assert.equal(imp.library.ps2.length, 1);
  assert.equal(imp.status.ps2.ready, false, 'aun sin PCSX2');

  // Lanzar sin emulador: intenta instalarlo solo; sin internet -> error con codigo para la interfaz.
  const game = imp.library.ps2[0];
  const fail = await handlers['game:launch']({}, game.id);
  assert.equal(fail.ok, false);
  assert.equal(fail.code, 'NO_EMULATOR');
  assert.match(fail.error, /No se pudo instalar PCSX2/);
  assert.ok(sent.some(([ch, p]) => ch === 'launch:prep' && p.id === game.id && /Instalando PCSX2/.test(p.phase)), 'la interfaz ve que se esta instalando');

  // "Instalar" un PCSX2 falso que solo escribe sus argumentos y termina.
  const emuDir = path.join(root, 'emulators', 'pcsx2');
  fs.mkdirSync(emuDir, { recursive: true });
  const fake = path.join(emuDir, 'pcsx2-qt.exe');
  const argsOut = path.join(root, 'args.json');
  fs.writeFileSync(fake, `#!/bin/sh\nnode -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' ${JSON.stringify(argsOut)} "$@"\n`);
  fs.chmodSync(fake, 0o755);
  const scan = await invoke('library:scan');
  assert.equal(scan.status.ps2.ready, true);
  assert.equal(scan.status.ps2.bios, 'Falta el BIOS de PS2', 'la tarjeta de PS2 avisa que falta el BIOS');

  // Sin BIOS no se abre PCSX2 (se evitaria su pantalla de error); con el BIOS en la carpeta bios, si.
  const noBios = await handlers['game:launch']({}, game.id);
  assert.equal(noBios.code, 'NO_BIOS');
  fs.writeFileSync(path.join(root, 'bios', 'scph70012.bin'), h.fakePs2Bios());
  const rescan = await invoke('library:scan');
  assert.equal(rescan.status.ps2.bios, undefined);
  // PCSX2 no portable: su configuracion vive en Documentos.
  const ini = fs.readFileSync(path.join(userDataDir, 'PCSX2', 'inis', 'PCSX2.ini'), 'utf8');
  assert.match(ini, /BIOS = scph70012\.bin/);

  const launched = await invoke('game:launch', game.id);
  assert.equal(launched.emulator, 'PCSX2');
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (sent.some(([ch]) => ch === 'game:ended')) { clearInterval(t); resolve(); }
    }, 25);
  });
  const args = JSON.parse(fs.readFileSync(argsOut, 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['-batch', '-nogui', '-fullscreen', '--']);
  assert.ok(args[4].endsWith(path.join('roms', 'ps2', 'Okami (USA).iso')));
  const ended = sent.find(([ch]) => ch === 'game:ended')[1];
  assert.equal(ended.id, game.id);
  assert.ok(ended.userData.lastPlayed[game.id], 'se registra la ultima vez que se jugo');

  const fav = await invoke('game:favorite', game.id);
  assert.equal(fav.favorite, true);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'config', 'userdata.json'), 'utf8'));
  assert.deepEqual(persisted.favorites, [game.id], 'favoritos guardados dentro de la biblioteca');

  const emus = await invoke('emu:status');
  assert.equal(emus.pcsx2.installed, true);
  assert.equal(emus.eden.auto, true, 'Eden se instala solo desde su sitio oficial');
  assert.equal(emus.ryujinx.auto, false);

  // ---- Juegos de tu Google Drive: aparecen en la biblioteca y con A se bajan y se abren.
  const rcloneDir = path.join(root, 'emulators', 'rclone');
  fs.mkdirSync(rcloneDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fake-rclone.js'), path.join(rcloneDir, 'rclone.exe'));
  fs.chmodSync(path.join(rcloneDir, 'rclone.exe'), 0o755);
  const drive = h.tmpDir('drive-');
  const folder = path.join(drive, '1FakeFolderIdParaPruebas_abcdefgh', 'PS2');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'Ico (USA).iso'), h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SCUS_971.13;1' }));
  process.env.FAKE_DRIVE = drive;
  h.withCloudFolder(root);
  const before = await invoke('cloud:games');
  assert.equal(before.info.connected, false, 'sin cuenta: la pantalla principal pide conectar Google');
  await invoke('cloud:connect');
  const listed = await invoke('cloud:refresh');
  assert.equal(listed.info.connected, true);
  const ico = listed.games.ps2.find((g) => g.title === 'Ico');
  assert.ok(ico && ico.cloud);
  const play = await invoke('cloud:play', ico.id);
  assert.equal(play.system, 'ps2');
  const done = await new Promise((resolve) => {
    const t = setInterval(() => {
      const d = sent.find(([ch, p]) => ch === 'cloud:done' && p.id === ico.id);
      if (d) { clearInterval(t); resolve(d[1]); }
    }, 25);
  });
  assert.equal(done.ok, true);
  assert.ok(done.playGameId, 'la interfaz sabe que juego abrir');
  assert.equal((done.cloudGames.ps2 || []).length, 0, 'ya no sale como juego de la nube');
  assert.ok(done.library.ps2.some((g) => g.id === done.playGameId && g.title === 'Ico'));
  const second = await invoke('game:launch', done.playGameId);
  assert.equal(second.emulator, 'PCSX2');
});

test.after(() => {
  Module._load = origLoad;
});
