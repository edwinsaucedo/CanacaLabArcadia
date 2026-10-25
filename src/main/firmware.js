'use strict';
// Archivos gratuitos que CanacaLabArcadia baja e instala sola:
//  - Firmware de PS3 (PS3UPDAT.PUP) desde los servidores oficiales de Sony, e instalacion en RPCS3 sin clics.
//  - Disco duro de Xbox para xemu (xbox_hdd.qcow2), la imagen en blanco que publica el proyecto xemu.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { downloadFile, extractArchive } = require('./emulators');
const { rpcs3FirmwareInstalled, findXboxFiles, getValue, setValue } = require('./emusetup');

const MB = 1024 * 1024;

// ---------------------------------------------------------------- PS3

// Lista oficial de Sony con el enlace al firmware mas reciente (la misma que consulta una PS3 al actualizarse).
const PS3_UPDATE_LISTS = [
  'http://fus01.ps3.update.playstation.net/update/ps3/list/us/ps3-updatelist.txt',
  'http://feu01.ps3.update.playstation.net/update/ps3/list/eu/ps3-updatelist.txt',
  'http://fjp01.ps3.update.playstation.net/update/ps3/list/jp/ps3-updatelist.txt'
];
// Si la lista no responde: firmware 4.91 en el servidor de Sony.
const PS3_PUP_FALLBACK = 'http://dus01.ps3.update.playstation.net/update/ps3/image/us/2024_0227_3694eb3fb8d9915c112e6ab41a60c69f/PS3UPDAT.PUP';

function pupUrlFromList(text) {
  const m = String(text || '').match(/CDN=(https?:\/\/[^;\s]+?PS3UPDAT\.PUP)/i);
  return m ? m[1] : null;
}

function isPup(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(5);
    fs.readSync(fd, b, 0, 5, 0);
    fs.closeSync(fd);
    return b.toString('ascii') === 'SCEUF' && fs.statSync(file).size > 100 * MB;
  } catch {
    return false;
  }
}

async function ps3PupUrl(fetchImpl = fetch, lists = PS3_UPDATE_LISTS) {
  for (const url of lists) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'PS3Update-agent/1.0.0 libhttp/1.0.0' } });
      if (!r.ok) continue;
      const hit = pupUrlFromList(await r.text());
      if (hit) return hit;
    } catch { /* siguiente region */ }
  }
  return PS3_PUP_FALLBACK;
}

// Baja PS3UPDAT.PUP a <biblioteca>\bios. Devuelve la ruta.
async function downloadPs3Firmware(dataRoot, { onProgress, fetchImpl = fetch, lists } = {}) {
  const dest = path.join(dataRoot, 'bios', 'PS3UPDAT.PUP');
  if (isPup(dest)) return dest;
  const url = await ps3PupUrl(fetchImpl, lists);
  const tmp = path.join(dataRoot, 'bios', 'PS3UPDAT.PUP.descarga');
  await downloadFile(url, tmp, onProgress, fetchImpl);
  if (!isPup(tmp)) {
    try { fs.unlinkSync(tmp); } catch { /* nada */ }
    throw new Error('Lo que bajó de Sony no es un firmware de PS3 válido.');
  }
  fs.renameSync(tmp, dest);
  return dest;
}

// RPCS3 sin ventanas de bienvenida ni de "instalado con exito" (para que la instalacion no espere un clic).
function prepareRpcs3Gui(exe) {
  const file = path.join(path.dirname(exe), 'GuiConfigs', 'CurrentSettings.ini');
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* primera vez */ }
  let text = before;
  for (const key of ['infoBoxEnabledWelcome', 'infoBoxEnabledInstallPUP']) {
    if (getValue(text, 'main_window', key) !== 'false') text = setValue(text, 'main_window', key, 'false').replace(`${key} = false`, `${key}=false`);
  }
  if (text !== before) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return file;
}

function dirSize(dir, depth = 0) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 8) total += dirSize(p, depth + 1); } else {
      try { total += fs.statSync(p).size; } catch { /* nada */ }
    }
  }
  return total;
}

// RPCS3 reciente escribe su log en log\RPCS3.log; versiones viejas, junto al .exe.
function rpcs3Logs(exe) {
  return [path.join(path.dirname(exe), 'log', 'RPCS3.log'), path.join(path.dirname(exe), 'RPCS3.log')];
}

function logSaysDone(exe) {
  for (const file of rpcs3Logs(exe)) {
    try {
      const log = fs.readFileSync(file, 'utf8');
      if (/Successfully installed PS3 firmware/i.test(log.slice(-200000))) return true;
    } catch { /* no existe */ }
  }
  return false;
}

// Abre RPCS3 con --installfw, espera a que termine y lo cierra solo.
// Listo = el log dice que se instalo, o los archivos del firmware existen y ya no cambian.
function installPs3Firmware({ exe, pup, user32 = null, onStart, pollMs = 1000, stableTicks = 6, timeoutMs = 15 * 60 * 1000, closeWaitMs = 12000 }) {
  prepareRpcs3Gui(exe);
  // Un log viejo no debe confundirse con esta instalacion.
  for (const file of rpcs3Logs(exe)) {
    try { fs.renameSync(file, file.replace(/RPCS3\.log$/, 'RPCS3.old.log')); } catch { /* no habia */ }
  }
  return new Promise((resolve) => {
    let running = true;
    let closing = false;
    const p = spawn(exe, ['--installfw', pup], { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: false });
    if (onStart) onStart(p);
    const devFlash = path.join(path.dirname(exe), 'dev_flash');
    const version = path.join(devFlash, 'vsh', 'etc', 'version.txt');
    let lastSize = -1;
    let stable = 0;
    const started = Date.now();
    const finish = () => resolve({ installed: rpcs3FirmwareInstalled(exe) });
    p.on('error', () => { running = false; clearInterval(timer); finish(); });
    p.on('exit', () => { running = false; clearInterval(timer); finish(); });
    const close = () => {
      if (closing) return;
      closing = true;
      const ask = () => { if (running && user32) user32.closeWindows(p.pid); };
      ask();
      const again = setInterval(ask, 2000);
      setTimeout(() => {
        clearInterval(again);
        if (running) { try { p.kill(); } catch { /* ya cerro */ } }
      }, closeWaitMs);
    };
    const timer = setInterval(() => {
      if (!running || closing) return;
      if (Date.now() - started > timeoutMs) return close();
      if (logSaysDone(exe)) return close();
      if (rpcs3FirmwareInstalled(exe) && fs.existsSync(version)) {
        const size = dirSize(devFlash);
        stable = size === lastSize ? stable + 1 : 0;
        lastSize = size;
        if (stable >= stableTicks) close();
      }
    }, pollMs);
  });
}

// ---------------------------------------------------------------- Xbox

const XBOX_HDD_URL = 'https://github.com/xemu-project/xemu-hdd-image/releases/download/1.0/xbox_hdd.qcow2.zip';

async function downloadXboxHdd(dataRoot, { fetchImpl = fetch, extract = extractArchive, url = XBOX_HDD_URL } = {}) {
  const have = findXboxFiles(dataRoot).hdd;
  if (have) return have.full;
  const dir = path.join(dataRoot, 'bios', 'xbox');
  const zip = path.join(dataRoot, 'bios', 'xbox_hdd.qcow2.zip');
  await downloadFile(url, zip, null, fetchImpl);
  try {
    await extract(zip, dir);
  } finally {
    try { fs.unlinkSync(zip); } catch { /* nada */ }
  }
  const got = findXboxFiles(dataRoot).hdd;
  if (!got) throw new Error('No se pudo preparar el disco duro de Xbox.');
  return got.full;
}

module.exports = {
  PS3_UPDATE_LISTS, PS3_PUP_FALLBACK, XBOX_HDD_URL,
  pupUrlFromList, ps3PupUrl, isPup, downloadPs3Firmware, prepareRpcs3Gui, installPs3Firmware, downloadXboxHdd
};
