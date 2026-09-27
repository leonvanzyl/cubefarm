// `npm run dev`'s server: runs server/index.ts and restarts it when server/ or shared/ code changes.
//
// This replaces `node --watch`, which on Windows restarts on any change notification, including last-access updates:
// merely reading a server file (the CEO reviewing this repo, git status, grep) restarted the office mid-work and
// interrupted every agent. Here a file only counts as changed when its modification time or size does.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const DIRS = ['server', 'shared'];
const CODE = /\.(ts|tsx|js|mjs|json)$/;
const args = ['--import', 'tsx', 'server/index.ts', ...process.argv.slice(2)];

const stamps = new Map(); // file → "mtime:size", or "gone"
const stamp = (file) => {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'gone';
  }
};
for (const dir of DIRS) {
  for (const name of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    const file = path.join(root, dir, String(name));
    if (CODE.test(file)) stamps.set(file, stamp(file));
  }
}

let child = null;
let restarting = false;
let timer = null;
const start = () => {
  child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    if (restarting) {
      restarting = false;
      start();
    } else if (!stopping) console.log(`\x1b[31mServer exited (${signal ?? code}); waiting for a file change to restart\x1b[39m`);
  });
};
const restart = (file) => {
  console.log(`\x1b[32mRestarting: ${path.relative(root, file)} changed\x1b[39m`);
  if (!child) return start();
  restarting = true;
  child.kill();
};

for (const dir of DIRS) {
  fs.watch(path.join(root, dir), { recursive: true }, (_event, name) => {
    if (!name || !CODE.test(name)) return;
    const file = path.join(root, dir, name);
    const now = stamp(file);
    if (stamps.get(file) === now) return; // read, not written: only its access time moved
    stamps.set(file, now);
    clearTimeout(timer);
    timer = setTimeout(() => restart(file), 250); // an editor's save or a git checkout touches several files at once
  });
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    child?.kill();
    process.exit(0);
  });
}
start();
