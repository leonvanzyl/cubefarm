// The people controller: where each agent's body should be (body.ts). Nobody listed here sits at their desk. Plain
// module state, read by Character.tsx every frame, so moving someone never re-renders React.
// window.__swarmPeople drives it by hand (a straight-line walk, no navigation) and reports where everyone is and
// which errand (errands.ts) they're on, for QA and Playwright.

import { WALK_SPEED, type BodyMode, type BodyState, type BodyTarget, type Gesture } from './body';

const targets = new Map<string, BodyTarget>();
const live = new Map<string, BodyState>();
const busy = new Map<string, ErrandInfo>();
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

/** Back to their chair: they walk to the standing spot beside it and sit down. */
export const seatBody = (id: string) => void targets.delete(id);

/** Character.tsx registers each person's live state, so the probe can report it. */
export function trackBody(id: string, s: BodyState) {
  live.set(id, s);
  return () => {
    if (live.get(id) === s) live.delete(id);
  };
}

/** Someone's live body (where they are now), while they're drawn on the current floor. */
export const bodyState = (id: string) => live.get(id);

/** The errand director (ErrandDirector.tsx) says who is on which errand; null when they're at their desk. */
export function setErrand(id: string, info: ErrandInfo | null) {
  if (info) busy.set(id, info);
  else busy.delete(id);
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

/** Everyone drawn on the current floor, by agent id. */
export const liveBodies = (): ReadonlyMap<string, BodyState> => live;

const round = (n: number) => Math.round(n * 100) / 100;
const modeOf = (s: BodyState): BodyMode => (s.stage === 'seated' ? 'seated' : s.speed > 0.05 ? 'walking' : 'standing');

const probe = {
  /** Stands someone up at (x, z) straight away, facing heading. */
  place(id: string, x: number, z: number, heading = 0) {
    setBody(id, { mode: 'standing', x, z, heading });
    targets.set(id, { ...targets.get(id)!, teleport: ++teleports });
  },
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
      target: targets.get(id) ?? null,
    }));
  },
  /** The errand director on this floor: how many are away, the cap, who is queued. Null on a floor without one. */
  errands() {
    return director?.() ?? null;
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmPeople = probe;
