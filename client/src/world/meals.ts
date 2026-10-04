// The rituals' meals (Rituals.tsx turns them on and off): lunch at the coffee table or the kitchenette, and a slice of
// Friday's pizza from the coffee table. Scripted errands (errands.ts), so only free people go, the walker cap holds and
// work calls them back: they take a spot, eat standing up, chat a little in emoji and go back to their desk.

import type { Gesture } from './body';
import { headingFor, isFree, registerErrand, type Act, type ErrandScript, type Me } from './errands';
import { bodyState, say, setHandFood } from './people';
import { KITCHEN_SPOTS, TABLE_SPOTS, freeSpot, lunchOf } from './ritualSchedule';
import { headingTo } from './socials';
import type { Pt } from './toys/roombaBrain';
import type { Spot } from './walkways';

/** What's on, on the floor you're on. Rituals.tsx sets it; `changed()` tells the pizza on the table to redraw. */
export const meals = {
  lunch: false,
  /** Who has had lunch this lunchtime, and a slice of this pizza. */
  ate: new Set<string>(),
  had: new Set<string>(),
  /** The pizza's on the coffee table, and how many slices are left. */
  pizza: false,
  slices: 0,
  /** Who stands where (spot ids). */
  spots: new Map<string, string>(),
};

const listeners = new Set<() => void>();
let version = 0;

export function subscribeMeals(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const mealsVersion = () => version;

export function mealsChanged() {
  version++;
  for (const fn of listeners) fn();
}

/** Nothing on: the floor went away. */
export function resetMeals() {
  Object.assign(meals, { lunch: false, pizza: false, slices: 0 });
  meals.ate.clear();
  meals.had.clear();
  meals.spots.clear();
  mealsChanged();
}

/** Seconds someone sits at lunchtime before going, from their roll: people go in turns, not all at once. */
export const lunchWait = (roll = 0.5) => 2 + roll * 30;

const taken = () => new Set(meals.spots.values());
const picked = new Map<string, Spot>();

/** Where to eat: with whoever is already eating, else at the coffee table or the kitchenette (by their roll). */
function placeFor(id: string, spots: readonly (readonly Spot[])[], home: Pt, roll = 0.5): Spot | null {
  const used = taken();
  const busy = spots.find((venue) => venue.some((s) => used.has(s.id)) && venue.some((s) => !used.has(s.id)));
  const order = busy ? [busy] : roll < 0.5 ? spots : [...spots].reverse();
  for (const venue of order) {
    const s = freeSpot(venue, used, home);
    if (s) {
      picked.set(id, s);
      return s;
    }
  }
  return null;
}

function claimSpot(id: string): Spot | null {
  const s = picked.get(id);
  picked.delete(id);
  if (!s || taken().has(s.id)) return null;
  meals.spots.set(id, s.id);
  return s;
}

/** One beat of a meal: for `t` seconds do `gesture`, maybe saying something, facing their spot or whoever is near. */
type Beat = { t: number; gesture: Gesture; say?: string; peer?: boolean; grab?: boolean };

const LUNCH_BEATS: Beat[] = [
  { t: 1, gesture: 'none' },
  { t: 1.6, gesture: 'sip' },
  { t: 1.6, gesture: 'none', say: '😋', peer: true },
  { t: 1.5, gesture: 'sip' },
  { t: 2.6, gesture: 'talk', say: '💬', peer: true },
  { t: 1.5, gesture: 'sip' },
  { t: 2.4, gesture: 'talk', say: '😂', peer: true },
  { t: 1.4, gesture: 'sip' },
  { t: 1, gesture: 'none', peer: true },
];

const PIZZA_BEATS: Beat[] = [
  { t: 0.9, gesture: 'stoop', grab: true },
  { t: 0.6, gesture: 'none' },
  { t: 1.5, gesture: 'sip', say: '🍕' },
  { t: 1.8, gesture: 'none', peer: true },
  { t: 1.5, gesture: 'sip' },
  { t: 2.2, gesture: 'talk', say: '😋', peer: true },
  { t: 1.4, gesture: 'sip' },
];

/** The nearest other person eating, for a chat. */
function nearestEater(id: string, me: Pt): Pt | null {
  let best: Pt | null = null;
  let bd = 3;
  for (const other of meals.spots.keys()) {
    if (other === id) continue;
    const b = bodyState(other);
    const d = b ? Math.hypot(b.x - me.x, b.z - me.z) : Infinity;
    if (b && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Eats through the beats at their spot; a slice of pizza is taken off the table first (none left: a shrug). */
class Meal implements ErrandScript {
  private act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  private beat = -1;
  private left = 0;

  constructor(
    readonly id: string,
    readonly spot: Spot,
    private beats: Beat[],
  ) {}

  tick(me: Me): Act {
    this.left -= me.dt;
    while (this.left <= 0) {
      this.beat++;
      const b = this.beats[this.beat];
      if (!b) {
        this.act.do = 'done';
        return this.act;
      }
      this.left += b.t;
      say(this.id, b.say ?? null);
      if (b.grab) {
        if (meals.slices <= 0) {
          // all gone: a shrug, and back to their desk
          this.beats = [{ t: 1.4, gesture: 'shrug' }];
          this.beat = -1;
          this.left = 0;
          continue;
        }
        meals.slices--;
        mealsChanged();
        setHandFood(this.id, 'pizza');
      }
      const peer = b.peer ? nearestEater(this.id, me) : null;
      this.act.heading = peer ? headingTo(me, peer) : headingFor(this.spot.facing);
      this.act.gesture = b.gesture;
    }
    return this.act;
  }

  end() {
    meals.spots.delete(this.id);
    setHandFood(this.id, null);
    say(this.id, null);
  }
}

registerErrand({
  name: 'lunch',
  weight: 500,
  when: (a, s) => s.floor === 'office' && meals.lunch && isFree(a.status) && !meals.ate.has(a.id) && s.seatedFor >= lunchWait(s.roll),
  spot: [],
  steps: [],
  place: (a, s) => placeFor(a.id, [TABLE_SPOTS, KITCHEN_SPOTS], s.home ?? TABLE_SPOTS[0], s.roll),
  claim: (id) => {
    if (!meals.lunch || !claimSpot(id)) return false;
    meals.ate.add(id);
    setHandFood(id, lunchOf(id));
    return true;
  },
  bring: 'hold',
  script: (a) => {
    const s = meals.spots.get(a.id);
    const spot = [...TABLE_SPOTS, ...KITCHEN_SPOTS].find((x) => x.id === s);
    return spot ? new Meal(a.id, spot, LUNCH_BEATS) : null;
  },
});

registerErrand({
  name: 'pizza',
  weight: 600,
  when: (a, s) => s.floor === 'office' && meals.pizza && meals.slices > 0 && isFree(a.status) && !meals.had.has(a.id) && s.seatedFor >= lunchWait(s.roll) / 2,
  spot: [],
  steps: [],
  place: (a, s) => placeFor(a.id, [TABLE_SPOTS], s.home ?? TABLE_SPOTS[0]),
  claim: (id) => {
    if (!meals.pizza || meals.slices <= 0 || !claimSpot(id)) return false;
    meals.had.add(id);
    return true;
  },
  script: (a) => {
    const s = meals.spots.get(a.id);
    const spot = TABLE_SPOTS.find((x) => x.id === s);
    return spot ? new Meal(a.id, spot, PIZZA_BEATS) : null;
  },
});
