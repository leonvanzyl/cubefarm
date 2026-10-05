// The people controller: where each agent's body should be (body.ts). Nobody listed here sits at their desk. Plain
// module state, read by Character.tsx every frame, so moving someone never re-renders React.
// window.__swarmPeople drives it by hand (a straight-line walk, no navigation) and reports where everyone is, which
// errand (errands.ts) they're on, and their face and look (face.ts, appearance.ts), for QA and Playwright.

import type { Appearance } from './appearance';
import { WALK_SPEED, type BodyMode, type BodyState, type BodyTarget, type Gesture } from './body';
import { EXPRESSIONS, type Expression } from './face';
import type { Food } from './ritualSchedule';

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

/** A speech bubble: what someone says (an emoji or a short line), performance.now() when they started and when it ends. */
export interface Saying {
  text: string;
  at: number;
  /** performance.now() when it goes away by itself; absent: until hidden. */
  until?: number;
}

/** Shows a speech bubble over someone (null hides it), for `seconds` or until hidden. Character.tsx draws it. */
export function say(id: string, text: string | null, seconds?: number) {
  const at = performance.now();
  if (text) said.set(id, { text, at, until: seconds ? at + seconds * 1000 : undefined });
  else said.delete(id);
}

/** What someone is saying now, if anything. */
export function saying(id: string) {
  const s = said.get(id);
  if (s?.until !== undefined && performance.now() >= s.until) {
    said.delete(id);
    return undefined;
  }
  return s;
}

/** Everyone you can see on the current floor, as they are now (the elevator opens for anyone near its doors). */
export function* bodies() {
  for (const [id, s] of live) if (!hidden.has(id)) yield s;
}

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

/** The errand someone is on, and how far along, while they're on one. */
export const errandOf = (id: string): Readonly<ErrandInfo> | undefined => busy.get(id);

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

/** Character.tsx and Desk.tsx redraw when someone's mugs (or food) change (rarely: a mug taken, a sip, back at the desk). */
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

// ---------- faces ----------

/** Someone's face as Character.tsx last drew it: the expression, how far closed the eyes are (blinks), their look. */
export interface FaceInfo {
  expression: Expression;
  lid: number;
  look: Appearance;
}

const faces = new Map<string, FaceInfo>();
const forced = new Map<string, { expression: Expression; until: number }>();

/** Character.tsx registers each person's face (it updates the object in place every frame). */
export function trackFace(id: string, f: FaceInfo) {
  faces.set(id, f);
  return () => {
    if (faces.get(id) === f) faces.delete(id);
  };
}

/** An expression put on someone by hand through the probe, until it runs out (`now` is performance.now()). */
export function forcedExpression(id: string, now: number) {
  const f = forced.get(id);
  if (f && now > f.until) forced.delete(id);
  return f && now <= f.until ? f.expression : null;
}

// ---------- food in hand, and out of sight (the rituals) ----------

const food = new Map<string, Food>();
const hidden = new Set<string>();

/** What someone eats (lunch, a slice of pizza), drawn in their hand; null for nothing. Redraws like the mugs. */
export function setHandFood(id: string, f: Food | null) {
  if ((food.get(id) ?? null) === f) return;
  if (f) food.set(id, f);
  else food.delete(id);
  changed();
}

export const handFood = (id: string) => food.get(id) ?? null;

/** Someone gone home for the night, the CEO off round the floors, or up on the roof: Character.tsx doesn't draw them. */
export function setHidden(id: string, on: boolean) {
  if (on) hidden.add(id);
  else hidden.delete(id);
}

export const isHidden = (id: string) => hidden.has(id);

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
      says: saying(id)?.text ?? null,
      target: targets.get(id) ?? null,
      mug: hands.get(id) ?? null,
      deskMug: deskMug(id),
      expression: faces.get(id)?.expression ?? null,
      lid: round(faces.get(id)?.lid ?? 0),
      look: faces.get(id)?.look ?? null,
      food: food.get(id) ?? null,
      hidden: hidden.has(id),
    }));
  },
  /** Puts an expression on someone's face for `seconds` (the face.ts names), whatever they're up to. */
  express(id: string, expression: Expression, seconds = 5) {
    if (!EXPRESSIONS.includes(expression)) throw new Error(`no expression "${expression}": try ${EXPRESSIONS.join(', ')}`);
    forced.set(id, { expression, until: performance.now() + seconds * 1000 });
  },
  /** Sends someone seated on an errand by name ('coffee', 'stretch', 'hoops', 'toss', 'catch', 'roof') as soon as the rules and the cap allow. */
  send(id: string, errand: string) {
    asks.set(id, errand);
  },
  /** The errand director on this floor: how many are away, the cap, who is queued. Null on a floor without one. */
  errands() {
    return director?.() ?? null;
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmPeople = probe;
