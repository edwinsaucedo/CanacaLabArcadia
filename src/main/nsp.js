'use strict';
// Switch: distingue el juego base de sus actualizaciones (updates) y DLC.
// Cada contenido de Switch tiene un "title ID" de 16 digitos hexadecimales:
//   juego base   0100ABCD12340000   (los ultimos 3 digitos en 000 y el bit 0x1000 apagado)
//   update       0100ABCD12340800   (base + 0x800)
//   DLC          0100ABCD12341001   (base + 0x1000 + numero de DLC)
// El title ID sale del nombre del archivo ("Juego [0100ABCD12340000][v0].nsp") o, si no lo trae,
// del ticket que va dentro del .nsp (un archivo "<title ID>....tik" en la cabecera PFS0).
const fs = require('fs');
const path = require('path');

const TID_RE = /\b(01[0-9a-f]{14})\b/i;

function titleIdFromName(name) {
  const m = String(name || '').match(/[[(]\s*(01[0-9a-f]{14})\s*[\])]/i) || String(name || '').match(TID_RE);
  return m ? m[1].toUpperCase() : null;
}

function kindOfTitleId(tid) {
  if (!tid || !/^[0-9A-F]{16}$/i.test(tid)) return null;
  const v = BigInt(`0x${tid}`);
  const low = v & 0xFFFn;
  if (low === 0x800n) return 'update';
  if (low === 0n && (v & 0x1000n) === 0n) return 'base';
  return 'dlc';
}

// Title ID del juego base al que pertenece un update o DLC.
function baseTitleId(tid) {
  if (!tid) return null;
  const v = BigInt(`0x${tid}`);
  const kind = kindOfTitleId(tid);
  const base = kind === 'update' ? v - 0x800n : kind === 'dlc' ? (v & ~0x1FFFn) : v;
  return base.toString(16).toUpperCase().padStart(16, '0');
}

// Lee los nombres de archivo de la cabecera PFS0 de un .nsp (sin leer el resto del archivo).
function readPfs0Names(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) < 16 || head.toString('ascii', 0, 4) !== 'PFS0') return null;
    const count = head.readUInt32LE(4);
    const strSize = head.readUInt32LE(8);
    if (count === 0 || count > 4096 || strSize > 1024 * 1024) return null;
    const tableSize = count * 24 + strSize;
    const table = Buffer.alloc(tableSize);
    if (fs.readSync(fd, table, 0, tableSize, 16) < tableSize) return null;
    const strings = table.subarray(count * 24);
    const names = [];
    for (let i = 0; i < count; i++) {
      const off = table.readUInt32LE(i * 24 + 16);
      if (off >= strings.length) continue;
      const end = strings.indexOf(0, off);
      names.push(strings.toString('utf8', off, end < 0 ? strings.length : end));
    }
    return names;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* nada */ }
  }
}

function titleIdFromNsp(file) {
  const names = readPfs0Names(file);
  if (!names) return null;
  const tik = names.find((n) => /^[0-9a-f]{32}\.tik$/i.test(n));
  return tik ? tik.slice(0, 16).toUpperCase() : null;
}

// Cuando no hay title ID: pistas en el nombre.
function kindFromWords(name) {
  const n = String(name || '');
  if (/\[(dlc|aoc)\]|\bdlc\b|add-?on content/i.test(n)) return 'dlc';
  if (/\[(upd|update)\]|\bupdate\b|\bactualizaci[oó]n\b/i.test(n)) return 'update';
  const v = n.match(/\[v(\d+)\]/i);
  if (v && Number(v[1]) > 0) return 'update';
  return null;
}

const cache = new Map();

// { kind: 'base' | 'update' | 'dlc', titleId, baseId }
function classifySwitchFile(file, { readHeader = true } = {}) {
  const name = path.basename(file);
  let key = null;
  if (readHeader) {
    try {
      const st = fs.statSync(file);
      key = `${file}|${st.size}|${st.mtimeMs}`;
      if (cache.has(key)) return cache.get(key);
    } catch { /* no existe: solo el nombre */ }
  }
  let tid = titleIdFromName(name);
  if (!tid && readHeader && /\.nsp$/i.test(name)) tid = titleIdFromNsp(file);
  const kind = kindOfTitleId(tid) || kindFromWords(name) || 'base';
  const out = { kind, titleId: tid, baseId: tid ? baseTitleId(tid) : null };
  if (key) cache.set(key, out);
  return out;
}

// Une los updates y DLC (archivos sueltos de la nube) con su juego base.
// units: salida de groupUnits para la carpeta de Switch. Devuelve solo los juegos base, cada uno con "extras".
function attachSwitchExtras(units) {
  const bases = [];
  const extras = [];
  for (const u of units) {
    if (u.kind !== 'files') { bases.push({ ...u, extras: [] }); continue; }
    const c = classifySwitchFile(u.name, { readHeader: false });
    if (c.kind === 'base') bases.push({ ...u, titleId: c.titleId, extras: [] });
    else extras.push({ ...u, ...c });
  }
  const norm = (s) => s.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\.(nsp|xci|nsz|xcz)$/i, '').replace(/\b(update|upd|dlc)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const x of extras) {
    let base = x.baseId && bases.find((b) => b.titleId === x.baseId);
    // Sin title ID: por nombre ("Juego [UPD].nsp" va con "Juego.nsp").
    if (!base) {
      const n = norm(x.name);
      base = n && bases.find((b) => b.kind === 'files' && norm(b.name) === n);
    }
    if (base) {
      base.extras.push({ name: x.name, kind: x.kind, files: x.files, size: x.size });
    }
  }
  return bases;
}

module.exports = { titleIdFromName, kindOfTitleId, baseTitleId, readPfs0Names, titleIdFromNsp, classifySwitchFile, attachSwitchExtras, kindFromWords };
