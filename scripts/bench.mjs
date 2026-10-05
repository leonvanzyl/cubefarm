#!/usr/bin/env node
// The scale benchmark (#228): boots a demo office headless (the big company by default, 10 floors of 15 people),
// visits the lobby and three floors, and writes what each costs to a JSON report: frame rate, frame-time p95, draw
// calls, triangles, JS heap, live audio nodes and websocket traffic. Run `npm run build` first. `--help` for options.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { cpuStats, eventType, floorsToVisit, frameStats, median, medianRun, parseReadout, portProblem, wsStats } from './benchSteps.mjs';

const HELP = `
  node scripts/bench.mjs [options]       (after npm run build)

    --floors <n> --agents <n>   the demo company to boot (default 10 and 15)
    --standard                  the usual two-floor demo instead
    --url <http://host:port>    measure an office that's already running instead of booting one
    --port <n>                  port for the office it boots (default BENCH_PORT or 4398)
    --visit 0,1,5,10            floors to measure (0 is the lobby; default the lobby, 1, the middle and the top)
    --seconds <n>               measuring time per visit (default 10), after --warmup <n> (default 6)
    --settle <n>                seconds the office works before the first visit (default 20)
    --runs <n>                  visits per floor; the report keeps every run and their medians (default 1)
    --gpu                       the real GPU (ANGLE d3d11 / metal / gl) instead of SwiftShader; --angle <name> picks one
    --size 1280x720             the browser's viewport
    --gfx low|medium|high|auto  the graphics preset to measure with, where the office has one
    --visitors <n>              the demo's fake visitors walking about the floor you're on (shared presence)
    --browser <path>            a Chromium to use instead of Playwright's (or BENCH_CHROMIUM)
    --label <text>              a name for this run, kept in the report ("before", "after")
    --out <file>                where the JSON report goes (default a file in the temp folder)
`;

const { values } = parseArgs({
  options: {
    floors: { type: 'string', default: '10' },
    agents: { type: 'string', default: '15' },
    standard: { type: 'boolean' },
    url: { type: 'string' },
    port: { type: 'string', default: process.env.BENCH_PORT || '4398' },
    visit: { type: 'string' },
    seconds: { type: 'string', default: '10' },
    warmup: { type: 'string', default: '6' },
    settle: { type: 'string', default: '20' },
    runs: { type: 'string', default: '1' },
    gpu: { type: 'boolean' },
    angle: { type: 'string' },
    size: { type: 'string', default: '1280x720' },
    gfx: { type: 'string' },
    visitors: { type: 'string', default: '0' },
    browser: { type: 'string', default: process.env.BENCH_CHROMIUM },
    label: { type: 'string', default: '' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const root = path.resolve(import.meta.dirname, '..');
const num = (v) => Number(v);
const [width, height] = values.size.split('x').map(num);
const angle = values.angle ?? (values.gpu ? (process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl') : 'swiftshader');
const seconds = num(values.seconds);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? '';

// ---------- the office ----------

let server = null;
let home = null;
let stopping = false;
let base = values.url?.replace(/\/$/, '');
if (!base) {
  const port = num(values.port);
  const problem = portProblem(port);
  if (problem) throw new Error(`--port: ${problem}. Pick another (your reserved port, or BENCH_PORT).`);
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/ is missing: run npm run build first.');
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-bench-'));
  const scale = values.standard ? [] : ['--floors', values.floors, '--agents', values.agents];
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--demo', ...scale], {
    cwd: root,
    env: { ...process.env, SWARM_HOME: home, SWARM_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32', // its own process group, so stopping it takes its children too
  });
  server.stdout.on('data', (d) => /DEMO MODE/.test(d) && process.stdout.write(`office:${String(d).split('\n').find((l) => /DEMO MODE/.test(l))}\n`));
  // The office's own output goes to a log beside its state, so the report stays readable; it's printed if it fails.
  const log = fs.createWriteStream(path.join(home, 'office.log'));
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', (code) => code && !stopping && console.error(`the office exited with code ${code}:\n${fs.readFileSync(path.join(home, 'office.log'), 'utf8').slice(-4000)}`));
  base = `http://127.0.0.1:${port}`;
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  stopping = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  else process.kill(-server.pid, 'SIGTERM');
}
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

async function officeState() {
  return fetch(`${base}/api/state`)
    .then((r) => r.json())
    .catch(() => null);
}

// ---------- one visit ----------

async function enterOffice(page) {
  const enter = page.getByRole('button', { name: 'Enter the office' });
  const skipSetup = page.getByRole('button', { name: /skip setup/i });
  await enter.or(skipSetup).first().waitFor({ timeout: 180_000 });
  if (await skipSetup.isVisible()) await skipSetup.click();
  else {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Enter the office' && !b.disabled), null, { timeout: 180_000 });
    await enter.click();
  }
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /skip tour/i.test(b.textContent ?? ''))?.click());
}

async function visit(browser, floor) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  // Where the elevator lets you out, looking into the floor over the desks.
  const view = JSON.stringify({ floor, x: 0, z: 10.4, yaw: 0, pitch: -0.12 });
  await page.addInitScript(([v, gfx]) => {
    localStorage.setItem('cubefarm:view', v);
    if (gfx) localStorage.setItem('cubefarm:graphics', gfx);
  }, [view, values.gfx ?? '']);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(`page error: ${e.message.slice(0, 300)}`));

  const cdp = await context.newCDPSession(page);
  let audioNodes = 0;
  const audio = await cdp.send('WebAudio.enable').then(
    () => true,
    () => false,
  );
  cdp.on('WebAudio.audioNodeCreated', () => audioNodes++);
  cdp.on('WebAudio.audioNodeWillBeDestroyed', () => audioNodes--);

  const frames = [];
  let recording = false;
  let snapshotBytes = null;
  page.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname !== '/ws') return;
    ws.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8');
      const bytes = Buffer.byteLength(text);
      const type = eventType(text);
      if (type === 'snapshot' && snapshotBytes === null) snapshotBytes = bytes;
      if (recording) frames.push({ bytes, type });
    });
  });

  // A busy machine can take a while to serve and compile the page.
  await page.goto(`${base}/?stats`, { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await enterOffice(page);
  const visitors = num(values.visitors);
  if (visitors) await page.evaluate((n) => window.__swarmPresence?.fakes(n), visitors);
  await sleep(num(values.warmup) * 1000);

  // CPU time the page's main thread (and its renderer process) used: on a busy machine frames wait for a core, but
  // the work done per frame stays comparable.
  await cdp.send('Performance.enable').catch(() => undefined);
  const metrics = async () => Object.fromEntries(((await cdp.send('Performance.getMetrics').catch(() => null))?.metrics ?? []).map((m) => [m.name, m.value]));
  const before = await metrics();
  recording = true;
  await page.evaluate(() => {
    const b = { stamps: [], readouts: [], stop: false, timer: 0 };
    window.__bench = b;
    const tick = (t) => {
      b.stamps.push(t);
      if (!b.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // The renderer's counters: the office's probe where it has one, else the ?stats corner readout.
    const numbers = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number'));
    b.timer = setInterval(() => b.readouts.push(window.__swarmStats ? numbers(window.__swarmStats) : (document.querySelector('.stats span')?.textContent ?? null)), 500);
  });
  await sleep(seconds * 1000);
  const data = await page.evaluate(() => {
    const b = window.__bench;
    b.stop = true;
    clearInterval(b.timer);
    return { stamps: b.stamps, readouts: b.readouts };
  });
  recording = false;
  const after = await metrics();

  await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
  await sleep(300);
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const readouts = data.readouts.map((r) => (typeof r === 'string' ? parseReadout(r) : r)).filter(Boolean);
  const renderer = readouts.length
    ? Object.fromEntries(Object.keys(readouts[readouts.length - 1]).filter((k) => typeof readouts[readouts.length - 1][k] === 'number').map((k) => [k, median(readouts.map((r) => r[k]))]))
    : null;
  const frameNumbers = frameStats(data.stamps);
  const result = {
    floor,
    ...frameNumbers,
    cpu: cpuStats(before, after, frameNumbers.frames),
    renderer,
    heapMB: heap ? Math.round((heap.usedSize / 2 ** 20) * 10) / 10 : null,
    audioNodes: audio ? audioNodes : null,
    ws: { snapshotBytes, ...wsStats(frames, seconds) },
    errors,
  };
  await context.close();
  return result;
}

// ---------- the run ----------

let state = null;
for (let i = 0; i < 240 && !state; i++) {
  if (server && server.exitCode !== null) throw new Error(`the office exited with code ${server.exitCode}`);
  state = await officeState();
  if (!state) await sleep(500);
}
if (!state) throw new Error(`no office answered at ${base}`);
const floors = state.repos.length;
const visits = floorsToVisit(floors, values.visit?.split(',').map(num));
console.log(`measuring ${visits.map((f) => (f ? `floor ${f}` : 'the lobby')).join(', ')} of ${floors} floors, ${state.agents.length} people, ANGLE ${angle}`);
if (server) await sleep(num(values.settle) * 1000);

const browser = await chromium.launch({
  headless: true,
  executablePath: values.browser || undefined,
  args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', ...(angle === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : ['--enable-gpu'])],
});
const probe = await browser.newPage();
const gpu = await probe.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
});
await probe.close();

const locations = [];
for (const floor of visits) {
  const runs = [];
  for (let r = 0; r < num(values.runs); r++) {
    const busy = (await officeState())?.agents.filter((a) => a.status === 'working' || a.status === 'preparing').length ?? null;
    const run = await visit(browser, floor).catch((err) => ({ floor, failed: String(err?.message ?? err).split('\n')[0] }));
    if (run.failed) {
      console.log(`  ${floor ? `floor ${floor}` : 'lobby  '} run ${r + 1} failed: ${run.failed}`);
      continue;
    }
    runs.push({ ...run, busy });
    const ws = `${(run.ws.bytesPerSecond / 1024).toFixed(1)} KB/s`;
    console.log(`  ${floor ? `floor ${floor}` : 'lobby  '} run ${r + 1}: ${run.fps} fps, p95 ${run.frameMs.p95} ms, main thread ${run.cpu.mainMsPerFrame} ms/frame, ${run.renderer?.calls ?? '?'} calls, ${run.renderer?.triangles ?? '?'} tris, heap ${run.heapMB} MB, ${run.audioNodes ?? '?'} audio nodes, ws ${ws}${run.errors.length ? `, ${run.errors.length} console errors` : ''}`);
  }
  const agents = state.agents.filter((a) => state.repos.find((x) => x.id === a.repoId)?.floor === floor).length;
  locations.push({ name: floor ? `floor ${floor}` : 'lobby', floor, people: agents, median: medianRun(runs), runs });
}
await browser.close();
stopServer();

const report = {
  label: values.label,
  at: new Date().toISOString(),
  commit: `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? '+dirty' : ''}`,
  office: { floors, people: state.agents.length, scale: values.url ? 'attached' : values.standard ? 'standard' : `${values.floors}x${values.agents}` },
  browser: { angle, gpu, viewport: `${width}x${height}`, gfx: values.gfx ?? null, visitors: num(values.visitors) },
  machine: { platform: process.platform, cpus: os.cpus().length, cpu: os.cpus()[0]?.model ?? null, memoryGB: Math.round(os.totalmem() / 2 ** 30), loadavg: os.loadavg() },
  window: { seconds, warmup: num(values.warmup), runs: num(values.runs) },
  locations,
};
const out = values.out ?? path.join(os.tmpdir(), `cubefarm-bench-${Date.now()}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${'where'.padEnd(10)}${'fps'.padStart(7)}${'p95 ms'.padStart(9)}${'cpu ms'.padStart(8)}${'calls'.padStart(8)}${'tris'.padStart(10)}${'heap MB'.padStart(9)}${'audio'.padStart(7)}${'ws KB/s'.padStart(9)}`);
for (const l of locations) {
  const m = l.median;
  console.log(`${l.name.padEnd(10)}${String(m.fps).padStart(7)}${String(m.frameMsP95).padStart(9)}${String(m.mainMsPerFrame).padStart(8)}${String(m.drawCalls).padStart(8)}${String(m.triangles).padStart(10)}${String(m.heapMB).padStart(9)}${String(m.audioNodes).padStart(7)}${(m.wsBytesPerSecond / 1024).toFixed(1).padStart(9)}`);
}
console.log(`\nreport: ${out}`);
try {
  if (home) fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
} catch {
  // Windows may hold the stopped office's files a little longer; it's only a temp folder
}
