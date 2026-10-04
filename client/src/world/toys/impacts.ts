// When a ball's bounce makes a sound, how loud and bright it is, and whether it hit the hoop's rim or backboard.
// Pure (no three.js, no physics, no audio), so it's unit-tested; ToyWorld.tsx feeds it each ball's velocity change.

import { HALF_D } from '../layout';
import { HOOP, type Rim, type Vec3 } from './hoopScore';

/**
 * Impacts are measured as the change in a ball's velocity over one physics step (m/s), less what gravity added.
 * Below `min` it's resting, rolling or being nudged: silent. From `full` up it's as loud as it gets.
 */
export const IMPACT = { min: 0.8, full: 9, cooldownMs: 70 };

export interface ImpactLevel {
  /** 0-1, multiplies the sound's peak. */
  gain: number;
  /** 0-1, opens the sound's filter: soft hits are dull, hard ones bright. */
  bright: number;
}

/** How a hit of `dv` m/s sounds, or null when it's too gentle to hear. */
export function impactLevel(dv: number): ImpactLevel | null {
  if (!(dv >= IMPACT.min)) return null;
  const x = Math.min(1, (dv - IMPACT.min) / (IMPACT.full - IMPACT.min));
  // A soft start, so the last little hops of a settling bounce fade out instead of stopping dead.
  return { gain: 0.12 + 0.88 * Math.sqrt(x), bright: x };
}

/** Whether a ball that last sounded at `lastMs` may sound again at `nowMs` (each ball has its own cooldown). */
export const offCooldown = (lastMs: number, nowMs: number) => nowMs - lastMs >= IMPACT.cooldownMs;

export type HoopPart = 'rim' | 'board';

/** How close (m) a ball's surface must be to a hoop part for a hit to count as touching it. */
const TOUCH = 0.05;
/** The most `moved` may widen TOUCH by, so a hard hit elsewhere doesn't reach out to the hoop. */
const MAX_MOVED = 0.08;

/**
 * Which part of the hoop a ball centred at `p` with radius `r` is touching, if any. `rim` is the floor's rim
 * (hoopRim); the backboard's face is parallel to the south wall, filled back to it like its collider, underside
 * included. `p` is read after the physics step, when the ball has already rebounded up to `moved` m (its speed
 * times the step) away from what it hit, so that much more counts as touching.
 */
export function hoopPart(p: Vec3, r: number, rim: Rim, moved = 0): HoopPart | null {
  const touch = TOUCH + Math.min(MAX_MOVED, Math.max(0, moved));
  const radial = Math.hypot(p.x - rim.x, p.z - rim.z) - rim.r;
  if (Math.hypot(radial, p.y - rim.y) <= r + HOOP.rim.tube + touch) return 'rim';
  const face = HALF_D - HOOP.standoff - HOOP.board.t;
  const halfW = Math.max(HOOP.board.w, HOOP.score.w) / 2;
  const top = HOOP.score.bottom + HOOP.score.h;
  if (p.z >= face - r - touch && Math.abs(p.x - rim.x) <= halfW + r && p.y >= HOOP.board.bottom - r - touch && p.y <= top + r) return 'board';
  return null;
}
