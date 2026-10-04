#!/usr/bin/env node
// `npx cubefarm`: checks this machine is ready, starts the office and opens it in the browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MIN_NODE = 22;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const HELP = `
  cubefarm ${pkg.version}: a cartoon 3D office where a team of AI coding agents works through your GitHub issues.

  Usage
    npx cubefarm            start the office and open it in your browser
    npx cubefarm login      sign in to Claude Code, the built-in coding agent
    npx cubefarm doctor     check that this machine is ready

  Options
    --port <n>   port for the office (default 4317)
    --demo       fake GitHub and fake agents: look around without spending any usage
    --floors <n> --agents <n>
                 with --demo: a bigger company, n floors with n people each (up to 20 and 15)
    --no-open    don't open the browser
    -v, --version
    -h, --help

  The office keeps its state and workspaces in ~/.cubefarm (set SWARM_HOME to use another folder).
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (open, close) => (s) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const green = paint(32, 39);
const red = paint(31, 39);
const dim = paint(2, 22);
const fail = (msg) => {
  console.error(`\n  ${red('✗')} ${msg}\n`);
  process.exit(1);
};

if (Number(process.versions.node.split('.')[0]) < MIN_NODE) fail(`cubefarm needs Node.js ${MIN_NODE} or newer (this is ${process.version}). Get it from https://nodejs.org`);

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      demo: { type: 'boolean' },
      floors: { type: 'string' },
      agents: { type: 'string' },
      'no-open': { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(`${err.message}\n    Run npx cubefarm --help for the options.`);
}
const { values, positionals } = args;
const command = positionals[0] ?? 'start';

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

// ---------- Claude Code ----------

// The Agent SDK ships Claude Code as a per-platform package. The office runs its agents on it, so logging in with it
// is logging the agents in. Same lookup as the SDK's own.
function claudeBinary() {
  let sdk;
  try {
    sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return null;
  }
  const { platform, arch } = process;
  const musl = platform === 'linux' && !process.report?.getReport?.()?.header?.glibcVersionRuntime;
  const targets = platform === 'linux' ? (musl ? [`linux-${arch}-musl`, `linux-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`]) : [`${platform}-${arch}`];
  const fromSdk = createRequire(sdk);
  for (const target of targets) {
    try {
      return fromSdk.resolve(`@anthropic-ai/claude-agent-sdk-${target}/claude${platform === 'win32' ? '.exe' : ''}`);
    } catch {
      // not installed for this target
    }
  }
  return null;
}

// Like the agents: no API keys or settings inherited from a Claude Code session this was started from.
function claudeEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ANTHROPIC_|CLAUDE)/i.test(k) || k === 'CLAUDE_CONFIG_DIR') env[k] = v;
  return env;
}

// ---------- checks ----------

const sh = (cmd, cmdArgs, env) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true, timeout: 30_000, env });

/** What the office needs: { name, ok, detail, fix, required }. */
function checks() {
  const out = [{ name: 'Node.js', ok: true, detail: process.version }];

  const git = sh('git', ['--version']);
  out.push({ name: 'git', ok: git.status === 0, detail: git.stdout?.trim().replace(/^git version /, ''), fix: 'install git: https://git-scm.com/downloads', required: true });

  if (sh('gh', ['--version']).status !== 0) {
    out.push({ name: 'GitHub CLI', ok: false, fix: 'install it from https://cli.github.com, then run: gh auth login' });
  } else {
    const ok = sh('gh', ['auth', 'status']).status === 0;
    out.push({ name: 'GitHub CLI', ok, detail: ok ? 'signed in' : 'not signed in', fix: 'run: gh auth login' });
  }

  const claude = claudeBinary();
  if (!claude) {
    out.push({ name: 'Claude Code', ok: false, fix: `reinstall cubefarm: Claude Code for ${process.platform}-${process.arch} is missing` });
  } else {
    let status = null;
    try {
      status = JSON.parse(sh(claude, ['auth', 'status', '--json'], claudeEnv()).stdout);
    } catch {
      // unreadable: treated as signed out
    }
    const ok = status?.loggedIn === true;
    out.push({ name: 'Claude', ok, detail: ok ? `signed in${status.subscriptionType ? ` (${status.subscriptionType})` : ''}` : 'not signed in', fix: 'run: npx cubefarm login' });
  }

  // Agents test in a browser through Playwright, which drives Google Chrome by default.
  const chrome = chromePaths().some((p) => fs.existsSync(p));
  out.push({ name: 'Chrome', ok: chrome, detail: chrome ? 'for browser testing' : 'Google Chrome not found', fix: 'install Google Chrome so agents can test in a browser' });
  // The pinned Playwright MCP server the agents' browser runs on (server/browser.ts), installed with cubefarm.
  let mcp = null;
  try {
    mcp = JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'), 'utf8')).version;
  } catch {
    // not installed
  }
  out.push({ name: 'Browser tool', ok: !!mcp, detail: mcp ? `@playwright/mcp ${mcp}` : 'not installed', fix: 'reinstall cubefarm: npx cubefarm@latest' });
  return out;
}

function chromePaths() {
  const env = process.env;
  if (process.platform === 'win32') {
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications', 'Google Chrome.app')];
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

const printCheck = (c) => console.log(`  ${c.ok ? green('✓') : red('✗')} ${c.name.padEnd(12)} ${c.detail ? dim(c.detail) : ''}${c.ok ? '' : `  → ${c.fix}`}`);

// ---------- helpers ----------

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function isOffice(url) {
  try {
    const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return Array.isArray(data?.repos) && Array.isArray(data?.agents);
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const [cmd, cmdArgs, opts] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `"start "" "${url}""`], { windowsVerbatimArguments: true }]
      : process.platform === 'darwin'
        ? ['open', [url], {}]
        : ['xdg-open', [url], {}];
  try {
    spawn(cmd, cmdArgs, { ...opts, stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => undefined)
      .unref();
  } catch {
    // no browser to open: the URL is printed anyway
  }
}

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('-')[0].split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function checkForUpdate() {
  // A checkout's `npm start` runs this under scripts/office.mjs, which updates the office from its origin instead.
  if (process.env.CI || process.env.SWARM_LAUNCHER === '1') return;
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, { signal: AbortSignal.timeout(4000) });
    const { version } = await res.json();
    if (typeof version === 'string' && newer(version, pkg.version)) {
      console.log(`\n  cubefarm ${version} is out (this is ${pkg.version}). Start it with ${green('npx cubefarm@latest')} to update.\n`);
    }
  } catch {
    // offline, or the registry is slow: try again next time
  }
}

// ---------- commands ----------

if (command === 'doctor') {
  console.log(`\n  cubefarm ${pkg.version}\n`);
  const results = checks();
  results.forEach(printCheck);
  const ok = results.every((c) => c.ok);
  console.log(ok ? `\n  All set. Start the office with: npx cubefarm\n` : '');
  process.exit(ok ? 0 : 1);
}

if (command === 'login') {
  const claude = claudeBinary();
  if (!claude) fail(`Claude Code for ${process.platform}-${process.arch} is missing. Reinstall cubefarm.`);
  console.log('\n  Signing in to Claude. Your agents use this login and your subscription.\n');
  const res = spawnSync(claude, ['auth', 'login'], { stdio: 'inherit', env: claudeEnv() });
  process.exit(res.status ?? 1);
}

if (command !== 'start') fail(`Unknown command "${command}". Run npx cubefarm --help for the options.`);

const port = Number(values.port ?? process.env.SWARM_PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`"${values.port ?? process.env.SWARM_PORT}" isn't a port number.`);
const url = `http://localhost:${port}`;
const demo = values.demo || process.env.SWARM_DEMO === '1' || process.env.SWARM_DEMO === 'true';

// A second office on the same state would resume every agent's session a second time.
if (port !== 0 && (await portOpen(port))) {
  if (!(await isOffice(`http://127.0.0.1:${port}`))) fail(`Something else is using port ${port}. Start cubefarm on another one: npx cubefarm --port 4400`);
  console.log(`\n  cubefarm is already running: ${url}\n`);
  if (!values['no-open']) openBrowser(url);
  process.exit(0);
}

if (!demo) {
  const problems = checks().filter((c) => !c.ok);
  if (problems.length) {
    console.log('');
    problems.forEach(printCheck);
    if (problems.some((c) => c.required)) fail('cubefarm can’t run without these.');
    console.log(dim('\n  Starting anyway. Fix the above, and check again with: npx cubefarm doctor'));
  }
}

const entry = path.join(root, 'dist-server', 'index.js');
if (!fs.existsSync(entry)) fail(`${path.relative(process.cwd(), entry) || entry} is missing. In a checkout of the repo, run npm run build first.`);

process.env.SWARM_PORT = String(port);
if (demo) process.env.SWARM_DEMO = '1';
if (values.floors) process.env.SWARM_DEMO_FLOORS = values.floors;
if (values.agents) process.env.SWARM_DEMO_AGENTS = values.agents;
process.setSourceMapsEnabled(true);
// The server loads its state, then listens.
await import(pathToFileURL(entry).href);

if (!values['no-open'] && port !== 0) {
  for (let i = 0; i < 100 && !(await portOpen(port)); i++) await new Promise((r) => setTimeout(r, 200));
  openBrowser(url);
}
void checkForUpdate();
