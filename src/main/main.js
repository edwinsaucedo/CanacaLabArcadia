'use strict';
// Proceso principal de CanacaLabArcadia (Electron).
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');

const { loadCatalog } = require('./catalog');
const { SettingsStore, UserData } = require('./store');
const { scanLibrary, romDirsFor } = require('./scanner');
const emus = require('./emulators');
const { buildCommand, GameSession } = require('./launcher');
const { ComboWatcher, PadTracker } = require('./xinput');
const { buildImportPlan, executeImport } = require('./importer');
const { retroarchAppendConfig, ensureRetroArchProfiles, ensureRpcs3Input, ensureDolphinProfiles, setDolphinPlayer1, ensureLibraryFolders } = require('./configs');
const { prepareEmulator, findPs3Firmware, findXboxFiles, rpcs3FirmwareInstalled, SONY_PS3_FIRMWARE_PAGE } = require('./emusetup');
const { fetchCovers, fetchCoverItems } = require('./covers');
const { CloudService, loadCloud, cloudPath, destFor } = require('./cloud');
const { checkBios, biosMessage } = require('./bios');
const { loadUser32, handOffFocus } = require('./win32');
const { edenStatus, installEdenFiles, prepareEdenConfig } = require('./switchsetup');
const { downloadPs3Firmware, installPs3Firmware, downloadXboxHdd } = require('./firmware');
const { Autopilot } = require('./autopilot');
const { loadScraperConfig, saveScraperConfig, publicScraperConfig, sourcesOf, fetchSmartCovers, testScraperConfig } = require('./scraper');
const { readJsonSafe, writeJsonAtomic } = require('./store');

const KIOSK = process.argv.includes('--kiosk');
// Solo para las pruebas automaticas: nada se descarga de internet.
const TEST_OFFLINE = process.env.ARCADIA_TEST_OFFLINE === '1';
const dataArg = process.argv.find((a) => a.startsWith('--data='));

protocol.registerSchemesAsPrivileged([
  { scheme: 'arcadia-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;
let settings = null;
let userData = null;
let catalog = null;
let library = {};
const session = new GameSession();
let combo = null;
let pads = null;
let cloud = null;
let autopilot = null;
let autopilotStarted = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dataRoot() {
  return settings.get().dataRoot;
}

function defaultRoots() {
  const safe = (name) => { try { return app.getPath(name); } catch { return null; } };
  const list = process.platform === 'win32' ? ['C:\\CanacaLabArcadia'] : [];
  if (safe('home')) list.push(path.join(safe('home'), 'CanacaLabArcadia'));
  if (safe('documents')) list.push(path.join(safe('documents'), 'CanacaLabArcadia'));
  return list;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function systemStatus() {
  const s = settings.get();
  const out = {};
  for (const sys of catalog.systems) {
    out[sys.id] = dataRoot() ? emus.resolveForSystem(dataRoot(), s, catalog, sys.id) : { ready: false, reason: 'Elige tu carpeta de biblioteca' };
    if (out[sys.id].ready && sys.bios) {
      const b = checkBios(dataRoot(), sys, null);
      if (!b.ok) {
        out[sys.id].bios = b.problems.map((p) => (p.kind === 'falta' ? `Falta el BIOS ${p.file}` : `${p.file} incompleto`)).join(' · ');
        out[sys.id].biosHelp = biosMessage(sys, b.problems, dataRoot());
      }
    }
    if (out[sys.id].ready && out[sys.id].emu === 'eden') {
      try {
        const opts = emuPrepOpts(out[sys.id].exe);
        const es = edenStatus(opts);
        if (!es.ok) {
          out[sys.id].bios = switchError ? 'No se pudo preparar Switch' : es.short;
          out[sys.id].biosHelp = switchError || es.message;
          // Llaves y firmware en la carpeta bios: se instalan solos en segundo plano (una vez).
          if (es.canInstall && !switchError) ensureSwitchInstall(out[sys.id].exe);
        }
      } catch { /* se revisa al abrir el juego */ }
    }
    if (out[sys.id].ready && ['pcsx2', 'xemu', 'rpcs3'].includes(out[sys.id].emu)) {
      try {
        const prep = prepareEmulator(out[sys.id].emu, emuPrepOpts(out[sys.id].exe));
        const onlyHdd = prep.missing && prep.missing.length === 1 && prep.missing[0] === 'hdd';
        if (!prep.ok && prep.firmware) {
          // Se resuelve solo al abrir el primer juego: no es un problema que tengas que arreglar.
          out[sys.id].autoFix = 'El firmware de PS3 se baja de Sony y se instala solo al abrir tu primer juego.';
          out[sys.id].firmware = true;
          out[sys.id].firmwarePup = prep.pup || null;
        } else if (!prep.ok && onlyHdd) {
          out[sys.id].autoFix = 'El disco duro de Xbox se baja solo al abrir tu primer juego.';
        } else if (!prep.ok) {
          out[sys.id].bios = prep.short;
          out[sys.id].biosHelp = prep.message;
        }
      } catch { /* si no se puede revisar, se avisa al abrir el juego */ }
    }
  }
  return out;
}

// Instalacion de llaves y firmware de Switch en Eden (en segundo plano, una vez).
let switchInstall = null;
let switchError = null;
function ensureSwitchInstall(exe) {
  if (switchInstall) return switchInstall;
  switchInstall = installEdenFiles({ ...emuPrepOpts(exe), extract: (a, d) => emus.extractArchive(a, d) })
    .then((r) => {
      // Si no quedo listo, no se reintenta solo (se reintenta al bajar BIOS de la nube o al abrir un juego).
      if (!r.ok) switchError = r.message || 'No se pudieron instalar las llaves o el firmware de Switch. Revisa que los archivos de la carpeta BIOS estén completos.';
      return r;
    })
    .catch((e) => {
      switchError = `No se pudieron instalar las llaves o el firmware de Switch: ${e.message}`;
      return { ok: false, installed: [], error: switchError };
    })
    .then((r) => {
      switchInstall = null;
      send('status:update', {
        status: systemStatus(),
        message: r.installed && r.installed.length ? `Switch listo: se instalaron ${r.installed.join(' y ')} en Eden.` : null,
        error: r.ok ? null : switchError
      });
      return r;
    });
  return switchInstall;
}

function emuPrepOpts(exe) {
  const safe = (name) => { try { return app.getPath(name); } catch { return null; } };
  return { exe, dataRoot: dataRoot(), documentsDir: safe('documents'), appDataDir: safe('appData'), downloadsDir: safe('downloads') };
}

// ---------------- instalaciones compartidas (una sola a la vez por emulador, aunque la pidan varios)

const installs = new Map();
const installListeners = new Map();
function installOnce(id, onProgress) {
  if (onProgress) {
    const set = installListeners.get(id) || new Set();
    set.add(onProgress);
    installListeners.set(id, set);
  }
  if (installs.has(id)) return installs.get(id);
  if (TEST_OFFLINE) return Promise.reject(new Error('sin internet'));
  const p = emus.installEmulator(dataRoot(), catalog, id, (pr) => {
    send('emu:progress', pr);
    for (const fn of installListeners.get(id) || []) { try { fn(pr); } catch { /* nada */ } }
  }).then((r) => {
    if (id === 'dolphin') ensureDolphinProfiles(r.exe);
    return r;
  }).finally(() => {
    installs.delete(id);
    installListeners.delete(id);
    send('status:update', { status: systemStatus() });
  });
  installs.set(id, p);
  return p;
}

function installCore(core, onProgress) {
  const key = `core:${core}`;
  if (installs.has(key)) return installs.get(key);
  const exe = emus.locateEmulator(dataRoot(), settings.get(), catalog, 'retroarch');
  if (!exe) return installOnce('retroarch', onProgress);
  const tmp = path.join(dataRoot(), 'emulators', '_descargas');
  fs.mkdirSync(tmp, { recursive: true });
  const p = emus.installRetroArchCores(exe, [core], tmp, onProgress).then((failed) => {
    if (failed.length) throw new Error(`No se pudo bajar el núcleo ${core} de RetroArch.`);
    return true;
  }).finally(() => {
    installs.delete(key);
    send('status:update', { status: systemStatus() });
  });
  installs.set(key, p);
  return p;
}

let pupDownload = null;
function ps3PupOnce(onProgress) {
  if (!pupDownload) {
    pupDownload = downloadPs3Firmware(dataRoot(), { onProgress: (p) => { if (pupDownload && pupDownload.listener) pupDownload.listener(p); } })
      .finally(() => { pupDownload = null; });
  }
  pupDownload.listener = onProgress || null;
  return pupDownload;
}

let fwInstall = null;
// Firmware de PS3: se baja de Sony si hace falta, RPCS3 lo instala y se cierra solo.
async function ensurePs3Firmware(exe, onPhase = () => {}) {
  if (rpcs3FirmwareInstalled(exe)) return true;
  if (fwInstall) return fwInstall;
  fwInstall = (async () => {
    let found = findPs3Firmware(dataRoot(), [emuPrepOpts(exe).downloadsDir]);
    let pup = found && found.full;
    if (!pup) {
      onPhase('Bajando el firmware de PS3 de Sony (solo la primera vez)', 0);
      pup = await ps3PupOnce((p) => onPhase('Bajando el firmware de PS3 de Sony (solo la primera vez)', p.pct));
    }
    // Si venia de Descargas, queda una copia en la carpeta bios.
    const biosDir = path.join(dataRoot(), 'bios');
    if (path.resolve(path.dirname(pup)) !== path.resolve(biosDir)) {
      try {
        await fs.promises.mkdir(biosDir, { recursive: true });
        const copy = path.join(biosDir, 'PS3UPDAT.PUP');
        await fs.promises.copyFile(pup, copy);
        pup = copy;
      } catch { /* se instala desde donde esta */ }
    }
    onPhase('Instalando el firmware de PS3 (solo la primera vez, 1 a 3 minutos). RPCS3 se abre y se cierra solo.', null);
    const user32 = loadUser32();
    if (user32) user32.allowForeground();
    const r = await installPs3Firmware({ exe, pup, user32 });
    bringToFront();
    if (!r.installed) throw new Error('RPCS3 no terminó de instalar el firmware de PS3. Intenta de nuevo; si sigue fallando, abre RPCS3 en Menú > Emuladores > Abrir para configurar.');
    send('status:update', { status: systemStatus(), message: 'Firmware de PS3 instalado.' });
    return true;
  })().finally(() => { fwInstall = null; });
  return fwInstall;
}

// Control del jugador 1: el que usaste para abrir el juego; si no se sabe, el primero conectado.
function pickPad() {
  if (!pads) return null;
  try {
    const active = pads.activeDevice();
    if (active) return active;
    for (const i of pads.connected()) {
      const d = pads.deviceAt(i);
      if (d) return d;
    }
  } catch { /* sin XInput */ }
  return null;
}

function padsSummary() {
  if (!pads) return 'sin XInput';
  try {
    const list = pads.connected().map((i) => {
      const d = pads.deviceAt(i);
      return d ? `${i}=${d.vid.toString(16).padStart(4, '0')}:${d.pid.toString(16).padStart(4, '0')} v${d.ver}` : `${i}=sin identidad`;
    });
    return `controles XInput [${list.join(', ') || 'ninguno'}], ultimo usado ${pads.lastIndex == null ? 'ninguno' : pads.lastIndex}`;
  } catch (e) {
    return `error leyendo controles: ${e.message}`;
  }
}

// Registro de CanacaLabArcadia (logs\canacalab.log): que control y emulador se usaron en cada juego.
function appLog(line) {
  try {
    const file = path.join(dataRoot(), 'logs', 'canacalab.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`); } catch { /* nuevo */ }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* sin registro */ }
}

function edenStateFile() {
  return path.join(dataRoot(), 'config', 'eden-control.json');
}

function publicCatalog() {
  return {
    systems: catalog.systems,
    emulators: Object.fromEntries(Object.entries(catalog.emulators).map(([id, e]) => [id, { name: e.name, desc: e.desc }]))
  };
}

function rescan() {
  if (!dataRoot()) {
    library = {};
    return library;
  }
  library = scanLibrary(dataRoot(), settings.get(), catalog);
  return library;
}

function findGame(id) {
  for (const list of Object.values(library)) {
    const g = list.find((x) => x.id === id);
    if (g) return g;
  }
  return null;
}

function allowedMediaPath(p) {
  const root = dataRoot();
  if (!root || !p) return false;
  const abs = path.resolve(p).toLowerCase();
  const roots = [root];
  for (const sys of catalog.systems) roots.push(...romDirsFor(root, settings.get(), sys.id));
  return roots.some((r) => abs.startsWith(path.resolve(r).toLowerCase() + path.sep) || abs === path.resolve(r).toLowerCase());
}

function bringToFront() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  setTimeout(() => win && !win.isDestroyed() && win.setAlwaysOnTop(false), 400);
}

function createWindow() {
  const s = settings.get();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(900, height),
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#0A0B10',
    autoHideMenuBar: true,
    fullscreen: KIOSK || s.startFullscreen,
    kiosk: KIOSK,
    title: 'CanacaLabArcadia',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  // Al abrir, la ventana toma el foco (si no, Windows deja el teclado y el control en la ventana anterior).
  win.once('ready-to-show', () => {
    win.show();
    bringToFront();
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Bloquear navegacion fuera de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------------- sesiones de juego ----------------

session.on('started', ({ game, pid }) => {
  userData.markPlayed(game.id);
  send('game:started', { id: game.id, title: game.title });
  if (combo) combo.start();
  // Se espera la ventana del emulador y se le da el foco a ella; solo entonces se minimiza CanacaLabArcadia.
  handOffFocus({
    pid,
    isRunning: () => session.running,
    done: () => {
      if (!win || win.isDestroyed() || !session.running) return;
      win.setAlwaysOnTop(false);
      win.minimize();
    }
  });
});

session.on('ended', ({ game, seconds, code, forced }) => {
  if (combo) combo.stop();
  if (game) userData.addPlaytime(game.id, seconds);
  bringToFront();
  send('game:ended', { id: game && game.id, seconds: Math.round(seconds), code, forced, userData: userData.get() });
});

session.on('error', (e) => send('game:error', { message: e.message }));

// Lo que se esta preparando antes de abrir un juego (la interfaz lo muestra con su barra).
const cancelled = new Set();
function prepStep(gameId, phase, pct = null) {
  send('launch:prep', { id: gameId, phase, pct });
}
function checkCancel(gameId) {
  if (!cancelled.has(gameId)) return;
  cancelled.delete(gameId);
  const e = new Error('Cancelado');
  e.code = 'CANCELLED';
  throw e;
}

// Si los BIOS de tu Drive se estan bajando, se espera a que terminen.
async function waitBiosJobs(gameId) {
  const pending = () => {
    const q = cloud.snapshot();
    return [q.current, ...q.pending].filter((j) => j && j.system === 'bios');
  };
  const started = Date.now();
  let list = pending();
  while (list.length && Date.now() - started < 30 * 60 * 1000) {
    const cur = list[0];
    prepStep(gameId, `Bajando ${list.length === 1 ? 'un archivo' : `${list.length} archivos`} de tu carpeta BIOS de Google Drive`, cur.total ? Math.round((cur.bytes / cur.total) * 100) : null);
    await sleep(800);
    checkCancel(gameId);
    list = pending();
  }
}

async function ensureEmulatorFor(game, gameId) {
  let resolved = emus.resolveForSystem(dataRoot(), settings.get(), catalog, game.system);
  if (resolved.ready) return resolved;
  const need = autopilot.missingFor(game.system);
  if (need) {
    const name = catalog.emulators[need.emu].name;
    const label = need.core ? `Instalando el núcleo ${need.core} de RetroArch (solo la primera vez)` : `Instalando ${name} (solo la primera vez)`;
    prepStep(gameId, label, 0);
    try {
      if (need.core) await installCore(need.core, (p) => prepStep(gameId, label, p.pct));
      else await installOnce(need.emu, (p) => prepStep(gameId, label, p.pct));
    } catch (e) {
      const err = new Error(`No se pudo instalar ${name}: ${e.message}. Revisa tu internet e intenta de nuevo.`);
      err.code = 'NO_EMULATOR';
      throw err;
    }
    checkCancel(gameId);
    resolved = emus.resolveForSystem(dataRoot(), settings.get(), catalog, game.system);
  }
  if (!resolved.ready) {
    const err = new Error(resolved.reason);
    err.code = 'NO_EMULATOR';
    throw err;
  }
  return resolved;
}

async function launchGame(gameId) {
  const game = findGame(gameId);
  if (!game) throw new Error('No encontré ese juego. Actualiza la biblioteca.');
  if (session.running) throw new Error('Ya hay un juego abierto. Ciérralo con View + Menu.');
  cancelled.delete(gameId);
  const s = settings.get();
  const sys = catalog.byId[game.system];
  const resolved = await ensureEmulatorFor(game, gameId);
  appLog(`Abrir "${game.title}" (${game.system}) con ${resolved.label}; ${padsSummary()}`);

  await waitBiosJobs(gameId);
  const bios = checkBios(dataRoot(), sys, game.launch || game.path);
  if (!bios.ok) {
    const err = new Error(biosMessage(sys, bios.problems, dataRoot()));
    err.code = 'NO_BIOS';
    throw err;
  }
  const opts = emuPrepOpts(resolved.exe);
  if (resolved.emu === 'eden') {
    let es = edenStatus(opts);
    if (!es.ok && es.canInstall) {
      switchError = null;
      prepStep(gameId, 'Instalando llaves y firmware de Switch en Eden (solo la primera vez)');
      await ensureSwitchInstall(resolved.exe);
      es = edenStatus(opts);
    }
    if (!es.ok) {
      const err = new Error(switchError || es.message);
      err.code = 'NO_BIOS';
      throw err;
    }
    // Updates/DLC de la carpeta de Switch y el control del jugador 1, listos en Eden.
    try {
      const pad = pickPad();
      const r = prepareEdenConfig({ ...opts, pad, state: readJsonSafe(edenStateFile(), {}) });
      if (r.controls) writeJsonAtomic(edenStateFile(), r.controls);
      appLog(`Eden: ${r.info}`);
    } catch (e) { appLog(`Eden: no se pudo preparar la configuracion: ${e.message}`); }
  }
  if (resolved.emu === 'xemu') {
    const first = prepareEmulator('xemu', opts);
    if (!first.ok && (first.missing || []).includes('hdd')) {
      prepStep(gameId, 'Preparando el disco duro de Xbox (solo la primera vez)');
      try { await downloadXboxHdd(dataRoot(), { extract: emus.extractArchive }); } catch { /* se avisa abajo */ }
      checkCancel(gameId);
    }
  }
  if (resolved.emu === 'rpcs3') {
    const first = prepareEmulator('rpcs3', opts);
    if (!first.ok && first.firmware) {
      await ensurePs3Firmware(resolved.exe, (phase, pct) => prepStep(gameId, phase, pct));
      checkCancel(gameId);
    }
  }
  const prep = prepareEmulator(resolved.emu, opts);
  if (!prep.ok) {
    const err = new Error(prep.message);
    err.code = 'NO_BIOS';
    throw err;
  }
  checkCancel(gameId);
  // El control con el que abriste el juego es el jugador 1.
  const player1 = pads ? pads.activeIndex() : 0;
  const configDir = path.join(dataRoot(), 'config');
  // Controles: CanacaLabArcadia los deja listos en cada emulador antes de abrir el juego (nada que mapear).
  const safe = (fn) => { try { fn(); } catch { /* si no se puede escribir, el emulador usa lo suyo */ } };
  if (resolved.emu === 'retroarch') safe(() => ensureRetroArchProfiles(resolved.exe));
  if (resolved.emu === 'rpcs3') safe(() => ensureRpcs3Input(resolved.exe, player1));
  if (resolved.emu === 'retroarch') {
    retroarchAppendConfig(dataRoot(), {
      player1Device: pads ? pads.activeDevice() : null,
      joypadDriver: s.retroarchJoypadDriver || 'sdl3'
    });
  }
  if (resolved.emu === 'dolphin') {
    ensureDolphinProfiles(resolved.exe);
    setDolphinPlayer1(resolved.exe, player1);
  }
  const cmd = buildCommand({ catalog, settings: s, resolved, game, configDir });
  // El emulador podra tomar el foco al abrir su ventana (Windows lo bloquea si no se le permite).
  const user32 = loadUser32();
  if (user32) user32.allowForeground();
  session.start(cmd, game);
  return { emulator: resolved.label, exe: cmd.exe, args: cmd.args };
}

// Despues de bajar un juego de la nube: cual es en la biblioteca.
const playWatch = new Map();
function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
function inside(p, dir) {
  const a = path.resolve(p).toLowerCase();
  const d = path.resolve(dir).toLowerCase() + path.sep;
  return a.startsWith(d);
}
function findDownloadedGame(d) {
  const list = library[d.system] || [];
  const dest = destFor(dataRoot(), d.system);
  if (d.kind === 'dir' && d.path) {
    const dir = path.join(dest, d.path);
    const g = list.find((x) => samePath(x.path, dir) || inside(x.path, dir));
    if (g) return g;
  } else {
    const names = (d.files || []).map((f) => path.join(dest, path.basename(f)));
    const g = list.find((x) => names.some((n) => samePath(x.path, n)));
    if (g) return g;
  }
  // Un .zip/.7z que se descomprimio: el juego nuevo de esa consola.
  const before = playWatch.get(d.id);
  return before ? list.find((x) => !before.has(x.id)) || null : null;
}

function cloudGamesSafe() {
  try { return dataRoot() ? cloud.cloudGames() : {}; } catch { return {}; }
}

function cloudInfo() {
  if (!dataRoot()) return { connected: false, hasFolders: false, at: null };
  let cfg = { carpetas: [] };
  try { cfg = loadCloud(dataRoot()); } catch { /* sin nube */ }
  const index = cloud.loadIndex();
  return { connected: cloud.connected(), hasFolders: cfg.carpetas.length > 0, at: index && index.at };
}

// ---------------- IPC ----------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code || null };
    }
  });
}

function registerIpc() {
  handle('app:init', () => {
    if (dataRoot()) {
      ensureLibraryFolders(dataRoot(), catalog);
      retroarchAppendConfig(dataRoot());
      loadCloud(dataRoot());
    }
    rescan();
    if (dataRoot() && !autopilotStarted && !TEST_OFFLINE) {
      autopilotStarted = true;
      setTimeout(() => autopilot.run('inicio'), 2500);
    }
    return {
      version: app.getVersion(),
      platform: process.platform,
      kiosk: KIOSK,
      settings: settings.get(),
      catalog: publicCatalog(),
      library,
      status: systemStatus(),
      userData: userData.get(),
      comboAvailable: !!(combo && combo.available),
      cloudGames: cloudGamesSafe(),
      cloudInfo: cloudInfo(),
      auto: autopilot ? autopilot.state : null,
      suggestedRoot: process.platform === 'win32' ? 'C:\\CanacaLabArcadia' : path.join(app.getPath('home'), 'CanacaLabArcadia')
    };
  });

  handle('settings:update', (patch) => settings.update(patch || {}));

  handle('library:scan', () => ({ library: rescan(), status: systemStatus() }));

  handle('game:launch', (id) => launchGame(id));
  handle('game:cancelLaunch', (id) => { cancelled.add(id); return true; });
  handle('game:stop', () => session.stop());
  handle('game:favorite', (id) => ({ favorite: userData.toggleFavorite(id), userData: userData.get() }));
  handle('game:reveal', (id) => {
    const g = findGame(id);
    if (g) shell.showItemInFolder(g.path);
    return true;
  });

  handle('emu:status', () => (dataRoot() ? emus.emulatorStatus(dataRoot(), settings.get(), catalog) : {}));
  handle('emu:install', async (id) => {
    const r = await installOnce(id);
    return { ...r, status: systemStatus() };
  });
  handle('emu:locate', async (id) => {
    const def = catalog.emulators[id];
    const res = await dialog.showOpenDialog(win, {
      title: `Ubica ${def.name} (${def.exe[0]})`,
      properties: ['openFile'],
      filters: [{ name: 'Programa', extensions: ['exe'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const s = settings.get();
    settings.update({ emuPaths: { ...s.emuPaths, [id]: res.filePaths[0] } });
    if (id === 'dolphin') ensureDolphinProfiles(res.filePaths[0]);
    return { exe: res.filePaths[0], status: systemStatus() };
  });
  handle('emu:openGui', (id) => {
    const exe = emus.locateEmulator(dataRoot(), settings.get(), catalog, id);
    if (!exe) throw new Error('Primero instala o ubica el emulador');
    if (id === 'dolphin') ensureDolphinProfiles(exe);
    emus.openEmulatorGui(exe);
    return true;
  });
  handle('emu:homepage', (id) => shell.openExternal(catalog.emulators[id].homepage));
  handle('emu:setDefault', (systemId, key) => {
    const s = settings.get();
    return settings.update({ defaultEmu: { ...s.defaultEmu, [systemId]: key } });
  });

  handle('folder:open', (kind, systemId) => {
    const root = dataRoot();
    const target = {
      roms: path.join(root, 'roms', systemId || ''),
      bios: path.join(root, 'bios'),
      emulators: path.join(root, 'emulators', systemId || ''),
      covers: path.join(root, 'media', 'covers', systemId || ''),
      root
    }[kind] || root;
    fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });
  handle('folder:chooseRoot', async (suggested) => {
    let chosen = suggested;
    if (!chosen) {
      const res = await dialog.showOpenDialog(win, { title: 'Carpeta para tu biblioteca de CanacaLabArcadia', properties: ['openDirectory', 'createDirectory'] });
      if (res.canceled || !res.filePaths[0]) return null;
      chosen = res.filePaths[0];
    }
    fs.mkdirSync(chosen, { recursive: true });
    settings.update({ dataRoot: chosen, firstRunDone: true });
    ensureLibraryFolders(chosen, catalog);
    retroarchAppendConfig(chosen);
    loadCloud(chosen);
    // Favoritos y tiempo jugado viven dentro de la biblioteca (se van contigo si la mueves).
    userData = new UserData(path.join(chosen, 'config', 'userdata.json'));
    rescan();
    autopilotStarted = true;
    if (!TEST_OFFLINE) setTimeout(() => autopilot.run('biblioteca'), 500);
    return { settings: settings.get(), library, status: systemStatus(), userData: userData.get(), cloudGames: cloudGamesSafe(), cloudInfo: cloudInfo() };
  });
  handle('folder:addRomDir', async (systemId) => {
    const res = await dialog.showOpenDialog(win, { title: 'Carpeta extra de juegos', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const s = settings.get();
    const list = [...new Set([...(s.extraRomDirs[systemId] || []), res.filePaths[0]])];
    settings.update({ extraRomDirs: { ...s.extraRomDirs, [systemId]: list } });
    rescan();
    return { settings: settings.get(), library };
  });
  handle('folder:removeRomDir', (systemId, dir) => {
    const s = settings.get();
    const list = (s.extraRomDirs[systemId] || []).filter((d) => d !== dir);
    settings.update({ extraRomDirs: { ...s.extraRomDirs, [systemId]: list } });
    rescan();
    return { settings: settings.get(), library };
  });

  handle('import:plan', (paths) => buildImportPlan(paths || []));
  handle('import:pick', async (mode) => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Elige juegos o una carpeta completa',
      properties: mode === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    });
    if (res.canceled) return [];
    return buildImportPlan(res.filePaths);
  });
  handle('import:execute', async (items, move) => {
    const report = await executeImport(dataRoot(), items || [], { move: !!move, onProgress: (p) => send('import:progress', p) });
    rescan();
    return { report, library, status: systemStatus() };
  });

  // Bloquea o desbloquea internet a los emuladores (Firewall de Windows). Pide permiso de administrador.
  handle('emu:firewall', (block) => new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Solo disponible en Windows'));
    const root = dataRoot();
    const ps1 = path.join(root, 'config', 'canacalab-arcadia-firewall.ps1');
    fs.copyFileSync(path.join(__dirname, '..', '..', 'config', 'canacalab-arcadia-firewall.ps1'), ps1);
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${ps1}"`, '-Biblioteca', `"${root}"`];
    if (!block) args.push('-Quitar');
    const cmd = `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList ${args.map(q).join(',')}; exit $p.ExitCode`;
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true }, (err) => {
      if (err) return reject(new Error('No se aplicó el cambio (se canceló el permiso de administrador o falló el firewall).'));
      settings.update({ emulatorsOffline: !!block });
      resolve(settings.get());
    });
  }));

  // Portadas: todas las que falten (en la Ally y en tu Drive), con las fuentes que tengas configuradas.
  handle('covers:fetch', async () => {
    const items = autopilot.coverTargets({ ignoreMisses: true });
    const r = await fetchSmartCovers(dataRoot(), items, { onProgress: (p) => send('covers:progress', p) });
    autopilot.rememberMisses(r.misses);
    rescan();
    return { ...r, library, cloudGames: cloudGamesSafe() };
  });
  handle('covers:config', () => publicScraperConfig(loadScraperConfig(dataRoot())));
  // Solo estas dos paginas (para sacar tus llaves): la consola de desarrolladores de Twitch y ScreenScraper.
  handle('covers:openSite', (which) => {
    const url = { twitch: 'https://dev.twitch.tv/console', screenscraper: 'https://www.screenscraper.fr/', screenscraperForo: 'https://www.screenscraper.fr/forumsujets.php?frub=12&numpage=0' }[which];
    if (url) shell.openExternal(url);
    return !!url;
  });
  handle('covers:saveConfig', async (patch) => {
    needRoot();
    const cfg = saveScraperConfig(dataRoot(), patch || {});
    const test = await testScraperConfig(cfg);
    // Con fuentes nuevas, se buscan otra vez las portadas que faltaban (en segundo plano).
    if (!TEST_OFFLINE) autopilot.run('portadas');
    return { config: publicScraperConfig(cfg), test };
  });

  // ---------------- nube (Google Drive) ----------------
  const needRoot = () => {
    if (!dataRoot()) throw new Error('Primero elige tu carpeta de biblioteca');
  };
  const cloudStatus = async () => ({ ...(await cloud.status()), queue: cloud.snapshot() });
  handle('cloud:status', async () => { needRoot(); return cloudStatus(); });
  handle('cloud:connect', async () => {
    needRoot();
    if (!emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rclone')) {
      await emus.installEmulator(dataRoot(), catalog, 'rclone', (p) => send('cloud:setup', { phase: p.phase, pct: p.pct }));
    }
    send('cloud:setup', { phase: 'Abriendo el navegador para iniciar sesion con Google...', pct: null });
    // CanacaLabArcadia va en pantalla completa: se minimiza para que el navegador quede a la vista
    // y vuelve al frente en cuanto termina el inicio de sesion (bien, mal o cancelado).
    let hidden = false;
    try {
      await cloud.connectAccount({
        onLink: (url) => {
          send('cloud:authLink', { url });
          if (!hidden && win && !win.isDestroyed()) { hidden = true; setTimeout(() => win && !win.isDestroyed() && win.minimize(), 1200); }
        }
      });
    } finally {
      if (hidden) bringToFront();
    }
    // Con la cuenta conectada: lista de juegos de tu Drive, BIOS y lo que falte, sin que lo pidas.
    if (!TEST_OFFLINE) autopilot.run('cuenta');
    return cloudStatus();
  });
  handle('cloud:cancelConnect', () => cloud.cancelConnect());
  handle('cloud:removeAccount', async (remote) => { await cloud.removeAccount(remote); return cloudStatus(); });
  handle('cloud:saveSource', async (src) => { cloud.saveSource(src || {}); return cloudStatus(); });
  handle('cloud:removeSource', async (id) => { cloud.removeSource(id); return cloudStatus(); });
  handle('cloud:setMapping', async (name, systemId) => { cloud.setMapping(name, systemId); return cloudStatus(); });
  handle('cloud:folders', (sourceId) => cloud.folders(sourceId));
  handle('cloud:items', (sourceId, folder, systemId, refresh) => cloud.items(sourceId, folder, systemId, { refresh: !!refresh }));
  handle('cloud:download', (sourceId, folder, systemId, units) => cloud.enqueue((units || []).map((u) => ({
    id: u.id, sourceId, folder, system: systemId, name: u.name, kind: u.kind, path: u.path, files: u.files, size: u.size
  }))));
  handle('cloud:cancel', (id) => cloud.cancel(id));
  handle('cloud:games', () => ({ games: cloudGamesSafe(), info: cloudInfo() }));
  handle('cloud:refresh', async () => {
    needRoot();
    await cloud.buildIndex();
    const jobs = cloud.backgroundJobs();
    if (jobs.length) cloud.enqueue(jobs);
    return { games: cloudGamesSafe(), info: cloudInfo() };
  });
  // A sobre un juego que esta en tu Drive: se baja primero y se abre al terminar.
  handle('cloud:play', async (id) => {
    needRoot();
    if (!emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rclone')) await installOnce('rclone');
    const r = cloud.playJob(id);
    if (!playWatch.has(r.id)) playWatch.set(r.id, new Set((library[r.system] || []).map((g) => g.id)));
    return { id: r.id, name: r.name, system: r.system, size: r.size };
  });
  handle('cloud:openLink', (url) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url) || /^https:\/\/drive\.google\.com\//.test(url)) shell.openExternal(url);
    return true;
  });
  handle('cloud:openConfig', () => { needRoot(); loadCloud(dataRoot()); return shell.openPath(cloudPath(dataRoot())); });

  // Firmware de PS3: RPCS3 lo instala con --installfw (se abre, lo instala y la cierras).
  handle('emu:firmwarePage', () => shell.openExternal(SONY_PS3_FIRMWARE_PAGE));
  handle('emu:installFirmware', async () => {
    const exe = emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rpcs3') || (await installOnce('rpcs3')).exe;
    await ensurePs3Firmware(exe, (phase, pct) => prepStep(null, phase, pct));
    return { installed: rpcs3FirmwareInstalled(exe), status: systemStatus() };
  });
  // La interfaz lo pide cuando presionas el control y la ventana no tiene el foco.
  handle('app:focus', () => {
    if (!win || win.isDestroyed() || win.isMinimized() || session.running) return false;
    bringToFront();
    return true;
  });
  handle('app:quit', () => app.quit());
  handle('app:fullscreen', () => {
    if (win) win.setFullScreen(!win.isFullScreen());
    return win ? win.isFullScreen() : false;
  });
}

// ---------------- arranque ----------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => bringToFront());

  app.whenReady().then(() => {
    catalog = loadCatalog();
    settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    if (dataArg) settings.update({ dataRoot: dataArg.slice('--data='.length) });
    // Primera vez: la biblioteca va en C:\CanacaLabArcadia sin preguntar (se cambia en Menú > Biblioteca).
    if (!settings.get().dataRoot) {
      for (const candidate of defaultRoots()) {
        try {
          fs.mkdirSync(candidate, { recursive: true });
          settings.update({ dataRoot: candidate, firstRunDone: true });
          break;
        } catch { /* siguiente opcion */ }
      }
    }
    const root = settings.get().dataRoot;
    userData = new UserData(path.join(root || app.getPath('userData'), root ? 'config' : '', 'userdata.json'));

    cloud = new CloudService({
      getDataRoot: () => dataRoot(),
      getCatalog: () => catalog,
      getRcloneExe: () => (dataRoot() ? emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rclone') : null),
      extract: (archive, dest) => emus.extractArchive(archive, dest)
    });
    cloud.on('queue', (q) => send('cloud:queue', q));
    cloud.on('progress', (p) => send('cloud:progress', p));
    cloud.on('done', (d) => {
      rescan();
      if (d.ok && d.system === 'bios') switchError = null;
      const played = d.ok && d.play ? findDownloadedGame(d) : null;
      playWatch.delete(d.id);
      const { files, ...rest } = d;
      send('cloud:done', { ...rest, library, status: systemStatus(), cloudGames: cloudGamesSafe(), playGameId: played ? played.id : null });
    });

    autopilot = new Autopilot({
      getDataRoot: () => dataRoot(),
      getCatalog: () => catalog,
      getLibrary: () => library,
      cloud,
      resolve: (sysId) => emus.resolveForSystem(dataRoot(), settings.get(), catalog, sysId),
      hasRclone: () => !!emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rclone'),
      install: (id, onProgress) => installOnce(id, onProgress),
      installCore: (core, onProgress) => installCore(core, onProgress),
      isPlaying: () => session.running,
      needsXboxHdd: () => !findXboxFiles(dataRoot()).hdd,
      downloadXboxHdd: () => downloadXboxHdd(dataRoot(), { extract: emus.extractArchive }),
      needsPs3Pup: () => {
        const exe = emus.locateEmulator(dataRoot(), settings.get(), catalog, 'rpcs3');
        if (exe && rpcs3FirmwareInstalled(exe)) return false;
        return !findPs3Firmware(dataRoot(), [emuPrepOpts(exe || '').downloadsDir]);
      },
      downloadPs3Pup: (onProgress) => ps3PupOnce(onProgress),
      fetchCovers: (items, onProgress) => fetchSmartCovers(dataRoot(), items, { onProgress }),
      coverSources: () => sourcesOf(loadScraperConfig(dataRoot())),
      log: (m) => { try { console.log(m); } catch { /* sin consola */ } }
    });
    autopilot.on('status', (st) => send('auto:status', st));
    autopilot.on('index', () => send('cloud:games', { games: cloudGamesSafe(), info: cloudInfo() }));
    autopilot.on('installed', () => send('status:update', { status: systemStatus() }));
    autopilot.on('covers', () => {
      rescan();
      send('library:update', { library, status: systemStatus(), cloudGames: cloudGamesSafe() });
    });

    combo = new ComboWatcher({ holdMs: settings.get().exitHoldMs });
    pads = new PadTracker();
    pads.start();
    combo.on('combo', () => session.stop());

    protocol.handle('arcadia-media', (req) => {
      const u = new URL(req.url);
      const p = u.searchParams.get('p');
      if (!allowedMediaPath(p) || !fs.existsSync(p)) return new Response('no', { status: 404 });
      return net.fetch(pathToFileURL(p).toString());
    });

    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (session.running) session.stop();
    if (cloud) { cloud.cancel(); cloud.cancelConnect(); }
    if (pads) pads.stop();
    app.quit();
  });
}
