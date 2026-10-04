// Office rituals, the pure part: when the stand-up (the CEO filed a burst of issues), lunch, Friday pizza, the evening
// wind-down (then home time and the morning after) and the CEO's walk round a floor happen, decided from the office
// clock (sky/time.ts) and what's going on on the floor, plus where everyone stands for them. Rituals.tsx runs it on
// the floor you're on. No three.js, no store: every rule is tested without a browser.

import type { PullInfo } from '../../../shared/types';
import { kanbanColumnSpan } from './draw';
import { BOARD, HALF_D, HALF_W } from './layout';
import { CYCLE_MS, type DayMode } from './sky/time';
import type { Pt } from './toys/roombaBrain';
import type { Spot } from './walkways';

export const RITUALS = ['standup', 'lunch', 'pizza', 'winddown', 'ceo-walk'] as const;
export type Ritual = (typeof RITUALS)[number];

/** `?ritual=lunch` forces that ritual on the floor you're on (QA); null when absent or unknown. */
export function parseRitualParam(search: string): Ritual | null {
  const raw = new URLSearchParams(search).get('ritual');
  return RITUALS.includes(raw as Ritual) ? (raw as Ritual) : null;
}

// ---------- the clock ----------

export interface OfficeClock {
  /** The office's hour of the day, 0 to 24: the sky's phase (sky/time.ts) times 24. */
  hour: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  /** The office day, as a key that changes at the office's midnight, and when it began (epoch ms). */
  day: string;
  dayStart: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The office clock at `now` (epoch ms) and sky phase `t`. In the 30-minute cycle every cycle is a day of its own (with
 * its own lunch and evening); otherwise days are the viewer's local days. Weekdays are always the real ones.
 */
export function officeClock(now: number, t: number, mode: DayMode): OfficeClock {
  const d = new Date(now);
  const hour = (((t % 1) + 1) % 1) * 24;
  if (mode === 'cycle') {
    const k = Math.floor(now / CYCLE_MS);
    return { hour, weekday: d.getDay(), day: `cycle-${k}`, dayStart: k * CYCLE_MS };
  }
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { hour, weekday: d.getDay(), day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dayStart: start };
}

// ---------- times of day ----------

/** Lunch: noon to 1 pm. */
export const LUNCH = { from: 12, to: 13 };
/** Friday pizza: from 4 pm, or after the floor's fifth merge of the day. */
export const PIZZA = { weekday: 5, from: 16, merges: 5 };
/** The evening: winding down from 7 pm, idle people home from 10 pm, back at 8 am. */
export const EVENING = { from: 19, home: 22, morning: 8 };

export const isLunch = (h: number) => h >= LUNCH.from && h < LUNCH.to;
export const isNight = (h: number) => h >= EVENING.from || h < EVENING.morning;
export const isLate = (h: number) => h >= EVENING.home || h < EVENING.morning;

/** Whether Friday pizza is due: 4 pm or the fifth merge of the day, whichever is first, and not in the middle of the night. */
export const pizzaDue = (c: Pick<OfficeClock, 'hour' | 'weekday'>, mergesToday: number) =>
  c.weekday === PIZZA.weekday && !isLate(c.hour) && (c.hour >= PIZZA.from || mergesToday >= PIZZA.merges);

/** When (epoch ms) each of a floor's PRs merged. */
export const mergeTimes = (pulls: readonly Pick<PullInfo, 'state' | 'mergedAt'>[]): number[] =>
  pulls.flatMap((p) => (p.state === 'MERGED' && p.mergedAt ? [Date.parse(p.mergedAt)] : [])).filter(Number.isFinite);

export const mergesSince = (times: readonly number[], since: number) => times.filter((t) => t >= since).length;

// ---------- the evening ----------

/** 'winddown': lamps on, lights down; 'home': idle people have gone home for the night. */
export type Evening = 'day' | 'winddown' | 'home';
export type EveningEvent = 'winddown' | 'home' | 'morning';

/** Seconds the floor must have had nobody working before it winds down. */
export const IDLE_BEFORE_WINDDOWN = 20;

/**
 * The evening's next step: wind down once the floor has gone idle after 7 pm, send idle people home after 10 pm, and
 * bring the lights (and anyone who went home) back at 8 am. A floor still busy at 10 pm winds down when it goes idle,
 * and goes home straight after.
 */
export function stepEvening(phase: Evening, hour: number, idleFor: number): { phase: Evening; event: EveningEvent | null } {
  if (!isNight(hour)) return phase === 'day' ? { phase, event: null } : { phase: 'day', event: 'morning' };
  if (phase === 'day') return idleFor >= IDLE_BEFORE_WINDDOWN ? { phase: 'winddown', event: 'winddown' } : { phase, event: null };
  if (phase === 'winddown' && isLate(hour)) return { phase: 'home', event: 'home' };
  return { phase, event: null };
}

// ---------- the stand-up ----------

/**
 * A stand-up: at least `min` issues new to the floor within `window` seconds, the newest `settle` seconds old (the CEO
 * may still be filing), at most one every `gap` seconds; the CEO puts up at most `stickies` of them.
 */
export const STANDUP = { min: 2, window: 120, settle: 4, gap: 150, stickies: 6 };

/** An issue first seen on the floor at `at` (the ritual clock's seconds). */
export interface Fresh {
  n: number;
  at: number;
}

/** Open issues not in `seen` (which they're added to): what's new on the floor since the last look. */
export function freshIssues(seen: Set<number>, open: readonly number[]): number[] {
  const out = open.filter((n) => !seen.has(n));
  for (const n of out) seen.add(n);
  return out;
}

/** Whether the fresh issues (within the window) make a stand-up now. */
export function standupDue(fresh: readonly Fresh[], now: number, lastStandup: number): boolean {
  const recent = fresh.filter((f) => now - f.at <= STANDUP.window);
  if (recent.length < STANDUP.min || now - lastStandup < STANDUP.gap) return false;
  return now - Math.max(...recent.map((f) => f.at)) >= STANDUP.settle;
}

// ---------- the CEO's walk ----------

/**
 * The CEO walks a floor every `min`-`max` seconds of you watching (the first one sooner), from 8 am to 9 pm, and
 * `soon` seconds after a merge streak (`streak.merges` merges within `streak.within` seconds); the walk takes in the
 * gong when the floor merged something in the last `gong` seconds.
 */
export const CEO_WALK = { min: 420, max: 900, first: { min: 90, max: 240 }, from: 8, to: 21, streak: { merges: 2, within: 900 }, soon: 10, gong: 900 };

export const walkHours = (h: number) => h >= CEO_WALK.from && h < CEO_WALK.to;
export const nextWalkGap = (rand: number, first = false) =>
  first ? CEO_WALK.first.min + rand * (CEO_WALK.first.max - CEO_WALK.first.min) : CEO_WALK.min + rand * (CEO_WALK.max - CEO_WALK.min);

/** The newest merge of a streak at `now` (epoch ms), or null when the floor isn't on one. */
export function streakMerge(times: readonly number[], now: number): number | null {
  const recent = times.filter((t) => t <= now && now - t <= CEO_WALK.streak.within * 1000);
  return recent.length >= CEO_WALK.streak.merges ? Math.max(...recent) : null;
}

// ---------- the scheduler ----------

/** What the scheduler remembers between looks (one per floor visit; `walkAt` is shared across floors). */
export interface RitualState {
  evening: Evening;
  lunch: boolean;
  /** The office day pizza came on, or null. */
  pizza: string | null;
  /** When the last stand-up started, and when the next CEO walk is due (the ritual clock's seconds). */
  standupAt: number;
  walkAt: number;
  /** The last merge (epoch ms) a streak walk was for, so one streak brings the CEO once. */
  streakFor: number;
  fresh: Fresh[];
}

/** A floor's scheduler, starting now: the next CEO walk at `walkAt`, merges up to `lastMerge` (epoch ms) old news. */
export const newRitualState = (walkAt: number, lastMerge = 0): RitualState => ({ evening: 'day', lunch: false, pizza: null, standupAt: -Infinity, walkAt, streakFor: lastMerge, fresh: [] });

/** What the scheduler looks at. */
export interface Facts {
  /** The ritual clock (seconds of you watching; it stops while the 3D view is paused) and the wall clock (epoch ms). */
  now: number;
  wall: number;
  clock: OfficeClock;
  /** Seconds nobody on the floor has been working or setting up. */
  idleFor: number;
  /** The CEO has nothing on (their status). */
  ceoFree: boolean;
  /** What the CEO is already doing here: a stand-up waits only for another stand-up (it cuts a walk short). */
  ceoOn: 'standup' | 'walk' | null;
  /** When the floor's PRs merged (epoch ms). */
  merged: readonly number[];
  rand: () => number;
}

export type Decision = { do: 'standup'; issues: number[] } | { do: 'ceo-walk'; gong: boolean } | { do: 'pizza' } | { do: 'lunch'; on: boolean } | { do: EveningEvent };

/** Everything that starts or changes now, in order; `s` moves on. */
export function schedule(s: RitualState, f: Facts): Decision[] {
  const out: Decision[] = [];
  const { hour } = f.clock;
  const ev = stepEvening(s.evening, hour, f.idleFor);
  s.evening = ev.phase;
  if (ev.event) out.push({ do: ev.event });
  const lunch = isLunch(hour);
  if (lunch !== s.lunch) {
    s.lunch = lunch;
    out.push({ do: 'lunch', on: lunch });
  }
  if (s.pizza !== f.clock.day && pizzaDue(f.clock, mergesSince(f.merged, f.clock.dayStart))) {
    s.pizza = f.clock.day;
    out.push({ do: 'pizza' });
  }
  s.fresh = s.fresh.filter((x) => f.now - x.at <= STANDUP.window);
  if (f.ceoOn !== 'standup' && standupDue(s.fresh, f.now, s.standupAt)) {
    out.push({ do: 'standup', issues: s.fresh.map((x) => x.n).sort((a, b) => a - b).slice(-STANDUP.stickies) });
    s.fresh = [];
    s.standupAt = f.now;
    return out;
  }
  if (f.ceoOn || !f.ceoFree || !walkHours(hour)) return out;
  const streak = streakMerge(f.merged, f.wall);
  const streakWalk = streak !== null && streak > s.streakFor && f.wall - streak >= CEO_WALK.soon * 1000;
  if (streakWalk || f.now >= s.walkAt) {
    if (streak !== null) s.streakFor = streak;
    s.walkAt = f.now + nextWalkGap(f.rand());
    const last = f.merged.length ? Math.max(...f.merged) : -Infinity;
    out.push({ do: 'ceo-walk', gong: f.wall - last <= CEO_WALK.gong * 1000 });
  }
  return out;
}

// ---------- where ----------

/** The Backlog column's middle on the whiteboard (x), as drawKanban lays the columns out (any canvas width will do). */
const backlog = kanbanColumnSpan(0, 2560);
const BACKLOG_X = -BOARD.w / 2 + ((backlog.x0 + backlog.colW / 2) / 2560) * BOARD.w;

/** Where the CEO presents a stand-up: at the right edge of the Backlog column, a step out from the board. */
export const PRESENTER: Pt = { x: BACKLOG_X + 1.45, z: -HALF_D + 1.35 };

/** Facing (walkways.ts: 0 east, π/2 south) from `from` towards `to`. */
export const facingTo = (from: Pt, to: Pt) => Math.atan2(to.z - from.z, to.x - from.x);

/**
 * Where the team stands at a stand-up: `n` spots on an arc round the presenter, `r` metres away, spread `spread`
 * radians either side of straight out from the board, each facing the presenter.
 */
export function semicircle(center: Pt, n: number, r = 2.3, spread = 1.05): Spot[] {
  return Array.from({ length: n }, (_, i) => {
    const a = n === 1 ? 0 : -spread + (2 * spread * i) / (n - 1);
    const x = center.x + Math.sin(a) * r;
    const z = center.z + Math.cos(a) * r;
    return { id: `standup-${i}`, x, z, facing: facingTo({ x, z }, center) };
  });
}

/** How many stand at a stand-up, at most. The walker cap (errands.ts) usually lets fewer go. */
export const STANDUP_SPOTS = 6;

const WEST = Math.PI;
const EAST = 0;
const NORTH = -Math.PI / 2;
const SOUTH = Math.PI / 2;

/** The coffee table by the couch (OfficeFloor.tsx): where the pizza goes. */
export const COFFEE_TABLE = { x: -HALF_W + 2.6, z: 6.5, top: 0.46 };

/** Round the coffee table: lunch, and pizza. */
export const TABLE_SPOTS: readonly Spot[] = [
  { id: 'table-e0', x: COFFEE_TABLE.x + 1.05, z: 6.1, facing: WEST },
  { id: 'table-e1', x: COFFEE_TABLE.x + 1.05, z: 6.9, facing: WEST },
  { id: 'table-s', x: COFFEE_TABLE.x, z: 7.85, facing: NORTH },
  { id: 'table-n', x: COFFEE_TABLE.x, z: 5.15, facing: SOUTH },
];

/** By the kitchenette's counter, past the coffee machine: lunch only. */
export const KITCHEN_SPOTS: readonly Spot[] = [
  { id: 'kitchen-0', x: HALF_W - 1.55, z: 8.75, facing: EAST },
  { id: 'kitchen-1', x: HALF_W - 1.55, z: 9.6, facing: EAST },
  { id: 'kitchen-2', x: HALF_W - 2.6, z: 9.2, facing: EAST },
];

/** Where the courier puts the pizza down: the table's east side. */
export const COURIER_DROP: Spot = { id: 'courier', x: COFFEE_TABLE.x + 1.1, z: 6.5, facing: WEST };

/** Along the aisles between the rows of desks: where the CEO strolls on a walk round a floor. */
export const AISLES: readonly Pt[] = [
  { x: -7, z: -3.6 },
  { x: 0, z: -3.6 },
  { x: 7, z: -3.6 },
  { x: -7, z: 1 },
  { x: 0, z: 1 },
  { x: 7, z: 1 },
];

/** Where someone gone home waits, out of sight: the back of the elevator cabin, beyond where its doors open for people. */
export const PARKED: Pt = { x: 0, z: HALF_D + 2.3 };

/** The first spot of `spots` nobody has (`taken`), nearest `from`; null when they're all taken. */
export function freeSpot<T extends Spot>(spots: readonly T[], taken: ReadonlySet<string>, from: Pt): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const s of spots) {
    if (taken.has(s.id)) continue;
    const d = Math.hypot(s.x - from.x, s.z - from.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// ---------- food ----------

export type Food = 'lunchbox' | 'sandwich' | 'noodles' | 'pizza';
const LUNCHES: readonly Food[] = ['lunchbox', 'sandwich', 'noodles'];

/** What someone has for lunch: the same every day (by their id). */
export function lunchOf(id: string): Food {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LUNCHES[h % LUNCHES.length];
}

/** Slices in the courier's boxes (two boxes of eight; one more box stays shut on top). */
export const SLICES = 16;
