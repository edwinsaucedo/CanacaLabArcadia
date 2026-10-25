'use strict';
// Ajustes de CanacaLabArcadia y datos del usuario (favoritos, tiempo jugado, recientes).
// Todo se guarda en JSON con escritura atomica para no corromper archivos si se apaga la Ally X.
const fs = require('fs');
const path = require('path');

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  dataRoot: null,
  extraRomDirs: {},
  emuPaths: {},
  defaultEmu: {},
  customArgs: {},
  startFullscreen: true,
  sounds: true,
  showEmptySystems: true,
  homeGames: false,
  exitHoldMs: 1200,
  emulatorsOffline: false,
  firstRunDone: false
};

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULT_SETTINGS, ...readJsonSafe(file, {}) };
  }
  get() {
    return JSON.parse(JSON.stringify(this.data));
  }
  update(patch) {
    this.data = { ...this.data, ...patch };
    writeJsonAtomic(this.file, this.data);
    return this.get();
  }
}

class UserData {
  constructor(file) {
    this.file = file;
    this.data = { favorites: [], playtime: {}, lastPlayed: {}, ...readJsonSafe(file, {}) };
  }
  save() {
    writeJsonAtomic(this.file, this.data);
  }
  get() {
    return JSON.parse(JSON.stringify(this.data));
  }
  toggleFavorite(gameId) {
    const i = this.data.favorites.indexOf(gameId);
    if (i >= 0) this.data.favorites.splice(i, 1);
    else this.data.favorites.push(gameId);
    this.save();
    return i < 0;
  }
  addPlaytime(gameId, seconds) {
    this.data.playtime[gameId] = (this.data.playtime[gameId] || 0) + Math.max(0, Math.round(seconds));
    this.data.lastPlayed[gameId] = new Date().toISOString();
    this.save();
  }
  markPlayed(gameId) {
    this.data.lastPlayed[gameId] = new Date().toISOString();
    this.save();
  }
}

module.exports = { SettingsStore, UserData, readJsonSafe, writeJsonAtomic, DEFAULT_SETTINGS };
