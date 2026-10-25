'use strict';
// Arma el comando de cada emulador, abre el juego y lo vigila hasta que se cierre.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

// Reemplaza {rom}, {core}, {config}, {emudir} en la lista de argumentos.
// Se pasa como arreglo a spawn (sin shell), asi que espacios y acentos en rutas no rompen nada.
function buildArgs(template, vars) {
  return template.map((a) => a.replace(/\{(rom|core|config|emudir)\}/g, (_, k) => vars[k] ?? ''));
}

function buildCommand({ catalog, settings, resolved, game, configDir }) {
  const def = catalog.emulators[resolved.emu];
  const template = (settings.customArgs && settings.customArgs[resolved.emu]) || def.args;
  const args = buildArgs(template, {
    rom: game.launch || game.path,
    core: resolved.corePath || '',
    config: configDir,
    emudir: path.dirname(resolved.exe)
  });
  return { exe: resolved.exe, args, cwd: path.dirname(resolved.exe) };
}

class GameSession extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.game = null;
    this.startedAt = 0;
    this.closing = false;
  }

  get running() {
    return !!this.proc;
  }

  start(cmd, game) {
    if (this.proc) throw new Error('Ya hay un juego abierto');
    if (!fs.existsSync(cmd.exe)) throw new Error(`No existe ${cmd.exe}`);
    // SDL (RetroArch, PCSX2, xemu, shadPS4, Dolphin): que el control funcione aunque Windows tarde en darle el foco.
    const env = { ...process.env, SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '1', ...(cmd.env || {}) };
    const proc = spawn(cmd.exe, cmd.args, { cwd: cmd.cwd, windowsHide: false, stdio: 'ignore', env });
    this.proc = proc;
    this.game = game;
    this.startedAt = Date.now();
    this.closing = false;
    proc.on('error', (e) => {
      this.emit('error', e);
      this._finish(-1);
    });
    proc.on('exit', (code) => this._finish(code));
    this.emit('started', { game, pid: proc.pid });
    return proc.pid;
  }

  _finish(code) {
    if (!this.proc) return;
    const seconds = (Date.now() - this.startedAt) / 1000;
    const game = this.game;
    this.proc = null;
    this.game = null;
    this.emit('ended', { game, code, seconds, forced: this.closing });
  }

  // Cierre amable (como presionar la X); si no responde en 3 s, se fuerza.
  stop() {
    if (!this.proc) return false;
    this.closing = true;
    const pid = this.proc.pid;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => {});
      setTimeout(() => {
        if (this.proc && this.proc.pid === pid) {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
        }
      }, 3000);
    } else {
      try { this.proc.kill('SIGTERM'); } catch { /* nada */ }
      setTimeout(() => {
        if (this.proc && this.proc.pid === pid) {
          try { this.proc.kill('SIGKILL'); } catch { /* nada */ }
        }
      }, 3000);
    }
    return true;
  }
}

module.exports = { buildArgs, buildCommand, GameSession };
