// The people controller: where each agent's body should be (body.ts). Nobody listed here sits at their desk. Plain
// module state, read by Character.tsx every frame, so moving someone never re-renders React.
// window.__swarmPeople drives it by hand (a straight-line walk, no navigation) and reports where everyone is and
// which errand (errands.ts) they're on, for QA and Playwright.

import { WALK_SPEED, type BodyMode, type BodyState, type BodyTarget, type Gesture } from './body';

const targets = new Map<string, BodyTarget>();
const live = new Map<string, BodyState>();
const busy = new Map<string, ErrandInfo>();
const said = new Map<string, Saying>();
let teleports = 0;
let director: (() => unknown) | null = null;

/** The errand someone is on, as the probe shows it. */
export interface ErrandInfo {
  name: string;
  phase: string;
  spot: string;
}

/** This agent's body target, or undefined to stay (or go back to being) seated. */
export const bodyTarget = (id: string) => targets.get(id);

/** Sends someone to stand or walk somewhere. Fields left out keep their current value. */
export function setBody(id: string, patch: Partial<Omit<BodyTarget, 'teleport'>>) {
  const t = targets.get(id) ?? { mode: 'walking' as BodyMode, x: 0, z: 0, heading: 0, speed: WALK_SPEED, gesture: 'none' as Gesture, teleport: 0 };
  targets.set(id, { ...t, ...patch });
}

/** Stands someone at (x, z) straight away, facing heading (a new hire inside the elevator, say). */
export function placeBody(id: string, x: number, z: number, heading = 0) {
  setBody(id, { mode: 'standing', x, z, heading });
  targets.set(id, { ...targets.get(id)!, teleport: ++teleports });
}

/** Back to their chair: they walk to the standing spot beside it and sit down. */
export const seatBody = (id: string) => void targets.delete(id);

/** A speech bubble: what someone says (an emoji) and performance.now() when they started. */
export interface Saying {
  text: string;
  at: number;
}

/** Shows a speech bubble over someone (null hides it). Character.tsx draws it. */
export function say(id: string, text: string | null) {
  if (text) said.set(id, { text, at: performance.now() });
  else said.delete(id);
}

export const saying = (id: string) => said.get(id);

/** Everyone drawn on the current floor, as they are now (the elevator opens for anyone near its doors). */
export const bodies = () => live.values();

/** Character.tsx registers each person's live state, so the probe can report it. */
export function trackBody(id: string, s: BodyState) {
  live.set(id, s);
  return () => {
    if (live.get(id) === s) live.delete(id);
  };
}

/** Everyone drawn on the current floor, by agent id. */
export const liveBodies = (): ReadonlyMap<string, BodyState> => live;

/** Someone's live body (where they are now), while they're drawn on the current floor. */
export const bodyState = (id: string) => live.get(id);

/** The errand director (ErrandDirector.tsx) says who is on which errand; null when they're at their desk. */
export function setErrand(id: string, info: ErrandInfo | null) {
  if (info) busy.set(id, info);
  else busy.delete(id);
}

/** Whether the errand director has them out on an errand (rather than someone walking them by hand). */
export const onErrand = (id: string) => busy.has(id);

const claimers = new Set<(id: string) => void>();

/** The errand director lets go of anyone claimed by something that beats an errand (the gong run). */
export function onClaim(fn: (id: string) => void) {
  claimers.add(fn);
  return () => void claimers.delete(fn);
}

/** Takes someone off their errand there and then; their body target goes too, for the caller to set the next. */
export function claimBody(id: string) {
  for (const fn of claimers) fn(id);
  busy.delete(id);
  targets.delete(id);
}

/** The director on the current floor reports its summary through the probe while it runs. */
export function trackDirector(report: () => unknown) {
  director = report;
  return () => {
    if (director === report) director = null;
  };
}

/** In their chair and staying there (nobody told to get up, not rising, walking or sitting back down). */
export const isSeated = (id: string) => !targets.has(id) && (live.get(id)?.stage ?? 'seated') === 'seated';

// ---------- mugs ----------

/** A mug someone holds, or one they left on their desk (until `until`, a Date.now() time). */
export interface PersonMug {
  id: string;
  sips: number;
}

const hands = new Map<string, PersonMug>();
const desks = new Map<string, PersonMug & { until: number }>();
const mugListeners = new Set<() => void>();
const changed = () => {
  for (const fn of mugListeners) fn();
};

/** Character.tsx and Desk.tsx redraw when someone's mugs change (rarely: a mug taken, a sip, back at the desk). */
export function subscribeMugs(fn: () => void) {
  mugListeners.add(fn);
  return () => void mugListeners.delete(fn);
}

/** The mug in someone's hand; null for none. */
export const handMug = (id: string) => hands.get(id) ?? null;

export function setHandMug(id: string, mug: PersonMug | null) {
  if (mug) hands.set(id, mug);
  else hands.delete(id);
  changed();
}

/** A coffee someone brought back to their desk, while it's still there. */
export function deskMug(id: string, now = Date.now()) {
  const d = desks.get(id);
  return d && d.until > now ? d : null;
}

export function setDeskMug(id: string, mug: PersonMug, seconds: number) {
  desks.set(id, { ...mug, until: Date.now() + seconds * 1000 });
  changed();
}

// ---------- errands asked for by hand ----------

const asks = new Map<string, string>();

/** The errand someone was sent on through the probe, once (the director takes it). */
export function takeAsk(id: string) {
  const name = asks.get(id);
  asks.delete(id);
  return name;
}

const round = (n: number) => Math.round(n * 100) / 100;
const modeOf = (s: BodyState): BodyMode => (s.stage === 'seated' ? 'seated' : s.speed > 0.05 ? 'walking' : 'standing');

const probe = {
  /** Stands someone up at (x, z) straight away, facing heading. */
  place: placeBody,
  /** Gets someone up (if seated) and walks them in a straight line to (x, z). speed in m/s. */
  walkTo(id: string, x: number, z: number, speed = WALK_SPEED, heading?: number) {
    const s = live.get(id);
    setBody(id, { mode: 'walking', x, z, speed, heading: heading ?? (s ? Math.atan2(-(x - s.x), -(z - s.z)) : 0) });
  },
  sit: seatBody,
  gesture(id: string, gesture: Gesture) {
    setBody(id, { gesture, ...(targets.has(id) ? {} : { mode: 'standing' as BodyMode, ...this.where(id) }) });
  },
  where(id: string) {
    const s = live.get(id);
    return s ? { x: s.x, z: s.z, heading: s.heading } : { x: 0, z: 0, heading: 0 };
  },
  /** Everyone drawn on the current floor. */
  list() {
    return [...live].map(([id, s]) => ({
      id,
      mode: modeOf(s),
      stage: s.stage,
      x: round(s.x),
      z: round(s.z),
      heading: round(s.heading),
      speed: round(s.speed),
      errand: busy.get(id) ?? null,
      says: said.get(id)?.text ?? null,
      target: targets.get(id) ?? null,
      mug: hands.get(id) ?? null,
      deskMug: deskMug(id),
    }));
  },
  /** Sends someone seated on an errand by name ('coffee', 'stretch', 'hoops', 'toss', 'catch') as soon as the rules and the cap allow. */
  send(id: string, errand: string) {
    asks.set(id, errand);
  },
  /** The errand director on this floor: how many are away, the cap, who is queued. Null on a floor without one. */
  errands() {
    return director?.() ?? null;
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmPeople = probe;
