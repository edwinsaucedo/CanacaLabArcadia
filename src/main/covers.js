'use strict';
// Portadas opcionales desde el repositorio publico de libretro-thumbnails (requiere internet,
// solo cuando TU lo pides). Funciona cuando el nombre del archivo sigue la convencion No-Intro / Redump,
// por ejemplo "Super Mario World (USA).sfc". Si no hay portada, CanacaLabArcadia dibuja una con el titulo.
const fs = require('fs');
const path = require('path');

const BASE = 'https://thumbnails.libretro.com';

function thumbName(name) {
  return name.replace(/[&*/:`<>?\\|"]/g, '_');
}

function thumbUrl(system, rawName, kind = 'Named_Boxarts', base = BASE) {
  return `${base}/${encodeURIComponent(system)}/${kind}/${encodeURIComponent(thumbName(rawName))}.png`;
}

async function fetchCovers(dataRoot, catalog, library, opts = {}) {
  const queue = [];
  for (const sys of catalog.systems) {
    if (!sys.thumbs) continue;
    for (const g of library[sys.id] || []) {
      if (!g.cover && !g.folderGame) queue.push({ sys, g });
    }
  }
  return fetchCoverItems(dataRoot, queue, opts);
}

// items: [{ sys, g }] con g.rawName. Devuelve tambien las que no existen ("consola/nombre") para no volver a pedirlas.
async function fetchCoverItems(dataRoot, items, { onProgress, fetchImpl = fetch, base = BASE, concurrency = 4 } = {}) {
  const queue = items;
  const result = { found: 0, missing: 0, total: queue.length, misses: [] };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const { sys, g } = queue[i++];
      const dest = path.join(dataRoot, 'media', 'covers', sys.id, `${g.rawName}.png`);
      try {
        // "Copia de Juego (USA)" se busca como "Juego (USA)"; se guarda con el nombre del archivo.
        const lookup = String(g.rawName).replace(/^\s*(copia de|copy of)\s+/i, '');
        const r = await fetchImpl(thumbUrl(sys.thumbs, lookup, 'Named_Boxarts', base), { headers: { 'User-Agent': 'CanacaLabArcadia-Frontend/1.0' } });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 100 && buf.readUInt32BE(0) === 0x89504e47) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, buf);
            result.found++;
          } else { result.missing++; result.misses.push(`${sys.id}/${lookup}`); }
        } else {
          result.missing++;
          if (r.status === 404) result.misses.push(`${sys.id}/${lookup}`);
        }
      } catch {
        result.missing++;
      }
      onProgress && onProgress({ done: result.found + result.missing, total: queue.length, title: g.title });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return result;
}

module.exports = { fetchCovers, fetchCoverItems, thumbUrl, thumbName };
