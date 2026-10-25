'use strict';
// Lector de PARAM.SFO (PS3, PS4, PSP y PBP). Sirve para mostrar el nombre real del juego
// en lugar del nombre de la carpeta (por ejemplo "BLUS30443" -> "Demon's Souls").
const fs = require('fs');

function parseSfo(buf) {
  if (!buf || buf.length < 20) return null;
  if (buf.readUInt32BE(0) !== 0x00505346) return null; // "\0PSF"
  const keyTable = buf.readUInt32LE(8);
  const dataTable = buf.readUInt32LE(12);
  const count = buf.readUInt32LE(16);
  if (count > 512 || keyTable > buf.length || dataTable > buf.length) return null;
  const out = {};
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    if (e + 16 > buf.length) break;
    const keyOff = buf.readUInt16LE(e);
    const fmt = buf.readUInt16LE(e + 2);
    const len = buf.readUInt32LE(e + 4);
    const dataOff = buf.readUInt32LE(e + 12);
    const kStart = keyTable + keyOff;
    let kEnd = kStart;
    while (kEnd < buf.length && buf[kEnd] !== 0) kEnd++;
    const key = buf.toString('utf8', kStart, kEnd);
    const dStart = dataTable + dataOff;
    if (dStart + len > buf.length) continue;
    if (fmt === 0x0404) {
      out[key] = len >= 4 ? buf.readUInt32LE(dStart) : 0;
    } else {
      out[key] = buf.toString('utf8', dStart, dStart + len).replace(/\0+$/, '');
    }
  }
  return out;
}

function readSfoFile(file) {
  try {
    return parseSfo(fs.readFileSync(file));
  } catch {
    return null;
  }
}

// PBP (EBOOT.PBP de PSP o PS1 "PSone Classic"): el PARAM.SFO va embebido.
function readPbpSfo(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(40);
    fs.readSync(fd, head, 0, 40, 0);
    if (head.readUInt32BE(0) !== 0x00504250) return null; // "\0PBP"
    const sfoStart = head.readUInt32LE(8);
    const sfoEnd = head.readUInt32LE(12);
    const size = sfoEnd - sfoStart;
    if (size <= 0 || size > 1024 * 1024) return null;
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, sfoStart);
    return parseSfo(buf);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { parseSfo, readSfoFile, readPbpSfo };
