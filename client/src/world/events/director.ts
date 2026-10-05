// World events outside: the catalogue (from an airliner crossing to a friendly kaiju wading through the city) and the
// director that picks one every so often. Pure and seeded (no three.js, no clock of its own: it's stepped with the
// render's seconds, so nothing happens while the office isn't on screen), so the schedule is tested without a browser.
// eventsState.ts runs it; scenes/ draws each event.

import type { EventFrequency } from '../../../../shared/outside';

export const EVENT_IDS = ['plane', 'helicopter', 'birds', 'balloon', 'blimp', 'skywriting', 'fireworks', 'ufo', 'meteors', 'rainbow', 'kaiju', 'duck', 'whale', 'hurricane'] as const;
export type EventId = (typeof EVENT_IDS)[number];

/** Everyday sights, fun ones, weird ones, the absurd and rare, and the weather's own. */
export type Tier = 'everyday' | 'fun' | 'weird' | 'absurd' | 'weather';

export interface EventDef {
  id: EventId;
  label: string;
  tier: Tier;
  /** Big events draw a crowd at the windows and never overlap each other; everyday ones can run alongside. */
  big: boolean;
  /** How likely, against the others that may happen now. */
  weight: number;
  /** How long it runs, seconds of render time. */
  seconds: number;
  /** Only by day or only at night. */
  when: 'any' | 'day' | 'night';
  /** The rare ones put a note on your phone. */
  toast: boolean;
}

const def = (id: EventId, label: string, tier: Tier, weight: number, seconds: number, when: EventDef['when'] = 'any'): EventDef => ({
  id,
  label,
  tier,
  big: tier !== 'everyday',
  weight,
  seconds,
  when,
  toast: tier === 'weird' || tier === 'absurd' || tier === 'weather',
});

export const EVENTS: Record<EventId, EventDef> = {
  plane: def('plane', 'An airliner crossing high', 'everyday', 10, 70),
  helicopter: def('helicopter', 'A helicopter circling the block', 'everyday', 6, 60),
  birds: def('birds', 'A flock of birds sweeping past', 'everyday', 8, 26, 'day'),
  balloon: def('balloon', 'A hot-air balloon drifting by', 'everyday', 5, 95, 'day'),
  blimp: def('blimp', 'A blimp with the office news', 'fun', 4, 85),
  skywriting: def('skywriting', "Skywriting the floor's name", 'fun', 3, 80, 'day'),
  fireworks: def('fireworks', 'Fireworks over the city', 'fun', 4, 60, 'night'),
  ufo: def('ufo', 'A UFO borrowing a car', 'weird', 2, 40),
  meteors: def('meteors', 'A meteor shower', 'weird', 3, 50, 'night'),
  rainbow: def('rainbow', 'A rainbow', 'weird', 0.6, 70, 'day'),
  kaiju: def('kaiju', 'A friendly kaiju wading through the city', 'absurd', 0.8, 80),
  duck: def('duck', 'A giant rubber duck floating past', 'absurd', 1, 75),
  whale: def('whale', 'A whale-shaped airship', 'absurd', 1, 85),
  hurricane: def('hurricane', 'A hurricane passing offshore', 'weather', 0.7, 95),
};

const ALIASES: Record<string, EventId> = {
  airliner: 'plane',
  jet: 'plane',
  heli: 'helicopter',
  chopper: 'helicopter',
  flock: 'birds',
  bird: 'birds',
  'hot-air-balloon': 'balloon',
  skywriter: 'skywriting',
  'sky-writing': 'skywriting',
  firework: 'fireworks',
  saucer: 'ufo',
  meteor: 'meteors',
  'meteor-shower': 'meteors',
  monster: 'kaiju',
  'rubber-duck': 'duck',
  airship: 'whale',
  'whale-airship': 'whale',
  storm: 'hurricane',
};

/** An event's name as typed (`?event=kaiju`, __swarmEvents.trigger('duck')), or null when it isn't one. */
export function parseEventId(raw: unknown): EventId | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return EVENT_IDS.includes(k as EventId) ? (k as EventId) : (ALIASES[k] ?? null);
}

export const parseEventParam = (search: string) => parseEventId(new URLSearchParams(search).get('event'));

// ---------- what may happen now ----------

/** What the director needs to know about the moment. */
export interface Moment {
  frequency: EventFrequency;
  /** Keep it calm: no absurd events and no hurricane. */
  calm: boolean;
  night: boolean;
  /** The weather is on (not Settings → Weather → Off), so weather events can happen. */
  weather: boolean;
  /** How hard it's raining now (0-1). */
  rain: number;
  /** Seconds since it last rained (Infinity: not today). */
  sinceRain: number;
}

/** Whether `e` could happen at this moment. */
export function eligible(e: EventDef, m: Moment): boolean {
  if (m.frequency === 'off') return false;
  if (m.calm && (e.tier === 'absurd' || e.tier === 'weather')) return false;
  if (e.when === 'day' && m.night) return false;
  if (e.when === 'night' && !m.night) return false;
  if (e.id === 'hurricane' && !m.weather) return false;
  // a rainbow wants the sun out: not in the rain itself
  if (e.id === 'rainbow' && m.rain > 0.15) return false;
  return true;
}

/** How likely `e` is now, against the others: a rainbow is likely just after rain, a hurricane while it rains. */
export function weightOf(e: EventDef, m: Moment): number {
  if (!eligible(e, m)) return 0;
  if (e.id === 'rainbow') return m.weather && m.sinceRain < 600 ? 6 : e.weight;
  if (e.id === 'hurricane') return e.weight * (1 + 3 * m.rain);
  return e.weight;
}

/** One event picked by weight (`roll` in [0, 1)), leaving out what's running and, while a big one runs, every big one. */
export function pickEvent(m: Moment, running: readonly { id: EventId; big: boolean }[], roll: number): EventId | null {
  const bigNow = running.some((r) => r.big);
  const options = Object.values(EVENTS).filter((e) => !running.some((r) => r.id === e.id) && !(bigNow && e.big));
  const weights = options.map((e) => weightOf(e, m));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = roll * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r < 0 && weights[i] > 0) return options[i].id;
  }
  return options[weights.findLastIndex((w) => w > 0)].id;
}

/** Seconds until the next event: every 6-20 minutes normally, rarer or all the time; Infinity when off. */
export const GAPS: Record<EventFrequency, [number, number] | null> = {
  off: null,
  rare: [20 * 60, 45 * 60],
  normal: [6 * 60, 20 * 60],
  chaos: [50, 150],
};

export function gapSeconds(frequency: EventFrequency, roll: number): number {
  const g = GAPS[frequency];
  return g ? g[0] + (g[1] - g[0]) * Math.min(1, Math.max(0, roll)) : Infinity;
}

/** When nothing may happen at the moment it's due (night-only events by day, a big one already on), look again in a bit. */
export const RETRY_SECONDS = 30;

// ---------- the director ----------

export interface Running {
  key: number;
  id: EventId;
  big: boolean;
  /** Director-clock seconds it ends at. */
  until: number;
}

export interface Director {
  /** Seconds of render time the director has run. */
  clock: number;
  nextAt: number;
  frequency: EventFrequency;
  running: Running[];
  rand: () => number;
}

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A director that has run for no time yet. The first event comes a little sooner than the rest, so a visit sees one. */
export function newDirector(seed: number, frequency: EventFrequency): Director {
  const rand = seeded(seed);
  return { clock: 0, nextAt: gapSeconds(frequency, rand()) * 0.5, frequency, running: [], rand };
}

/** Settings → World events changed: a new frequency reschedules the next event from now. */
export function setFrequency(d: Director, frequency: EventFrequency) {
  if (frequency === d.frequency) return;
  d.frequency = frequency;
  d.nextAt = d.clock + gapSeconds(frequency, d.rand()) * 0.5;
}

/**
 * Moves the director on by dt seconds: what has finished drops out, and when the next event is due one is picked
 * (or, when none may happen now, it looks again shortly). Returns the event to start, or null.
 */
export function stepDirector(d: Director, dt: number, m: Moment): EventId | null {
  d.clock += dt;
  setFrequency(d, m.frequency);
  for (let i = d.running.length - 1; i >= 0; i--) if (d.running[i].until <= d.clock) d.running.splice(i, 1);
  if (d.clock < d.nextAt) return null;
  const id = pickEvent(m, d.running, d.rand());
  d.nextAt = d.clock + (id ? gapSeconds(m.frequency, d.rand()) : RETRY_SECONDS);
  return id;
}

/** Records an event as running (scheduled or forced), until its time is up. */
export function startRunning(d: Director, key: number, id: EventId, seconds = EVENTS[id].seconds) {
  d.running.push({ key, id, big: EVENTS[id].big, until: d.clock + seconds });
}

/** An event ended early (or was replaced by a forced one). */
export function stopRunning(d: Director, key: number) {
  const i = d.running.findIndex((r) => r.key === key);
  if (i >= 0) d.running.splice(i, 1);
}
