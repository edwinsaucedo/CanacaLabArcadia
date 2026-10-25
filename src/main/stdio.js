'use strict';
// Si CanacaLabArcadia se abrio desde una ventana negra (por ejemplo, al final de INSTALAR.bat), Electron se engancha a
// esa consola. Cuando la ventana se cierra, escribir en la consola da "EBADF: bad file descriptor, write" y ese error
// rompia lo que estuvieras haciendo (abrir un juego, descargar...). Aqui la consola se vuelve opcional: si ya no
// existe, lo que se escribe en ella simplemente se descarta.
const { Writable } = require('stream');

function blackHole() {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}

function guardStream(name, proc = process) {
  let stream = null;
  try { stream = proc[name]; } catch { stream = null; }
  if (!stream || typeof stream.write !== 'function') {
    stream = blackHole();
    try { Object.defineProperty(proc, name, { value: stream, configurable: true, writable: true }); } catch { /* se queda como estaba */ }
    return stream;
  }
  if (stream.__arcadiaGuarded) return stream;
  try { stream.on('error', () => {}); } catch { /* sin eventos */ }
  const original = stream.write.bind(stream);
  stream.write = function safeWrite(chunk, encoding, cb) {
    try {
      return original(chunk, encoding, cb);
    } catch {
      const done = typeof encoding === 'function' ? encoding : cb;
      if (typeof done === 'function') { try { done(); } catch { /* nada */ } }
      return true;
    }
  };
  stream.__arcadiaGuarded = true;
  return stream;
}

function guardStdio(proc = process) {
  return { stdout: guardStream('stdout', proc), stderr: guardStream('stderr', proc) };
}

module.exports = { guardStdio, guardStream };
