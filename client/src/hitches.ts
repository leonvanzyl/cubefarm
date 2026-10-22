// The hitch recorder (#294), always on: every frame that took HITCH_MS or more, every time the 3D view stopped
// drawing, and every time the player stopped while a movement key was held, each with what was going on (the pure
// rules are in hitchLog.ts). The last HITCH_KEEP are in window.__swarmHitches, the ?stats line and the performance
// report (Settings → Graphics). Per frame it only compares numbers: everything is gathered when a hitch happens.
// It imports nothing of three.js (the websocket feeds it, and pocket mode never loads the 3D view): the 3D side
// registers what it knows (camera mode, events, graphics) with setHitchContext.
import { useStore } from './store';
import { guessCause, HITCH_KEEP, HITCH_MS, isFrameHitch, newRing, notesBefore, pushRing, clearRing, ringItems, summarize, type Hitch, type HitchKind, type HitchNote, type WsNote } from './hitchLog';

const hitches = newRing<Hitch>(HITCH_KEEP);
const notes = newRing<HitchNote>(64);
/** DPR and graphics tier changes, kept longer than the notes: the report lists the last of them. */
const changes = newRing<HitchNote>(30);

/** Something that happened, kept a moment in case a hitch follows (and DPR and tier changes for the report). */
export function hitchNote(kind: string, detail: string) {
  const n = { at: performance.now(), kind, detail };
  pushRing(notes, n);
  if (kind === 'dpr' || kind === 'gfx') pushRing(changes, n);
}

// ---------- the websocket ----------

// Fixed arrays, so noting a message allocates nothing.
const WS_KEEP = 64;
const wsAt = new Float64Array(WS_KEEP);
const wsBytes = new Float64Array(WS_KEEP);
const wsMs = new Float64Array(WS_KEEP);
const wsType: string[] = new Array<string>(WS_KEEP).fill('');
let wsNext = 0;

/** net.ts: a message was parsed and applied, `bytes` long, taking `ms`. */
export function hitchWs(type: string, bytes: number, ms: number) {
  wsAt[wsNext] = performance.now();
  wsBytes[wsNext] = bytes;
  wsMs[wsNext] = ms;
  wsType[wsNext] = type;
  wsNext = (wsNext + 1) % WS_KEEP;
}

function wsBetween(from: number, to: number): WsNote[] {
  const out: WsNote[] = [];
  for (let i = 0; i < WS_KEEP; i++) if (wsType[i] && wsAt[i] > from && wsAt[i] <= to) out.push({ type: wsType[i], bytes: wsBytes[i], ms: Math.round(wsMs[i] * 10) / 10 });
  return out.sort((a, b) => b.ms - a.ms).slice(0, 8);
}

// ---------- the GPU ----------

/** Shader programs linked and texture uploads since the page loaded (counted on the context itself). */
export const glCounts = { compiles: 0, uploads: 0 };
let watchedGl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

/** Counts program links and texture uploads on this context. Once per context; a counter increment per call. */
export function watchGl(ctx: WebGLRenderingContext | WebGL2RenderingContext) {
  if (watchedGl === ctx) return;
  watchedGl = ctx;
  const c = ctx as unknown as Record<string, (...args: unknown[]) => unknown>;
  const wrap = (name: string, count: 'compiles' | 'uploads') => {
    const orig = c[name];
    if (typeof orig !== 'function') return;
    c[name] = function (this: unknown) {
      glCounts[count]++;
      // eslint-disable-next-line prefer-rest-params
      return orig.apply(this, arguments as unknown as unknown[]);
    };
  };
  wrap('linkProgram', 'compiles');
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D']) wrap(name, 'uploads');
}

// ---------- what the 3D view knows ----------

export interface HitchContext {
  camera: () => string;
  dpr: () => number;
  gfx: () => string;
  events: () => string[];
  textures: () => number;
}

let context: HitchContext | null = null;
export const setHitchContext = (c: HitchContext | null) => void (context = c);

// ---------- recording ----------

// The browser's own account of slow frames (Chrome's long animation frames): the slowest scripts in each.
const loafs = newRing<{ start: number; end: number; scripts: string[] }>(16);

const fileOf = (url: string) => url.split(/[?#]/)[0].split('/').pop() || url;

function scriptsBetween(from: number, to: number) {
  for (const l of ringItems(loafs)) if (l.end >= from && l.start <= to && l.scripts.length) return l.scripts;
  return [];
}

function record(kind: HitchKind, ms: number, detail: string, gapFrom: number, deltas = { programs: 0, textures: 0, uploads: 0 }): Hitch {
  const now = performance.now();
  const s = useStore.getState();
  const h: Hitch = {
    kind,
    at: Math.round(now),
    wall: new Date().toISOString(),
    ms: Math.round(ms),
    cause: '',
    detail,
    floor: s.floor,
    camera: context?.camera() ?? 'none',
    overlay: s.overlay?.kind ?? null,
    dpr: context?.dpr() ?? 0,
    gfx: context?.gfx() ?? '',
    ...deltas,
    ws: kind === 'frame' ? wsBetween(gapFrom, now) : [],
    notes: notesBefore(ringItems(notes), now, now - gapFrom),
    events: context?.events() ?? [],
    scripts: kind === 'frame' ? scriptsBetween(gapFrom, now) : [],
  };
  h.cause = guessCause(h);
  pushRing(hitches, h);
  return h;
}

/** A stall that isn't a slow frame: the player stuck, or their movement keys let go of by something else. */
export function recordHitch(kind: Exclude<HitchKind, 'frame' | 'paused'>, ms: number, detail: string) {
  record(kind, ms, detail, performance.now());
}

// ---------- frames ----------

const frame = { last: 0, resumed: true, compiles: 0, uploads: 0, textures: 0 };

/** Once a drawn frame (perf.tsx's HitchProbe). Allocates nothing unless the gap since the last one was a hitch. */
export function hitchFrame() {
  const now = performance.now();
  const textures = context?.textures() ?? 0;
  const gap = now - frame.last;
  if (frame.last && isFrameHitch(gap, frame.resumed)) {
    record('frame', gap, '', frame.last, { programs: glCounts.compiles - frame.compiles, textures: Math.max(0, textures - frame.textures), uploads: glCounts.uploads - frame.uploads });
  }
  frame.last = now;
  frame.resumed = false;
  frame.compiles = glCounts.compiles;
  frame.uploads = glCounts.uploads;
  frame.textures = textures;
}

/** The next gap between frames is no measure (the loop was paused, the tab hidden). */
export const hitchResume = () => void (frame.resumed = true);

let openPause: { h: Hitch; from: number } | null = null;

/** The 3D view stopped drawing, and why ("kanban covers the view", "tab hidden", "photo frozen"); null: drawing again. */
export function hitchPaused(reason: string | null) {
  frame.resumed = true;
  if (openPause) {
    openPause.h.ms = Math.round(performance.now() - openPause.from);
    openPause = null;
  }
  if (reason) openPause = { h: record('paused', 0, reason, performance.now()), from: performance.now() };
}

// ---------- listening ----------

let started = false;

/** Starts listening for what hitches are kept with (focus, chunks, panels, floors). Once; from the 3D view. */
export function startHitchRecorder() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('blur', () => setTimeout(() => hitchNote('focus', `window lost focus${document.activeElement && document.activeElement !== document.body ? ` to ${document.activeElement.tagName.toLowerCase()}` : ''}`), 0));
  window.addEventListener('focus', () => hitchNote('focus', 'window focused'));
  document.addEventListener('visibilitychange', () => {
    hitchResume();
    hitchNote('visibility', document.hidden ? 'tab hidden' : 'tab shown');
  });
  document.addEventListener('pointerlockchange', () => hitchNote('lock', document.pointerLockElement ? 'mouse grabbed' : 'mouse let go'));
  useStore.subscribe((s, prev) => {
    if (s.overlay?.kind !== prev.overlay?.kind) hitchNote('overlay', s.overlay ? `${s.overlay.kind} opened` : `${prev.overlay?.kind} closed`);
    if (s.floor !== prev.floor) hitchNote('floor', `to floor ${s.floor}`);
    if (!!s.travel !== !!prev.travel) hitchNote('travel', s.travel ? `elevator to ${s.travel.to}` : 'elevator arrived');
  });
  const supported = typeof PerformanceObserver !== 'undefined' ? (PerformanceObserver.supportedEntryTypes ?? []) : [];
  if (supported.includes('resource')) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        // A chunk served from the memory cache can report no responseEnd, and so a negative duration.
        if (/\.(m?js|wasm)(\?|$)/.test(e.name)) pushRing(notes, { at: e.responseEnd || e.startTime, kind: 'chunk', detail: `${fileOf(e.name)}, ${Math.max(0, Math.round(e.duration))} ms` });
      }
    }).observe({ type: 'resource' });
  }
  if (supported.includes('long-animation-frame')) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < HITCH_MS) continue;
        const scripts = ((e as unknown as { scripts?: { duration: number; sourceFunctionName?: string; invoker?: string; sourceURL?: string }[] }).scripts ?? [])
          .slice()
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((x) => `${x.sourceFunctionName || x.invoker || 'script'} @ ${fileOf(x.sourceURL ?? '')} (${Math.round(x.duration)} ms)`);
        const l = { start: e.startTime, end: e.startTime + e.duration, scripts };
        pushRing(loafs, l);
        // It arrives after the frame it describes: give it to a hitch already recorded for that gap.
        for (const h of ringItems(hitches)) {
          if (h.kind !== 'frame' || h.scripts.length || !scripts.length || h.at < l.start || h.at - h.ms > l.end) continue;
          h.scripts = scripts;
          h.cause = guessCause(h);
        }
      }
    }).observe({ type: 'long-animation-frame' });
  }
}

// ---------- reading ----------

export const hitchList = () => ringItems(hitches);

let summaryAt = -1;
let summary = summarize([]);
/** The summary, worked out again only when a hitch was added. */
export function hitchSummary() {
  if (summaryAt !== hitches.total) {
    summaryAt = hitches.total;
    summary = summarize(ringItems(hitches));
  }
  return summary;
}

function gpuName() {
  try {
    const gl = watchedGl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    return null;
  }
}

/** Everything a stutter report needs, as text to paste into an issue (Settings → Graphics, or __swarmHitches.report()). */
export function performanceReport(): string {
  const s = useStore.getState();
  const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
  const gfx = w.__swarmGfx;
  const sum = hitchSummary();
  const report = {
    at: new Date().toISOString(),
    upMinutes: Math.round(performance.now() / 600) / 100,
    browser: navigator.userAgent,
    gpu: gpuName(),
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio, window: `${innerWidth}x${innerHeight}` },
    office: { floors: s.repos.length, people: Object.keys(s.agents).length, floor: s.floor, overlay: s.overlay?.kind ?? null },
    view: context ? { camera: context.camera(), dpr: context.dpr(), gfx: context.gfx(), events: context.events() } : null,
    graphics: gfx ? { preset: gfx.preset, tier: gfx.tier, shown: gfx.shown, fps: gfx.fps, decisions: gfx.decisions } : null,
    gpuWork: { programsLinked: glCounts.compiles, textureUploads: glCounts.uploads },
    changes: ringItems(changes).map((c) => ({ ...c, at: Math.round(c.at) })),
    hitches: { frames: sum.frames, worstMs: sum.worst?.ms ?? null, worstCause: sum.worst?.cause ?? null, causes: sum.causes, paused: sum.paused, input: sum.input, stuck: sum.stuck, total: hitches.total },
    list: ringItems(hitches).map((h) => ({ ...h, notes: h.notes.map((n) => ({ ...n, at: Math.round(n.at) })) })),
  };
  return JSON.stringify(report, null, 2);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmHitches = {
    /** Oldest first. */
    get list() {
      return hitchList();
    },
    /** Frame hitches kept. */
    get count() {
      return hitchSummary().frames;
    },
    get worst() {
      return hitchSummary().worst;
    },
    get summary() {
      return hitchSummary();
    },
    get notes() {
      return ringItems(notes);
    },
    get gl() {
      return { ...glCounts };
    },
    report: performanceReport,
    clear() {
      clearRing(hitches);
      summaryAt = -1;
    },
  };
}
