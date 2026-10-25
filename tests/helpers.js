'use strict';
// Generadores de imagenes de disco falsas (solo cabeceras) para probar la deteccion sin ROMs reales.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const SECTOR = 2048;

function tmpDir(prefix = 'arcadia-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function dirRecord(name, lba, size, isDir) {
  const nameBuf = name === '.' ? Buffer.from([0]) : name === '..' ? Buffer.from([1]) : Buffer.from(name, 'ascii');
  let len = 33 + nameBuf.length;
  if (len % 2) len++;
  const r = Buffer.alloc(len);
  r[0] = len;
  r.writeUInt32LE(lba, 2);
  r.writeUInt32BE(lba, 6);
  r.writeUInt32LE(size, 10);
  r.writeUInt32BE(size, 14);
  r[25] = isDir ? 2 : 0;
  r.writeUInt16LE(1, 28);
  r[32] = nameBuf.length;
  nameBuf.copy(r, 33);
  return r;
}

// files: { 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_200.62;1', 'PSP_GAME/': null }
function buildIso9660(files) {
  const names = Object.keys(files);
  const rootLba = 18;
  let nextLba = 20;
  const recs = [dirRecord('.', rootLba, SECTOR, true), dirRecord('..', rootLba, SECTOR, true)];
  const data = [];
  for (const n of names) {
    const isDir = n.endsWith('/');
    const content = isDir ? Buffer.alloc(SECTOR) : Buffer.from(files[n] || '', 'latin1');
    const lba = nextLba;
    nextLba += Math.max(1, Math.ceil(content.length / SECTOR));
    recs.push(dirRecord(isDir ? n.slice(0, -1) : `${n};1`, lba, isDir ? SECTOR : content.length, isDir));
    data.push({ lba, content });
  }
  const img = Buffer.alloc(nextLba * SECTOR + SECTOR * 4);
  const pvd = Buffer.alloc(SECTOR);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'ascii');
  pvd[6] = 1;
  dirRecord('.', rootLba, SECTOR, true).copy(pvd, 156);
  pvd.copy(img, 16 * SECTOR);
  const term = Buffer.alloc(SECTOR);
  term[0] = 255;
  term.write('CD001', 1, 'ascii');
  term.copy(img, 17 * SECTOR);
  Buffer.concat(recs).copy(img, rootLba * SECTOR);
  for (const d of data) d.content.copy(img, d.lba * SECTOR);
  return img;
}

// Convierte una imagen de 2048 a BIN crudo MODE2/2352 (como los CD de PS1).
function toRawMode2(img) {
  const n = Math.ceil(img.length / SECTOR);
  const out = Buffer.alloc(n * 2352);
  for (let i = 0; i < n; i++) {
    const base = i * 2352;
    out.fill(0xff, base + 1, base + 11);
    out[base + 15] = 2;
    img.copy(out, base + 24, i * SECTOR, Math.min(img.length, (i + 1) * SECTOR));
  }
  return out;
}

// Comprime una imagen de 2048 a CSO v1 (PSP).
function toCso(img) {
  const n = Math.ceil(img.length / SECTOR);
  const blocks = [];
  for (let i = 0; i < n; i++) blocks.push(zlib.deflateRawSync(img.subarray(i * SECTOR, (i + 1) * SECTOR)));
  const header = Buffer.alloc(0x18);
  header.write('CISO', 0, 'ascii');
  header.writeUInt32LE(0x18, 4);
  header.writeBigUInt64LE(BigInt(n * SECTOR), 8);
  header.writeUInt32LE(SECTOR, 0x10);
  header[0x14] = 1;
  header[0x15] = 0;
  const index = Buffer.alloc((n + 1) * 4);
  let pos = 0x18 + index.length;
  for (let i = 0; i < n; i++) {
    index.writeUInt32LE(pos, i * 4);
    pos += blocks[i].length;
  }
  index.writeUInt32LE(pos, n * 4);
  return Buffer.concat([header, index, ...blocks]);
}

function buildSfo(map) {
  const keys = Object.keys(map);
  const keyTable = [];
  const dataTable = [];
  const index = Buffer.alloc(keys.length * 16);
  let kOff = 0;
  let dOff = 0;
  keys.forEach((k, i) => {
    const v = map[k];
    const kb = Buffer.from(`${k}\0`, 'utf8');
    let db;
    let fmt;
    if (typeof v === 'number') {
      db = Buffer.alloc(4);
      db.writeUInt32LE(v, 0);
      fmt = 0x0404;
    } else {
      db = Buffer.from(`${v}\0`, 'utf8');
      fmt = 0x0204;
    }
    index.writeUInt16LE(kOff, i * 16);
    index.writeUInt16LE(fmt, i * 16 + 2);
    index.writeUInt32LE(db.length, i * 16 + 4);
    index.writeUInt32LE(db.length, i * 16 + 8);
    index.writeUInt32LE(dOff, i * 16 + 12);
    keyTable.push(kb);
    dataTable.push(db);
    kOff += kb.length;
    dOff += db.length;
  });
  const kt = Buffer.concat(keyTable);
  const pad = Buffer.alloc((4 - (kt.length % 4)) % 4);
  const header = Buffer.alloc(20);
  header.writeUInt32BE(0x00505346, 0);
  header.writeUInt32LE(0x0101, 4);
  header.writeUInt32LE(20 + index.length, 8);
  header.writeUInt32LE(20 + index.length + kt.length + pad.length, 12);
  header.writeUInt32LE(keys.length, 16);
  return Buffer.concat([header, index, kt, pad, ...dataTable]);
}

function buildPbp(sfo) {
  const header = Buffer.alloc(40);
  header.writeUInt32BE(0x00504250, 0);
  header.writeUInt32LE(0x00010000, 4);
  header.writeUInt32LE(40, 8);
  for (let i = 3; i < 10; i++) header.writeUInt32LE(40 + sfo.length, i * 4);
  return Buffer.concat([header, sfo]);
}

// ZIP minimo sin compresion (solo para listar nombres).
// crcs (opcional): { nombre: 'crc32 en hex' } para simular sets reales.
function buildZip(names, crcs = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(nb.length, 28);
    if (crcs[name]) ch.writeUInt32LE(parseInt(crcs[name], 16) >>> 0, 16);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb);
    offset += 30 + nb.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function nintendoDisc(kind, id = 'GALE01') {
  const b = Buffer.alloc(0x440);
  b.write(id, 0, 'ascii');
  if (kind === 'gc') b.writeUInt32BE(0xc2339f3d, 0x1c);
  else b.writeUInt32BE(0x5d1c9ea3, 0x18);
  return b;
}

function rvz(discType) {
  const b = Buffer.alloc(0x100);
  b.write('RVZ\u0001', 0, 'latin1');
  b.writeUInt32BE(discType, 0x48);
  return b;
}

// Imagen de Xbox: particion XDVDFS con raiz que contiene default.xbe o default.xex.
function xboxImage(base, exeName) {
  const rootSector = 0x30;
  const size = base + 0x10000 + 0x40000;
  const img = Buffer.alloc(size);
  const magicPos = base + 0x10000;
  img.write('MICROSOFT*XBOX*MEDIA', magicPos, 'ascii');
  img.writeUInt32LE(rootSector, magicPos + 20);
  img.writeUInt32LE(0x800, magicPos + 24);
  img.write('MICROSOFT*XBOX*MEDIA', magicPos + 0x7ec, 'ascii');
  const entry = Buffer.alloc(14 + exeName.length);
  entry.writeUInt32LE(0x40, 4);
  entry.writeUInt32LE(1234, 8);
  entry[12] = 0x20;
  entry[13] = exeName.length;
  entry.write(exeName, 14, 'ascii');
  entry.copy(img, base + rootSector * SECTOR);
  return img;
}

// Igual que xboxImage pero escribe un archivo disperso (sparse) para no reservar cientos de MB.
function writeXboxImage(file, base, exeName) {
  const rootSector = 0x30;
  const fd = fs.openSync(file, 'w');
  const magicPos = base + 0x10000;
  const sec = Buffer.alloc(0x800);
  sec.write('MICROSOFT*XBOX*MEDIA', 0, 'ascii');
  sec.writeUInt32LE(rootSector, 20);
  sec.writeUInt32LE(0x800, 24);
  sec.write('MICROSOFT*XBOX*MEDIA', 0x7ec, 'ascii');
  fs.writeSync(fd, sec, 0, sec.length, magicPos);
  const entry = Buffer.alloc(0x800);
  entry.writeUInt32LE(0x40, 4);
  entry[12] = 0x20;
  entry[13] = exeName.length;
  entry.write(exeName, 14, 'ascii');
  fs.writeSync(fd, entry, 0, entry.length, base + rootSector * SECTOR);
  fs.ftruncateSync(fd, Math.max(magicPos + 0x40000, base + rootSector * SECTOR + 0x40000));
  fs.closeSync(fd);
}

// BIOS de PS2 simulado: ROMDIR con RESET / ROMDIR / ROMVER, como lo lee PCSX2.
function fakePs2Bios(romver = '0220AC20060905') {
  const buf = Buffer.alloc(4 * 1024 * 1024);
  const entry = (at, name, size) => {
    buf.write(name, at, 'latin1');
    buf.writeUInt32LE(size, at + 12);
  };
  entry(0x2700, 'RESET', 0x2700);
  entry(0x2710, 'ROMDIR', 0x60);
  entry(0x2720, 'ROMVER', 0x10);
  buf.write(romver, 0x2700 + 0x60, 'latin1');
  return buf;
}

// Biblioteca con la carpeta de ROMs de Drive ya configurada (como queda tras "Agregar carpeta").
const TEST_FOLDER = '1FakeFolderIdParaPruebas_abcdefgh';
function withCloudFolder(dataRoot, folderId = TEST_FOLDER) {
  const file = path.join(dataRoot, 'config', 'nube.json');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'nube.default.json'), 'utf8'));
  base.carpetas = [{ id: 'roms-principal', nombre: 'ROMs (Google Drive)', enlace: `https://drive.google.com/drive/folders/${folderId}`, cuenta: '' }];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(base, null, 2));
  return dataRoot;
}

// RAR 4 sin compresion (metodo "store"): suficiente para probar la descompresion de .rar.
function buildRar(files) {
  const crc = (b) => zlib.crc32(b) >>> 0;
  const head = (body) => {
    const out = Buffer.alloc(2 + body.length);
    out.writeUInt16LE(crc(body) & 0xffff, 0);
    body.copy(out, 2);
    return out;
  };
  const parts = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])];
  const main = Buffer.alloc(11);
  main.writeUInt8(0x73, 0); main.writeUInt16LE(0, 1); main.writeUInt16LE(13, 3);
  parts.push(head(main));
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const fname = Buffer.from(name.replace(/\//g, '\\'), 'latin1');
    const h = Buffer.alloc(30 + fname.length);
    h.writeUInt8(0x74, 0); // archivo
    h.writeUInt16LE(0x8000, 1); // con datos despues del encabezado
    h.writeUInt16LE(32 + fname.length, 3);
    h.writeUInt32LE(data.length, 5); // empacado
    h.writeUInt32LE(data.length, 9); // original
    h.writeUInt8(2, 13); // Windows
    h.writeUInt32LE(crc(data), 14);
    h.writeUInt32LE(0x5b2c0000, 18); // fecha DOS
    h.writeUInt8(20, 22); // version 2.0
    h.writeUInt8(0x30, 23); // store
    h.writeUInt16LE(fname.length, 24);
    h.writeUInt32LE(0x20, 26); // atributo "archivo"
    fname.copy(h, 30);
    parts.push(head(h), data);
  }
  const end = Buffer.alloc(5);
  end.writeUInt8(0x7b, 0); end.writeUInt16LE(0x4000, 1); end.writeUInt16LE(7, 3);
  parts.push(head(end));
  return Buffer.concat(parts);
}

module.exports = { buildRar, TEST_FOLDER, withCloudFolder, fakePs2Bios, tmpDir, buildIso9660, toRawMode2, toCso, buildSfo, buildPbp, buildZip, nintendoDisc, rvz, xboxImage, writeXboxImage };
