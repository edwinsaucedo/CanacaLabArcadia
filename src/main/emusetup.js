'use strict';
// Deja listos PCSX2 (PS2) y xemu (Xbox) con los archivos que pongas en la carpeta bios de tu biblioteca:
//  - PCSX2: carpeta y archivo del BIOS, sin asistente inicial y con el control de la Ally X en el Puerto 1.
//  - xemu: MCPX boot ROM, BIOS (flash), disco duro y pantalla completa al iniciar.
// Lo que ya hayas configurado a mano (otro BIOS, otros botones) se respeta.
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- INI / TOML sencillos

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function sectionRange(lines, section) {
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.+\]\s*$/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function keyRe(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
}

function getValue(text, section, key) {
  const lines = text.split(/\r?\n/);
  const r = sectionRange(lines, section);
  if (!r) return null;
  for (let i = r.start + 1; i < r.end; i++) {
    if (keyRe(key).test(lines[i])) return lines[i].slice(lines[i].indexOf('=') + 1).trim();
  }
  return null;
}

// Cambia (o agrega) "key = value" dentro de [section], sin tocar el resto del archivo.
function setValue(text, section, key, value) {
  const eol = eolOf(text);
  const lines = text.length ? text.split(/\r?\n/) : [];
  const line = `${key} = ${value}`;
  let r = sectionRange(lines, section);
  if (!r) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`[${section}]`, line, '');
    return lines.join(eol);
  }
  for (let i = r.start + 1; i < r.end; i++) {
    if (keyRe(key).test(lines[i])) {
      lines[i] = line;
      return lines.join(eol);
    }
  }
  let at = r.end;
  while (at - 1 > r.start && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  return lines.join(eol);
}

// Reemplaza todas las lineas "key = ..." de [section] por una linea por valor.
function setValues(text, section, key, values) {
  const eol = eolOf(text);
  let out = setValue(text, section, key, values[0]);
  if (values.length === 1) return out;
  const lines = out.split(/\r?\n/);
  const r = sectionRange(lines, section);
  const idx = [];
  for (let i = r.start + 1; i < r.end; i++) if (keyRe(key).test(lines[i])) idx.push(i);
  for (const i of idx.slice(1).reverse()) lines.splice(i, 1);
  lines.splice(idx[0] + 1, 0, ...values.slice(1).map((v) => `${key} = ${v}`));
  return lines.join(eol);
}

function writeIfChanged(file, before, after) {
  if (before === after) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after, 'utf8');
  return true;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function filesIn(dirs) {
  const out = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(dir, e.name);
      out.push({ full, name: e.name, size: fs.statSync(full).size });
    }
  }
  return out;
}

// ---------------------------------------------------------------- PS2 / PCSX2

const MB = 1024 * 1024;

// Lee la version y la region del BIOS igual que PCSX2: busca la entrada RESET del ROMDIR y luego ROMVER.
function ps2BiosInfo(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    if (st.size < 4 * MB || st.size > 8 * MB) return null;
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  const name = (at) => {
    const raw = buf.subarray(at, at + 10);
    const z = raw.indexOf(0);
    return raw.toString('latin1', 0, z < 0 ? 10 : z);
  };
  let i = 0;
  const limit = Math.min(buf.length - 16, 512 * 1024 * 16);
  while (i <= limit && name(i) !== 'RESET') i += 16;
  if (i > limit) return null;
  let offset = 0;
  let romver = null;
  while (i + 16 <= buf.length) {
    const n = name(i);
    if (!n) break;
    if (n === 'ROMVER') romver = buf.toString('latin1', offset, offset + 14);
    const size = buf.readUInt32LE(i + 12);
    offset += size % 0x10 === 0 ? size : (size + 0x10) & ~0xf;
    i += 16;
  }
  if (!romver || !/^\d{4}[A-Z]/.test(romver)) return null;
  const zone = { J: 'Japón', A: 'EE.UU.', E: 'Europa', H: 'Asia', C: 'China', O: 'Oceanía', R: 'Rusia', M: 'México' }[romver[4]] || romver[4];
  return { version: `${romver.slice(0, 2)}.${romver.slice(2, 4)}`, region: romver[4], zone };
}

// BIOS de PS2 en la carpeta bios. Se prefiere el de EE.UU. (tus juegos son USA) y luego la version mas nueva.
function findPs2Bios(dataRoot) {
  const found = filesIn([path.join(dataRoot, 'bios'), path.join(dataRoot, 'bios', 'ps2')])
    .map((f) => ({ ...f, info: ps2BiosInfo(f.full) }))
    .filter((f) => f.info);
  found.sort((a, b) => (b.info.region === 'A') - (a.info.region === 'A') || b.info.version.localeCompare(a.info.version));
  return found[0] || null;
}

// Botones del Puerto 1 de PCSX2 (nombres de SDL3 que usa PCSX2 2.x).
const SDL_PAD = {
  Up: 'DPadUp', Right: 'DPadRight', Down: 'DPadDown', Left: 'DPadLeft',
  Triangle: 'FaceNorth', Circle: 'FaceEast', Cross: 'FaceSouth', Square: 'FaceWest',
  Select: 'Back', Start: 'Start',
  L1: 'LeftShoulder', L2: '+LeftTrigger', R1: 'RightShoulder', R2: '+RightTrigger',
  L3: 'LeftStick', R3: 'RightStick',
  LUp: '-LeftY', LRight: '+LeftX', LDown: '+LeftY', LLeft: '-LeftX',
  RUp: '-RightY', RRight: '+RightX', RDown: '+RightY', RLeft: '-RightX',
  LargeMotor: 'LargeMotor', SmallMotor: 'SmallMotor'
};
// El control integrado de la Ally X y uno externo (Xbox) manejan los dos al jugador 1.
const PAD_DEVICES = ['SDL-0', 'SDL-1'];

function pcsx2IniPath(exe, documentsDir) {
  const dir = path.dirname(exe);
  const portable = ['portable.ini', 'portable.txt'].some((f) => fs.existsSync(path.join(dir, f)));
  return portable ? path.join(dir, 'inis', 'PCSX2.ini') : path.join(documentsDir || dir, 'PCSX2', 'inis', 'PCSX2.ini');
}

// { ok, changed, bios, file, message? }
function preparePcsx2({ exe, dataRoot, documentsDir }) {
  const file = pcsx2IniPath(exe, documentsDir);
  const before = readText(file);
  // Sin SettingsVersion, PCSX2 borra el archivo y vuelve a abrir el asistente.
  let ini = before || ['[UI]', 'SettingsVersion = 1', ''].join('\r\n');

  // BIOS: si ya elegiste uno a mano y existe, se queda ese.
  const dataDir = path.dirname(exe);
  const folder = getValue(ini, 'Folders', 'Bios') || 'bios';
  const folderAbs = path.isAbsolute(folder) ? folder : path.join(dataDir, folder);
  const chosen = getValue(ini, 'Filenames', 'BIOS');
  let bios = chosen ? path.join(folderAbs, chosen) : null;
  if (!bios || !ps2BiosInfo(bios)) {
    const found = findPs2Bios(dataRoot);
    if (!found) {
      return {
        ok: false,
        file,
        message: `Falta el BIOS de PS2. Sube el archivo .bin de tu PS2 (pesa 4 MB, por ejemplo SCPH-70012) a la carpeta BIOS de tu Google Drive y descárgalo en Menú > Nube, o cópialo en ${path.join(dataRoot, 'bios')}.`
      };
    }
    ini = setValue(ini, 'Folders', 'Bios', path.dirname(found.full));
    ini = setValue(ini, 'Filenames', 'BIOS', found.name);
    bios = found.full;
  }

  ini = setValue(ini, 'UI', 'SetupWizardIncomplete', 'false');
  ini = setValue(ini, 'UI', 'ConfirmShutdown', 'false');
  ini = setValue(ini, 'InputSources', 'SDL', 'true');

  // Control: solo si el Puerto 1 sigue con el teclado de fabrica (o vacio). Si ya lo asignaste, no se toca.
  const binds = Object.keys(SDL_PAD).map((k) => getValue(ini, 'Pad1', k)).filter(Boolean);
  const untouched = !binds.length || binds.every((b) => /^Keyboard\//.test(b));
  if (untouched) {
    if (!getValue(ini, 'Pad1', 'Type')) ini = setValue(ini, 'Pad1', 'Type', 'DualShock2');
    for (const [k, v] of Object.entries(SDL_PAD)) {
      // Se conserva la tecla de fabrica: control integrado, control externo y teclado sirven a la vez.
      const kb = getValue(ini, 'Pad1', k);
      ini = setValues(ini, 'Pad1', k, [...PAD_DEVICES.map((d) => `${d}/${v}`), ...(kb && /^Keyboard\//.test(kb) ? [kb] : [])]);
    }
  }

  const changed = writeIfChanged(file, before, ini);
  return { ok: true, changed, bios, file };
}

// ---------------------------------------------------------------- Xbox / xemu

const XBOX_PARTS = {
  bootrom: 'MCPX boot ROM (mcpx_1.0.bin, 512 bytes)',
  flashrom: 'BIOS de Xbox (por ejemplo Complex_4627.bin, 1 MB)',
  hdd: 'disco duro (xbox_hdd.qcow2)'
};

function findXboxFiles(dataRoot) {
  const files = filesIn(['', 'xbox', 'xemu'].map((d) => path.join(dataRoot, 'bios', d)));
  const pick = (list, prefer) => list.sort((a, b) => prefer.test(b.name) - prefer.test(a.name))[0] || null;
  const bootrom = pick(files.filter((f) => f.size === 512 && /\.bin$/i.test(f.name)), /mcpx/i);
  // BIOS de Xbox: primero Complex 4627 (el recomendado para xemu), luego los de consola normal (retail).
  // Los "debug" son de kits de desarrollo y fallan con juegos normales: solo si no hay otro.
  const flashScore = (n) => (/debug/i.test(n) ? 0
    : /complex.*4627/i.test(n) ? 3
      : /4627|5838|5933|5713|5530|5101|4817|4034|3944/.test(n) ? 2
        : /xbox|bios/i.test(n) ? 1 : 0.5);
  const flashrom = files
    .filter((f) => (f.size === MB || f.size === 256 * 1024) && /\.(bin|rom)$/i.test(f.name) && !/firmware|dsi_|bios[79]|gba|gbc?_bios|scph/i.test(f.name))
    .sort((a, b) => flashScore(b.name) - flashScore(a.name) || (b.size - a.size) || a.name.localeCompare(b.name))[0] || null;
  const hdd = files.find((f) => /\.qcow2$/i.test(f.name)) || null;
  const eeprom = files.find((f) => /^eeprom.*\.bin$/i.test(f.name) && f.size === 256) || null;
  return { bootrom, flashrom, hdd, eeprom };
}

function xemuTomlPath(exe, appDataDir) {
  const local = path.join(path.dirname(exe), 'xemu.toml');
  if (fs.existsSync(local) || !appDataDir) return local;
  return path.join(appDataDir, 'xemu', 'xemu', 'xemu.toml');
}

const tomlString = (p) => (p.includes("'") ? JSON.stringify(p) : `'${p}'`);
const tomlPath = (v) => (v ? v.replace(/^['"]|['"]$/g, '').replace(/\\\\/g, '\\') : '');

// { ok, changed, file, missing?: [...], message? }
function prepareXemu({ exe, dataRoot, appDataDir }) {
  const file = xemuTomlPath(exe, appDataDir);
  const before = readText(file);
  let toml = before;
  const found = findXboxFiles(dataRoot);
  const missing = [];
  for (const part of ['bootrom', 'flashrom', 'hdd']) {
    const current = tomlPath(getValue(toml, 'sys.files', `${part}_path`));
    if (current && fs.existsSync(current)) continue;
    if (!found[part]) {
      missing.push(part);
      continue;
    }
    toml = setValue(toml, 'sys.files', `${part}_path`, tomlString(found[part].full));
  }
  if (missing.length) {
    return {
      ok: false,
      file,
      missing,
      message: `Faltan archivos de Xbox: ${missing.map((m) => XBOX_PARTS[m]).join(', ')}. Súbelos a la carpeta BIOS de tu Google Drive y descárgalos en Menú > Nube, o cópialos en ${path.join(dataRoot, 'bios')}.`
    };
  }
  const eeprom = tomlPath(getValue(toml, 'sys.files', 'eeprom_path'));
  if (found.eeprom && !(eeprom && fs.existsSync(eeprom))) toml = setValue(toml, 'sys.files', 'eeprom_path', tomlString(found.eeprom.full));
  toml = setValue(toml, 'general', 'show_welcome', 'false');
  toml = setValue(toml, 'display.window', 'fullscreen_on_startup', 'true');
  const changed = writeIfChanged(file, before, toml);
  return { ok: true, changed, file };
}

// ---------------------------------------------------------------- PS3 / RPCS3

const SONY_PS3_FIRMWARE_PAGE = 'https://www.playstation.com/es-mx/support/hardware/ps3/system-software/';

function rpcs3FirmwareInstalled(exe) {
  return fs.existsSync(path.join(path.dirname(exe), 'dev_flash', 'vsh', 'module', 'vsh.self'));
}

// PS3UPDAT.PUP en la carpeta bios (bajado de tu Drive) o en Descargas (bajado de la pagina de Sony).
function findPs3Firmware(dataRoot, extraDirs = []) {
  const dirs = [path.join(dataRoot, 'bios'), path.join(dataRoot, 'bios', 'ps3'), ...extraDirs.filter(Boolean)];
  const found = filesIn(dirs).filter((f) => /^ps3updat.*\.pup$/i.test(f.name) && f.size > 10 * MB);
  found.sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);
  return found[0] || null;
}

// { ok, firmware: true, pup, message }
function prepareRpcs3({ exe, dataRoot, downloadsDir }) {
  if (rpcs3FirmwareInstalled(exe)) return { ok: true };
  const pup = findPs3Firmware(dataRoot, [downloadsDir]);
  return {
    ok: false,
    firmware: true,
    pup: pup ? pup.full : null,
    message: pup
      ? `Falta instalar el firmware de PS3. Ya tienes ${pup.name} en ${path.dirname(pup.full)}: toca "Instalar firmware" y RPCS3 lo instala solo (cuando diga que terminó, ciérralo).`
      : 'Falta el firmware de PS3 (PS3UPDAT.PUP). Es gratis: toca "Página de Sony", descárgalo (se queda en Descargas) o súbelo a la carpeta BIOS de tu Google Drive, y luego toca "Instalar firmware".'
  };
}

// Para el estado de cada consola y antes de abrir un juego.
function prepareEmulator(emu, opts) {
  if (emu === 'pcsx2') return { short: 'Falta el BIOS de PS2', ...preparePcsx2(opts) };
  if (emu === 'xemu') return { short: 'Faltan archivos de Xbox', ...prepareXemu(opts) };
  if (emu === 'rpcs3') return { short: 'Falta el firmware de PS3', ...prepareRpcs3(opts) };
  return { ok: true };
}

module.exports = {
  prepareEmulator, preparePcsx2, prepareXemu, prepareRpcs3, rpcs3FirmwareInstalled, findPs3Firmware, SONY_PS3_FIRMWARE_PAGE, ps2BiosInfo, findPs2Bios, findXboxFiles,
  pcsx2IniPath, xemuTomlPath, getValue, setValue, setValues, SDL_PAD
};
