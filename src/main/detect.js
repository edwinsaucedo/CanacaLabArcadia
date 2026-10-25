'use strict';
// Motor de deteccion: dado un archivo o carpeta, decide a que consola pertenece.
// Primero mira la extension; si es ambigua (.iso, .cso, .zip, .cue...) lee la cabecera del disco:
//   - GameCube / Wii: numero magico en la cabecera del disco (tambien dentro de RVZ/WIA/WBFS/CISO)
//   - Xbox / Xbox 360: sistema de archivos XDVDFS ("MICROSOFT*XBOX*MEDIA") y default.xbe / default.xex
//   - PS1 / PS2 / PSP / PS3: sistema ISO9660 y sus archivos raiz (SYSTEM.CNF, UMD_DATA.BIN, PS3_DISC.SFB)
//   - Neo Geo vs MAME: nombres de los archivos dentro del .zip
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readSfoFile, readPbpSfo } = require('./sfo');

const SECTOR = 2048;
const XBOX_MAGIC = Buffer.from('MICROSOFT*XBOX*MEDIA', 'ascii');
// Desplazamientos donde puede empezar la particion de juego en imagenes de Xbox / 360.
const XDVDFS_PARTITIONS = [
  { base: 0, kind: 'xiso' },
  { base: 0x18300000, kind: 'xgd1' }, // Xbox original, volcado completo (redump)
  { base: 0x0fd90000, kind: 'xgd2' }, // Xbox 360
  { base: 0x02080000, kind: 'xgd3' } // Xbox 360
];

// Extensiones que identifican la consola sin necesidad de abrir el archivo.
const UNIQUE_EXT = {
  '.nes': 'nes', '.unf': 'nes', '.unif': 'nes', '.fds': 'nes',
  '.sfc': 'snes', '.smc': 'snes',
  '.z64': 'n64', '.n64': 'n64', '.v64': 'n64',
  '.gb': 'gb', '.gbc': 'gb',
  '.gba': 'gba',
  '.nds': 'nds',
  '.gcm': 'gamecube',
  '.wbfs': 'wii', '.wad': 'wii', '.wia': 'wii',
  '.nsp': 'switch', '.xci': 'switch', '.nca': 'switch', '.nro': 'switch',
  '.md': 'genesis', '.gen': 'genesis', '.smd': 'genesis',
  '.xex': 'xbox360', '.zar': 'xbox360',
  '.xiso': 'xbox'
};

// Palabras en la ruta que sirven de pista cuando el archivo no se puede identificar solo.
// El orden importa: lo mas especifico primero.
const PATH_HINTS = [
  [/xbox[\s_-]*360|\bx360\b/i, 'xbox360'],
  [/\bxbox\b/i, 'xbox'],
  [/playstation[\s_-]*4|\bps4\b|\bcusa\d{5}\b/i, 'ps4'],
  [/playstation[\s_-]*3|\bps3\b|\brpcs3\b/i, 'ps3'],
  [/playstation[\s_-]*2|\bps2\b|\bpcsx2\b/i, 'ps2'],
  [/playstation[\s_-]*portable|\bpsp\b|\bppsspp\b/i, 'psp'],
  [/playstation[\s_-]*1|\bps1\b|\bpsx\b|\bpsone\b|playstation/i, 'ps1'],
  [/game[\s_-]*cube|\bngc\b|\bgcn\b/i, 'gamecube'],
  [/\bwii\b/i, 'wii'],
  [/\bswitch\b|\bnsw\b/i, 'switch'],
  [/nintendo[\s_-]*64|\bn64\b/i, 'n64'],
  [/super[\s_-]*nintendo|\bsnes\b|\bsfc\b/i, 'snes'],
  [/\bnes\b|famicom/i, 'nes'],
  [/game[\s_-]*boy[\s_-]*advance|\bgba\b/i, 'gba'],
  [/game[\s_-]*boy|\bgbc?\b/i, 'gb'],
  [/nintendo[\s_-]*ds|\bnds\b/i, 'nds'],
  [/genesis|mega[\s_-]*drive|sega[\s_-]*cd|mega[\s_-]*cd/i, 'genesis'],
  [/neo[\s_-]*geo/i, 'neogeo'],
  [/\bmame\b|arcade|fbneo|\bfba\b/i, 'mame']
];

function hintFromPath(p) {
  const parts = path.resolve(p).split(/[\\/]+/).slice(-4).join(' / ');
  for (const [re, id] of PATH_HINTS) if (re.test(parts)) return id;
  return null;
}

// ---------- lectura de bajo nivel ----------

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return n === len ? buf : buf.subarray(0, n);
}

function fileSize(fd) {
  return fs.fstatSync(fd).size;
}

// Lector de sectores de 2048 bytes sobre ISO, BIN crudo (2352) o CSO comprimido.
function openSectorReader(file, opts = {}) {
  const fd = fs.openSync(file, 'r');
  const size = fileSize(fd);
  const head = readAt(fd, 0, 0x40);
  const close = () => fs.closeSync(fd);

  // CSO (PSP / PS2): "CISO" + cabecera de 0x18 bytes + indice de bloques.
  if (head.length >= 0x18 && head.toString('ascii', 0, 4) === 'CISO') {
    const headerSize = head.readUInt32LE(4);
    const blockSize = head.readUInt32LE(0x10);
    if ((headerSize === 0x18 || headerSize === 0) && blockSize === SECTOR) {
      const totalBytes = Number(head.readBigUInt64LE(8));
      const align = head[0x15] || 0;
      const blocks = Math.ceil(totalBytes / blockSize);
      const readSector = (lba) => {
        if (lba >= blocks) return null;
        const idx = readAt(fd, 0x18 + lba * 4, 8);
        if (idx.length < 8) return null;
        const a = idx.readUInt32LE(0);
        const b = idx.readUInt32LE(4);
        const plain = (a & 0x80000000) !== 0;
        const start = (a & 0x7fffffff) * 2 ** align;
        const end = (b & 0x7fffffff) * 2 ** align;
        const raw = readAt(fd, start, Math.max(0, end - start));
        if (plain) return raw.subarray(0, SECTOR);
        try {
          return zlib.inflateRawSync(raw).subarray(0, SECTOR);
        } catch {
          return null;
        }
      };
      return { kind: 'cso', size: totalBytes, readSector, readRaw: null, close };
    }
  }

  // BIN crudo de CD (2352 bytes por sector). Probamos MODE2 (offset 24) y MODE1 (offset 16).
  const tryRaw = (dataOffset) => {
    const pos = 16 * 2352 + dataOffset;
    const b = readAt(fd, pos, 6);
    return b.length === 6 && b.toString('ascii', 1, 6) === 'CD001';
  };
  const isPlainIso = (() => {
    const b = readAt(fd, 16 * SECTOR, 6);
    return b.length === 6 && b.toString('ascii', 1, 6) === 'CD001';
  })();

  let rawOffset = null;
  if (!isPlainIso && (opts.raw || size % 2352 === 0)) {
    if (tryRaw(24)) rawOffset = 24;
    else if (tryRaw(16)) rawOffset = 16;
  }
  if (rawOffset !== null) {
    return {
      kind: 'bin',
      size,
      readSector: (lba) => readAt(fd, lba * 2352 + rawOffset, SECTOR),
      readRaw: (pos, len) => readAt(fd, pos, len),
      close
    };
  }

  return {
    kind: 'iso',
    size,
    readSector: (lba) => readAt(fd, lba * SECTOR, SECTOR),
    readRaw: (pos, len) => readAt(fd, pos, len),
    close
  };
}

// ---------- ISO9660 ----------

function iso9660Root(reader) {
  const pvd = reader.readSector(16);
  if (!pvd || pvd.length < 190 || pvd.toString('ascii', 1, 6) !== 'CD001') return null;
  const rootLba = pvd.readUInt32LE(156 + 2);
  const rootLen = pvd.readUInt32LE(156 + 10);
  const entries = [];
  const sectors = Math.min(Math.ceil(rootLen / SECTOR), 16);
  for (let s = 0; s < sectors; s++) {
    const sec = reader.readSector(rootLba + s);
    if (!sec) break;
    let off = 0;
    while (off < sec.length) {
      const len = sec[off];
      if (!len) break;
      const lba = sec.readUInt32LE(off + 2);
      const size = sec.readUInt32LE(off + 10);
      const flags = sec[off + 25];
      const nameLen = sec[off + 32];
      let name = sec.toString('ascii', off + 33, off + 33 + nameLen);
      if (nameLen === 1 && (sec[off + 33] === 0 || sec[off + 33] === 1)) name = '';
      name = name.replace(/;\d+$/, '').replace(/\.$/, '');
      if (name) entries.push({ name: name.toUpperCase(), lba, size, isDir: (flags & 2) !== 0 });
      off += len;
    }
  }
  return entries;
}

function readIsoFile(reader, entry, max = 4096) {
  const len = Math.min(entry.size, max);
  const chunks = [];
  for (let read = 0, s = 0; read < len; s++, read += SECTOR) {
    const sec = reader.readSector(entry.lba + s);
    if (!sec) break;
    chunks.push(sec);
  }
  return Buffer.concat(chunks).subarray(0, len);
}

function classifyIso9660(reader) {
  const root = iso9660Root(reader);
  if (!root) return null;
  const names = new Set(root.map((e) => e.name));
  if (names.has('PS3_DISC.SFB') || names.has('PS3_GAME')) return { system: 'ps3', reason: 'Disco de PS3 (PS3_DISC.SFB)' };
  if (names.has('UMD_DATA.BIN') || names.has('PSP_GAME')) return { system: 'psp', reason: 'Disco UMD de PSP (UMD_DATA.BIN)' };
  const cnf = root.find((e) => e.name === 'SYSTEM.CNF');
  if (cnf) {
    const txt = readIsoFile(reader, cnf, 1024).toString('latin1');
    if (/BOOT2\s*=/i.test(txt)) return { system: 'ps2', reason: 'Disco de PS2 (SYSTEM.CNF con BOOT2)' };
    if (/BOOT\s*=/i.test(txt)) return { system: 'ps1', reason: 'Disco de PS1 (SYSTEM.CNF con BOOT)' };
  }
  return { system: null, reason: 'Disco ISO9660 sin archivos de consola reconocibles', iso9660: true };
}

// ---------- Nintendo ----------

const GC_MAGIC = 0xc2339f3d;
const WII_MAGIC = 0x5d1c9ea3;

function classifyNintendoHeader(buf, offset = 0) {
  if (buf.length < offset + 0x20) return null;
  if (buf.readUInt32BE(offset + 0x18) === WII_MAGIC) return { system: 'wii', reason: 'Disco de Wii (número mágico de cabecera)' };
  if (buf.readUInt32BE(offset + 0x1c) === GC_MAGIC) return { system: 'gamecube', reason: 'Disco de GameCube (número mágico de cabecera)' };
  return null;
}

function nintendoTitleId(buf, offset = 0) {
  const id = buf.toString('ascii', offset, offset + 6);
  return /^[A-Z0-9]{6}$/.test(id) ? id : null;
}

function classifyNintendoContainer(head) {
  const magic4 = head.toString('ascii', 0, 4);
  if ((magic4 === 'RVZ\u0001' || magic4 === 'WIA\u0001') && head.length >= 0x4c) {
    const discType = head.readUInt32BE(0x48);
    if (discType === 1) return { system: 'gamecube', reason: `Imagen ${magic4.slice(0, 3)} de GameCube` };
    if (discType === 2) return { system: 'wii', reason: `Imagen ${magic4.slice(0, 3)} de Wii` };
  }
  if (magic4 === 'WBFS') return { system: 'wii', reason: 'Imagen WBFS de Wii' };
  if (head.length >= 4 && head.readUInt32LE(0) === 0xb10bc001) return { system: 'gamecube', reason: 'Imagen GCZ (Dolphin)', confidence: 'media' };
  return null;
}

// CISO de Dolphin (no confundir con CSO de PSP): bloque de datos a partir de 0x8000.
function classifyDolphinCiso(fd, head) {
  if (head.toString('ascii', 0, 4) !== 'CISO') return null;
  const blockSize = head.readUInt32LE(4);
  if (blockSize === 0x18 || blockSize === 0 || blockSize === SECTOR) return null; // es CSO de PSP/PS2
  const disc = readAt(fd, 0x8000, 0x20);
  return classifyNintendoHeader(disc, 0);
}

// ---------- Xbox ----------

function classifyXdvdfs(fd, size) {
  for (const p of XDVDFS_PARTITIONS) {
    const magicPos = p.base + 0x10000;
    if (magicPos + 0x800 > size) continue;
    const sec = readAt(fd, magicPos, 0x800);
    if (!sec.subarray(0, 20).equals(XBOX_MAGIC)) continue;
    if (p.kind === 'xgd2' || p.kind === 'xgd3') return { system: 'xbox360', reason: `Disco de Xbox 360 (${p.kind.toUpperCase()})` };
    const rootSector = sec.readUInt32LE(20);
    const rootSize = Math.min(sec.readUInt32LE(24), 256 * 1024);
    const root = readAt(fd, p.base + rootSector * SECTOR, rootSize).toString('latin1').toLowerCase();
    if (root.includes('default.xex')) return { system: 'xbox360', reason: 'Disco de Xbox 360 (default.xex)' };
    if (p.kind === 'xgd1') {
      return { system: 'xbox', reason: 'Disco de Xbox completo (redump)', needsXiso: true };
    }
    return { system: 'xbox', reason: 'Disco de Xbox en formato XISO (default.xbe)' };
  }
  return null;
}

// ---------- ZIP ----------

function listZipEntries(file) {
  const d = listZipDetails(file);
  return d ? d.map((e) => e.name) : null;
}

// Entradas de un .zip con su CRC32 (sale del directorio central, sin descomprimir nada).
function listZipDetails(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fileSize(fd);
    const tailLen = Math.min(size, 65536 + 22);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    if (cdSize > 32 * 1024 * 1024) return null;
    const cd = readAt(fd, cdOff, cdSize);
    const names = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nLen = cd.readUInt16LE(p + 28);
      const xLen = cd.readUInt16LE(p + 30);
      const cLen = cd.readUInt16LE(p + 32);
      names.push({ name: cd.toString('utf8', p + 46, p + 46 + nLen), crc: cd.readUInt32LE(p + 16), size: cd.readUInt32LE(p + 24) });
      p += 46 + nLen + xLen + cLen;
    }
    return names;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const NEOGEO_PART = /(^|\/)(\d{3}|[a-z0-9]{2,8})-[pcsmv]\d+\.[pcsmv]\d+$/i;

function classifyArchiveEntries(names, base) {
  if (!names || !names.length) return null;
  const files = names.filter((n) => !n.endsWith('/'));
  // ROM de consola dentro del zip (por ejemplo "Super Mario Bros (USA).nes").
  for (const n of files) {
    const id = UNIQUE_EXT[path.extname(n).toLowerCase()];
    if (id && !['xbox360', 'xbox'].includes(id)) return { system: id, reason: `Contiene ${path.basename(n)}` };
  }
  if (base.toLowerCase() === 'neogeo.zip') return { system: 'neogeo', reason: 'BIOS de Neo Geo (neogeo.zip)', isBios: true };
  if (files.some((n) => NEOGEO_PART.test(n))) return { system: 'neogeo', reason: 'Romset de Neo Geo (piezas p1/c1/s1/m1/v1)' };
  // Romset de arcade: muchos archivos sin extension de consola.
  if (files.length >= 2) return { system: 'mame', reason: 'Romset de arcade (MAME)', confidence: 'media' };
  return null;
}

// ---------- CUE ----------

function parseCue(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const fm = txt.match(/FILE\s+"([^"]+)"/i) || txt.match(/FILE\s+(\S+)/i);
    const tm = txt.match(/TRACK\s+\d+\s+(MODE[12]\/\d+|AUDIO)/i);
    if (!fm) return null;
    return { bin: path.join(path.dirname(file), fm[1]), mode: tm ? tm[1].toUpperCase() : null };
  } catch {
    return null;
  }
}

// ---------- carpetas (PS3 / PS4 / Xbox 360) ----------

function existsCi(dir, rel) {
  // Busca rel sin importar mayusculas/minusculas (Windows no las distingue, pero los zips si).
  let cur = dir;
  for (const part of rel.split('/')) {
    let list;
    try {
      list = fs.readdirSync(cur);
    } catch {
      return null;
    }
    const hit = list.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

function detectFolder(dir) {
  const ps3Eboot = existsCi(dir, 'PS3_GAME/USRDIR/EBOOT.BIN') || existsCi(dir, 'USRDIR/EBOOT.BIN');
  if (ps3Eboot) {
    const sfoPath = existsCi(dir, 'PS3_GAME/PARAM.SFO') || existsCi(dir, 'PARAM.SFO');
    const sfo = sfoPath ? readSfoFile(sfoPath) : null;
    const icon = existsCi(dir, 'PS3_GAME/ICON0.PNG') || existsCi(dir, 'ICON0.PNG');
    return {
      system: 'ps3', confidence: 'alta', reason: 'Carpeta de juego de PS3 (EBOOT.BIN)',
      launch: ps3Eboot, title: sfo && sfo.TITLE, serial: sfo && sfo.TITLE_ID, icon
    };
  }
  const ps4Eboot = existsCi(dir, 'eboot.bin');
  const ps4Sfo = existsCi(dir, 'sce_sys/param.sfo');
  if (ps4Eboot && ps4Sfo) {
    const sfo = readSfoFile(ps4Sfo);
    const icon = existsCi(dir, 'sce_sys/icon0.png');
    return {
      system: 'ps4', confidence: 'alta', reason: 'Carpeta de juego de PS4 (eboot.bin + param.sfo)',
      launch: ps4Eboot, title: sfo && sfo.TITLE, serial: sfo && (sfo.TITLE_ID || sfo.CONTENT_ID), icon
    };
  }
  const xex = existsCi(dir, 'default.xex');
  if (xex) return { system: 'xbox360', confidence: 'alta', reason: 'Juego de Xbox 360 extraído (default.xex)', launch: xex };
  const xbe = existsCi(dir, 'default.xbe');
  if (xbe) {
    return { system: 'xbox', confidence: 'baja', reason: 'Juego de Xbox extraído: xemu necesita convertirlo a XISO', needsXiso: true, launch: null };
  }
  return null;
}

// ---------- archivo ----------

function detectFile(file) {
  const base = path.basename(file);
  const lower = base.toLowerCase();
  const ext = path.extname(lower);
  const hint = hintFromPath(file);
  const result = (r, confidence = 'alta') => ({ confidence, ...r });

  if (UNIQUE_EXT[ext]) {
    return result({ system: UNIQUE_EXT[ext], reason: `Extension ${ext}` });
  }

  if (ext === '.pbp') {
    const sfo = readPbpSfo(file);
    if (sfo && sfo.CATEGORY === 'ME') return result({ system: 'ps1', reason: 'PSone Classic (EBOOT.PBP)', title: sfo.TITLE });
    if (sfo) return result({ system: 'psp', reason: 'Juego de PSP (EBOOT.PBP)', title: sfo.TITLE });
    return result({ system: 'psp', reason: 'Archivo PBP' }, 'media');
  }

  if (ext === '.zip' || ext === '.7z') {
    if (ext === '.zip') {
      const r = classifyArchiveEntries(listZipEntries(file), base);
      if (r) {
        // Si la carpeta dice "neo geo" y el zip parece arcade, gana la pista.
        if (r.system === 'mame' && hint === 'neogeo') return result({ ...r, system: 'neogeo', reason: 'Romset de arcade en carpeta de Neo Geo' }, 'media');
        return result(r, r.confidence || 'alta');
      }
    }
    if (hint) return result({ system: hint, reason: `Archivo comprimido en una carpeta de ${hint}` }, 'media');
    return result({ system: null, reason: 'Archivo comprimido: elige la consola', candidates: ['nes', 'snes', 'gba', 'genesis', 'mame', 'neogeo'] }, 'baja');
  }

  if (ext === '.m3u') {
    try {
      const first = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (first) {
        const inner = detectFile(path.join(path.dirname(file), first));
        if (inner.system) return result({ ...inner, reason: `Lista de discos (${inner.reason})` }, inner.confidence);
      }
    } catch { /* sin lectura */ }
    return result({ system: hint || 'ps1', reason: 'Lista de discos .m3u' }, 'media');
  }

  if (ext === '.cue' || ext === '.ccd') {
    const cue = ext === '.cue' ? parseCue(file) : null;
    const bin = cue ? cue.bin : file.replace(/\.ccd$/i, '.img');
    if (fs.existsSync(bin)) {
      const r = detectDisc(bin, { raw: true });
      if (r.system) return result(r);
    }
    if (hint) return result({ system: hint, reason: 'Imagen CUE (por la carpeta)' }, 'media');
    return result({ system: 'ps1', reason: 'Imagen CUE/BIN (lo más común es PS1)', candidates: ['ps1', 'ps2', 'genesis'] }, 'baja');
  }

  if (['.iso', '.gcz', '.rvz', '.ciso', '.cso', '.bin', '.img'].includes(ext)) {
    const r = detectDisc(file, { raw: ext === '.bin' || ext === '.img' });
    if (r.system) return result(r, r.confidence || 'alta');
    if (ext === '.bin') {
      const g = detectGenesisCart(file);
      if (g) return result(g);
    }
    if (hint) return result({ system: hint, reason: `No se pudo leer el disco; se usa la carpeta (${hint})` }, 'media');
    return result({ system: null, reason: r.reason || 'Imagen de disco no reconocida', candidates: ['ps2', 'psp', 'gamecube', 'wii', 'xbox', 'xbox360', 'ps3'] }, 'baja');
  }

  if (ext === '.chd' || ext === '.zso' || ext === '.gz') {
    if (hint) return result({ system: hint, reason: `Imagen ${ext} en una carpeta de ${hint}` }, 'media');
    const candidates = ext === '.chd' ? ['ps1', 'ps2', 'psp', 'mame'] : ['ps2', 'psp'];
    return result({ system: null, reason: `Las imágenes ${ext} no dicen su consola: elige una`, candidates }, 'baja');
  }

  return { system: null, confidence: 'baja', reason: 'Formato no reconocido', ignored: true };
}

function detectGenesisCart(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (fileSize(fd) > 16 * 1024 * 1024) return null;
    const h = readAt(fd, 0x100, 16).toString('ascii');
    if (/^SEGA/.test(h)) return { system: 'genesis', reason: 'Cartucho de Genesis (cabecera SEGA)' };
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function detectDisc(file, opts = {}) {
  let reader;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fileSize(fd);
    const head = readAt(fd, 0, 0x80);

    const nin = classifyNintendoContainer(head) || classifyDolphinCiso(fd, head) || classifyNintendoHeader(head, 0);
    if (nin) {
      const id = nintendoTitleId(head, 0);
      return { ...nin, serial: id || undefined };
    }

    if (head.toString('ascii', 0, 14) === 'SEGADISCSYSTEM' || head.toString('ascii', 0x10, 0x10 + 14) === 'SEGADISCSYSTEM') {
      return { system: 'genesis', reason: 'Disco de Sega CD' };
    }

    const xb = classifyXdvdfs(fd, size);
    if (xb) return xb;

    fs.closeSync(fd);
    fd = undefined;
    reader = openSectorReader(file, opts);
    const iso = classifyIso9660(reader);
    if (iso) return iso;
    return { system: null, reason: 'Imagen de disco sin firma conocida' };
  } catch (e) {
    return { system: null, reason: `No se pudo leer: ${e.message}` };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (reader) reader.close();
  }
}

function detect(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { system: null, confidence: 'baja', reason: 'No existe' };
  }
  if (st.isDirectory()) {
    const r = detectFolder(p);
    if (r) return r;
    return { system: null, confidence: 'baja', reason: 'Carpeta sin juego reconocible', isCollection: true };
  }
  return detectFile(p);
}

module.exports = {
  detect, detectFile, detectFolder, detectDisc, hintFromPath, listZipEntries, listZipDetails,
  openSectorReader, iso9660Root, UNIQUE_EXT, existsCi
};
