'use strict';
// Carga el catalogo de consolas y emuladores (config/*.json).
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let cache = null;

function loadCatalog(configDir = CONFIG_DIR) {
  if (cache && cache.dir === configDir) return cache;
  const systems = readJson(path.join(configDir, 'systems.json')).systems;
  const emuFile = readJson(path.join(configDir, 'emulators.json'));
  const emulators = emuFile.emulators;
  const retroarchCores = emuFile.retroarchCores || [];
  const tools = emuFile.tools || {};

  // Validacion basica para detectar errores al editar los JSON a mano.
  const ids = new Set();
  for (const s of systems) {
    if (!s.id || ids.has(s.id)) throw new Error(`systems.json: id repetido o vacio (${s.id})`);
    ids.add(s.id);
    s.ext = (s.ext || []).map((e) => e.toLowerCase());
    s.ignore = (s.ignore || []).map((e) => e.toLowerCase());
    for (const ref of s.emulators || []) {
      if (!emulators[ref.emu]) throw new Error(`systems.json: ${s.id} usa el emulador "${ref.emu}" que no existe en emulators.json`);
    }
  }
  cache = { dir: configDir, systems, emulators, tools, retroarchCores, byId: Object.fromEntries(systems.map((s) => [s.id, s])) };
  return cache;
}

function resetCatalogCache() {
  cache = null;
}

module.exports = { loadCatalog, resetCatalogCache, CONFIG_DIR };
