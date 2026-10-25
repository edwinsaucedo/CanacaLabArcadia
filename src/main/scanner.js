'use strict';
// Escanea las carpetas de ROMs y arma la biblioteca de juegos por consola.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectFolder, detectFile } = require('./detect');
const { readPbpSfo } = require('./sfo');
const { classifySwitchFile } = require('./nsp');

const COVER_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const REGIONS = {
  usa: 'USA', 'u': 'USA', europe: 'Europa', eur: 'Europa', e: 'Europa', japan: 'Japón', jpn: 'Japón', j: 'Japón',
  world: 'Mundo', brazil: 'Brasil', korea: 'Corea', spain: 'España', france: 'Francia', germany: 'Alemania',
  italy: 'Italia', asia: 'Asia', australia: 'Australia', mexico: 'México', 'latin america': 'Latinoamérica'
};

let arcadeNames = null;
function loadArcadeNames() {
  if (arcadeNames) return arcadeNames;
  try {
    arcadeNames = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'arcade-names.json'), 'utf8'));
  } catch {
    arcadeNames = {};
  }
  return arcadeNames;
}

function gameId(system, p) {
  return crypto.createHash('sha1').update(`${system}|${path.resolve(p).toLowerCase()}`).digest('hex').slice(0, 12);
}

// "Final Fantasy X (USA) (Disc 1) [!]" -> { title: "Final Fantasy X", region: "USA", disc: 1 }
function parseName(raw) {
  const tags = [];
  const re = /[([]([^)\]]*)[)\]]/g;
  let m;
  while ((m = re.exec(raw))) tags.push(m[1].trim());
  const title = raw.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || raw;
  let region = null;
  let disc = null;
  for (const t of tags) {
    const parts = t.toLowerCase().split(/\s*,\s*/);
    for (const p of parts) if (!region && REGIONS[p]) region = REGIONS[p];
    const d = t.match(/^(?:disc|disco|cd)\s*(\d+)/i);
    if (d) disc = Number(d[1]);
  }
  return { title, region, disc };
}

function findCover(dataRoot, system, names) {
  const dir = path.join(dataRoot, 'media', 'covers', system);
  for (const n of names) {
    if (!n) continue;
    for (const e of COVER_EXT) {
      const f = path.join(dir, n + e);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function fileSizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  for (const e of safeReaddir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p, depth + 1);
    else total += fileSizeOf(p);
  }
  return total;
}

// Archivos que no deben salir como juegos sueltos: los .bin de un .cue, los discos de un .m3u, etc.
function hiddenByIndexes(dir, entries) {
  const hidden = new Set();
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    const full = path.join(dir, e.name);
    if (lower.endsWith('.cue')) {
      try {
        const txt = fs.readFileSync(full, 'utf8');
        for (const m of txt.matchAll(/FILE\s+"([^"]+)"/gi)) hidden.add(m[1].toLowerCase());
      } catch { /* ignorar */ }
    }
    if (lower.endsWith('.m3u')) {
      try {
        for (const l of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
          const t = l.trim();
          if (t && !t.startsWith('#')) hidden.add(path.basename(t).toLowerCase());
        }
      } catch { /* ignorar */ }
    }
  }
  return hidden;
}

// Titulo que se muestra: el nombre limpio, o el nombre real de los juegos de arcade (mslug -> Metal Slug).
// "Copia de Mario Kart 64 (USA)" (lo que pone Google Drive al copiar un archivo) -> "Mario Kart 64 (USA)".
function withoutCopyPrefix(name) {
  return String(name || '').replace(/^\s*(copia de|copy of)\s+/i, '');
}

function titleFor(systemId, rawName, given = null) {
  if (given) return given;
  const clean = withoutCopyPrefix(rawName);
  const parsed = parseName(clean);
  if (systemId === 'mame' || systemId === 'neogeo') {
    const names = loadArcadeNames();
    return names[clean.toLowerCase()] || clean.toUpperCase();
  }
  // Los juegos de Switch suelen traer [title ID][v0] en el nombre: ya los quita parseName.
  // Carpetas de PS3/PS4 con el codigo del disco al inicio: "BLUS30443 - Demon's Souls" -> "Demon's Souls".
  const noSerial = parsed.title.replace(/^[A-Z]{4}[-_]?\d{5}\s*[-_–:]\s*/, '').trim();
  return noSerial || parsed.title;
}

function makeGame(dataRoot, system, info) {
  const parsed = parseName(info.rawName);
  const title = titleFor(system.id, info.rawName, info.title);
  const cover = findCover(dataRoot, system.id, [info.rawName, withoutCopyPrefix(info.rawName), title, parsed.title, info.serial]) || info.icon || null;
  return {
    id: gameId(system.id, info.path),
    system: system.id,
    title,
    rawName: info.rawName,
    path: info.path,
    launch: info.launch || info.path,
    size: info.size || 0,
    region: parsed.region,
    disc: parsed.disc,
    serial: info.serial || null,
    cover,
    folderGame: !!info.folderGame
  };
}

function scanFileSystem(dataRoot, system, root, games, depth = 0) {
  if (depth > 3) return;
  const entries = safeReaddir(root);
  const hidden = hiddenByIndexes(root, entries);
  for (const e of entries) {
    const full = path.join(root, e.name);
    const lower = e.name.toLowerCase();
    if (e.isDirectory()) {
      if (system.folderGames) {
        const r = detectFolder(full);
        if (r && r.system === system.id && r.launch) {
          games.push(makeGame(dataRoot, system, {
            rawName: e.name, path: full, launch: r.launch, title: r.title, serial: r.serial,
            icon: r.icon, size: dirSize(full), folderGame: true
          }));
          continue;
        }
      }
      if (lower.startsWith('.') || lower === 'bios' || lower === 'media') continue;
      scanFileSystem(dataRoot, system, full, games, depth + 1);
      continue;
    }
    if (!e.isFile()) continue;
    if (hidden.has(lower) || system.ignore.includes(lower)) continue;
    const ext = system.ext.find((x) => lower.endsWith(x));
    if (!ext) continue;
    let title = null;
    let serial = null;
    if (lower.endsWith('.pbp')) {
      const sfo = readPbpSfo(full);
      if (sfo) {
        // Un PBP de PS1 en la carpeta de PSP (o al reves) se queda donde lo puso el usuario.
        title = sfo.TITLE || null;
        serial = sfo.DISC_ID || null;
      }
    }
    // Los updates y DLC de Switch no son juegos: Eden los toma solos (ver switchsetup.js).
    if (system.id === 'switch' && lower.endsWith('.nsp') && classifySwitchFile(full).kind !== 'base') continue;
    const rawName = e.name.slice(0, e.name.length - ext.length);
    games.push(makeGame(dataRoot, system, { rawName, path: full, title, serial, size: fileSizeOf(full) }));
  }
}

function romDirsFor(dataRoot, settings, systemId) {
  const dirs = [path.join(dataRoot, 'roms', systemId)];
  for (const d of (settings.extraRomDirs && settings.extraRomDirs[systemId]) || []) dirs.push(d);
  return dirs;
}

function scanSystem(dataRoot, settings, system) {
  const games = [];
  for (const dir of romDirsFor(dataRoot, settings, system.id)) {
    if (fs.existsSync(dir)) scanFileSystem(dataRoot, system, dir, games);
  }
  // Quitar duplicados (misma ruta agregada dos veces) y ordenar alfabeticamente.
  const seen = new Set();
  const unique = games.filter((g) => (seen.has(g.id) ? false : seen.add(g.id)));
  unique.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base', numeric: true }));
  return unique;
}

function scanLibrary(dataRoot, settings, catalog) {
  const library = {};
  for (const s of catalog.systems) library[s.id] = scanSystem(dataRoot, settings, s);
  return library;
}

// Clasifica un archivo suelto que el usuario quiere agregar (lo usa el importador).
function classifyForImport(p) {
  return detectFile(p);
}

module.exports = { scanLibrary, scanSystem, parseName, gameId, romDirsFor, classifyForImport, dirSize, titleFor, findCover, withoutCopyPrefix };
