#!/usr/bin/env node
'use strict';
// rclone simulado para las pruebas: "Google Drive" es una carpeta local FAKE_DRIVE/<id de carpeta>/...
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes(name);
const conf = opt('--config');
const DRIVE = process.env.FAKE_DRIVE;

function readConf() {
  try {
    return fs.readFileSync(conf, 'utf8');
  } catch {
    return '';
  }
}
function sections() {
  return [...readConf().matchAll(/^\[(.+)\]\s*\ntype = (\S+)/gm)].map((m) => ({ name: m[1], type: m[2] }));
}
function resolveRemote(spec) {
  const i = spec.indexOf(':');
  const remote = spec.slice(0, i);
  const sub = spec.slice(i + 1);
  if (!sections().some((s) => s.name === remote)) {
    process.stderr.write(JSON.stringify({ level: 'error', msg: `didn't find section in config file ("${remote}")` }) + '\n');
    process.exit(1);
  }
  const root = path.join(DRIVE, opt('--drive-root-folder-id'));
  if (!fs.existsSync(root)) {
    process.stderr.write(JSON.stringify({ level: 'error', msg: 'directory not found' }) + '\n');
    process.exit(3);
  }
  return path.join(root, sub);
}

const [cmd, sub] = args;
if (cmd === 'listremotes') {
  for (const s of sections()) process.stdout.write(`${s.name}: ${s.type}\n`);
  process.exit(0);
}
if (cmd === 'config' && sub === 'create') {
  const name = args[2];
  process.stderr.write(`NOTICE: If your browser doesn't open automatically go to the following link: http://127.0.0.1:53682/auth?state=abc123\n`);
  process.stderr.write('NOTICE: Log in and authorize rclone for access\n');
  if (process.env.FAKE_AUTH_FAIL) {
    process.stderr.write('CRITICAL: Failed to create drive remote: auth error\n');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.appendFileSync(conf, `[${name}]\ntype = drive\nscope = drive.readonly\ntoken = {"access_token":"x"}\n\n`);
  process.exit(0);
}
if (cmd === 'config' && sub === 'userinfo') {
  process.stdout.write(JSON.stringify({ Email: 'jugadora@example.com' }));
  process.exit(0);
}
if (cmd === 'config' && sub === 'delete') {
  const name = args[2];
  const txt = readConf().replace(new RegExp(`^\\[${name}\\][\\s\\S]*?(?=^\\[|$(?![\\s\\S]))`, 'm'), '');
  fs.writeFileSync(conf, txt);
  process.exit(0);
}
if (cmd === 'lsjson') {
  const dir = resolveRemote(args[1]);
  const out = [];
  const walk = (d, rel, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!has('--files-only')) out.push({ Path: p, Name: e.name, Size: -1, IsDir: true, ID: `id-${p}` });
        if (has('-R')) walk(full, p, depth + 1);
      } else if (!has('--dirs-only')) {
        out.push({ Path: p, Name: e.name, Size: fs.statSync(full).size, IsDir: false, ID: `id-${p}` });
      }
    }
  };
  walk(dir, '', 0);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
if (cmd === 'copy') {
  const src = resolveRemote(args[1]);
  const dest = args[2];
  if (!fs.existsSync(src)) {
    process.stderr.write(JSON.stringify({ level: 'error', msg: `error reading source root directory: directory not found` }) + '\n');
    process.exit(3);
  }
  fs.mkdirSync(dest, { recursive: true });
  const st = fs.statSync(src);
  let total = 0;
  if (st.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
    const sum = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((t, e) => t + (e.isDirectory() ? sum(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
    total = sum(src);
  } else {
    fs.copyFileSync(src, path.join(dest, path.basename(src)));
    total = st.size;
  }
  const stats = (bytes) => JSON.stringify({ level: 'notice', msg: 'stats', stats: { bytes, totalBytes: total, speed: 1000, eta: 0 } }) + '\n';
  process.stderr.write(stats(Math.floor(total / 2)));
  process.stderr.write(stats(total));
  process.exit(0);
}
process.stderr.write(`fake rclone: comando no soportado ${args.join(' ')}\n`);
process.exit(2);
