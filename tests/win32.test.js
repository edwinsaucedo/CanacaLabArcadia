'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handOffFocus } = require('../src/main/win32');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('foco: espera la ventana del emulador, se la da y despues minimiza CanacaLabArcadia', async () => {
  const log = [];
  let calls = 0;
  const api = {
    findWindow: (pid) => { calls++; return calls >= 3 ? `hwnd-${pid}` : null; },
    focus: (h) => { log.push(`foco ${h}`); return true; }
  };
  const done = new Promise((resolve) => handOffFocus({
    pid: 42, api, intervalMs: 10, settleMs: 10, done: (how) => { log.push(`minimizar (${how})`); resolve(); }
  }));
  await done;
  assert.deepEqual(log, ['foco hwnd-42', 'minimizar (ventana)'], 'primero el foco al juego, luego minimizar');
});

test('foco: si el emulador nunca abre ventana, igual se minimiza al pasar el tiempo', async () => {
  let how = null;
  handOffFocus({ pid: 1, api: { findWindow: () => null, focus: () => true }, intervalMs: 5, timeoutMs: 30, done: (h) => { how = h; } });
  await wait(80);
  assert.equal(how, 'tiempo');
});

test('foco: si el juego se cierra antes, no se minimiza nada raro', async () => {
  let how = null;
  handOffFocus({ pid: 1, api: { findWindow: () => null, focus: () => true }, isRunning: () => false, intervalMs: 5, done: (h) => { how = h; } });
  await wait(30);
  assert.equal(how, 'termino');
});

test('foco: sin Windows (pruebas) solo espera un momento', async () => {
  let how = null;
  handOffFocus({ pid: 1, api: null, fallbackMs: 10, done: (h) => { how = h; } });
  await wait(30);
  assert.equal(how, 'sin-win32');
});
