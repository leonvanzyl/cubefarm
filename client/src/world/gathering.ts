// Gatherings: a few people called to stand together for a while, each at a spot of their own (the stand-up's arc at
// the whiteboard). One scripted errand (errands.ts) runs every gathering, so the errand director treats it like any
// other: only free people come, the walker cap holds, work calls them straight back, and leaving the floor ends it.
// Whoever opens one (Rituals.tsx) says what everyone does from moment to moment, and when it's over.

import type { Gesture } from './body';
import { headingFor, isFree, registerErrand, type Act, type ErrandAgent, type ErrandScript, type Me } from './errands';
import type { Pt } from './toys/roombaBrain';
import type { FloorKind, Spot } from './walkways';

export interface GatheringSpec {
  name: string;
  floor: FloorKind;
  /** Where people stand, one each. */
  spots: readonly Spot[];
  /** Who may come, besides being free (errands.ts isFree). */
  welcome(a: ErrandAgent): boolean;
}

export interface Gathering {
  spec: GatheringSpec;
  /** Who has which spot (an index into spec.spots), and who has got there. */
  seats: Map<string, number>;
  there: Set<string>;
  /** Everyone who has come: nobody comes twice. */
  came: Set<string>;
  /** Still taking people; once `over`, everyone heads back. */
  open: boolean;
  over: boolean;
  /** What everyone does now (a person's own, from `gestureOf`, wins), and how far they look away from their facing. */
  gesture: Gesture;
  gestureOf: ((id: string) => Gesture | null) | null;
  turn: number;
}

let current: Gathering | null = null;
/** The spot `place` picked for someone, which `claim` then gives them. */
const picked = new Map<string, number>();

/** Opens a gathering on the floor you're on (one at a time: an earlier one is over). */
export function openGathering(spec: GatheringSpec): Gathering {
  if (current) current.over = true;
  current = { spec, seats: new Map(), there: new Set(), came: new Set(), open: true, over: false, gesture: 'none', gestureOf: null, turn: 0 };
  return current;
}

/** Everyone heads back to their desk, and nobody else comes. */
export function closeGathering(g: Gathering) {
  g.open = false;
  g.over = true;
  if (current === g) current = null;
}

export const gathering = () => current;

/** The free spot (an index) nearest `from`, or null when every one is taken. */
export function nearestFreeSpot(spots: readonly Pt[], taken: Iterable<number>, from: Pt): number | null {
  const used = new Set(taken);
  let best: number | null = null;
  let bd = Infinity;
  spots.forEach((s, i) => {
    if (used.has(i)) return;
    const d = Math.hypot(s.x - from.x, s.z - from.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

const wanted = (g: Gathering | null, a: ErrandAgent): g is Gathering => !!g && g.open && !g.over && isFree(a.status) && !g.came.has(a.id) && g.spec.welcome(a);

/** Stands at their spot, doing what the gathering does, until it's over. */
class Attend implements ErrandScript {
  private act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };

  constructor(
    readonly id: string,
    readonly g: Gathering,
  ) {}

  tick(_me: Me): Act {
    const g = this.g;
    const i = g.seats.get(this.id);
    if (g.over || i === undefined) {
      this.act.do = 'done';
      return this.act;
    }
    g.there.add(this.id);
    this.act.heading = headingFor(g.spec.spots[i].facing) + g.turn;
    this.act.gesture = g.gestureOf?.(this.id) ?? g.gesture;
    return this.act;
  }

  end() {
    this.g.seats.delete(this.id);
    this.g.there.delete(this.id);
  }
}

registerErrand({
  name: 'gathering',
  // whatever else they fancied, a gathering wins
  weight: 1000,
  when: (a, s) => wanted(current, a) && current.spec.floor === s.floor && current.seats.size < current.spec.spots.length,
  spot: [],
  steps: [],
  place: (a, s) => {
    const g = current;
    if (!wanted(g, a)) return null;
    const i = nearestFreeSpot(g.spec.spots, g.seats.values(), s.home ?? g.spec.spots[0]);
    if (i === null) return null;
    picked.set(a.id, i);
    return g.spec.spots[i];
  },
  claim: (id) => {
    const g = current;
    const i = picked.get(id);
    picked.delete(id);
    if (!g || !g.open || g.over || i === undefined || [...g.seats.values()].includes(i)) return false;
    g.seats.set(id, i);
    g.came.add(id);
    return true;
  },
  script: (a) => {
    const g = current;
    return g && g.seats.has(a.id) ? new Attend(a.id, g) : null;
  },
});
