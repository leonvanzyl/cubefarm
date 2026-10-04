// The time-lapse's pure rules (replay.ts runs them): the replay clock (journal time from real time at a speed, with
// pausing, seeking and speed changes that never jump), when the next stretch of journal is fetched, and "since I was
// last here": when the manager was last at the office before their latest time away, kept per browser.

export const SPEEDS = [30, 120, 600] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 120;

/** Journal time asked for at once, and how far ahead (in real time at the current speed) the next stretch is fetched. */
export const CHUNK_MS = 60 * 60_000;
export const PREFETCH_REAL_MS = 8_000;

/** Replay time `at` held at real time `real` (performance.now()), moving `speed` times faster while playing. */
export interface ReplayClock {
  from: number;
  to: number;
  speed: number;
  playing: boolean;
  at: number;
  real: number;
}

const clampTo = (c: Pick<ReplayClock, 'from' | 'to'>, t: number) => Math.min(c.to, Math.max(c.from, t));

export function createClock(from: number, to: number, speed: number, real: number): ReplayClock {
  return { from, to: Math.max(from, to), speed, playing: true, at: from, real };
}

/** The replay time at real time `real`, never outside [from, to]. */
export function clockTime(c: ReplayClock, real: number): number {
  return clampTo(c, c.playing ? c.at + Math.max(0, real - c.real) * c.speed : c.at);
}

/** A new speed from now on: the replay time carries on from where it is. */
export const withSpeed = (c: ReplayClock, speed: number, real: number): ReplayClock => ({ ...c, at: clockTime(c, real), real, speed });

export const withPlaying = (c: ReplayClock, playing: boolean, real: number): ReplayClock => ({ ...c, at: clockTime(c, real), real, playing });

export const seekClock = (c: ReplayClock, t: number, real: number): ReplayClock => ({ ...c, at: clampTo(c, t), real });

export const clockEnded = (c: ReplayClock, real: number) => clockTime(c, real) >= c.to;

/**
 * Where the next fetch should start and end, or null when nothing is needed yet: what's loaded runs out within
 * PREFETCH_REAL_MS of real time at this speed, and the replay goes on past it.
 */
export function nextFetch(loadedTo: number, time: number, speed: number, to: number): { from: number; to: number } | null {
  if (loadedTo >= to) return null;
  if ((loadedTo - time) / Math.max(1, speed) > PREFETCH_REAL_MS) return null;
  return { from: loadedTo, to: Math.min(to, loadedTo + CHUNK_MS) };
}

/** Where on the timeline (0-1) a moment falls. */
export const timelineAt = (t: number, from: number, to: number) => (to > from ? Math.min(1, Math.max(0, (t - from) / (to - from))) : 0);

// ---------- since I was last here ----------

/** Away at least this long and the time-lapse offers what happened meanwhile. */
export const AWAY_MS = 10 * 60_000;

/** The manager's comings and goings in this browser: their last activity, and their latest time away (from, back). */
export interface Presence {
  last: number | null;
  awayFrom: number | null;
  backAt: number | null;
}

/** After activity at `now`: a gap of AWAY_MS or more since the last one was a time away, from that last one to now. */
export function touchPresence(p: Presence, now: number): Presence {
  if (p.last !== null && now - p.last >= AWAY_MS) return { last: now, awayFrom: p.last, backAt: now };
  return { ...p, last: now };
}

export function parsePresence(raw: string | null): Presence {
  try {
    const p = JSON.parse(raw ?? 'null') as Partial<Presence> | null;
    const ok = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
    return { last: ok(p?.last), awayFrom: ok(p?.awayFrom), backAt: ok(p?.backAt) };
  } catch {
    return { last: null, awayFrom: null, backAt: null };
  }
}

/**
 * What "since I was last here" replays: the latest time away, from when it began (or the oldest journal, if that's
 * later) to when the manager came back (or the end of what's recorded). Null without a time away, or with less than
 * a minute of it recorded.
 */
export function sinceLastHere(p: Presence, recorded: { from: number; to: number } | null): { from: number; to: number } | null {
  if (p.awayFrom === null || !recorded) return null;
  const from = Math.max(p.awayFrom, recorded.from);
  const to = Math.min(recorded.to, p.backAt ?? recorded.to);
  return to - from >= 60_000 ? { from, to } : null;
}
