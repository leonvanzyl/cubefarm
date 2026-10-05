import { WALK_SPEED, type Gesture } from '../../body';
import { bodyState, setBody } from '../../people';
import type { Pt } from '../../toys/roombaBrain';

// Walking people along a path for a theme's little scenes (the birthday guests, the New Year crowd at the windows, a
// Valentine's sticky run): one leg at a time through the people controller (people.ts), then standing at the end,
// facing `heading` with a gesture. ThemeLayer ticks it while a theme is mounted.

interface Walk {
  path: Pt[];
  heading: number;
  gesture: Gesture;
  speed: number;
  done?: () => void;
  arrived: boolean;
}

const walks = new Map<string, Walk>();
const NEAR = 0.15;

/** Walks someone already standing (or seated: they get up) through `path`, then stands them facing `heading`. */
export function walkAlong(id: string, path: Pt[], heading: number, gesture: Gesture = 'none', done?: () => void, speed = WALK_SPEED) {
  const w: Walk = { path: path.map((p) => ({ x: p.x, z: p.z })), heading, gesture, speed, done, arrived: false };
  walks.set(id, w);
  step(id, w);
}

/** Forgets someone's walk (they stop where the controller has them). */
export const stopWalk = (id: string) => void walks.delete(id);

/** Whether someone is still on their way. */
export const onTheWay = (id: string) => walks.get(id)?.arrived === false;

function step(id: string, w: Walk) {
  const s = bodyState(id);
  const next = w.path[0];
  if (!next) {
    const at = s ?? { x: 0, z: 0 };
    setBody(id, { mode: 'standing', x: at.x, z: at.z, heading: w.heading, gesture: w.gesture });
    return;
  }
  const from = s ?? next;
  const heading = Math.hypot(next.x - from.x, next.z - from.z) > 0.01 ? Math.atan2(-(next.x - from.x), -(next.z - from.z)) : w.heading;
  setBody(id, { mode: w.path.length > 1 ? 'walking' : 'standing', x: next.x, z: next.z, heading: w.path.length > 1 ? heading : w.heading, speed: w.speed, gesture: w.path.length > 1 ? 'none' : w.gesture });
}

/** Moves every walk on: the next leg once someone reaches a waypoint, and `done` once they reach the last. */
export function tickWalks() {
  for (const [id, w] of walks) {
    if (w.arrived) continue;
    const s = bodyState(id);
    const next = w.path[0];
    if (!s || !next) continue;
    if (Math.hypot(s.x - next.x, s.z - next.z) > NEAR) continue;
    w.path.shift();
    if (w.path.length) step(id, w);
    else {
      w.arrived = true;
      w.done?.();
    }
  }
}
