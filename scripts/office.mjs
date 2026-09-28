// The office's parent process, for a checkout of this repo (`npm run dev`, `npm run demo`, `npm start`).
//
//   --dev    the server from source (tsx) plus Vite, restarting the server when server/ or shared/ code changes
//   (none)   the built office: bin/cubefarm.js (checks, then dist-server/ serving dist/), no Vite, no watching
//   --demo   passed to the server
//
// It also updates the office. When the server has drained and sends `office:update` (or you type `u` + Enter here),
// it stops everything, fast-forwards this folder to origin's default branch, runs npm install if the dependencies
// changed and, in start mode, npm run build, then starts the office again. A failed step rolls back to the old
// commit. The result goes to <SWARM_HOME>/last-update.json for the server to report. `npx cubefarm` has no launcher:
// installed from npm, the office only reports that an update is ready.
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { clientPort, isUpdateCommand, parseOfficeArgs, parseSymref, refusal, rollbackPlan, stepsFor, swarmHome } from './officeSteps.mjs';

const HELP = `
  node scripts/office.mjs [--dev] [--demo] [--no-open]

    --dev       run the server from source with Vite on SWARM_CLIENT_PORT (default 5317), restarting it on code changes
    --demo      fake GitHub and fake agents
    --no-open   start mode: don't open the browser

  Type u + Enter to update the office now (only on the default branch with no local changes).
`;

const root = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
// How long the server gets to stop its previews and exit before its process tree is killed.
const STOP_TIMEOUT_MS = 20_000;
// --no-save: installs what the pulled package.json and lockfile say without rewriting the lockfile (another npm
// version would reformat it), which would leave local changes and refuse every later update.
const INSTALL = ['install', '--no-audit', '--no-fund', '--no-save'];

let opts;
try {
  opts = parseOfficeArgs(process.argv.slice(2));
} catch (err) {
  console.error(`${err.message}\n${HELP}`);
  process.exit(1);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
const startMode = !opts.dev;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[39m` : s);
const [magenta, red, green] = [paint(35), paint(31), paint(32)];
const log = (msg) => console.log(`${magenta('[office]')} ${msg}`);
const warn = (msg) => console.log(red(`[office] ${msg}`));
const oneLine = (err) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 300);
const short = (sha) => sha.slice(0, 7);

// ---------- child processes ----------

/** Kill a process and everything it started. */
function killTree(proc) {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  if (WIN) {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    return;
  }
  killGroup(proc.pid) || proc.kill('SIGKILL');
}

/** SIGKILL a child's process group (each child leads its own, see spawnChild). False when it's already gone. */
function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** The server and, with --dev, Vite. Each is { name, proc, exited, stopped }. */
const children = { server: null, client: null };
let firstStart = true;

function spawnChild(name, args, { ipc = false, env = process.env } = {}) {
  const proc = spawn(process.execPath, args, {
    cwd: root,
    env,
    // stdin stays with the launcher, which reads `u` from it.
    stdio: ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    // Elsewhere each child leads its own process group, so the whole tree can be killed at once (Windows: taskkill /T).
    detached: !WIN,
  });
  const child = { name, proc, stopped: null, exited: new Promise((resolve) => proc.once('exit', resolve)) };
  proc.on('error', (err) => warn(`${name}: ${err.message}`));
  proc.once('exit', (code, signal) => onExit(child, signal ?? code));
  children[name] = child;
  return child;
}

function startServer() {
  const demo = opts.demo ? ['--demo'] : [];
  const args = opts.dev
    ? ['--import', 'tsx', path.join('server', 'index.ts'), ...demo]
    : [path.join('bin', 'cubefarm.js'), ...demo, ...(opts.open && firstStart ? [] : ['--no-open'])];
  const child = spawnChild('server', args, { ipc: true, env: { ...process.env, SWARM_LAUNCHER: '1' } });
  child.proc.on('message', (msg) => {
    if (msg?.type === 'office:update') void update(`the office asked, from ${short(String(msg.from ?? ''))}`);
  });
}

function startClient() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) {
    warn('Vite is missing: run npm install');
    return void shutdown(1);
  }
  // vite.config.ts reads SWARM_CLIENT_PORT (strictPort) and proxies to SWARM_PORT.
  spawnChild('client', [vite]);
}

function startChildren() {
  startServer();
  if (opts.dev) {
    startClient();
    log(`Open http://localhost:${clientPort()}  ·  type u + Enter to update the office`);
  } else {
    log('Type u + Enter to update the office');
  }
  firstStart = false;
}

function onExit(child, how) {
  if (children[child.name] === child) children[child.name] = null;
  if (child.stopped || shuttingDown) return;
  if (child.name === 'server' && opts.dev) {
    warn(`Server exited (${how}); waiting for a file change to restart`);
    return;
  }
  // The built office, or Vite: nothing to wait for.
  warn(`${child.name === 'server' ? 'The office' : 'Vite'} exited (${how})`);
  void shutdown(how === 0 ? 0 : 1);
}

/**
 * Stop a child. 'update' asks the server over IPC (the contract with the server), 'stop' also sends SIGTERM where
 * signals exist, 'kill' kills its tree right away. Whatever is still running after 20 s is killed.
 */
function stopChild(child, how) {
  if (!child) return Promise.resolve();
  child.stopped ??= (async () => {
    const { proc } = child;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    if (how === 'kill') killTree(proc);
    else {
      const asked = proc.connected;
      if (asked) proc.send({ type: 'office:shutdown' }, () => undefined);
      if (!WIN && (how === 'stop' || !asked)) proc.kill('SIGTERM');
      else if (!asked) killTree(proc);
    }
    const timer = setTimeout(() => {
      warn(`${child.name} didn't stop within ${STOP_TIMEOUT_MS / 1000} s; killing it`);
      killTree(proc);
    }, STOP_TIMEOUT_MS);
    await child.exited;
    clearTimeout(timer);
    if (!WIN) killGroup(proc.pid); // anything it left running
  })();
  return child.stopped;
}

const stopChildren = (how) => Promise.all([stopChild(children.server, how), stopChild(children.client, 'kill')]);

// ---------- commands ----------

function git(args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: root, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]} failed: ${(String(stderr).trim() || err.message).split(/\r?\n/)[0]}`));
        else resolve(String(stdout).trim());
      },
    );
  });
}

/** npm with its output shown here. On Windows npm is a .cmd, so it goes through cmd.exe (fixed arguments only). */
function npm(args) {
  return new Promise((resolve, reject) => {
    log(`npm ${args.join(' ')}`);
    const [cmd, cmdArgs] = WIN ? ['cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]] : ['npm', args];
    const proc = spawn(cmd, cmdArgs, { cwd: root, stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true });
    let last = '';
    proc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      const lines = String(chunk).split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) last = lines[lines.length - 1].trim();
    });
    proc.on('error', (err) => reject(new Error(`npm ${args[0]} failed: ${err.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} failed (exit ${code})${last ? `: ${last}` : ''}`))));
  });
}

async function defaultBranch() {
  const local = await git(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (local.startsWith('origin/')) return local.slice('origin/'.length);
  const remote = parseSymref(await git(['ls-remote', '--symref', 'origin', 'HEAD'], 60_000).catch(() => ''));
  if (remote) return remote;
  throw new Error("can't tell origin's default branch");
}

// ---------- updating ----------

let updating = null; // the running update

function update(trigger) {
  if (shuttingDown) return Promise.resolve();
  if (updating) {
    log('Already updating');
    return updating;
  }
  updating = runUpdate(trigger).finally(() => {
    updating = null;
  });
  return updating;
}

async function runUpdate(trigger) {
  log(`Updating the office (${trigger}): stopping it first`);
  await stopChildren('update');

  const result = { from: '', to: '', ok: true, installed: false, built: false };
  const ran = { installed: false, built: false }; // started, even if it then failed
  try {
    result.from = await git(['rev-parse', 'HEAD']);
    await git(['fetch', 'origin', '--prune'], 180_000);
    const branch = await defaultBranch();
    const target = `origin/${branch}`;
    const refused = refusal({
      branch: await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => ''),
      defaultBranch: branch,
      dirty: (await git(['status', '--porcelain', '--untracked-files=no'])) !== '',
      ahead: Number(await git(['rev-list', '--count', `${target}..HEAD`])),
    });
    if (refused) throw new Error(refused);
    await git(['merge', '--ff-only', target]);
    const changed = (await git(['diff', '--name-only', result.from, 'HEAD'])).split(/\r?\n/).filter(Boolean);
    const head = await git(['rev-parse', 'HEAD']);
    log(head === result.from ? 'Already up to date' : `Fast-forwarded to ${short(head)} (${changed.length} file${changed.length === 1 ? '' : 's'} changed)`);
    const steps = stepsFor(changed, { startMode });
    if (steps.install) {
      ran.installed = true;
      await npm(INSTALL);
      result.installed = true;
    }
    if (steps.build) {
      ran.built = true;
      await npm(['run', 'build']);
      result.built = true;
    }
  } catch (err) {
    result.ok = false;
    result.error = oneLine(err);
    warn(`Update failed: ${result.error}`);
    if (result.from) await rollBack(result, ran);
  }
  result.to = await git(['rev-parse', 'HEAD']).catch(() => result.from);
  writeLastUpdate({ ...result, at: Date.now() });
  if (opts.dev) rescan();
  if (shuttingDown) return;
  log(result.ok && result.from !== result.to ? `Updated: ${short(result.from)} → ${short(result.to)}. Starting the office` : 'Starting the office again');
  startChildren();
}

/** Back to the commit the update started from, with its dependencies and build. Local changes are never touched. */
async function rollBack(result, ran) {
  const head = await git(['rev-parse', 'HEAD']).catch(() => result.from);
  const plan = rollbackPlan({ moved: head !== result.from, ...ran });
  try {
    if (plan.reset) {
      log(`Rolling back to ${short(result.from)}`);
      await git(['reset', '--keep', result.from]);
    }
    if (plan.install) {
      await npm(INSTALL);
      result.installed = true;
    }
    if (plan.build) {
      await npm(['run', 'build']);
      result.built = true;
    }
  } catch (err) {
    result.error += `; the rollback failed too: ${oneLine(err)}`;
    warn(`Rollback failed: ${oneLine(err)}`);
  }
}

/** What the server reports on its next start: { from, to, ok, error?, installed, built, at }. */
function writeLastUpdate(result) {
  const home = swarmHome();
  const file = path.join(home, 'last-update.json');
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(result, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    warn(`Couldn't write ${file}: ${oneLine(err)}`);
  }
}

// ---------- restarting on code changes (--dev) ----------

// This replaces `node --watch`, which on Windows restarts on any change notification, including last-access updates:
// merely reading a server file (the CEO reviewing this repo, git status, grep) restarted the office mid-work and
// interrupted every agent. Here a file only counts as changed when its modification time or size does.
const WATCHED = ['server', 'shared'];
const CODE = /\.(ts|tsx|js|mjs|json)$/;
const stamps = new Map(); // file → "mtime:size", or "gone"
const stamp = (file) => {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'gone';
  }
};
/** Take every file's current stamp, e.g. after an update, whose changes the restart already covers. */
function rescan() {
  stamps.clear();
  for (const dir of WATCHED) {
    for (const name of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      const file = path.join(root, dir, String(name));
      if (CODE.test(file)) stamps.set(file, stamp(file));
    }
  }
}

function watch() {
  rescan();
  let timer = null;
  for (const dir of WATCHED) {
    fs.watch(path.join(root, dir), { recursive: true }, (_event, name) => {
      if (!name || !CODE.test(name) || updating || shuttingDown) return; // paused while updating: rescan() follows
      const file = path.join(root, dir, name);
      const now = stamp(file);
      if (stamps.get(file) === now) return; // read, not written: only its access time moved
      stamps.set(file, now);
      clearTimeout(timer);
      timer = setTimeout(() => void restartServer(file), 250); // an editor's save or a git checkout touches several files at once
    });
  }
}

async function restartServer(file) {
  log(green(`Restarting: ${path.relative(root, file)} changed`));
  await stopChild(children.server, 'stop');
  if (!children.server && !updating && !shuttingDown) startServer();
}

// ---------- stopping ----------

let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Stopping the office');
  await stopChildren('stop');
  if (updating) {
    log('Letting the update finish so this folder stays consistent (press Ctrl+C again to quit now)');
    await updating;
  }
  process.exit(code);
}

for (const sig of WIN ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => (shuttingDown ? process.exit(1) : void shutdown(0)));
}
// Last resort (a second Ctrl+C, a crash): no child outlives the launcher.
process.on('exit', () => {
  for (const child of Object.values(children)) {
    const { proc } = child ?? {};
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) continue;
    if (WIN) spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else killGroup(proc.pid);
  }
});

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (isUpdateCommand(line)) void update('you typed u');
});

if (opts.dev) watch();
startChildren();
