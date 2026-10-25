'use strict';
// Switch (Eden): instala solas las llaves (prod.keys / title.keys) y el firmware que tengas en la carpeta bios
// de tu biblioteca (por ejemplo, descargados de la carpeta BIOS de tu Google Drive), sin abrir Eden.
//   Llaves:   <datos de Eden>\keys\prod.keys
//   Firmware: <datos de Eden>\nand\system\Contents\registered\*.nca
// <datos de Eden> es la carpeta "user" junto a eden.exe (modo portable) o %APPDATA%\eden.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_FIRMWARE_NCAS = 20;

function edenDataDir(exe, appDataDir) {
  const portable = path.join(path.dirname(exe), 'user');
  if (fs.existsSync(portable)) return portable;
  return path.join(appDataDir || path.dirname(exe), 'eden');
}

function listFiles(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4) listFiles(full, depth + 1, out); } else out.push(full);
  }
  return out;
}

function countNcas(dir) {
  try { return fs.readdirSync(dir).filter((n) => /\.nca$/i.test(n)).length; } catch { return 0; }
}

// Que hay en la carpeta bios para Switch.
function findSwitchSources(dataRoot) {
  const roots = [path.join(dataRoot, 'bios'), path.join(dataRoot, 'bios', 'switch')];
  const files = roots.flatMap((r) => {
    try { return fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(r, e.name)); } catch { return []; }
  });
  const base = (f) => path.basename(f).toLowerCase();
  const newest = (list) => list.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  const keysFile = files.find((f) => base(f) === 'prod.keys') || null;
  const titleKeys = files.find((f) => base(f) === 'title.keys') || null;
  const keysZip = keysFile ? null : newest(files.filter((f) => /\.(zip|7z)$/i.test(f) && /keys?/i.test(base(f))));
  // Si hay varios firmwares, el mas reciente.
  const firmwareZip = newest(files.filter((f) => /\.(zip|7z)$/i.test(f) && /firm/i.test(base(f))));
  const ncaFolder = roots.map((r) => path.join(r, 'firmware')).find((d) => countNcas(d) >= MIN_FIRMWARE_NCAS) || null;
  return { keysFile, titleKeys, keysZip, firmwareZip, ncaFolder };
}

// Revision rapida (sin descomprimir): para la tarjeta de la consola y antes de abrir un juego.
function edenStatus({ exe, dataRoot, appDataDir }) {
  const dir = edenDataDir(exe, appDataDir);
  const keysOk = fs.existsSync(path.join(dir, 'keys', 'prod.keys'));
  const fwOk = countNcas(path.join(dir, 'nand', 'system', 'Contents', 'registered')) >= MIN_FIRMWARE_NCAS;
  if (keysOk && fwOk) return { ok: true, dir };
  const src = findSwitchSources(dataRoot);
  const haveKeys = keysOk || !!(src.keysFile || src.keysZip);
  const haveFw = fwOk || !!(src.firmwareZip || src.ncaFolder);
  const missing = [];
  if (!haveKeys) missing.push('las llaves (prod.keys)');
  if (!haveFw) missing.push('el firmware');
  return {
    ok: false,
    dir,
    keysOk,
    fwOk,
    canInstall: haveKeys && haveFw,
    short: missing.length ? 'Faltan llaves o firmware de Switch' : 'Preparando llaves y firmware de Switch',
    message: missing.length
      ? `Falta ${missing.join(' y ')} de tu Switch. Súbelos a la carpeta BIOS de tu Google Drive y descárgalos en Menú > Nube, o cópialos en ${path.join(dataRoot, 'bios')}. CanacaLabArcadia los instala en Eden sola.`
      : 'CanacaLabArcadia está instalando tus llaves y el firmware de Switch en Eden. Tarda menos de un minuto, solo la primera vez.'
  };
}

async function copyFirst(files, name, destDir) {
  const hit = files.find((f) => path.basename(f).toLowerCase() === name);
  if (!hit) return false;
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.promises.copyFile(hit, path.join(destDir, name));
  return true;
}

// Instala lo que falte. extract(archivo, carpeta) descomprime (.zip/.7z) con 7-Zip.
async function installEdenFiles({ exe, dataRoot, appDataDir, extract, tmpRoot = os.tmpdir() }) {
  const st = edenStatus({ exe, dataRoot, appDataDir });
  if (st.ok) return { ok: true, installed: [] };
  if (!st.canInstall) return { ok: false, installed: [], message: st.message };
  const src = findSwitchSources(dataRoot);
  const keysDir = path.join(st.dir, 'keys');
  const registered = path.join(st.dir, 'nand', 'system', 'Contents', 'registered');
  const installed = [];
  const tmp = await fs.promises.mkdtemp(path.join(tmpRoot, 'arcadia-switch-'));
  try {
    if (!st.keysOk) {
      if (src.keysFile) {
        await fs.promises.mkdir(keysDir, { recursive: true });
        await fs.promises.copyFile(src.keysFile, path.join(keysDir, 'prod.keys'));
        if (src.titleKeys) await fs.promises.copyFile(src.titleKeys, path.join(keysDir, 'title.keys'));
      } else {
        const out = path.join(tmp, 'keys');
        await extract(src.keysZip, out);
        const files = listFiles(out);
        if (!(await copyFirst(files, 'prod.keys', keysDir))) throw new Error(`${path.basename(src.keysZip)} no trae prod.keys.`);
        await copyFirst(files, 'title.keys', keysDir);
      }
      installed.push('llaves');
    }
    if (!st.fwOk) {
      let ncas;
      if (src.ncaFolder) {
        ncas = listFiles(src.ncaFolder).filter((f) => /\.nca$/i.test(f));
      } else {
        const out = path.join(tmp, 'firmware');
        await extract(src.firmwareZip, out);
        ncas = listFiles(out).filter((f) => /\.nca$/i.test(f));
      }
      if (ncas.length < MIN_FIRMWARE_NCAS) throw new Error(`${path.basename(src.firmwareZip || src.ncaFolder)} no parece un firmware de Switch (no trae archivos .nca).`);
      // Firmware limpio: si quedaba uno a medias, se reemplaza completo.
      await fs.promises.rm(registered, { recursive: true, force: true });
      await fs.promises.mkdir(registered, { recursive: true });
      for (const f of ncas) await fs.promises.copyFile(f, path.join(registered, path.basename(f)));
      installed.push('firmware');
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return { ok: edenStatus({ exe, dataRoot, appDataDir }).ok, installed };
}

// ---------------------------------------------------------------- qt-config.ini de Eden
// Eden guarda su configuracion en <datos de Eden>\config\qt-config.ini con lineas "clave=valor".
// Cada ajuste puede llevar "clave\default=true|false": si dice true, Eden ignora el valor y usa el de fabrica.

function edenConfigPath(exe, appDataDir) {
  return path.join(edenDataDir(exe, appDataDir), 'config', 'qt-config.ini');
}

function splitLines(text) {
  return text.length ? text.split(/\r?\n/) : [];
}

function sectionBounds(lines, section) {
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^\s*\[.+\]\s*$/.test(lines[i])) { end = i; break; }
  return { start, end };
}

const keyOfLine = (l) => { const i = l.indexOf('='); return i < 0 ? null : l.slice(0, i).trim(); };

function iniGet(text, section, key) {
  const lines = splitLines(text);
  const b = sectionBounds(lines, section);
  if (!b) return null;
  for (let i = b.start + 1; i < b.end; i++) if (keyOfLine(lines[i]) === key) return lines[i].slice(lines[i].indexOf('=') + 1);
  return null;
}

// Cambia varias claves de una seccion (null borra la clave). Lo demas del archivo no se toca.
function iniSetMany(text, section, values) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = splitLines(text);
  let b = sectionBounds(lines, section);
  if (!b) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`[${section}]`);
    b = { start: lines.length - 1, end: lines.length };
  }
  const pending = new Map(Object.entries(values));
  for (let i = b.end - 1; i > b.start; i--) {
    const k = keyOfLine(lines[i]);
    if (k === null || !pending.has(k)) continue;
    const v = pending.get(k);
    if (v === null) lines.splice(i, 1);
    else lines[i] = `${k}=${v}`;
    pending.delete(k);
    b.end = sectionBounds(lines, section).end;
  }
  let at = b.end;
  while (at - 1 > b.start && lines[at - 1].trim() === '') at--;
  const add = [...pending].filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`);
  lines.splice(at, 0, ...add);
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  return out;
}

// Lista "Paths\gamedirs\1\path=..." -> [{ path, deep_scan, expanded }]
function iniArray(text, section, name) {
  const size = Number(iniGet(text, section, `${name}\\size`)) || 0;
  const out = [];
  for (let i = 1; i <= size; i++) {
    const p = iniGet(text, section, `${name}\\${i}\\path`);
    if (p === null) continue;
    out.push({
      path: p.replace(/^"|"$/g, ''),
      deep_scan: iniGet(text, section, `${name}\\${i}\\deep_scan`) === 'true',
      expanded: iniGet(text, section, `${name}\\${i}\\expanded`) !== 'false'
    });
  }
  return out;
}

function iniWriteArray(text, section, name, entries, { dirFields = false } = {}) {
  // Primero se borra la lista vieja completa.
  const lines = splitLines(text);
  const b = sectionBounds(lines, section);
  if (b) {
    const prefix = `${name}\\`;
    for (let i = b.end - 1; i > b.start; i--) {
      const k = keyOfLine(lines[i]);
      if (k && k.startsWith(prefix)) lines.splice(i, 1);
    }
    text = lines.join(/\r\n/.test(text) ? '\r\n' : '\n');
  }
  const values = {};
  entries.forEach((e, idx) => {
    const n = idx + 1;
    values[`${name}\\${n}\\path\\default`] = 'false';
    values[`${name}\\${n}\\path`] = e.path;
    if (dirFields) {
      values[`${name}\\${n}\\deep_scan\\default`] = 'false';
      values[`${name}\\${n}\\deep_scan`] = e.deep_scan ? 'true' : 'false';
      values[`${name}\\${n}\\expanded\\default`] = 'false';
      values[`${name}\\${n}\\expanded`] = e.expanded === false ? 'false' : 'true';
    }
  });
  values[`${name}\\size`] = String(entries.length);
  return iniSetMany(text, section, values);
}

const edenPath = (p) => path.resolve(p).replace(/\\/g, '/');
const samePath = (a, b) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// GUID de SDL2 para un control XInput (como lo ve Eden): bus USB, sin el CRC del nombre (Eden lo borra),
// VID, PID y version del control, firma 'x' de XInput y el subtipo (1 = gamepad).
function sdlXInputGuid({ vid, pid, ver = 0, sub = 1 }) {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(0x0003, 0);
  b.writeUInt16LE(vid & 0xffff, 4);
  b.writeUInt16LE(pid & 0xffff, 8);
  b.writeUInt16LE(ver & 0xffff, 12);
  b[14] = 0x78;
  b[15] = sub & 0xff;
  return b.toString('hex');
}

// Botones de Switch -> control Xbox en SDL (por posicion, como el mapeo automatico de Eden: A de Switch = B de Xbox).
function edenPadBindings(guid, port = 0) {
  const base = `engine:sdl,port:${port},guid:${guid}`;
  const btn = (n) => `"${base},button:${n}"`;
  const hat = (d) => `"${base},hat:0,direction:${d}"`;
  const trig = (a) => `"${base},axis:${a},threshold:0.500000,invert:+"`;
  const stick = (x, y) => `"${base},axis_x:${x},axis_y:${y},offset_x:-0.000000,offset_y:0.000000,invert_x:+,invert_y:+,deadzone:0.150000,range:0.950000"`;
  return {
    button_a: btn(1), button_b: btn(0), button_x: btn(3), button_y: btn(2),
    button_lstick: btn(8), button_rstick: btn(9), button_l: btn(4), button_r: btn(5),
    button_zl: trig(2), button_zr: trig(5), button_plus: btn(7), button_minus: btn(6),
    button_dleft: hat('left'), button_dup: hat('up'), button_dright: hat('right'), button_ddown: hat('down'),
    button_home: btn(10),
    lstick: stick(0, 1), rstick: stick(3, 4)
  };
}

// Deja Eden listo antes de abrir un juego:
//  - Updates y DLC: Eden lee la carpeta de juegos de Switch como "contenido externo" (no hay que instalarlos).
//  - La carpeta de juegos aparece tambien en la lista de juegos de Eden.
//  - Control: el jugador 1 queda en el control con el que abriste el juego, salvo que tu lo hayas cambiado en Eden.
// state: lo que CanacaLabArcadia escribio la vez pasada (para no pisar lo que configures a mano).
function prepareEdenConfig({ exe, appDataDir, dataRoot, pad = null, state = {} }) {
  const file = edenConfigPath(exe, appDataDir);
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* Eden aun no se ha abierto */ }
  let text = before;
  const romDir = edenPath(path.join(dataRoot, 'roms', 'switch'));

  const ext = iniArray(text, 'UI', 'Paths\\external_content_dirs');
  if (!ext.some((e) => samePath(e.path, romDir))) text = iniWriteArray(text, 'UI', 'Paths\\external_content_dirs', [...ext, { path: romDir }]);

  let dirs = iniArray(text, 'UI', 'Paths\\gamedirs');
  if (!dirs.length) dirs = ['SDMC', 'UserNAND', 'SysNAND'].map((p) => ({ path: p, deep_scan: false, expanded: true }));
  if (!dirs.some((d) => samePath(d.path, romDir))) text = iniWriteArray(text, 'UI', 'Paths\\gamedirs', [...dirs, { path: romDir, deep_scan: true, expanded: true }], { dirFields: true });

  text = iniSetMany(text, 'Data%20Storage', { 'ext_content_from_game_dirs\\default': 'false', ext_content_from_game_dirs: 'true' });

  // ---- Control del jugador 1 ----
  // El jugador 1 es el control con el que abriste el juego. Lo que configures a mano en Eden para un control
  // se recuerda (por control) y se vuelve a poner cuando uses ese control otra vez.
  const st = { button_a: state.button_a || null, perfiles: { ...(state.perfiles || {}) }, ultimo: state.ultimo || null };
  let stateChanged = false;
  const current = iniGet(text, 'Controls', 'player_0_button_a');
  const curGuidMatch = current && current.match(/guid:([0-9a-f]{32})/i);
  const curGuid = curGuidMatch ? curGuidMatch[1].toLowerCase() : null;
  const isDefault = iniGet(text, 'Controls', 'player_0_button_a\\default') !== 'false';
  const keyboard = !current || /engine:keyboard/.test(current);
  const ours = !!st.button_a && current === st.button_a;
  if (curGuid && !ours && !isDefault) {
    const lines = playerLines(text);
    const prev = st.perfiles[curGuid];
    if (!prev || JSON.stringify(prev.lines) !== JSON.stringify(lines)) {
      st.perfiles[curGuid] = { lines, at: new Date().toISOString() };
      stateChanged = true;
    }
  }
  let target = pad && pad.vid ? sdlXInputGuid(pad) : null;
  let info = target ? `control ${target}` : 'control sin identificar';
  // Sin saber que control es: si Eden quedo en teclado, se usa el ultimo control que funciono.
  if (!target && (isDefault || keyboard) && st.ultimo && st.perfiles[st.ultimo]) {
    target = st.ultimo;
    info = `control sin identificar: se usa el ultimo (${target})`;
  }
  if (target && target !== curGuid) {
    const learned = st.perfiles[target];
    const values = {};
    if (learned) {
      Object.assign(values, learned.lines);
      info += ' (configuracion que guardaste en Eden)';
    } else {
      const binds = edenPadBindings(target);
      for (const [k, v] of Object.entries(binds)) {
        values[`player_0_${k}\\default`] = 'false';
        values[`player_0_${k}`] = v;
      }
      st.button_a = binds.button_a;
      info += ' (configuracion automatica)';
    }
    values['player_0_connected\\default'] = 'false';
    values.player_0_connected = 'true';
    text = iniSetMany(text, 'Controls', values);
    stateChanged = true;
  } else if (target) {
    info += ' (ya estaba configurado)';
  }
  if (target && st.ultimo !== target) {
    st.ultimo = target;
    stateChanged = true;
  }

  const changed = text !== before;
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return { ok: true, file, changed, controls: stateChanged ? st : null, info };
}

// Todas las lineas del jugador 1 (botones, sticks y movimiento) de [Controls].
function playerLines(text) {
  const lines = splitLines(text);
  const b = sectionBounds(lines, 'Controls');
  const out = {};
  if (!b) return out;
  for (let i = b.start + 1; i < b.end; i++) {
    const k = keyOfLine(lines[i]);
    if (k && /^player_0_(button_|lstick|rstick|motion)/.test(k)) out[k] = lines[i].slice(lines[i].indexOf('=') + 1);
  }
  return out;
}

module.exports = {
  edenDataDir, edenStatus, installEdenFiles, findSwitchSources, MIN_FIRMWARE_NCAS,
  edenConfigPath, prepareEdenConfig, sdlXInputGuid, edenPadBindings, iniGet, iniSetMany, iniArray, iniWriteArray, playerLines
};
