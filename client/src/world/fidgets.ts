// Little life at the desk: which short personal motion (a fidget) someone is doing right now, and when the next one
// comes. Pure and allocation-free; Character.tsx steps one per person every frame and draws the pose. Seeded by the
// agent's id, so neighbours never move in lockstep, and each fidget is a few seconds with a cooldown after it.
// Times are in seconds.

export type Fidget =
  // idle at the desk
  | 'leanBack' // hands behind the head
  | 'spin' // swivel the chair a little
  | 'phone' // check their phone
  | 'sip' // a sip from the desk mug
  | 'stretch' // stand up, arms overhead, sit again
  | 'doze' // nod off after a long idle, until something happens
  // while working
  | 'neckRoll'
  | 'shoulders' // one arm across the chest
  | 'scratch' // scratch the head while thinking
  // reactions
  | 'facepalm' // their session errored
  | 'fistPump' // their PR passed QA
  | 'wave'; // a neighbour just merged

/** What they're up to, as far as fidgeting goes. 'busy' (setting up, cheering, slumped, away) means no fidgets. */
export type Mood = 'idle' | 'working' | 'thinking' | 'browsing' | 'busy';

/** How long each fidget lasts (seconds). Doze has no end: it lasts until something happens. */
export const FIDGET_SECONDS: Record<Fidget, number> = {
  leanBack: 4.5,
  spin: 2.6,
  phone: 5,
  sip: 3.4,
  stretch: 4.2,
  doze: Infinity,
  neckRoll: 2.8,
  shoulders: 2.6,
  scratch: 2,
  facepalm: 1.9,
  fistPump: 1.7,
  wave: 2.1,
};

const IDLE: readonly Fidget[] = ['leanBack', 'spin', 'phone', 'sip', 'stretch'];
/** Gaps between idle fidgets, and how long someone idles before they may nod off. */
export const IDLE_GAP = { min: 5, max: 14 };
export const DOZE_AFTER = { min: 80, max: 130 };
/** Working: a stretch now and then once a session has run a while; a head scratch once thinking drags on. */
export const WORK_GAP = { min: 25, max: 55 };
export const LONG_SESSION = 60;
export const LONG_THOUGHT = 5;
const SCRATCH_GAP = 10;
/** Seconds to ease into and out of a fidget. */
const EASE_IN = 0.35;
const EASE_OUT = 0.45;

export interface DeskLife {
  fidget: Fidget | null;
  since: number;
  until: number;
  /** When the next idle (or working) fidget may start. */
  next: number;
  /** The last idle fidget, so it isn't picked twice in a row. */
  last: Fidget | null;
  mood: Mood;
  /** When the current mood began, and when the current working session did (working, thinking or browsing). */
  moodSince: number;
  sessionSince: number;
  dozeAfter: number;
  lastScratch: number;
  /** The seeded random state (mulberry32). */
  rng: number;
  /** Whether there's a desk mug to sip from (the CEO's lobby desk has none). */
  hasMug: boolean;
}

/** A 32-bit hash of an id (FNV-1a). */
export function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The next number in [0, 1) from the state's seeded generator (mulberry32). */
export function random(s: DeskLife) {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const between = (s: DeskLife, r: { min: number; max: number }) => r.min + (r.max - r.min) * random(s);

export function newDeskLife(id: string, now: number, hasMug = true): DeskLife {
  const s: DeskLife = { fidget: null, since: 0, until: 0, next: 0, last: null, mood: 'busy', moodSince: now, sessionSince: now, dozeAfter: 0, lastScratch: -Infinity, rng: seedOf(id), hasMug };
  // Everyone starts at a different point, so a room that loads together doesn't fidget together.
  s.next = now + 2 + random(s) * IDLE_GAP.max;
  s.dozeAfter = between(s, DOZE_AFTER);
  return s;
}

function start(s: DeskLife, f: Fidget, now: number) {
  s.fidget = f;
  s.since = now;
  // a little personal variation in length
  s.until = now + FIDGET_SECONDS[f] * (f === 'doze' ? 1 : 0.9 + random(s) * 0.2);
}

function stop(s: DeskLife, now: number, gap: { min: number; max: number }) {
  s.fidget = null;
  s.next = now + between(s, gap);
}

const isIdleFidget = (f: Fidget) => IDLE.includes(f) || f === 'doze';
const atWork = (m: Mood) => m === 'working' || m === 'thinking' || m === 'browsing';
export const isReaction = (f: Fidget | null) => f === 'facepalm' || f === 'fistPump' || f === 'wave';

/** Plays a fidget straight away (a reaction, or one asked for by the dev probe), whatever they were doing. */
export function play(s: DeskLife, f: Fidget, now: number) {
  start(s, f, now);
  if (f !== 'doze') s.moodSince = now; // something happened, so no dozing straight after
}

/** Something happened (hit by a toy, spoken to): wake from a doze and idle a while before the next fidget. */
export function wake(s: DeskLife, now: number) {
  if (s.fidget === 'doze') stop(s, now, IDLE_GAP);
  s.moodSince = now;
}

/** Advances the schedule to `now` for this mood. Mutates and returns `s`. */
export function stepDeskLife(s: DeskLife, mood: Mood, now: number): DeskLife {
  if (mood !== s.mood) {
    if (atWork(mood) && !atWork(s.mood)) {
      s.sessionSince = now;
      s.next = now + between(s, WORK_GAP);
    }
    if (mood === 'idle') s.next = now + between(s, IDLE_GAP) * 0.5;
    s.mood = mood;
    s.moodSince = now;
    // A change of mood ends whatever didn't belong to it (reactions play out).
    const f = s.fidget;
    if (f && !isReaction(f) && (mood === 'idle' ? !isIdleFidget(f) : mood === 'busy' || isIdleFidget(f))) stop(s, now, IDLE_GAP);
  }
  if (s.fidget) {
    if (now < s.until) return s;
    const reaction = isReaction(s.fidget);
    stop(s, now, s.mood === 'idle' ? IDLE_GAP : WORK_GAP);
    // after a reaction, the regular fidgets wait their turn
    if (reaction) s.next = Math.max(s.next, now + IDLE_GAP.min);
  }
  if (mood === 'idle') {
    if (now - s.moodSince >= s.dozeAfter) start(s, 'doze', now);
    else if (now >= s.next) {
      let f = IDLE[Math.floor(random(s) * IDLE.length)];
      if (f === s.last || (f === 'sip' && !s.hasMug)) f = IDLE[(IDLE.indexOf(f) + 1 + Math.floor(random(s) * 2)) % IDLE.length];
      if (f === 'sip' && !s.hasMug) f = 'leanBack';
      s.last = f;
      start(s, f, now);
    }
  } else if (mood === 'thinking') {
    if (now - s.moodSince >= LONG_THOUGHT && now - s.lastScratch >= SCRATCH_GAP) {
      s.lastScratch = now;
      start(s, 'scratch', now);
    }
  } else if (mood === 'working' && now >= s.next && now - s.sessionSince >= LONG_SESSION) {
    start(s, random(s) < 0.5 ? 'neckRoll' : 'shoulders', now);
  }
  return s;
}

/** How far through the current fidget they are, 0 to 1 (0 when there is none; a doze counts from when it began). */
export function fidgetProgress(s: DeskLife, now: number) {
  if (!s.fidget) return 0;
  if (s.until === Infinity) return now - s.since;
  return Math.min(1, Math.max(0, (now - s.since) / (s.until - s.since)));
}

/** How much of the fidget shows, 0 to 1: it eases in at the start and out at the end. */
export function fidgetWeight(s: DeskLife, now: number) {
  if (!s.fidget) return 0;
  const a = Math.min(1, (now - s.since) / EASE_IN);
  const b = s.until === Infinity ? 1 : Math.min(1, (s.until - now) / EASE_OUT);
  const w = Math.max(0, Math.min(a, b));
  return w * w * (3 - 2 * w);
}
