'use strict';
// "Agregar juegos": el usuario arrastra archivos o carpetas (o una USB completa) y CanacaLabArcadia
// detecta la consola de cada uno y los copia/mueve a roms/<consola>/ con sus archivos acompanantes.
const fs = require('fs');
const path = require('path');
const { detect, detectFolder, UNIQUE_EXT } = require('./detect');

const KNOWN_EXT = new Set([
  ...Object.keys(UNIQUE_EXT), '.iso', '.cso', '.zso', '.chd', '.cue', '.ccd', '.m3u', '.pbp', '.gcz', '.rvz',
  '.ciso', '.bin', '.img', '.zip', '.7z', '.gz', '.xex'
]);

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function companionsOf(file) {
  const dir = path.dirname(file);
  const lower = file.toLowerCase();
  const out = [];
  const add = (name) => {
    const p = path.isAbsolute(name) ? name : path.join(dir, name);
    if (fs.existsSync(p) && !out.includes(p)) out.push(p);
  };
  try {
    if (lower.endsWith('.cue')) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/FILE\s+"([^"]+)"/gi)) add(m[1]);
    } else if (lower.endsWith('.m3u')) {
      for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = l.trim();
        if (!t || t.startsWith('#')) continue;
        add(t);
        for (const c of companionsOf(path.join(dir, t))) add(c);
      }
    } else if (lower.endsWith('.ccd')) {
      add(path.basename(file).replace(/\.ccd$/i, '.img'));
      add(path.basename(file).replace(/\.ccd$/i, '.sub'));
    } else if (lower.endsWith('.iso')) {
      // RPCS3: la llave de un ISO cifrado de PS3 va junto al ISO con el mismo nombre.
      add(path.basename(file).replace(/\.iso$/i, '.dkey'));
    }
  } catch { /* sin acompanantes */ }
  return out;
}

// Recorre lo que se solto y arma la lista de juegos encontrados.
function buildImportPlan(paths, { maxDepth = 4 } = {}) {
  const items = [];
  const consumed = new Set();

  const visit = (p, depth) => {
    const st = safeStat(p);
    if (!st) return;
    if (st.isDirectory()) {
      const folderGame = detectFolder(p);
      if (folderGame) {
        items.push({ src: p, isFolder: true, size: 0, ...folderGame });
        return;
      }
      if (depth >= maxDepth) return;
      let entries = [];
      try {
        entries = fs.readdirSync(p);
      } catch { /* sin permiso */ }
      // Primero los indices (.m3u, .cue) para que sus discos no salgan repetidos.
      entries.sort((a, b) => rank(a) - rank(b));
      for (const name of entries) visit(path.join(p, name), depth + 1);
      return;
    }
    const key = path.resolve(p).toLowerCase();
    if (consumed.has(key)) return;
    const ext = path.extname(p).toLowerCase();
    if (!KNOWN_EXT.has(ext)) return;
    const r = detect(p);
    if (r.ignored) return;
    const companions = companionsOf(p);
    for (const c of companions) consumed.add(path.resolve(c).toLowerCase());
    items.push({ src: p, isFolder: false, size: st.size, companions, ...r });
  };

  for (const p of paths) visit(p, 0);
  return items.map((it, i) => ({ index: i, name: path.basename(it.src), ...it }));
}

function rank(name) {
  const l = name.toLowerCase();
  if (l.endsWith('.m3u')) return 0;
  if (l.endsWith('.cue') || l.endsWith('.ccd')) return 1;
  return 2;
}

function uniqueDest(destDir, name, srcSize) {
  let dest = path.join(destDir, name);
  const st = safeStat(dest);
  if (!st) return { dest, skip: false };
  if (st.isFile() && st.size === srcSize) return { dest, skip: true };
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    dest = path.join(destDir, `${base} (${i})${ext}`);
    if (!safeStat(dest)) return { dest, skip: false };
  }
  throw new Error(`Demasiados archivos con el nombre ${name}`);
}

async function copyFileWithProgress(src, dest, onBytes) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.copiando`;
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 });
    const ws = fs.createWriteStream(tmp);
    rs.on('data', (c) => onBytes && onBytes(c.length));
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });
  await fs.promises.rename(tmp, dest);
}

async function moveOrCopy(src, dest, move, onBytes) {
  if (move) {
    try {
      await fs.promises.rename(src, dest);
      const st = safeStat(dest);
      if (st && onBytes) onBytes(st.isFile() ? st.size : 0);
      return;
    } catch (e) {
      if (e.code !== 'EXDEV') throw e; // otra unidad: copiar y luego borrar
    }
  }
  const st = await fs.promises.stat(src);
  if (st.isDirectory()) {
    await fs.promises.mkdir(dest, { recursive: true });
    for (const name of await fs.promises.readdir(src)) {
      await moveOrCopy(path.join(src, name), path.join(dest, name), false, onBytes);
    }
  } else {
    await copyFileWithProgress(src, dest, onBytes);
  }
  if (move) await fs.promises.rm(src, { recursive: true, force: true });
}

function totalSize(p) {
  const st = safeStat(p);
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let t = 0;
  for (const n of fs.readdirSync(p)) t += totalSize(path.join(p, n));
  return t;
}

// items: [{ src, system, isFolder, companions }] ya confirmados por el usuario.
async function executeImport(dataRoot, items, { move = false, onProgress } = {}) {
  const jobs = items.filter((i) => i.system);
  const grand = jobs.reduce((t, j) => t + totalSize(j.src) + (j.companions || []).reduce((a, c) => a + totalSize(c), 0), 0);
  let done = 0;
  const report = { added: [], skipped: [], failed: [] };
  const tick = (n) => {
    done += n;
    onProgress && onProgress({ done, total: grand, pct: grand ? Math.min(100, Math.round((done / grand) * 100)) : 100 });
  };
  for (const job of jobs) {
    const destDir = path.join(dataRoot, 'roms', job.system);
    try {
      await fs.promises.mkdir(destDir, { recursive: true });
      const size = job.isFolder ? 0 : totalSize(job.src);
      const { dest, skip } = uniqueDest(destDir, path.basename(job.src), size);
      if (skip) {
        report.skipped.push(job.src);
        tick(size);
        continue;
      }
      await moveOrCopy(job.src, dest, move, tick);
      for (const c of job.companions || []) {
        const cd = path.join(destDir, path.basename(c));
        if (!safeStat(cd)) await moveOrCopy(c, cd, move, tick);
      }
      report.added.push({ src: job.src, dest, system: job.system });
    } catch (e) {
      report.failed.push({ src: job.src, error: e.message });
    }
  }
  return report;
}

module.exports = { buildImportPlan, executeImport, companionsOf, uniqueDest };
