// Carrying and throwing balls, as numbers: where a carried ball is held and the velocity it leaves your hands with.
// Pure (no three.js, no physics), so ToyWorld.tsx and the throw simulation (throwSim.ts) share exactly the same maths.

import { WALL_H } from '../layout';
import type { Vec3 } from './hoopScore';

// Carrying: the held ball is steered towards a spot in front of and below the view, low enough to keep the crosshair
// clear. Looking up or down only counts partly, so the ball doesn't swing up into your face or down onto the floor.
// Speeds in m/s, distances in metres.
export const HOLD = { ahead: 1.0, drop: 0.5, dropPerR: 0.9, pitch: 0.55, minPitch: -0.7, maxPitch: 0.4, follow: 14, maxSpeed: 18, lost: 2.2, lostFor: 0.35, windUp: 0.25 };
export const THROW = { lob: 3.2, hard: 14, lift: 1.6, hardLift: 0.9, aim: 12, flightDamping: 0.05, walk: 1 };

/** Holding the throw button this long (ms) is still a tap, a gentle lob; by `full` the throw is at full power. */
export const CHARGE = { tap: 150, full: 1000 };

/** 0 for a tap up to 1 for a full charge. */
export const chargePower = (ms: number) => Math.min(1, Math.max(0, (ms - CHARGE.tap) / (CHARGE.full - CHARGE.tap)));

/** The view as the hands see it: the eye, and the camera's pitch and yaw (Euler 'YXZ', as Player.tsx sets them). */
export interface View {
  eye: Vec3;
  pitch: number;
  yaw: number;
}

/** Where a ball of radius `r` is held, written into `out`. `pull` (0 to HOLD.windUp) draws it back while charging. */
export function holdPoint(view: View, r: number, pull: number, out: Vec3): Vec3 {
  const pitch = Math.min(HOLD.maxPitch, Math.max(HOLD.minPitch, view.pitch * HOLD.pitch));
  const ahead = HOLD.ahead + r - pull;
  // along the (tamed) view direction, then straight down
  const y = ahead * Math.sin(pitch) - HOLD.drop - r * HOLD.dropPerR - pull * 0.4;
  const z = -ahead * Math.cos(pitch);
  out.x = view.eye.x + z * Math.sin(view.yaw);
  out.y = view.eye.y + y;
  out.z = view.eye.z + z * Math.cos(view.yaw);
  return out;
}

/**
 * The velocity a ball at `from` is thrown with, written into `out`: aimed through a point far along the crosshair (so
 * it leaves along it despite being held low), as fast as `power` (0 to 1) of the way from a lob to `top`, with a
 * little lift, plus the player's walking velocity.
 */
export function throwVelocity(view: View, from: Vec3, power: number, top: number, walk: { x: number; z: number }, out: Vec3): Vec3 {
  const cp = Math.cos(view.pitch);
  out.x = view.eye.x - Math.sin(view.yaw) * cp * THROW.aim - from.x;
  out.y = view.eye.y + Math.sin(view.pitch) * THROW.aim - from.y;
  out.z = view.eye.z - Math.cos(view.yaw) * cp * THROW.aim - from.z;
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  const speed = THROW.lob + (top - THROW.lob) * power;
  out.x = (out.x / len) * speed + walk.x * THROW.walk;
  out.y = (out.y / len) * speed + THROW.lift + (THROW.hardLift - THROW.lift) * power;
  out.z = (out.z / len) * speed + walk.z * THROW.walk;
  return out;
}

// ---------- the basketball's arcade shot ----------

/** Rapier's gravity, as @react-three/rapier sets it (m/s²). */
export const GRAVITY = 9.81;

/**
 * Throwing the basketball at its hoop is an arcade shot, not real basketball: aimed within `cone` (radians) of the
 * painted square, `minDist` to `maxDist` metres from the rim, it flies on the highest arc the ceiling allows (its
 * centre peaking at `top`), so it drops into the rim rather than lining it, and through it at the ideal strength.
 * The charge still decides the strength: within `band` of the ideal speed, how far it's off is shrunk to
 * `sweet` / distance (m) of itself, so the charge window that scores is about as wide (in ms) from near as from far.
 * Beyond the band it adds up again as usual.
 */
export const ASSIST = { cone: 0.1, minDist: 0.8, maxDist: 9, top: WALL_H - 0.25, sweet: 0.45, band: 0.25 };

/** What the arcade shot needs to know about the hoop on this floor. */
export interface HoopAim {
  rim: Vec3;
  /** The painted square's middle. */
  square: Vec3;
}

/**
 * The basketball's velocity for a throw at the hoop (see ASSIST), written into `out`; false (and `out` untouched)
 * when the throw isn't aimed at the hoop and should be an ordinary one (throwVelocity).
 */
export function hoopShot(view: View, from: Vec3, power: number, top: number, hoop: HoopAim, out: Vec3): boolean {
  const { eye, pitch, yaw } = view;
  const cp = Math.cos(pitch);
  const tx = hoop.square.x - eye.x;
  const ty = hoop.square.y - eye.y;
  const tz = hoop.square.z - eye.z;
  const along = (-Math.sin(yaw) * cp * tx + Math.sin(pitch) * ty - Math.cos(yaw) * cp * tz) / (Math.hypot(tx, ty, tz) || 1);
  if (along < Math.cos(ASSIST.cone)) return false;
  const dx = hoop.rim.x - from.x;
  const dz = hoop.rim.z - from.z;
  const reach = Math.hypot(dx, dz);
  const away = Math.hypot(hoop.rim.x - eye.x, hoop.rim.z - eye.z);
  if (away < ASSIST.minDist || away > ASSIST.maxDist || reach < 0.1 || from.y >= hoop.rim.y) return false;
  const { across, up, ideal } = hoopArc(from, hoop.rim);
  const off = (THROW.lob + (top - THROW.lob) * power) / ideal - 1;
  const near = Math.min(Math.abs(off), ASSIST.band);
  const s = 1 + Math.sign(off) * (near * Math.min(1, ASSIST.sweet / reach) + Math.abs(off) - near);
  out.x = (dx / reach) * across * s;
  out.y = up * s;
  out.z = (dz / reach) * across * s;
  return true;
}

/** The arcade shot's arc from `from` into `rim`: its speed across and up, and the throw speed that makes it (`ideal`). */
export function hoopArc(from: Vec3, rim: Vec3) {
  const reach = Math.hypot(rim.x - from.x, rim.z - from.z);
  // up to the top of the arc and down to the rim's height, the time between setting the speed across
  const apex = ASSIST.top;
  const rise = Math.sqrt(2 * GRAVITY * (apex - from.y));
  const t = rise / GRAVITY + Math.sqrt((2 * (apex - rim.y)) / GRAVITY);
  // the little drag of a flight, made up for
  const k = 1 + (THROW.flightDamping * t) / 2;
  const across = (reach / t) * k;
  const up = rise * k;
  return { across, up, ideal: Math.hypot(across, up) };
}
