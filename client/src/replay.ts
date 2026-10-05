// The time-lapse (docs/how-it-works.md, "Time-lapse"): plays the office's journal back through the store's own
// apply(), so the 3D office, the whiteboard, the gong and confetti, the sky and the clocks show the recorded day
// instead of the live one. While it plays, live events are dropped (net.ts) and live actions refused (api.ts and the
// store's openOverlay); stopping asks the server for a fresh snapshot. Also keeps "since I was last here" for this
// browser. The pure rules are in replayClock.ts and shared/journal.ts. QA: window.__swarmReplay.
import { create } from 'zustand';
import { api } from './api';
import { requestSnapshot } from './net';
import { EMPTY_OPS } from './ops';
import { useStore } from './store';
import { CHUNK_MS, clockTime, createClock, DEFAULT_SPEED, nextFetch, parsePresence, seekClock, touchPresence, withPlaying, withSpeed, type Presence, type ReplayClock } from './replayClock';
import { setGongVolume } from './world/gongState';
import { setReplayTime } from './world/sky/useDayTime';
import { applyRepoPatch, isFrame, type JournalDayView, type JournalFrame, type JournalLine, type JournalMark } from '../../shared/journal';
import type { WorldSnapshot } from '../../shared/types';

export type ReplayPhase = 'off' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface ReplayView {
  phase: ReplayPhase;
  from: number;
  to: number;
  /** The moment on screen (epoch ms). */
  time: number;
  speed: number;
  label: string;
  marks: JournalMark[];
  /** Journal events applied since the replay started (fast-forwards included). */
  applied: number;
  error: string | null;
}

export const useReplay = create<ReplayView>(() => ({ phase: 'off', from: 0, to: 0, time: 0, speed: DEFAULT_SPEED, label: '', marks: [], applied: 0, error: null }));

const TICK_MS = 100;
/** The gong's loudness while replaying: merges still boom, just not at full office volume. */
const GONG_LEVEL = 0.4;

let clock: ReplayClock | null = null;
let lines: JournalLine[] = []; // fetched and not yet applied from `cursor` on
let cursor = 0;
let loadedTo = 0; // journal time fetched up to
let fetching = false;
let gen = 0; // bumped by every start, seek and stop: answers for an older one are dropped
let session = 0; // bumped by every start and stop
let timer: ReturnType<typeof setInterval> | null = null;
let applied = 0;

const real = () => performance.now();

/** The marks of `days` that fall in [from, to]. */
export const marksBetween = (days: JournalDayView[], from: number, to: number) => days.flatMap((d) => d.marks).filter((m) => m.t >= from && m.t <= to);

/** A keyframe as a snapshot for the store: the recorded office, with this tab's own settings and connection. */
function frameSnapshot(f: JournalFrame): WorldSnapshot {
  const s = useStore.getState();
  return {
    user: s.user,
    ghReady: s.ghReady,
    ghError: s.ghError,
    demo: s.demo,
    workspaceRoot: s.workspaceRoot,
    settings: s.settings,
    repos: f.repos,
    agents: f.agents.map((a) => ({ ...a, log: [] })),
    qa: f.qa,
    requests: f.requests,
    ceo: f.ceo,
    messages: f.messages,
    phoneReadAt: Number.MAX_SAFE_INTEGER, // nothing replayed counts as unread
    version: s.version,
    officeCommit: s.officeCommit,
    officeUpdate: s.officeUpdate,
    usage: f.usage,
    clis: s.clis,
    voiceKeySet: s.voiceKeySet,
    voiceKeyHint: s.voiceKeyHint,
    voiceCache: s.voiceCache,
    notifyChannels: s.notifyChannels,
    ticker: f.ticker ?? [],
    prPreviews: [], // the PR theatre is live-only: off while replaying
    progress: s.progress, // coins and decorations are the office's own, now
    pong: s.pong, // so are the ping-pong leaderboards
    weather: s.weather, // the real local weather is live, like the settings
    ops: f.ops ?? EMPTY_OPS, // a day from before mission control (or the demo's sample day) shows its screens empty
  };
}

/**
 * One journal line into the store. Keyframes only matter when jumping ('seek') or after the office restarted (a boot
 * keyframe, after a gap): while playing, the events carry the state.
 */
function applyLine(l: JournalLine, mode: 'play' | 'seek') {
  const store = useStore.getState();
  if (isFrame(l)) {
    if (mode === 'seek' || l.boot) store.apply({ type: 'snapshot', data: frameSnapshot(l.k) }, 'seek');
    return;
  }
  // Agents and floors are recorded as their changes since the last line: on top of how they are on screen.
  if (l.e.type === 'agentPatch') {
    const prev = store.agents[l.e.id];
    if (prev) store.apply({ type: 'agent', agent: { ...prev, ...l.e.set } }, mode);
  } else if (l.e.type === 'repoPatch') {
    const id = l.e.id;
    const prev = store.repos.find((r) => r.id === id);
    if (prev) store.apply({ type: 'repo', repo: applyRepoPatch(prev, l.e) }, mode);
  } else store.apply(l.e, mode);
  applied++;
}

function fail(err: unknown) {
  if (clock) clock = withPlaying(clock, false, real());
  useReplay.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
}

function tick() {
  if (!clock || useReplay.getState().phase === 'loading') return;
  const now = real();
  const t = clockTime(clock, now);
  while (cursor < lines.length && lines[cursor].t <= t) applyLine(lines[cursor++], 'play');
  setReplayTime(t);
  const ended = t >= clock.to;
  if (ended && clock.playing) clock = withPlaying(clock, false, now);
  const phase = useReplay.getState().phase;
  useReplay.setState({ time: t, applied, phase: ended ? 'ended' : phase });
  const want = nextFetch(loadedTo, t, clock.speed, clock.to);
  if (want && !fetching) void fetchMore(want);
}

/** The next stretch of journal, appended to what's still to play. */
async function fetchMore(want: { from: number; to: number }) {
  fetching = true;
  const my = gen;
  try {
    const chunk = await api.journalEvents(want.from, want.to, false);
    if (my !== gen || !clock) return;
    lines = lines.slice(cursor).concat(chunk.lines);
    cursor = 0;
    // Nothing until `next` (the office was off): carry on from there.
    loadedTo = !chunk.lines.length && chunk.next !== null ? Math.min(clock.to, Math.max(want.to, chunk.next)) : want.to;
  } catch (err) {
    if (my === gen) fail(err);
  } finally {
    if (my === gen) fetching = false;
  }
}

/** Jumps to `t`: from the nearest keyframe before it, fast-forwarding (no gong, no confetti) to `t`. */
async function load(t: number) {
  const my = ++gen;
  fetching = false;
  const playing = clock?.playing ?? true;
  useReplay.setState({ phase: 'loading', error: null });
  try {
    const end = Math.min(clock!.to, t + CHUNK_MS);
    const chunk = await api.journalEvents(t, Math.max(end, t + 1), true);
    if (my !== gen || !clock) return;
    lines = chunk.lines;
    cursor = 0;
    loadedTo = end;
    // A start before anything was recorded begins at the first keyframe.
    let at = t;
    if (lines.length && lines[0].t > t) at = lines[0].t;
    while (cursor < lines.length && lines[cursor].t <= at) applyLine(lines[cursor++], 'seek');
    clock = withPlaying(seekClock(clock, at, real()), playing, real());
    setReplayTime(at);
    useReplay.setState({ phase: playing ? 'playing' : 'paused', time: at, applied });
  } catch (err) {
    if (my === gen) fail(err);
  }
}

/** Starts the time-lapse over [from, to]: the office shows the recorded day until stopReplay (or Esc). */
export async function startReplay(opts: { from: number; to: number; label?: string; speed?: number; marks?: JournalMark[] }) {
  const store = useStore.getState();
  if (!store.loaded || !(opts.to > opts.from)) return;
  store.openOverlay(null);
  store.setReplaying(true);
  const mine = ++session;
  setGongVolume(GONG_LEVEL);
  const speed = opts.speed ?? useReplay.getState().speed;
  clock = createClock(opts.from, opts.to, speed, real());
  lines = [];
  cursor = 0;
  loadedTo = opts.from;
  applied = 0;
  useReplay.setState({ phase: 'loading', from: opts.from, to: opts.to, time: opts.from, speed, label: opts.label ?? '', marks: opts.marks ?? [], applied: 0, error: null });
  if (!timer) timer = setInterval(tick, TICK_MS);
  if (!opts.marks) {
    void api
      .journalDays()
      .then((days) => {
        if (session === mine) useReplay.setState({ marks: marksBetween(days, opts.from, opts.to) });
      })
      .catch(() => undefined);
  }
  await load(opts.from);
}

/** Replays one recorded day. */
export const replayDay = (d: JournalDayView, speed?: number) => startReplay({ from: d.from, to: d.to, speed, marks: d.marks });

/** Back to the live office at once: live events flow again from a fresh snapshot. */
export function stopReplay() {
  if (!useStore.getState().replaying) return;
  gen++;
  session++;
  if (timer) clearInterval(timer);
  timer = null;
  clock = null;
  lines = [];
  cursor = 0;
  fetching = false;
  setReplayTime(null);
  setGongVolume(1);
  useReplay.setState({ phase: 'off', marks: [], error: null });
  requestSnapshot(); // before the flag drops, so no live event lands on the replayed state
  useStore.getState().setReplaying(false);
}

/** Moves the replay to `t`: forward within what's loaded by fast-forwarding, anywhere else from its keyframe. */
export function seekReplay(t: number) {
  if (!clock) return;
  const target = Math.min(clock.to, Math.max(clock.from, t));
  const now = clockTime(clock, real());
  if (target >= now && target <= loadedTo && useReplay.getState().phase !== 'loading') {
    while (cursor < lines.length && lines[cursor].t <= target) applyLine(lines[cursor++], 'seek');
    clock = seekClock(clock, target, real());
    if (target < clock.to && useReplay.getState().phase === 'ended') clock = withPlaying(clock, true, real());
    setReplayTime(target);
    useReplay.setState({ time: target, applied, phase: clock.playing ? 'playing' : 'paused' });
    return;
  }
  void load(target);
}

export function setReplaySpeed(speed: number) {
  if (clock) clock = withSpeed(clock, speed, real());
  useReplay.setState({ speed });
}

/** Play / pause; at the end, plays it again from the start. */
export function toggleReplay() {
  if (!clock) return;
  const { phase } = useReplay.getState();
  if (phase === 'loading') return;
  if (phase === 'ended') {
    clock = withPlaying(clock, true, real());
    void load(clock.from);
    return;
  }
  clock = withPlaying(clock, !clock.playing, real());
  useReplay.setState({ phase: clock.playing ? 'playing' : 'paused' });
}

// ---------- since I was last here ----------

const PRESENCE_KEY = 'cubefarm:presence';
const PRESENCE_EVERY_MS = 15_000;

let presence: Presence = (() => {
  try {
    return parsePresence(localStorage.getItem(PRESENCE_KEY));
  } catch {
    return parsePresence(null);
  }
})();

/** This browser's comings and goings: the latest time away is what "since I was last here" replays. */
export const currentPresence = () => presence;

function touch() {
  const now = Date.now();
  if (presence.last !== null && now - presence.last < PRESENCE_EVERY_MS) return;
  presence = touchPresence(presence, now);
  try {
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(presence));
  } catch {
    // storage may be unavailable (private mode); "since I was last here" just won't be offered
  }
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'mousemove', 'wheel'] as const) window.addEventListener(type, touch, { capture: true, passive: true });

  // For QA and e2e: state, time, speed and events applied; start({ day } | { from, to }), seek(t), stop() and friends.
  (window as unknown as Record<string, unknown>).__swarmReplay = {
    get state() {
      return useReplay.getState().phase;
    },
    get time() {
      return useReplay.getState().time;
    },
    get speed() {
      return useReplay.getState().speed;
    },
    get applied() {
      return useReplay.getState().applied;
    },
    get range() {
      const v = useReplay.getState();
      return { from: v.from, to: v.to };
    },
    get marks() {
      return useReplay.getState().marks;
    },
    get presence() {
      return presence;
    },
    /** What the office on screen shows, replayed or live: everyone's status and each floor's open PRs. */
    get office() {
      const s = useStore.getState();
      return {
        agents: Object.fromEntries(Object.values(s.agents).map((a) => [a.id, a.status])),
        pulls: Object.fromEntries(s.repos.map((r) => [r.id, r.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number)])),
      };
    },
    async start(o: { day?: string; from?: number; to?: number; speed?: number } = {}) {
      if (o.from !== undefined && o.to !== undefined) return startReplay({ from: o.from, to: o.to, speed: o.speed });
      const days = await api.journalDays();
      const d = days.find((x) => x.day === o.day) ?? days[0];
      if (d) await replayDay(d, o.speed);
    },
    stop: stopReplay,
    seek: seekReplay,
    setSpeed: setReplaySpeed,
    toggle: toggleReplay,
  };
}
