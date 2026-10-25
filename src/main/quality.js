'use strict';
// Calidad de imagen (reescalado) por consola. El reescalado lo hace cada emulador; CanacaLabArcadia solo escribe
// el ajuste en su archivo de configuracion justo antes de abrir el juego, segun el nivel elegido en Menu > Calidad de imagen.
//   PS2 (PCSX2)          inis\PCSX2.ini                  [EmuCore/GS] upscale_multiplier
//   GameCube/Wii (Dolphin) User\Config\GFX.ini           [Settings] InternalResolution
//   PSP (PPSSPP)         memstick\PSP\SYSTEM\ppsspp.ini  [Graphics] InternalResolution
//   N64 (RetroArch, Mupen64Plus-Next) config\Mupen64Plus-Next\Mupen64Plus-Next.opt  mupen64plus-EnableNativeResFactor
//   Xbox (xemu)          xemu.toml                       [display.quality] surface_scale
//   PS3 (RPCS3)          config\config.yml               Video: Resolution Scale
//   Switch (Eden)        qt-config.ini                   [Renderer] resolution_setup
const fs = require('fs');
const path = require('path');
const { setValue, pcsx2IniPath, xemuTomlPath } = require('./emusetup');
const { edenConfigPath, iniGet, iniSetMany } = require('./switchsetup');

const LEVELS = ['original', 'alta', 'maxima'];
const LEVEL_NAMES = { original: 'Original', alta: 'Alta', maxima: 'Máxima' };

// Valores por nivel. "def" es el nivel si no elegiste otro: Alta donde la Ally X va sobrada; Original en PS3 y
// Switch, que ya son 720p y emularlos es pesado (subirles la resolucion los pone lentos).
const QUALITY = {
  ps2: { emu: 'pcsx2', def: 'alta', values: { original: 1, alta: 3, maxima: 4 }, text: { original: '1x · 480p', alta: '3x · 1080p', maxima: '4x · 1440p' } },
  gamecube: { emu: 'dolphin', def: 'alta', values: { original: 1, alta: 3, maxima: 4 }, text: { original: '1x · 528p', alta: '3x · 1080p', maxima: '4x · 1440p' } },
  wii: { emu: 'dolphin', def: 'alta', values: { original: 1, alta: 3, maxima: 4 }, text: { original: '1x · 528p', alta: '3x · 1080p', maxima: '4x · 1440p' } },
  psp: { emu: 'ppsspp', def: 'alta', values: { original: 1, alta: 4, maxima: 6 }, text: { original: '1x · 272p', alta: '4x · 1080p', maxima: '6x · 1632p' } },
  n64: { emu: 'retroarch', core: 'mupen64plus_next', def: 'alta', values: { original: 1, alta: 4, maxima: 6 }, text: { original: '1x · 240p', alta: '4x · 960p', maxima: '6x · 1440p' } },
  xbox: { emu: 'xemu', def: 'alta', values: { original: 1, alta: 2, maxima: 3 }, text: { original: '1x · 480p', alta: '2x · 960p', maxima: '3x · 1440p' } },
  ps3: { emu: 'rpcs3', def: 'original', heavy: true, values: { original: 100, alta: 150, maxima: 200 }, text: { original: '100% · 720p', alta: '150% · 1080p', maxima: '200% · 1440p' } },
  switch: { emu: 'eden', def: 'original', heavy: true, values: { original: 1, alta: 1.5, maxima: 2 }, text: { original: '1x · 720p', alta: '1.5x · 1080p', maxima: '2x · 1440p' } }
};

function levelFor(settings, systemId) {
  const q = QUALITY[systemId];
  if (!q) return null;
  const chosen = settings && settings.calidad && settings.calidad[systemId];
  return LEVELS.includes(chosen) ? chosen : q.def;
}

// Para Menu > Calidad de imagen.
function qualityTable(settings) {
  return Object.entries(QUALITY).map(([id, q]) => ({
    id, emu: q.emu, heavy: !!q.heavy, def: q.def, level: levelFor(settings, id),
    options: LEVELS.map((l) => ({ id: l, name: LEVEL_NAMES[l], text: q.text[l] }))
  }));
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function save(file, before, after) {
  if (before === after) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after, 'utf8');
  return true;
}

// "clave = valor" sin secciones (archivos .opt/.cfg de RetroArch).
function setFlat(text, key, value) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const line = `${key} = "${value}"`;
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = line;
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line);
  }
  return lines.join(eol) + eol;
}

// Cambia "  clave: valor" dentro de un bloque de primer nivel de un YAML ("Video:"), sin tocar lo demas.
function setYaml(text, block, key, value) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const start = lines.findIndex((l) => l.trimEnd() === `${block}:`);
  if (start < 0) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${block}:`, `  ${key}: ${value}`);
    return lines.join(eol) + eol;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].length && !/^\s/.test(lines[i])) { end = i; break; }
  }
  for (let i = start + 1; i < end; i++) {
    if (new RegExp(`^  ${key}:`).test(lines[i])) {
      lines[i] = `  ${key}: ${value}`;
      return lines.join(eol) + (text.endsWith(eol) ? '' : eol);
    }
  }
  lines.splice(start + 1, 0, `  ${key}: ${value}`);
  return lines.join(eol) + (text.endsWith(eol) ? '' : eol);
}

function rpcs3ConfigPath(exe) {
  const dir = path.dirname(exe);
  const modern = path.join(dir, 'config', 'config.yml');
  const old = path.join(dir, 'config.yml');
  if (fs.existsSync(modern) || !fs.existsSync(old)) return modern;
  return old;
}

function ppssppIniPath(exe, documentsDir) {
  const dir = path.dirname(exe);
  // PPSSPP usa Documentos\PPSSPP solo si encuentra installed.txt junto al .exe; si no, la carpeta memstick de al lado.
  if (fs.existsSync(path.join(dir, 'installed.txt')) && documentsDir) return path.join(documentsDir, 'PPSSPP', 'PSP', 'SYSTEM', 'ppsspp.ini');
  return path.join(dir, 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini');
}

// Eden (fork de yuzu) guarda el reescalado como numero de su lista ResolutionSetup.
const EDEN_SETUP = ['Res1_4X', 'Res1_2X', 'Res3_4X', 'Res1X', 'Res5_4X', 'Res3_2X', 'Res2X', 'Res3X', 'Res4X', 'Res5X', 'Res6X', 'Res7X', 'Res8X'];
const EDEN_BY_SCALE = { 1: 'Res1X', 1.5: 'Res3_2X', 2: 'Res2X' };

const WRITERS = {
  pcsx2({ exe, documentsDir }, v) {
    const file = pcsx2IniPath(exe, documentsDir);
    const before = readText(file);
    // Sin SettingsVersion, PCSX2 borra el archivo y abre el asistente.
    const base = before || ['[UI]', 'SettingsVersion = 1', ''].join('\r\n');
    return { file, changed: save(file, before, setValue(base, 'EmuCore/GS', 'upscale_multiplier', String(v))) };
  },
  dolphin({ exe }, v) {
    const file = path.join(path.dirname(exe), 'User', 'Config', 'GFX.ini');
    const before = readText(file);
    return { file, changed: save(file, before, setValue(before, 'Settings', 'InternalResolution', String(v))) };
  },
  ppsspp({ exe, documentsDir }, v) {
    const file = ppssppIniPath(exe, documentsDir);
    const before = readText(file);
    return { file, changed: save(file, before, setValue(before, 'Graphics', 'InternalResolution', String(v))) };
  },
  retroarch({ exe, core }, v) {
    if (core && core !== 'mupen64plus_next') return { file: null, changed: false, skipped: `el núcleo ${core} no tiene este ajuste` };
    const file = path.join(path.dirname(exe), 'config', 'Mupen64Plus-Next', 'Mupen64Plus-Next.opt');
    const before = readText(file);
    let text = setFlat(before, 'mupen64plus-EnableNativeResFactor', String(v));
    // Con el dibujado ParaLLEl-RDP (Vulkan) el ajuste es otro y solo acepta 1x, 2x, 4x u 8x.
    text = setFlat(text, 'mupen64plus-parallel-rdp-upscaling', v >= 4 ? '4x' : v >= 2 ? '2x' : '1x');
    return { file, changed: save(file, before, text) };
  },
  xemu({ exe, appDataDir }, v) {
    const file = xemuTomlPath(exe, appDataDir);
    const before = readText(file);
    return { file, changed: save(file, before, setValue(before, 'display.quality', 'surface_scale', String(v))) };
  },
  rpcs3({ exe }, v) {
    const file = rpcs3ConfigPath(exe);
    const before = readText(file);
    return { file, changed: save(file, before, setYaml(before, 'Video', 'Resolution Scale', String(v))) };
  },
  eden({ exe, appDataDir }, v) {
    const file = edenConfigPath(exe, appDataDir);
    const before = readText(file);
    const name = EDEN_BY_SCALE[v] || 'Res1X';
    // Si tu Eden guarda nombres (Res1X) en vez de numeros, se respeta su formato.
    const current = iniGet(before, 'Renderer', 'resolution_setup');
    const value = current !== null && !/^\s*\d+\s*$/.test(current) ? name : String(EDEN_SETUP.indexOf(name));
    const text = v === 1
      ? iniSetMany(before, 'Renderer', { 'resolution_setup\\default': 'true', resolution_setup: value })
      : iniSetMany(before, 'Renderer', { 'resolution_setup\\default': 'false', resolution_setup: value });
    return { file, changed: save(file, before, text) };
  }
};

// Escribe en el emulador la calidad elegida para la consola del juego. { level, value, text, file, changed } o null.
function applyQuality({ systemId, emu, exe, core = null, settings, documentsDir = null, appDataDir = null }) {
  const q = QUALITY[systemId];
  if (!q || q.emu !== emu || !exe) return null;
  const level = levelFor(settings, systemId);
  const value = q.values[level];
  const res = WRITERS[emu]({ exe, core, documentsDir, appDataDir }, value);
  return { systemId, level, value, text: q.text[level], ...res };
}

module.exports = { QUALITY, LEVELS, LEVEL_NAMES, levelFor, qualityTable, applyQuality, setYaml, setFlat, rpcs3ConfigPath, ppssppIniPath, EDEN_SETUP };
