// How a person moves about: getting up from their chair, walking to a spot, idling and sitting back down. Pure and
// allocation-free (Character.tsx steps one of these per person every frame); the pose itself is drawn there.
// World units are metres; heading is a yaw like Object3D.rotation.y, 0 facing -Z.

export type BodyMode = 'seated' | 'standing' | 'walking';
/** What the hands are busy with while up. Later issues add more. */
export type Gesture = 'none' | 'reach' | 'post' | 'hold' | 'sip' | 'stretch' | 'mug' | 'tap' | 'chat' | 'cheer' | 'wave' | 'talk' | 'stoop' | 'shoot' | 'toss' | 'catch' | 'shrug' | 'take' | 'windup' | 'strike' | 'clap' | 'nod' | 'thumbs' | 'call';

/** Where someone should be: the people controller (people.ts) holds one per agent who isn't simply seated. */
export interface BodyTarget {
  mode: BodyMode;
  x: number;
  z: number;
  /** Facing once they've arrived. */
  heading: number;
  /** Walking speed in m/s; about 1.1 is a stroll, 2.5 a hurry. */
  speed: number;
  gesture: Gesture;
  /** Bumped to make the person jump straight to x/z (standing) instead of walking there. */
  teleport: number;
}

/** 'rising' and 'sitting' are the short transitions between the chair and the standing spot beside it. */
export type Stage = 'seated' | 'rising' | 'up' | 'sitting';

export interface BodyState {
  stage: Stage;
  /** 1 seated, 0 standing; eased in between while rising or sitting. */
  sit: number;
  x: number;
  z: number;
  heading: number;
  /** Current ground speed (m/s), eased towards the target's. */
  speed: number;
  /** Walk cycle phase in radians: one full turn is a left and a right step. */
  phase: number;
  /** The seat and the spot beside the desk where they stand up to, in world space; set by the caller each frame. */
  seatX: number;
  seatZ: number;
  seatHeading: number;
  standX: number;
  standZ: number;
  teleport: number;
}

export const SIT_SECONDS = 0.6;
export const WALK_SPEED = 1.1;
const ARRIVE = 0.03;
const TURN_RATE = 6; // rad/s
const ACCEL = 4; // m/s²

export function newBodyState(): BodyState {
  return { stage: 'seated', sit: 1, x: 0, z: 0, heading: 0, speed: 0, phase: 0, seatX: 0, seatZ: 0, seatHeading: 0, standX: 0, standZ: 0, teleport: 0 };
}

/** The shortest signed turn from a to b, in (-PI, PI]. */
export function angleDelta(a: number, b: number) {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d <= -Math.PI ? d + Math.PI * 2 : d;
}

const turnTo = (from: number, to: number, max: number) => {
  const d = angleDelta(from, to);
  return angleDelta(0, from + Math.max(-max, Math.min(max, d)));
};

export const smooth = (t: number) => t * t * (3 - 2 * t);

/** During a transition the person slides between the standing spot and the seat, turning to face the desk. */
function placeOnTransition(s: BodyState, dt: number) {
  const k = smooth(s.sit);
  s.x = s.standX + (s.seatX - s.standX) * k;
  s.z = s.standZ + (s.seatZ - s.standZ) * k;
  s.heading = turnTo(s.heading, s.seatHeading, TURN_RATE * dt);
  s.speed = 0;
}

/** Walks towards (x, z) at up to `speed`, slowing on arrival; then turns to `heading`. Returns true once there. */
function walkTo(s: BodyState, x: number, z: number, heading: number, speed: number, dt: number) {
  const dx = x - s.x;
  const dz = z - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist < ARRIVE) {
    s.speed = Math.max(0, s.speed - ACCEL * 2 * dt);
    s.heading = turnTo(s.heading, heading, TURN_RATE * 0.6 * dt);
    return s.speed === 0 && Math.abs(angleDelta(s.heading, heading)) < 0.05;
  }
  // Turn to face the way they're going before picking up speed, so nobody moonwalks.
  const want = Math.atan2(-dx, -dz);
  s.heading = turnTo(s.heading, want, TURN_RATE * dt);
  const facing = Math.max(0, Math.cos(angleDelta(s.heading, want)));
  const goal = Math.min(speed, dist * 2.5) * facing;
  s.speed += Math.max(-ACCEL * 2 * dt, Math.min(ACCEL * dt, goal - s.speed));
  const step = Math.min(dist, s.speed * dt);
  s.x += (dx / dist) * step;
  s.z += (dz / dist) * step;
  return false;
}

/** Advances someone by dt seconds towards `target` (null: back to their seat). Mutates and returns `s`. */
export function stepBody(s: BodyState, target: BodyTarget | null, dt: number): BodyState {
  const up = target != null && target.mode !== 'seated';
  if (up && target.teleport !== s.teleport) {
    s.teleport = target.teleport;
    s.stage = 'up';
    s.sit = 0;
    s.x = target.x;
    s.z = target.z;
    s.heading = target.heading;
    s.speed = 0;
  }
  switch (s.stage) {
    case 'seated':
      s.x = s.seatX;
      s.z = s.seatZ;
      s.heading = s.seatHeading;
      s.speed = 0;
      if (up) s.stage = 'rising';
      break;
    case 'rising':
      if (!up) {
        s.stage = 'sitting';
        break;
      }
      s.sit = Math.max(0, s.sit - dt / SIT_SECONDS);
      placeOnTransition(s, dt);
      if (s.sit === 0) s.stage = 'up';
      break;
    case 'sitting':
      if (up) {
        s.stage = 'rising';
        break;
      }
      s.sit = Math.min(1, s.sit + dt / SIT_SECONDS);
      placeOnTransition(s, dt);
      if (s.sit === 1) {
        s.stage = 'seated';
        s.heading = s.seatHeading;
      }
      break;
    case 'up':
      if (up) walkTo(s, target.x, target.z, target.heading, target.speed > 0 ? target.speed : WALK_SPEED, dt);
      else if (walkTo(s, s.standX, s.standZ, s.seatHeading, WALK_SPEED, dt)) s.stage = 'sitting';
      break;
  }
  if (s.speed > 0) s.phase = (s.phase + dt * gait(s.speed, GAIT).cadence * Math.PI) % (Math.PI * 2);
  return s;
}

// ---------- the walk cycle ----------

export interface Gait {
  /** Hip swing either side of straight down (radians). */
  stride: number;
  /** Steps per second. */
  cadence: number;
  /** Up-and-down bounce (metres) and forward lean (radians). */
  bob: number;
  lean: number;
}

const GAIT: Gait = { stride: 0, cadence: 0, bob: 0, lean: 0 };
const LEG = 0.8; // hip to sole when standing

/** Stride and cadence for a ground speed: longer and quicker steps the faster someone goes. Writes into `out`. */
export function gait(speed: number, out: Gait): Gait {
  const v = Math.max(0, speed);
  const stepLength = Math.min(0.95, 0.32 + 0.2 * v);
  out.cadence = v > 0 ? v / stepLength : 0;
  out.stride = Math.asin(Math.min(0.9, stepLength / (2 * LEG)));
  out.bob = 0.018 + 0.012 * Math.min(2, v);
  out.lean = 0.04 + 0.05 * Math.min(2.5, v);
  return out;
}
