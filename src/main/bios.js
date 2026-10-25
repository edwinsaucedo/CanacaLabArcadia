'use strict';
// Revisa que una consola tenga sus BIOS antes de abrir un juego, para no caer en la pantalla de error del emulador.
// La lista sale de "bios" en config/systems.json.
const fs = require('fs');
const path = require('path');
const { listZipDetails } = require('./detect');

// Donde se busca cada BIOS: junto al juego, en la carpeta de juegos de la consola y en la carpeta bios (y sus copias).
function candidates(dataRoot, sys, def, romPath) {
  const dirs = [];
  if (romPath) dirs.push(path.dirname(romPath));
  dirs.push(path.join(dataRoot, 'roms', sys.id), path.join(dataRoot, 'bios'));
  for (const rel of def.copyTo || []) dirs.push(path.join(dataRoot, ...rel.split('/')));
  return [...new Set(dirs)];
}

function findIn(dir, name) {
  try {
    const hit = fs.readdirSync(dir).find((n) => n.toLowerCase() === name.toLowerCase());
    return hit ? path.join(dir, hit) : null;
  } catch {
    return null;
  }
}

// Que archivos de "contains" no estan en el .zip. Se compara por CRC (el nombre puede variar entre sets).
function missingInside(file, contains) {
  const wanted = Object.entries(contains || {});
  if (!wanted.length || !/\.zip$/i.test(file)) return [];
  const entries = listZipDetails(file);
  if (!entries) return wanted.map(([n]) => n);
  const crcs = new Set(entries.map((e) => (e.crc >>> 0).toString(16).padStart(8, '0')));
  return wanted.filter(([, crc]) => !crcs.has(String(crc).toLowerCase().padStart(8, '0'))).map(([n]) => n);
}

// { ok, problems: [{ file, kind: 'falta' | 'incompleto', faltan: [...] }] }. Si el BIOS bueno esta en un lugar
// que el emulador no lee, lo copia a "copyTo" (por ejemplo FBNeo solo lee bios/fbneo o la carpeta del juego).
function checkBios(dataRoot, sys, romPath) {
  const defs = (sys && sys.bios) || [];
  const problems = [];
  for (const def of defs) {
    const found = candidates(dataRoot, sys, def, romPath).map((d) => findIn(d, def.file)).filter(Boolean);
    if (!found.length) {
      problems.push({ file: def.file, kind: 'falta', faltan: [] });
      continue;
    }
    let best = null;
    let bestMissing = null;
    for (const f of found) {
      const m = missingInside(f, def.contains);
      if (!bestMissing || m.length < bestMissing.length) { best = f; bestMissing = m; }
      if (!m.length) break;
    }
    if (bestMissing.length) {
      problems.push({ file: def.file, kind: 'incompleto', faltan: bestMissing, path: best });
      continue;
    }
    for (const rel of def.copyTo || []) {
      const dir = path.join(dataRoot, ...rel.split('/'));
      const target = path.join(dir, def.file);
      if (path.resolve(target) === path.resolve(best)) continue;
      try {
        if (!fs.existsSync(target) || missingInside(target, def.contains).length) {
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(best, target);
        }
      } catch { /* si no se puede copiar, el emulador aun puede leerlo junto al juego */ }
    }
  }
  return { ok: problems.length === 0, problems };
}

function biosMessage(sys, problems, dataRoot) {
  const p = problems[0];
  const romsDir = path.join(dataRoot, 'roms', sys.id);
  if (p.kind === 'falta') {
    return `Falta el BIOS ${p.file}. Súbelo a la carpeta BIOS de tu Google Drive y descárgalo en Menú > Nube, o cópialo en ${romsDir}.`;
  }
  return `Tu ${p.file} no sirve para esta versión del emulador: le falta ${p.faltan.join(', ')}. Reemplázalo por un ${p.file} actualizado (set para FBNeo).`;
}

module.exports = { checkBios, biosMessage, missingInside };
