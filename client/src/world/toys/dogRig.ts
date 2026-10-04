import type { DogPose } from './dogBrain';

// The dog's rig as numbers: where each joint should be for a pose, a gait (walk, trot, gallop) and a mood, plus the
// tail's wag and the ears' flop. Pure and allocation-free: Dog.tsx eases its meshes towards these every frame.
// The model faces +x: legs swing about z (+ swings a paw forward), the body pitches about z at the hips (+ lifts the
// front), and the head pitches up with +.

export interface DogJoints {
  /** How far the whole body drops (m), its pitch (rad, + nose up) and a sideways sway of the rear (the wiggle). */
  drop: number;
  pitch: number;
  sway: number;
  /** Legs: front left, front right, rear left, rear right. */
  fl: number;
  fr: number;
  rl: number;
  rr: number;
  headYaw: number;
  headPitch: number;
  /** How far the head reaches forward (m): on someone's lap, nose to a ball. */
  reach: number;
  tailYaw: number;
  tailLift: number;
  /** Ears: flared out from the head, and swept back. */
  earOut: number;
  earBack: number;
  tongue: number;
}

export const newJoints = (): DogJoints => ({ drop: 0, pitch: 0, sway: 0, fl: 0, fr: 0, rl: 0, rr: 0, headYaw: 0, headPitch: 0, reach: 0, tailYaw: 0, tailLift: 0, earOut: 0, earBack: 0, tongue: 0 });

/** Ground speeds where the gait changes: a walk, a trot, and a gallop from here. */
export const GALLOP = 2.6;

/** Strides per second at a ground speed. */
export const cadence = (speed: number) => (speed <= 0.02 ? 0 : speed < GALLOP ? 1.2 + speed * 0.9 : 1.2 + GALLOP * 0.9 + (speed - GALLOP) * 0.3);

/** How fast (rad/s) and how wide (rad) the tail wags for a happiness of 0-1: a slow sweep when calm, a blur when delighted. */
export const wagRate = (happy: number) => 4 + 22 * happy;
export const wagWidth = (happy: number) => 0.12 + 0.7 * happy;

export interface RigInput {
  pose: DogPose;
  speed: number;
  happy: number;
  /** Seconds of wiggle left (a pet), the gait's phase (radians) and the time (s). */
  wiggle: number;
  phase: number;
  t: number;
  /** Panting after a run; carrying a ball (head down to it). */
  panting: boolean;
  carrying: boolean;
  /** Where the head wants to look, as yaw and pitch from straight ahead (already clamped), and whether it does. */
  lookYaw: number;
  lookPitch: number;
  looking: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The head's turn towards a point (dx, dy, dz) from the head, for a dog facing `heading` (the brain's convention). */
export function headAim(heading: number, dx: number, dy: number, dz: number): { yaw: number; pitch: number } {
  const along = dx * Math.cos(heading) + dz * Math.sin(heading);
  const across = -dx * Math.sin(heading) + dz * Math.cos(heading); // + is to its right
  return { yaw: clamp(Math.atan2(-across, along), -1, 1), pitch: clamp(Math.atan2(dy, Math.hypot(along, across)), -0.7, 0.8) };
}

/** Writes the joint targets for this moment into `out`. */
export function rig(i: RigInput, out: DogJoints): DogJoints {
  const moving = i.speed > 0.08;
  const gallop = i.speed >= GALLOP;
  const s = Math.sin(i.phase);
  // stride grows with speed; a trot moves diagonal pairs together, a gallop the front pair then the rear pair
  const stride = moving ? clamp(0.18 + i.speed * 0.14, 0.2, 0.75) : 0;
  if (gallop) {
    out.fl = Math.sin(i.phase) * stride;
    out.fr = Math.sin(i.phase - 0.35) * stride;
    out.rl = Math.sin(i.phase + Math.PI) * stride;
    out.rr = Math.sin(i.phase + Math.PI - 0.35) * stride;
  } else {
    out.fl = s * stride;
    out.rr = s * stride;
    out.fr = -s * stride;
    out.rl = -s * stride;
  }
  out.drop = moving ? Math.abs(Math.cos(i.phase)) * (gallop ? 0.03 : 0.012) : 0;
  out.pitch = gallop ? Math.cos(i.phase) * 0.08 : 0;
  out.sway = i.wiggle > 0 ? Math.sin(i.t * 22) * 0.22 * Math.min(1, i.wiggle / 0.3) : 0;
  out.headYaw = i.looking ? i.lookYaw : 0;
  out.headPitch = i.looking ? i.lookPitch : 0;
  out.reach = 0;
  out.tongue = i.panting || (moving && gallop) ? 1 : 0;

  // sitting, lying and the rest, laid over the legs (only while standing still)
  if (!moving) {
    switch (i.pose) {
      case 'sit':
      case 'beg':
      case 'lap':
        out.pitch = 0.55;
        out.drop = 0.1;
        out.fl = out.fr = -0.55; // front legs straight down under the raised chest
        out.rl = out.rr = 1.45; // rear legs folded forward
        if (i.pose === 'beg') {
          out.drop -= Math.max(0, Math.sin(i.t * 9)) * 0.03; // a bounce: can't sit still
          out.fl = -0.55 + Math.max(0, Math.sin(i.t * 4.5)) * 0.5; // a paw up now and then
        }
        if (i.pose === 'lap') {
          out.headPitch = -0.25; // head resting forward on their knees, eyes up
          out.reach = 0.06;
          out.headYaw = 0;
        } else if (!i.looking) out.headPitch = 0.2;
        break;
      case 'lie':
      case 'sleep':
        out.pitch = 0;
        out.drop = 0.19;
        out.fl = out.fr = 1.45; // paws out in front
        out.rl = out.rr = 1.2;
        if (i.pose === 'sleep') {
          out.headPitch = -0.45; // chin on the paws
          out.headYaw = 0.25;
          out.reach = 0.03;
        }
        break;
      case 'sniff':
        out.pitch = -0.12;
        out.headPitch = -0.75 + Math.sin(i.t * 13) * 0.05;
        out.headYaw = Math.sin(i.t * 2.3) * 0.25;
        out.reach = 0.05;
        break;
      case 'hop':
        out.fl = out.fr = 0.5;
        out.rl = out.rr = -0.35;
        out.pitch = 0.15;
        out.headPitch = 0.35;
        break;
      case 'stand':
        break;
    }
  }
  if (i.carrying) {
    out.headPitch = Math.min(out.headPitch, -0.35); // nose down to the ball in front
    out.reach = 0.05;
  }

  // the tail: wagging with joy (still when asleep), held higher the happier it is
  const asleep = i.pose === 'sleep';
  out.tailYaw = asleep ? 0.6 : Math.sin(i.t * wagRate(i.happy)) * wagWidth(i.happy);
  out.tailLift = asleep ? -0.6 : -0.35 + 0.95 * i.happy;
  // the ears flop with every stride and stream back at a gallop
  out.earOut = asleep ? 0.05 : 0.15 + (moving ? Math.abs(Math.sin(i.phase * 2)) * 0.35 * Math.min(1, i.speed / 2) : 0) + (i.pose === 'hop' ? 0.5 : 0);
  out.earBack = gallop ? 0.9 : moving ? i.speed * 0.15 : 0;
  return out;
}
