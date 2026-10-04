// How people on toy errands aim: a hoop shot with a casual player's wobble (they make about a third), and a lob to
// a friend's hands. Pure (no three.js, no physics): the throws go through the player's own maths in throwing.ts,
// so the toy world and the tests (npcAim.test.ts, against the Rapier throw simulation) agree on where they land.

import { WALL_H } from '../layout';
import type { ToyFloor } from './balls';
import { HOOP, hoopRim, hoopSquare, type Vec3 } from './hoopScore';
import { GRAVITY, THROW, hoopArc, throwVelocity, type View } from './throwing';

/** Where a body stands and which way it faces (body.ts: heading 0 faces -Z). */
export interface Stance {
  x: number;
  z: number;
  heading: number;
}

/** How a ball is held: carried in front, overhead for a hoop shot, at the chest to toss, or down at the feet. */
export type NpcPose = 'carry' | 'shoot' | 'toss' | 'low';

/** Eye height of someone standing (m), where their throws are aimed from. */
export const NPC_EYE = 1.5;

// Each pose's hold point: `ahead` of the body plus `aheadR` ball radii, at height `y` plus `yR` radii. `pull` (m)
// draws it back for a toss, or dips it for a shot.
const POSES: Record<NpcPose, { ahead: number; aheadR: number; y: number; yR: number }> = {
  carry: { ahead: 0.38, aheadR: 1, y: 1.0, yR: 0.3 },
  shoot: { ahead: 0.2, aheadR: 0, y: 1.75, yR: 1 },
  toss: { ahead: 0.3, aheadR: 1, y: 1.2, yR: 0.3 },
  low: { ahead: 0.42, aheadR: 1, y: 0.03, yR: 1 },
};

/** Where someone standing at `s` holds a ball of radius `r` in `pose`, written into `out`. */
export function npcHoldPoint(s: Stance, pose: NpcPose, r: number, pull: number, out: Vec3): Vec3 {
  const p = POSES[pose];
  const ahead = p.ahead + p.aheadR * r - (pose === 'toss' ? pull : 0);
  out.x = s.x - Math.sin(s.heading) * ahead;
  out.y = p.y + p.yR * r - (pose === 'shoot' ? pull : 0);
  out.z = s.z - Math.cos(s.heading) * ahead;
  return out;
}

/** A throw: which way they look (the camera's yaw and pitch, as for the player) and how hard (0 to 1). */
export interface NpcAim {
  yaw: number;
  pitch: number;
  power: number;
}

/** How much a casual shot wobbles (standard deviations): its power (0-1) and its aim (radians). */
export const WOBBLE = { power: 0.4, aim: 0.02 };

/** A normal sample from two uniform ones in [0, 1). */
export const normal = (u: number, v: number) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/** The camera angles looking from the eye of someone at (x, z) to `at`. */
export function lookAt(x: number, z: number, at: Vec3): { yaw: number; pitch: number } {
  const dx = at.x - x;
  const dz = at.z - z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(at.y - NPC_EYE, Math.hypot(dx, dz)) };
}

/** Where they stand to shoot: `s`, turned to face the hoop. */
export function facingHoop(s: Pick<Stance, 'x' | 'z'>, floor: ToyFloor): Stance {
  return { x: s.x, z: s.z, heading: lookAt(s.x, s.z, hoopSquare(floor)).yaw };
}

/**
 * A hoop shot from `s` (facing the hoop): aimed at the painted square, as hard as the arcade shot wants from where the
 * ball is held overhead, then wobbled. `rand` gives uniform numbers in [0, 1).
 */
export function aimHoop(s: Stance, floor: ToyFloor, rand: () => number): NpcAim {
  const { yaw, pitch } = lookAt(s.x, s.z, hoopSquare(floor));
  const from = npcHoldPoint(s, 'shoot', HOOP.ball.r, 0, { x: 0, y: 0, z: 0 });
  const top = HOOP.ball.throwSpeed;
  const ideal = (hoopArc(from, hoopRim(floor)).ideal - THROW.lob) / (top - THROW.lob);
  return {
    yaw: yaw + normal(rand(), rand()) * WOBBLE.aim,
    pitch: pitch + normal(rand(), rand()) * WOBBLE.aim,
    power: Math.min(1, Math.max(0, ideal + normal(rand(), rand()) * WOBBLE.power)),
  };
}

/** The view a throw from someone at `s` is made along. */
export const npcView = (s: Pick<Stance, 'x' | 'z'>, aim: Pick<NpcAim, 'yaw' | 'pitch'>, eye: Vec3 = { x: 0, y: 0, z: 0 }): View => {
  eye.x = s.x;
  eye.y = NPC_EYE;
  eye.z = s.z;
  return { eye, yaw: aim.yaw, pitch: aim.pitch };
};

const NO_WALK = { x: 0, z: 0 };
const MAX_FLIGHT = 1.8; // s

/**
 * A gentle lob from someone at (x, z), facing `to`, into hands at `to`, for a ball of radius `r` whose full throw is
 * `top` m/s: the softest throw (and the lower of its two arcs) that gets there in under 2 s and stays well under the
 * ceiling. Null when there's none.
 */
export function aimToss(x: number, z: number, to: Vec3, r: number, top: number = THROW.hard): NpcAim | null {
  const yaw = Math.atan2(-(to.x - x), -(to.z - z));
  const from = npcHoldPoint({ x, z, heading: yaw }, 'toss', r, 0, { x: 0, y: 0, z: 0 });
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const v = { x: 0, y: 0, z: 0 };
  const view = npcView({ x, z }, { yaw, pitch: 0 });
  const miss = (power: number, pitch: number) => {
    view.pitch = pitch;
    throwVelocity(view, from, power, top, NO_WALK, v);
    const t = dist / (Math.hypot(v.x, v.z) || 1e-6);
    const apex = from.y + (v.y > 0 ? (v.y * v.y) / (2 * GRAVITY) : 0);
    if (t > MAX_FLIGHT || apex > WALL_H - 0.3 - r) return null;
    return from.y + v.y * t - (GRAVITY * t * t) / 2 - to.y;
  };
  for (let power = 0; power <= 0.6; power += 0.02) {
    let prev: number | null = null;
    for (let pitch = -0.5; pitch <= 1.3; pitch += 0.01) {
      const m = miss(power, pitch);
      if (m === null) {
        prev = null;
        continue;
      }
      if (prev !== null && prev < 0 && m >= 0) return { yaw, pitch: pitch - (0.01 * m) / (m - prev), power };
      prev = m;
    }
  }
  return null;
}
