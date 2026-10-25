'use strict';
// Consola cerrada (CanacaLabArcadia abierta desde la ventana del instalador): escribir no debe romper nada.
const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('stream');
const { guardStream } = require('../src/main/stdio');

test('consola cerrada: escribir en ella ya no lanza "EBADF: bad file descriptor, write"', () => {
  const broken = new Writable({ write(_c, _e, cb) { cb(); } });
  broken.write = () => { const e = new Error('EBADF: bad file descriptor, write'); e.code = 'EBADF'; throw e; };
  const proc = { stdout: broken };
  const s = guardStream('stdout', proc);
  assert.doesNotThrow(() => s.write('hola\n'));
  let called = false;
  s.write('x', () => { called = true; });
  assert.equal(called, true, 'el aviso de "ya escribi" se da aunque no haya consola');
  assert.equal(guardStream('stdout', proc), s, 'no se envuelve dos veces');
});

test('sin consola desde el inicio: se usa una salida vacia', () => {
  const proc = {};
  Object.defineProperty(proc, 'stderr', { configurable: true, get() { const e = new Error('EBADF: bad file descriptor, write'); throw e; } });
  const s = guardStream('stderr', proc);
  assert.doesNotThrow(() => s.write('hola'));
  assert.equal(proc.stderr, s);
});
