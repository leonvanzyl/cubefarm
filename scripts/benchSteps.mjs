// The scale benchmark's pure parts (bench.mjs): reading the options, which floors it visits, and turning frame times,
// renderer counters and websocket frames into the report's numbers. Plain JavaScript, so it runs without tsx.

/** Ports a benchmark must never use: the live office's server and Vite, and the floors' preview range. */
export function portProblem(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return `${port} is not a port`;
  if (port === 4317 || port === 5317) return `${port} is the live office's port`;
  if (port >= 6300 && port <= 6399) return `${port} is in the floors' preview range (6300-6399)`;
  return null;
}

/** The lobby (0), the first floor, a middle one and the top one: four places, fewer when the building is smaller. */
export function floorsToVisit(floors, wanted) {
  if (wanted?.length) return [...new Set(wanted.filter((f) => Number.isInteger(f) && f >= 0 && f <= floors))];
  return [...new Set([0, 1, Math.ceil(floors / 2), floors].filter((f) => f <= floors))];
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

/** requestAnimationFrame timestamps (ms) to the frame rate and frame times over the window they cover. */
export function frameStats(stamps) {
  const deltas = [];
  for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
  const span = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
  return {
    frames: deltas.length,
    fps: span > 0 ? round((deltas.length * 1000) / span) : 0,
    frameMs: { p50: round(percentile(deltas, 50)), p95: round(percentile(deltas, 95)), p99: round(percentile(deltas, 99)), max: round(deltas.length ? Math.max(...deltas) : null) },
  };
}

/**
 * CDP Performance metrics at the start and end of a window to CPU time per frame: the page's main thread
 * (ThreadTime), the script in it (ScriptDuration) and its whole renderer process (ProcessTime), in ms, and the share
 * of the window the main thread was busy.
 */
export function cpuStats(before, after, frames) {
  const d = (k) => (typeof before?.[k] === 'number' && typeof after?.[k] === 'number' ? after[k] - before[k] : null);
  const per = (k) => (d(k) === null || !frames ? null : round((d(k) * 1000) / frames, 2));
  const wall = d('Timestamp');
  return { mainMsPerFrame: per('ThreadTime'), scriptMsPerFrame: per('ScriptDuration'), processMsPerFrame: per('ProcessTime'), mainBusy: wall ? round(d('ThreadTime') / wall, 2) : null };
}

/** The `?stats` corner readout ("58 fps · 17.2 ms · 412 calls · 96k tris · dpr 1.00"): draw calls and triangles. */
export function parseReadout(text) {
  const calls = /(\d+) calls/.exec(text ?? '');
  const tris = /([\d.]+)([kM]?) tris/.exec(text ?? '');
  if (!calls || !tris) return null;
  const scale = tris[2] === 'M' ? 1e6 : tris[2] === 'k' ? 1e3 : 1;
  return { calls: Number(calls[1]), triangles: Math.round(Number(tris[1]) * scale) };
}

/** Websocket frames received in a window: bytes and messages per second, and which event types they were. */
export function wsStats(frames, seconds) {
  const byType = {};
  let bytes = 0;
  for (const f of frames) {
    bytes += f.bytes;
    const t = (byType[f.type] ??= { messages: 0, bytes: 0 });
    t.messages++;
    t.bytes += f.bytes;
  }
  const per = (n) => (seconds > 0 ? Math.round(n / seconds) : 0);
  const types = Object.fromEntries(Object.entries(byType).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => [k, { perSecond: round(v.messages / seconds, 2), bytesPerSecond: per(v.bytes) }]));
  return { bytesPerSecond: per(bytes), messagesPerSecond: round(frames.length / seconds, 1), types };
}

/** The type of a websocket message, without parsing all of a big one. */
export function eventType(payload) {
  const m = /^\{"type":"([^"]+)"/.exec(payload.slice(0, 64));
  return m ? m[1] : 'other';
}

/** One number per metric across runs: the median of each (the machine may be busy, so single runs are noisy). */
export function medianRun(runs) {
  const pick = (get) => median(runs.map(get));
  return {
    fps: round(pick((r) => r.fps)),
    frameMsP50: round(pick((r) => r.frameMs.p50)),
    frameMsP95: round(pick((r) => r.frameMs.p95)),
    mainMsPerFrame: round(pick((r) => r.cpu?.mainMsPerFrame), 2),
    scriptMsPerFrame: round(pick((r) => r.cpu?.scriptMsPerFrame), 2),
    drawCalls: pick((r) => r.renderer?.calls),
    triangles: pick((r) => r.renderer?.triangles),
    heapMB: round(pick((r) => r.heapMB)),
    audioNodes: pick((r) => r.audioNodes),
    wsBytesPerSecond: pick((r) => r.ws.bytesPerSecond),
    wsMessagesPerSecond: round(pick((r) => r.ws.messagesPerSecond)),
  };
}
