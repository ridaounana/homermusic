'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', 'logs'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(root);

let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log(`  ERR   ${path.relative(root, f)}\n${e.stderr?.toString() || e.message}`);
  }
}
console.log(`${files.length - bad}/${files.length} files parse cleanly`);

// Every command must expose a valid, uniquely-named slash command.
const cmdDir = path.join(root, 'src', 'commands');
const names = new Set();
let cmdErrors = 0;
for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'))) {
  const mod = require(path.join(cmdDir, file));
  const name = mod?.data?.toJSON?.().name;
  if (!name) { console.log(`  ERR   ${file}: no command name`); cmdErrors++; continue; }
  if (typeof mod.execute !== 'function') { console.log(`  ERR   ${file}: no execute()`); cmdErrors++; }
  if (names.has(name)) { console.log(`  ERR   ${file}: duplicate command name "${name}"`); cmdErrors++; }
  if (!/^[-_a-z0-9]{1,32}$/.test(name)) { console.log(`  ERR   ${file}: invalid name "${name}"`); cmdErrors++; }
  names.add(name);
}
console.log(`${names.size} commands, ${cmdErrors} problems`);
console.log([...names].sort().map((n) => `/${n}`).join(' '));

process.exit(bad + cmdErrors ? 1 : 0);
