// Ping-pong ball maths, pure (no three.js, no physics engine): the flight (gravity, air drag and a light Magnus force
// from spin), the bounce off the table (topspin kicks on, backspin checks), a forecast of where a ball goes, the shot
// solver every hit goes through, and how a paddle swing becomes a shot. The toy world (PingPong.tsx) adds the same
// forces to the real Rapier ball every step and swaps Rapier's table bounce for this one, so forecasts and play
// agree; pongSim.ts checks it against Rapier itself.

import { PONG_TABLE } from '../layout';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The two ends of the table: west (x below the net) and east. */
export type End = 'west' | 'east';

export const PONG = {
  /** Radius (m, a little bigger than a real 40 mm ball so it reads at a distance), and its bounce off the table: how
   * much of the speed into the table comes back out (`bounce`) and how hard the table grips its spin (`grip`). */
  ball: { r: 0.025, bounce: 0.87, grip: 0.4 },
  gravity: 9.81,
  /** Quadratic air drag (1/m): a = -drag |v| v. Lighter than a real ball's, for longer, friendlier rallies. */
  drag: 0.045,
  /** The Magnus force, light: a = magnus (w × v), with w in rad/s. */
  magnus: 0.0016,
  /** How fast spin dies away in flight (1/s). */
  spinDecay: 0.25,
  /** The net: height over the table, how far it reaches past each side, and thickness. */
  net: { h: 0.1525, overhang: 0.1525, t: 0.02 },
  step: 1 / 60,
  /** Rapier splits each step into this many for gravity (the toy world's numSolverIterations), and so does flightStep. */
  substeps: 8,
  /** The physics materials: the ball against everything else (a light hollow shell), and the net, which deadens it. */
  body: { restitution: 0.8, friction: 0.3, density: 40 },
  netBody: { restitution: 0.12, friction: 0.8 },
};

/** The net as a box (half sizes and centre, world coordinates), between the posts: PingPong.tsx's collider and pongSim.ts's. */
export function netBox(): { half: [number, number, number]; at: [number, number, number] } {
  const n = PONG.net;
  return { half: [n.t / 2, n.h / 2, PONG_TABLE.wid / 2 + n.overhang], at: [PONG_TABLE.x, PONG_TABLE.top + n.h / 2, PONG_TABLE.z] };
}

export const TABLE = PONG_TABLE;
const HALF_LEN = TABLE.len / 2;
const HALF_WID = TABLE.wid / 2;

// ---------- the table's two sides ----------

/** Which way along x the player at `end` hits: +1 from the west end, -1 from the east. */
export const dirOf = (end: End) => (end === 'west' ? 1 : -1);
export const otherEnd = (end: End): End => (end === 'west' ? 'east' : 'west');
/** The half of the table over x. */
export const halfAt = (x: number): End => (x < TABLE.x ? 'west' : 'east');
/** Whether (x, z) is over the table, grown by `margin`. */
export const overTable = (x: number, z: number, margin = 0) => Math.abs(x - TABLE.x) <= HALF_LEN + margin && Math.abs(z - TABLE.z) <= HALF_WID + margin;

/** A point as the player at `end` sees it: how far behind their end line (`back`, negative over the table) and to their right (`lat`). */
export function ownFrame(end: End, x: number, z: number): { back: number; lat: number } {
  const d = dirOf(end);
  return { back: (TABLE.x - d * HALF_LEN - x) * d, lat: (z - TABLE.z) * d };
}

/** Back from ownFrame to the floor plan. */
export function fromOwn(end: End, back: number, lat: number): { x: number; z: number } {
  const d = dirOf(end);
  return { x: TABLE.x - d * HALF_LEN - back * d, z: TABLE.z + lat * d };
}

/** The point `depth` m from the net into `end`'s half, `lat` m to the right as seen by the player hitting towards it. */
export function onHalf(end: End, depth: number, lat: number): { x: number; z: number } {
  const d = dirOf(end);
  return { x: TABLE.x - d * depth, z: TABLE.z - lat * d };
}

// ---------- flight ----------

export interface BallState {
  p: V3;
  v: V3;
  /** Spin, rad/s, as a world-space axis. */
  w: V3;
}

export const cloneBall = (b: BallState): BallState => ({ p: { ...b.p }, v: { ...b.v }, w: { ...b.w } });

/** The air's pull on the ball besides gravity (drag and Magnus), in m/s², written into `out`. */
export function airAccel(v: V3, w: V3, out: V3): V3 {
  const speed = Math.hypot(v.x, v.y, v.z);
  const k = PONG.drag * speed;
  const m = PONG.magnus;
  out.x = -k * v.x + m * (w.y * v.z - w.z * v.y);
  out.y = -k * v.y + m * (w.z * v.x - w.x * v.z);
  out.z = -k * v.z + m * (w.x * v.y - w.y * v.x);
  return out;
}

const acc: V3 = { x: 0, y: 0, z: 0 };

/** The air's share of one step: what PingPong.tsx adds to the Rapier ball's velocity (and spin) before each step. */
export function airStep(b: BallState, dt: number) {
  airAccel(b.v, b.w, acc);
  b.v.x += acc.x * dt;
  b.v.y += acc.y * dt;
  b.v.z += acc.z * dt;
  const keep = Math.exp(-PONG.spinDecay * dt);
  b.w.x *= keep;
  b.w.y *= keep;
  b.w.z *= keep;
}

/**
 * One step of flight, as Rapier takes it: the air's share first (PingPong.tsx sets it on the ball before the step),
 * then gravity over the step's substeps, which the position follows substep by substep.
 */
export function flightStep(b: BallState, dt: number) {
  airStep(b, dt);
  const n = PONG.substeps;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt - (PONG.gravity * dt * dt * (n + 1)) / (2 * n);
  b.p.z += b.v.z * dt;
  b.v.y -= PONG.gravity * dt;
}

/**
 * The ball meeting the table (velocity `v` into it): it comes back up with PONG.ball.bounce of its speed, and the
 * table's grip trades speed for spin until the ball rolls (or the grip runs out). A thin-shelled ball takes 40% of its
 * slip off its speed to roll. Changes `v` and `w` in place.
 */
export function tableBounce(v: V3, w: V3) {
  const { r, bounce, grip } = PONG.ball;
  const into = Math.max(0, -v.y);
  // how fast the bottom of the ball slides over the table
  const sx = v.x + r * w.z;
  const sz = v.z - r * w.x;
  const slip = Math.hypot(sx, sz);
  if (slip > 1e-9) {
    const dv = Math.min(0.4 * slip, grip * (1 + bounce) * into);
    const dvx = (-dv * sx) / slip;
    const dvz = (-dv * sz) / slip;
    v.x += dvx;
    v.z += dvz;
    w.x += (-1.5 * dvz) / r;
    w.z += (1.5 * dvx) / r;
  }
  v.y = into * bounce;
}

/** The spin (rad/s, world axis) for `top` (+ topspin, - backspin) and `side` (+ curves to the hitter's right) on a ball going along `d`. */
export function spinFor(d: { x: number; z: number }, top: number, side: number): V3 {
  const len = Math.hypot(d.x, d.z) || 1;
  return { x: (top * d.z) / len, y: -side, z: (-top * d.x) / len };
}

/** How much topspin (+) or backspin (-) a ball going along its velocity carries, rad/s. */
export function topspinOf(b: Pick<BallState, 'v' | 'w'>): number {
  const len = Math.hypot(b.v.x, b.v.z);
  if (len < 1e-6) return 0;
  return (b.w.x * b.v.z - b.w.z * b.v.x) / len;
}

/** How much a ball curves sideways, rad/s: + to the right of where it's going. */
export const sidespinOf = (b: Pick<BallState, 'w'>) => -b.w.y;

// ---------- forecasts ----------

/** What the ball does next, once it touches anything. */
export type FlightEvent =
  | { kind: 'bounce'; end: End; t: number; p: V3; v: V3 }
  | { kind: 'net'; t: number; p: V3 }
  /** Down past the table's top beside it (on its way to the floor), or out of time. */
  | { kind: 'dead'; t: number; p: V3 };

const TOP = TABLE.top;
const NET_TOP = TOP + PONG.net.h;

/**
 * Steps a copy of `b` forward until something happens: a table bounce (the ball then carries on, bounced, if `each`
 * asks for more), the net, or the ball dropping below the table top off its edge. `each` sees the ball after every
 * step and every event; returning true stops the forecast there. Returns the last event, or null if `each` stopped it.
 */
export function forecast(b0: BallState, each: (b: BallState, t: number, ev: FlightEvent | null) => boolean | void, maxT = 2.5, netMargin = 0): FlightEvent | null {
  const b = cloneBall(b0);
  const r = PONG.ball.r;
  const dt = PONG.step;
  for (let t = dt; t <= maxT + 1e-9; t += dt) {
    const px = b.p.x;
    const py = b.p.y;
    flightStep(b, dt);
    let ev: FlightEvent | null = null;
    // the net: the centre crossing its plane low enough to touch it, within its width
    if ((px - TABLE.x) * (b.p.x - TABLE.x) <= 0 && px !== b.p.x) {
      const k = (TABLE.x - px) / (b.p.x - px);
      const y = py + (b.p.y - py) * k;
      const z = b.p.z;
      if (y < NET_TOP + r + netMargin && y > TOP - r && Math.abs(z - TABLE.z) < HALF_WID + PONG.net.overhang + r) ev = { kind: 'net', t, p: { x: TABLE.x, y, z } };
    }
    if (!ev && b.p.y <= TOP + r && b.v.y < 0 && py > TOP + r - 0.05 && overTable(b.p.x, b.p.z)) {
      b.p.y = TOP + r;
      tableBounce(b.v, b.w);
      ev = { kind: 'bounce', end: halfAt(b.p.x), t, p: { ...b.p }, v: { ...b.v } };
    }
    if (!ev && b.p.y < TOP - 0.05) ev = { kind: 'dead', t, p: { ...b.p } };
    if (each(b, t, ev)) return null;
    if (ev && ev.kind !== 'bounce') return ev;
  }
  return { kind: 'dead', t: maxT, p: { ...b.p } };
}

/** The table bounces a ball makes from `b` (up to `max`, stopping at the net or the floor), and how it ended. */
export function bouncesOf(b: BallState, max = 2, maxT = 2.5, netMargin = 0): { bounces: Extract<FlightEvent, { kind: 'bounce' }>[]; end: FlightEvent | null } {
  const bounces: Extract<FlightEvent, { kind: 'bounce' }>[] = [];
  const end = forecast(
    b,
    (_b, _t, ev) => {
      if (ev?.kind !== 'bounce') return false;
      bounces.push(ev);
      return bounces.length >= max;
    },
    maxT,
    netMargin,
  );
  return { bounces, end };
}

// ---------- shots ----------

/** A shot as the hitter means it: where it should land, how fast it leaves the paddle, and its spin. */
export interface Shot {
  /** Where it should bounce on the other half: its first bounce, or a serve's second (after one on the server's own half). */
  target: { x: number; z: number };
  /** m/s off the paddle. */
  speed: number;
  /** rad/s: + topspin, - backspin; and + curving to the hitter's right. */
  top: number;
  side: number;
  serve?: boolean;
  /** How much higher than the net (m) it must pass: safer shots clear it by more. */
  clear?: number;
}

export interface Solved {
  v: V3;
  w: V3;
  /** Where it will land (the bounce the shot aims), or null when no arc at this speed makes it: it goes into the net or long. */
  land: { x: number; z: number } | null;
}

/** Launch angles tried (radians above level), low to high: the lowest that lands on target wins, flat beats loopy. */
const PITCHES = Array.from({ length: 56 }, (_, i) => -0.75 + i * 0.035);
/** A try's landing, along the aim from where it was hit: SHORT for the net (or its own half), LONG for past the end. */
const SHORT = -1;
const LONG = Infinity;
/** Shots are solved to clear the net by at least this much (m) unless they ask for more. */
const NET_MARGIN = 0.03;

/**
 * The velocity and spin that send a ball from `from`, hit by the player at `by`, onto `shot.target` at
 * `shot.speed`, curving with its spin. Searches the launch angle for the lowest arc that lands there (and clears the
 * net), then turns the aim to take out the sideways curve. When no arc lands on target, it keeps the one that came
 * closest; when none lands at all, the lowest over the net, which sails long.
 */
export function solveShot(from: V3, by: End, shot: Shot): Solved {
  const solved = solveOnce(from, by, shot);
  // A server who can't get it over adjusts: less spin and a touch more pace (a slow, heavily chopped serve dies in the net).
  for (let i = 0; shot.serve && !solved.land && i < 3; i++) {
    shot = { ...shot, top: shot.top * 0.5, side: shot.side * 0.5, speed: shot.speed + 0.5 };
    const again = solveOnce(from, by, shot);
    if (again.land) return again;
  }
  return solved;
}

function solveOnce(from: V3, by: End, shot: Shot): Solved {
  const to = otherEnd(by);
  const want = Math.hypot(shot.target.x - from.x, shot.target.z - from.z);
  const aimAt = Math.atan2(shot.target.z - from.z, shot.target.x - from.x);

  /** Where a try at `pitch` along `d` lands: `along` the aim (or SHORT / LONG), and the spot when it's good. */
  const fly = (pitch: number, d: { x: number; z: number }) => {
    const c = Math.cos(pitch);
    const b: BallState = { p: { ...from }, v: { x: shot.speed * c * d.x, y: shot.speed * Math.sin(pitch), z: shot.speed * c * d.z }, w: spinFor(d, shot.top, shot.side) };
    const { bounces, end } = bouncesOf(b, shot.serve ? 2 : 1, 2.5, Math.max(NET_MARGIN, shot.clear ?? 0));
    const last = bounces[bounces.length - 1];
    const ok = shot.serve ? bounces.length === 2 && bounces[0].end === by && last.end === to : bounces.length === 1 && last.end === to;
    if (ok) return { along: (last.p.x - from.x) * d.x + (last.p.z - from.z) * d.z, land: { x: last.p.x, z: last.p.z } };
    // short: into the net, down on the hitter's own half (twice, for a serve), or down before it even got to the net
    const short =
      end?.kind === 'net' ||
      (shot.serve ? bounces.length === 2 && last.end === by : bounces.length === 1 && last.end === by) ||
      (end?.kind === 'dead' && ownFrame(by, end.p.x, end.p.z).back > -HALF_LEN);
    return { along: short ? SHORT : LONG, land: null };
  };

  type Pick = { pitch: number; land: { x: number; z: number }; miss: number };
  /** The better of `pick` and a try at `pitch`: the one landing nearer the target. */
  const better = (pick: Pick | null, pitch: number, f: ReturnType<typeof fly>): Pick | null => {
    if (!f.land) return pick;
    const miss = Math.abs(f.along - want);
    return !pick || miss < pick.miss ? { pitch, land: f.land, miss } : pick;
  };

  let yaw = aimAt;
  let best: { pitch: number; land: { x: number; z: number } | null } | null = null;
  for (let pass = 0; pass < 4; pass++) {
    const d = { x: Math.cos(yaw), z: Math.sin(yaw) };
    let pick: Pick | null = null;
    let prev: { pitch: number; along: number } | null = null;
    for (const pitch of PITCHES) {
      const f = fly(pitch, d);
      pick = better(pick, pitch, f);
      // the landing passes the target between this angle and the last: narrow it down there, and stop at the first
      if (prev && (prev.along - want) * (f.along - want) <= 0) {
        let lo = prev.pitch;
        let hi = pitch;
        const below = prev.along < want;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          const g = fly(mid, d);
          pick = better(pick, mid, g);
          if (g.along < want === below) lo = mid;
          else hi = mid;
        }
        if (pick && pick.miss < 0.25) break;
      }
      prev = { pitch, along: f.along };
    }
    if (!pick) {
      best ??= { pitch: PITCHES.find((p) => fly(p, d).along !== SHORT) ?? PITCHES[PITCHES.length - 1], land: null };
      break;
    }
    best = pick;
    // take the sideways curve out: turn the aim by the angle between where it landed and where it should have
    const err = aimAt - Math.atan2(pick.land.z - from.z, pick.land.x - from.x);
    const turn = Math.atan2(Math.sin(err), Math.cos(err));
    if (Math.abs(turn) < 0.002) break;
    yaw += turn;
  }
  const d = { x: Math.cos(yaw), z: Math.sin(yaw) };
  const pitch = best?.pitch ?? 0.1;
  const c = Math.cos(pitch);
  return { v: { x: shot.speed * c * d.x, y: shot.speed * Math.sin(pitch), z: shot.speed * c * d.z }, w: spinFor(d, shot.top, shot.side), land: best?.land ?? null };
}

/** A launch a little off: turned `yaw` (radians, to the left), tipped `pitch` (up), and `pace` times as fast. A new velocity. */
export function offLine(v: V3, err: { yaw: number; pitch: number; pace: number }): V3 {
  const h = Math.hypot(v.x, v.z);
  const speed = Math.hypot(h, v.y) * err.pace;
  const yaw = Math.atan2(v.z, v.x) - err.yaw;
  const pitch = Math.atan2(v.y, h) + err.pitch;
  return { x: speed * Math.cos(pitch) * Math.cos(yaw), y: speed * Math.sin(pitch), z: speed * Math.cos(pitch) * Math.sin(yaw) };
}

// ---------- the paddle ----------

/** A paddle at the moment it meets the ball: how fast it moves forward (towards the net, m/s) and to the hitter's right. */
export interface Swing {
  forward: number;
  right: number;
}

export const SWING = {
  /** Shot speed (m/s) from a still paddle, what a forward swing adds per m/s, and the range. */
  speed: { base: 5, perForward: 0.85, chopLoss: 0.25, min: 4.2, max: 13.5 },
  /** Spin (rad/s) per m/s of swing: forward brushes topspin, back chops backspin; sideways curves it. */
  top: { perForward: 70, min: -320, max: 380 },
  side: { perRight: 90, max: 260 },
  /** How far (m) a swing moves the target sideways per m/s, and how much of where you met it carries. */
  aim: { perRight: 0.32, fromContact: 0.25, edge: 0.1 },
  /** Where it lands, measured from the net: a still paddle drops it about here, faster shots go deeper. */
  depth: { base: 0.5, perSpeed: 0.09, min: 0.35, max: 1.2 },
  /** A smash: a ball met this high over the table, swung at this speed forward or more. */
  smash: { height: 0.42, forward: 2.2, speedUp: 1.25 },
};

/** Whether a swing at a ball met at height `y` is a smash. */
export const isSmash = (y: number, swing: Swing) => y - TOP >= SWING.smash.height && swing.forward >= SWING.smash.forward;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The shot a paddle swing makes, hit by the player at `by` from `at`: its pace from the swing's speed, topspin from
 * swinging forward (backspin from chopping back), sidespin and aim from swinging sideways. A little of the incoming
 * ball's spin carries over, turned round.
 */
export function swingShot(by: End, at: V3, incoming: Pick<BallState, 'v' | 'w'>, swing: Swing): Shot {
  const s = SWING;
  const f = swing.forward;
  let speed = clamp(s.speed.base + s.speed.perForward * Math.max(0, f) - s.speed.chopLoss * Math.max(0, -f), s.speed.min, s.speed.max);
  let top = clamp(s.top.perForward * f, s.top.min, s.top.max) - 0.2 * topspinOf(incoming);
  if (isSmash(at.y, swing)) {
    speed = Math.min(s.speed.max, speed * s.smash.speedUp);
    top += 60;
  }
  const side = clamp(s.side.perRight * swing.right, -s.side.max, s.side.max);
  const edge = HALF_WID - s.aim.edge;
  const lat = clamp(s.aim.perRight * swing.right + s.aim.fromContact * ownFrame(by, at.x, at.z).lat, -edge, edge);
  const depth = clamp(s.depth.base + s.depth.perSpeed * speed - (top < 0 ? -top * 0.0006 : 0), s.depth.min, s.depth.max);
  return { target: onHalf(otherEnd(by), depth, lat), speed, top, side, clear: 0.06 };
}

/** A serve's shot: tossed and hit at `at` by the player at `by`, onto `lat` (to the server's right) on the other half, deep. */
export function serveShot(by: End, lat: number, swing: Swing): Shot {
  const top = clamp(SWING.top.perForward * 0.6 * swing.forward, -220, 220);
  const side = clamp(SWING.side.perRight * 0.6 * swing.right, -160, 160);
  const edge = HALF_WID - SWING.aim.edge;
  return { target: onHalf(otherEnd(by), 0.95, clamp(lat + 0.25 * swing.right, -edge, edge)), speed: clamp(5.2 + 0.3 * Math.max(0, swing.forward), 4.8, 7), top, side, serve: true };
}
