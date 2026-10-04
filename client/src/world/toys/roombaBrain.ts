import { FLOOR_D, FLOOR_W, HALF_D, HALF_W, PLAYER_RADIUS, SIDES, elevatorDoorway, lobbyColliders, officeColliders, rect, sideDoorway, WALL_T, type Rect } from '../layout';
import type { ToyFloor } from './balls';

// The roomba's brain: a pure state machine over the 2D layout rects, stepped once per physics step by Roomba.tsx.
// It cleans with bump-and-turn, some wall-following and the odd spiral, plans a grid path home when the run is
// over, charges, and goes out again. Headings are radians in the x/z plane: forward is (cos h, sin h), and a
// growing heading turns right.

export const ROOMBA = {
  r: 0.17,
  h: 0.09,
  speed: 0.3,
  turnRate: 1.8, // rad/s, turning in place
  backSpeed: 0.2,
  cleanMin: 120, // seconds out cleaning before it heads home
  cleanMax: 180,
  charge: 30, // seconds on the dock
  firstCharge: 6, // seconds it sits on the dock when the floor loads
  stuckAfter: 5,
  spin: 1.3, // seconds for the happy spin (two turns)
};

export type RoombaState = 'charging' | 'leaving' | 'cleaning' | 'returning' | 'docking';
export type RoombaMove = 'idle' | 'drive' | 'turn' | 'back' | 'spiral' | 'follow' | 'wait' | 'path' | 'park' | 'spin';

export interface Pt {
  x: number;
  z: number;
}

/** Things that happened during a step, ORed into Roomba.events for the sounds to pick up (and clear). */
export const ROOMBA_EVENT = {
  leave: 1, // backing off the dock
  home: 2, // run over: heading home
  dock: 4, // parked on the dock
  full: 8, // battery reached full while charging
  stuck: 16, // no progress for stuckAfter seconds
  bump: 32, // bumper met something
} as const;

/** Where the roomba parks on its dock (facing into it), and the dock's own footprint against the wall. */
export interface Dock {
  x: number;
  z: number;
  heading: number;
  rect: Rect;
}

export const DOCK_SIZE = { w: 0.44, d: 0.14, h: 0.26 };

/** Keep a hair off everything, so the bumper never visibly sinks into a wall. */
export const NAV_R = ROOMBA.r + 0.03;
const PLAN_R = NAV_R + 0.1; // paths keep a little further off
const CELL = 0.2;
const DRAIN = 0.8 / (ROOMBA.cleanMax + 90); // battery per second while out, leaving enough for the longest trip home
const LEAVE_BACK = 0.6; // metres it backs off the dock
const APPROACH = 0.6; // metres in front of the dock where the final approach starts
const PLAYER_STOP = 0.45; // gap it leaves in front of the player
/** Battery level that counts as fully charged (the status light turns green). */
export const FULL = 0.995;

// ---------- where things are ----------

// Both docks sit against the north wall, away from the windows (west), the QA lab and kitchenette (east), the
// app monitor and whiteboard, and the south-wall spots kept free for other toys. Office: past the "ship it"
// sign, north of the QA lab. Lobby: the quiet corridor behind reception, between the two glass offices.
const DOCK_X: Record<ToyFloor, number> = { office: 12.8, lobby: -3.5 };

// Plants aren't colliders (you brush past the leaves), but the roomba shouldn't drive through the pots.
// [x, z, scale], matching OfficeFloor.tsx and Lobby.tsx.
export const PLANTS: Record<ToyFloor, [number, number, number][]> = {
  office: [[-7.1, -HALF_D + 0.7, 1], [7.1, -HALF_D + 0.7, 1], [-HALF_W + 0.7, HALF_D - 0.8, 1.2], [-11, -HALF_D + 0.7, 1.1], [HALF_W - 0.7, HALF_D - 0.7, 0.9]],
  lobby: [
    [-7.1, -HALF_D + 0.6, 1.1], [-HALF_W + 0.6, -4.1, 0.9], [HALF_W - 0.7, -4.2, 1.1], [7.1, -4.1, 0.9],
    [HALF_W - 0.7, HALF_D - 0.7, 1.2], [-HALF_W + 0.7, HALF_D - 0.7, 1.2], [-3, HALF_D - 0.6, 1], [3, -HALF_D + 0.7, 0.8],
  ],
};

export function dockFor(floor: ToyFloor): Dock {
  const x = DOCK_X[floor];
  return {
    x,
    z: -HALF_D + DOCK_SIZE.d + NAV_R + 0.01,
    heading: -Math.PI / 2, // facing north, into the dock
    rect: { minX: x - DOCK_SIZE.w / 2, maxX: x + DOCK_SIZE.w / 2, minZ: -HALF_D, maxZ: -HALF_D + DOCK_SIZE.d, h: DOCK_SIZE.h },
  };
}

/**
 * Everything the roomba steers around: the floor's colliders, the elevator doorway, the side doorways (the balconies
 * are off-limits, and clear() keeps everything inside the walls anyway), plant pots and its dock.
 */
export function roombaRects(floor: ToyFloor): Rect[] {
  // The balconies' railings and furniture are out of reach anyway: leave them out, as paths check every rect often.
  const out = (floor === 'office' ? officeColliders() : lobbyColliders()).filter((r) => Math.abs(r.minX + r.maxX) / 2 < HALF_W + WALL_T);
  out.push(elevatorDoorway());
  for (const side of SIDES) out.push(sideDoorway(floor, side));
  for (const [x, z, s] of PLANTS[floor]) out.push(rect(x, z, 0.6 * s, 0.6 * s));
  out.push(dockFor(floor).rect);
  return out;
}

// ---------- navigation ----------

export interface Nav {
  rects: Rect[];
  cols: number;
  rows: number;
  /** 1 where a path may not go (too close to something). */
  blocked: Uint8Array;
  /** How far grid cells keep off everything, and how far a smoothed straight leg must. */
  planR: number;
  lineR: number;
  /** How much A* trusts its estimate: 1 finds the shortest grid path, more searches fewer cells. */
  greed: number;
}

/** Whether a circle of radius r at (x, z) is clear of every rect. */
export function clear(rects: Rect[], x: number, z: number, r = NAV_R) {
  if (Math.abs(x) > HALF_W - r || Math.abs(z) > HALF_D - r) return false;
  // what collide() would push it out of; checked directly, since paths ask this thousands of times
  for (const b of rects) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
  return true;
}

/** The walk grid over `rects`. The radii default to the roomba's; people (walkways.ts) pass their own. */
export function makeNav(rects: Rect[], { planR = PLAN_R, lineR = NAV_R + 0.04, greed = 1 }: { planR?: number; lineR?: number; greed?: number } = {}): Nav {
  const cols = Math.round(FLOOR_W / CELL);
  const rows = Math.round(FLOOR_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) blocked[j * cols + i] = clear(rects, cellX(i), cellZ(j), planR) ? 0 : 1;
  return { rects, cols, rows, blocked, planR, lineR, greed };
}

const cellX = (i: number) => -HALF_W + (i + 0.5) * CELL;
const cellZ = (j: number) => -HALF_D + (j + 0.5) * CELL;
const toCol = (x: number, cols: number) => Math.min(cols - 1, Math.max(0, Math.floor((x + HALF_W) / CELL)));
const toRow = (z: number, rows: number) => Math.min(rows - 1, Math.max(0, Math.floor((z + HALF_D) / CELL)));

/** Whether the roomba can drive the straight line a → b without touching anything. */
export function segmentClear(rects: Rect[], a: Pt, b: Pt, r = NAV_R + 0.04) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.08));
  // every sample k = 1..n once, coarse to fine, so a blocked line is usually found in a few checks
  let top = 1;
  while (top * 2 <= n) top *= 2;
  for (let stride = top; stride >= 1; stride >>= 1) {
    for (let k = stride; k <= n; k += stride) {
      if (stride !== top && k % (stride * 2) === 0) continue;
      if (!clear(rects, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, r)) return false;
    }
  }
  return true;
}

/** The nearest cell a path may use, searching outwards from (i, j). */
function nearestOpen(nav: Nav, i: number, j: number, avoid: (c: number) => boolean): number {
  const { cols, rows, blocked } = nav;
  for (let ring = 0; ring < 12; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue;
        const c = jj * cols + ii;
        if (blocked[c] || avoid(c)) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * A* over the grid from `from` to `to`, string-pulled into a few straight legs. Returns the waypoints after `from`
 * (ending at `to`), or null when there's no way through. `avoid` is a circle to keep out of (the player).
 */
export function planPath(nav: Nav, from: Pt, to: Pt, avoid: (Pt & { r: number }) | null = null): Pt[] | null {
  const { cols, rows, blocked } = nav;
  const avoidR = avoid ? avoid.r + nav.planR : 0;
  const avoided = (c: number) => !!avoid && Math.hypot(cellX(c % cols) - avoid.x, cellZ(Math.floor(c / cols)) - avoid.z) < avoidR;
  const start = nearestOpen(nav, toCol(from.x, cols), toRow(from.z, rows), avoided);
  const goal = nearestOpen(nav, toCol(to.x, cols), toRow(to.z, rows), () => false);
  if (start < 0 || goal < 0) return null;

  const n = cols * rows;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gi = goal % cols;
  const gj = Math.floor(goal / cols);
  const h = (c: number) => {
    const dx = Math.abs((c % cols) - gi);
    const dz = Math.abs(Math.floor(c / cols) - gj);
    return nav.greed * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
  };
  // binary heap of [f, cell]
  const heap: [number, number][] = [];
  const push = (f: number, c: number) => {
    heap.push([f, c]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  const open = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && !blocked[j * cols + i] && !avoided(j * cols + i);

  g[start] = 0;
  push(h(start), start);
  let found = false;
  while (heap.length) {
    const c = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) {
      found = true;
      break;
    }
    const i = c % cols;
    const j = Math.floor(c / cols);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        if (!open(i + di, j + dj)) continue;
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue; // no cutting corners
        const nb = (j + dj) * cols + i + di;
        const cost = g[c] + (di && dj ? Math.SQRT2 : 1);
        if (cost < g[nb]) {
          g[nb] = cost;
          came[nb] = c;
          push(cost + h(nb), nb);
        }
      }
    }
  }
  if (!found) return null;

  const cells: Pt[] = [];
  for (let c = goal; c >= 0; c = came[c]) cells.push({ x: cellX(c % cols), z: cellZ(Math.floor(c / cols)) });
  cells.reverse();
  cells.push({ x: to.x, z: to.z });

  // String-pulling: from each corner, jump to the furthest point still in a straight line of sight.
  const out: Pt[] = [];
  let at: Pt = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) {
      if (segmentClear(nav.rects, at, cells[m], nav.lineR)) {
        far = m;
        break;
      }
    }
    at = cells[far];
    out.push(at);
    k = far + 1;
  }
  return out;
}

// ---------- the roomba ----------

export interface Roomba {
  x: number;
  z: number;
  heading: number;
  state: RoombaState;
  move: RoombaMove;
  /** 0-1 */
  battery: number;
  /** Seconds in the current state. */
  stateTime: number;
  /** Seconds left in a timed move (back, wait, follow, spiral, spin). */
  moveTime: number;
  /** Radians left to turn in a 'turn' move, signed. */
  turnLeft: number;
  spiralR: number;
  path: Pt[];
  /** How long this cleaning run lasts. */
  cleanFor: number;
  chargeFrom: number;
  /** Seconds without getting anywhere, and where it last got to. */
  stuck: number;
  mark: Pt;
  /** Seconds spent waiting for the player to get out of the way. */
  waited: number;
  spinFrom: number;
  resume: { move: RoombaMove; moveTime: number };
  /** How fast it moved in the last step (m/s), for the brush and wheels. */
  speed: number;
  seed: number;
  /** ROOMBA_EVENT bits since the reader (RoombaSounds.tsx) last cleared them. Never read here, so they can't change how it drives. */
  events: number;
}

/** A roomba sitting on its dock, nearly charged: it heads out after a few seconds. */
export function createRoomba(dock: Dock, seed = 1): Roomba {
  const stateTime = ROOMBA.charge - ROOMBA.firstCharge;
  const chargeFrom = 0.9;
  return {
    x: dock.x,
    z: dock.z,
    heading: dock.heading,
    state: 'charging',
    move: 'idle',
    battery: chargeFrom + ((1 - chargeFrom) * stateTime) / ROOMBA.charge,
    stateTime,
    moveTime: 0,
    turnLeft: 0,
    spiralR: 0,
    path: [],
    cleanFor: ROOMBA.cleanMin,
    chargeFrom,
    stuck: 0,
    mark: { x: dock.x, z: dock.z },
    waited: 0,
    spinFrom: 0,
    resume: { move: 'idle', moveTime: 0 },
    speed: 0,
    seed: seed >>> 0 || 1,
    events: 0,
  };
}

/** mulberry32: a tiny seeded RNG kept in the state, so runs (and tests) repeat. */
function rand(r: Roomba) {
  r.seed = (r.seed + 0x6d2b79f5) >>> 0;
  let t = r.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (r: Roomba, a: number, b: number) => a + (b - a) * rand(r);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** What the hint says it's doing. */
export function roombaStatus(r: Roomba): string {
  if (r.state === 'charging') return r.battery < FULL ? 'charging' : 'docked';
  if (r.state === 'returning' || r.state === 'docking') return 'heading home';
  return 'cleaning';
}

/** E: a happy spin on the spot, then back to whatever it was doing. */
export function spinRoomba(r: Roomba) {
  if (r.move === 'spin') return;
  r.resume = { move: r.move, moveTime: r.moveTime };
  r.spinFrom = r.heading;
  r.move = 'spin';
  r.moveTime = ROOMBA.spin;
}

/** The evening round (the rituals' wind-down): off the dock for a clean now, rather than once it's charged. */
export function sendOut(r: Roomba): boolean {
  if (r.state !== 'charging' || r.move === 'spin') return false;
  r.stateTime = Math.max(r.stateTime, ROOMBA.charge);
  return true;
}

export interface RoombaEnv {
  nav: Nav;
  dock: Dock;
  /** Where the player stands, or null when they aren't on this floor. */
  player: Pt | null;
}

const approachPoint = (d: Dock): Pt => ({ x: d.x - Math.cos(d.heading) * APPROACH, z: d.z - Math.sin(d.heading) * APPROACH });

/** Advance the roomba by dt seconds. Mutates r. */
export function stepRoomba(r: Roomba, dt: number, env: RoombaEnv) {
  r.speed = 0;
  r.stateTime += dt;

  if (r.move === 'spin') {
    r.moveTime -= dt;
    const t = Math.min(1, 1 - r.moveTime / ROOMBA.spin);
    r.heading = r.spinFrom + 4 * Math.PI * (t * t * (3 - 2 * t)); // two turns, easing in and out
    if (r.moveTime <= 0) {
      r.heading = r.spinFrom;
      r.move = r.resume.move;
      r.moveTime = r.resume.moveTime;
    }
    if (r.state === 'charging') chargeStep(r);
    return;
  }

  if (r.state === 'charging') {
    chargeStep(r);
    if (r.stateTime >= ROOMBA.charge) {
      setState(r, 'leaving');
      r.events |= ROOMBA_EVENT.leave;
      r.cleanFor = between(r, ROOMBA.cleanMin, ROOMBA.cleanMax);
      r.move = 'back';
      r.moveTime = LEAVE_BACK / ROOMBA.backSpeed;
    }
    return;
  }

  r.battery = Math.max(0, r.battery - DRAIN * dt);
  if (r.state === 'cleaning' && (r.stateTime >= r.cleanFor || r.battery < 0.1)) goHome(r, env);

  // The player: back away if they're on top of it, and stop for them when they're in the way.
  const p = env.player;
  if (p) {
    const dx = p.x - r.x;
    const dz = p.z - r.z;
    const d = Math.hypot(dx, dz);
    if (d < ROOMBA.r + PLAYER_RADIUS + 0.02) {
      const ux = d > 1e-6 ? -dx / d : -Math.cos(r.heading);
      const uz = d > 1e-6 ? -dz / d : -Math.sin(r.heading);
      tryMove(r, ux * ROOMBA.speed * 1.5 * dt, uz * ROOMBA.speed * 1.5 * dt, dt, env);
      r.stuck = 0;
      return;
    }
  }

  switch (r.move) {
    case 'wait': {
      r.stuck = 0;
      r.moveTime -= dt;
      if (r.moveTime > 0) break;
      const still = p !== null && playerAhead(r, p);
      if (r.state === 'cleaning' || r.state === 'leaving') {
        if (still) turnTo(r, Math.atan2(r.z - p!.z, r.x - p!.x) + between(r, -0.7, 0.7));
        else r.move = 'drive';
        break;
      }
      // on the way home: wait a little longer, then find a way round them
      if (still) {
        r.waited += 0.8;
        r.moveTime = 0.8;
        if (r.waited >= 4) {
          r.waited = 0;
          replan(r, env, p);
        }
      } else {
        r.waited = 0;
        r.move = r.state === 'docking' ? 'park' : 'path';
      }
      break;
    }
    case 'turn': {
      const step = Math.sign(r.turnLeft) * Math.min(Math.abs(r.turnLeft), ROOMBA.turnRate * dt);
      r.heading = wrap(r.heading + step);
      r.turnLeft -= step;
      if (Math.abs(r.turnLeft) < 1e-4) afterTurn(r);
      break;
    }
    case 'back': {
      r.moveTime -= dt;
      const moved = tryMove(r, -Math.cos(r.heading) * ROOMBA.backSpeed * dt, -Math.sin(r.heading) * ROOMBA.backSpeed * dt, dt, env);
      if (moved && r.moveTime > 0) break;
      r.stuck = 0;
      if (r.state === 'leaving') {
        setState(r, 'cleaning');
        turnTo(r, env.dock.heading + Math.PI + between(r, -0.8, 0.8));
      } else if (r.state === 'cleaning') turnBy(r, (rand(r) < 0.5 ? 1 : -1) * between(r, 2, 3.6));
      else replan(r, env, null);
      break;
    }
    case 'drive': {
      if (yieldTo(r, p)) break;
      if (!forward(r, ROOMBA.speed, dt, env)) bump(r);
      else if (rand(r) < 0.02 * dt) {
        r.move = 'spiral';
        r.spiralR = 0.15;
        r.moveTime = 25;
      }
      break;
    }
    case 'spiral': {
      r.moveTime -= dt;
      r.heading = wrap(r.heading + (ROOMBA.speed / r.spiralR) * dt);
      r.spiralR += ((ROOMBA.speed * 0.32) / (2 * Math.PI * r.spiralR)) * dt; // ~a roomba's width further out each lap
      if (yieldTo(r, p)) break;
      if (!forward(r, ROOMBA.speed, dt, env)) bump(r);
      else if (r.spiralR > 1.4 || r.moveTime <= 0) r.move = 'drive';
      break;
    }
    case 'follow': {
      // Wall on the right: turn left while the way ahead is blocked, curve right when the wall falls away.
      r.moveTime -= dt;
      if (r.moveTime <= 0) {
        turnBy(r, -between(r, 0.6, 1.4));
        break;
      }
      const s = ROOMBA.speed * dt;
      const fx = Math.cos(r.heading);
      const fz = Math.sin(r.heading);
      if (!clear(env.nav.rects, r.x + fx * (s + 0.02), r.z + fz * (s + 0.02))) {
        r.heading = wrap(r.heading - ROOMBA.turnRate * dt);
        break;
      }
      const wall = !clear(env.nav.rects, r.x - fz * 0.12 + fx * 0.05, r.z + fx * 0.12 + fz * 0.05);
      if (!wall) r.heading = wrap(r.heading + (ROOMBA.speed / 0.3) * dt);
      if (yieldTo(r, p)) break;
      if (!forward(r, ROOMBA.speed, dt, env)) r.heading = wrap(r.heading - ROOMBA.turnRate * dt);
      break;
    }
    case 'path': {
      const w = r.path[0];
      if (!w) {
        setState(r, 'docking');
        turnTo(r, env.dock.heading);
        break;
      }
      const dx = w.x - r.x;
      const dz = w.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.04) {
        r.path.shift();
        break;
      }
      const err = wrap(Math.atan2(dz, dx) - r.heading);
      if (Math.abs(err) > 0.3) {
        r.heading = wrap(r.heading + Math.sign(err) * Math.min(Math.abs(err), ROOMBA.turnRate * dt));
        break;
      }
      r.heading = wrap(r.heading + Math.sign(err) * Math.min(Math.abs(err), ROOMBA.turnRate * dt));
      if (yieldTo(r, p)) break;
      if (!forward(r, Math.min(ROOMBA.speed, d / dt), dt, env)) {
        r.events |= ROOMBA_EVENT.bump;
        backUp(r, 0.5);
      }
      break;
    }
    case 'park': {
      const d = Math.hypot(env.dock.x - r.x, env.dock.z - r.z);
      if (d < 0.005) {
        r.x = env.dock.x;
        r.z = env.dock.z;
        r.heading = env.dock.heading;
        setState(r, 'charging');
        r.events |= ROOMBA_EVENT.dock;
        r.move = 'idle';
        r.chargeFrom = r.battery;
        break;
      }
      r.heading = Math.atan2(env.dock.z - r.z, env.dock.x - r.x);
      if (yieldTo(r, p)) break;
      if (!forward(r, Math.min(0.15, d / dt), dt, env)) {
        r.events |= ROOMBA_EVENT.bump;
        backUp(r, 0.8);
      }
      break;
    }
    case 'idle':
      break;
  }

  // Stuck recovery: no real progress for a while (and not just waiting for the player) means back up and turn.
  if (Math.hypot(r.x - r.mark.x, r.z - r.mark.z) > 0.2) {
    r.mark = { x: r.x, z: r.z };
    r.stuck = 0;
  } else if (r.move !== 'wait') {
    r.stuck += dt;
    if (r.stuck >= ROOMBA.stuckAfter) {
      r.stuck = 0;
      r.events |= ROOMBA_EVENT.stuck;
      if (r.state === 'docking') setState(r, 'returning');
      backUp(r, 0.8);
    }
  }
}

function setState(r: Roomba, s: RoombaState) {
  r.state = s;
  r.stateTime = 0;
}

function chargeStep(r: Roomba) {
  const was = r.battery;
  r.battery = r.chargeFrom + (1 - r.chargeFrom) * Math.min(1, r.stateTime / ROOMBA.charge);
  if (was < FULL && r.battery >= FULL) r.events |= ROOMBA_EVENT.full;
}

function playerAhead(r: Roomba, p: Pt) {
  const dx = p.x - r.x;
  const dz = p.z - r.z;
  const d = Math.hypot(dx, dz);
  return d < ROOMBA.r + PLAYER_RADIUS + PLAYER_STOP && (dx * Math.cos(r.heading) + dz * Math.sin(r.heading)) / d > 0.35;
}

/** About to drive forward with the player in the way: stop and wait for them instead. */
function yieldTo(r: Roomba, p: Pt | null) {
  if (!p || !playerAhead(r, p)) return false;
  r.move = 'wait';
  r.moveTime = 0.8;
  return true;
}

/** Move by (dx, dz) if that keeps it clear of everything and doesn't close in on the player. */
function tryMove(r: Roomba, dx: number, dz: number, dt: number, env: RoombaEnv) {
  const x = r.x + dx;
  const z = r.z + dz;
  if (!clear(env.nav.rects, x, z)) return false;
  const p = env.player;
  if (p) {
    const near = ROOMBA.r + PLAYER_RADIUS + 0.08;
    const before = Math.hypot(p.x - r.x, p.z - r.z);
    const after = Math.hypot(p.x - x, p.z - z);
    if (after < near && after < before) return false;
  }
  r.x = x;
  r.z = z;
  r.speed = Math.hypot(dx, dz) / dt;
  return true;
}

function forward(r: Roomba, speed: number, dt: number, env: RoombaEnv) {
  return tryMove(r, Math.cos(r.heading) * speed * dt, Math.sin(r.heading) * speed * dt, dt, env);
}

/** Hit something while cleaning: usually turn away at random, sometimes follow the wall for a bit. */
function bump(r: Roomba) {
  r.events |= ROOMBA_EVENT.bump;
  if (rand(r) < 0.3) {
    r.move = 'follow';
    r.moveTime = between(r, 6, 14);
    return;
  }
  turnBy(r, (rand(r) < 0.5 ? 1 : -1) * between(r, Math.PI / 2, Math.PI));
}

function turnBy(r: Roomba, a: number) {
  r.move = 'turn';
  r.turnLeft = a;
}

function turnTo(r: Roomba, heading: number) {
  turnBy(r, wrap(heading - r.heading));
}

function afterTurn(r: Roomba) {
  if (r.state === 'docking') r.move = 'park';
  else if (r.state === 'returning') r.move = 'path';
  else r.move = 'drive';
}

function backUp(r: Roomba, seconds: number) {
  r.move = 'back';
  r.moveTime = seconds;
}

function goHome(r: Roomba, env: RoombaEnv) {
  const path = planPath(env.nav, r, approachPoint(env.dock));
  if (!path) {
    r.cleanFor += 15; // boxed in somehow: clean a bit more and try again
    return;
  }
  setState(r, 'returning');
  r.events |= ROOMBA_EVENT.home;
  r.path = path;
  r.move = 'path';
  r.waited = 0;
}

function replan(r: Roomba, env: RoombaEnv, avoid: Pt | null) {
  if (r.state === 'docking') setState(r, 'returning');
  const path = planPath(env.nav, r, approachPoint(env.dock), avoid ? { ...avoid, r: PLAYER_RADIUS } : null) ?? planPath(env.nav, r, approachPoint(env.dock));
  r.path = path ?? [];
  r.move = path ? 'path' : 'wait';
  r.moveTime = 0.8;
}
