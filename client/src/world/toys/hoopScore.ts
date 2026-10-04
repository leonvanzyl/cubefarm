// The basketball hoop's placement and scoring rules. Pure geometry (no three.js, no physics), so it's unit-tested.

import { HALF_D } from '../layout';
import type { ToyFloor } from './balls';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The rim as a horizontal circle: its centre and radius (to the middle of the tube), in metres. */
export interface Rim extends Vec3 {
  r: number;
}

// Sizes in metres, measured out from the south wall (the hoop faces north, into the room). Real rims are 0.46 m
// across and a basketball 0.24 m, so a big ball from #15 (0.66 m and up) can't fit through.
export const HOOP = {
  /** How far the backboard's face stands off the wall. */
  standoff: 0.32,
  board: { w: 1.2, h: 0.62, t: 0.05, bottom: 2.56 },
  /** The painted target square: its bottom edge is level with the rim. */
  square: { w: 0.48, h: 0.36 },
  rim: { y: 2.7, r: 0.23, tube: 0.018, gap: 0.15 },
  net: { h: 0.42, bottomR: 0.14 },
  score: { w: 1.24, h: 0.36, bottom: 3.2 },
  /** Bounciness of the backboard and the rim's colliders. */
  bounce: { board: 0.6, rim: 0.45 },
  /** The basketball; `throwSpeed` is its fully charged throw in m/s. */
  ball: { r: 0.12, restitution: 0.75, density: 60, damping: 0.5, throwSpeed: 9.5 },
};

/** Where each floor's hoop hangs on the south wall: office floors east of the team-stats sign, the lobby west of the elevator. */
export const HOOP_X: Record<ToyFloor, number> = { office: 10.5, lobby: -9 };

/** How far the rim's centre sticks out from the wall. */
export const RIM_OUT = HOOP.standoff + HOOP.board.t + HOOP.rim.gap + HOOP.rim.r;

/** One of the hoop's fixed colliders, in the hoop's local coordinates (foot of the wall, -z out into the room). */
export interface HoopCollider {
  /** A box's half extents, or a ball's radius. */
  box?: [number, number, number];
  ball?: number;
  at: [number, number, number];
  restitution: number;
  friction: number;
}

const RIM_BALLS = 24;

/** The board (filled back to the wall, so nothing lodges behind it), the plate holding the rim, and the rim as a ring of small spheres. */
export function hoopColliders(): HoopCollider[] {
  const { standoff, board, rim, score, bounce } = HOOP;
  const back = standoff + board.t;
  const top = score.bottom + score.h;
  return [
    { box: [Math.max(board.w, score.w) / 2, (top - board.bottom) / 2, back / 2], at: [0, (board.bottom + top) / 2, -back / 2], restitution: bounce.board, friction: 0.5 },
    { box: [0.07, 0.013, rim.gap / 2], at: [0, rim.y, -(back + rim.gap / 2)], restitution: bounce.rim, friction: 0.5 },
    ...Array.from({ length: RIM_BALLS }, (_, i): HoopCollider => {
      const a = (i / RIM_BALLS) * Math.PI * 2;
      return { ball: rim.tube + 0.004, at: [Math.cos(a) * rim.r, rim.y, -RIM_OUT + Math.sin(a) * rim.r], restitution: bounce.rim, friction: 0.4 };
    }),
  ];
}

/** The rim of `floor`'s hoop, in world coordinates. */
export const hoopRim = (floor: ToyFloor): Rim => ({ x: HOOP_X[floor], y: HOOP.rim.y, z: HALF_D - RIM_OUT, r: HOOP.rim.r });

/** The middle of `floor`'s painted target square, on the backboard's face: what a player aims at. */
export const hoopSquare = (floor: ToyFloor): Vec3 => ({ x: HOOP_X[floor], y: HOOP.rim.y + HOOP.square.h / 2, z: HALF_D - HOOP.standoff - HOOP.board.t });

/** Per-ball memory between physics steps. */
export interface HoopTrack {
  prev: Vec3 | null;
  /**
   * False right after a basket, or after the ball came up through the net from below, until it has left the column
   * above and below the rim. So a basket counts once, and a ball pushed up through the net can't fall back in for one.
   */
  armed: boolean;
}

export const newTrack = (): HoopTrack => ({ prev: null, armed: true });

/** A jump longer than this (m) in one step is a respawn, not flight. */
const TELEPORT = 1.5;

/** Where the segment a→b crosses the rim's plane is inside the rim circle. */
function crossesInside(a: Vec3, b: Vec3, rim: Rim) {
  const t = (a.y - rim.y) / (a.y - b.y);
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  return Math.hypot(x - rim.x, z - rim.z) < rim.r;
}

/**
 * Feed one ball's centre after each physics step. Returns true when this step was a basket: the centre passed
 * downward through the rim circle. Updates `track` in place.
 */
export function stepHoop(track: HoopTrack, cur: Vec3, rim: Rim): boolean {
  const prev = track.prev;
  track.prev = { x: cur.x, y: cur.y, z: cur.z };
  if (!prev) return false;
  if (Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z) > TELEPORT) {
    track.armed = true;
    return false;
  }
  const falling = prev.y > rim.y && cur.y <= rim.y;
  const rising = prev.y <= rim.y && cur.y > rim.y;
  if ((falling || rising) && crossesInside(prev, cur, rim)) {
    const scored = falling && track.armed;
    track.armed = false;
    return scored;
  }
  if (!track.armed && Math.hypot(cur.x - rim.x, cur.z - rim.z) > rim.r) track.armed = true;
  return false;
}
