// Photo mode's camera moves, pure so they're tested without three.js: the free camera (fly with WASD, look with the
// mouse, roll, zoom) and the cinematic orbit round a target. Everything mutates the state it's given: the frame loop
// calls these every frame and must not allocate.

export const FOV_MIN = 15;
export const FOV_MAX = 110;
export const ROLL_MAX = Math.PI / 4;
const PITCH_MAX = 1.5;
/** Metres a second: normal, with Shift, and how quickly the speed eases to what the keys ask for (1/s). */
const SPEED = 2.4;
const FAST = 3.5;
const EASE = 7;
const ROLL_SPEED = 0.9; // radians a second
/** How far from the building the camera may wander (m), so it can't get lost in the city. */
export const BOUNDS = { x: 120, z: 120, yMin: -6, yMax: 60 };

export interface FreeCam {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  /** Current velocity (m/s), eased towards what the keys ask for. */
  vx: number;
  vy: number;
  vz: number;
}

/** What the keys ask for this frame: each axis -1..1. */
export interface FlyInput {
  forward: number;
  right: number;
  up: number;
  roll: number;
  fast: boolean;
}

export const newFreeCam = (x: number, y: number, z: number, yaw: number, pitch: number, fov: number): FreeCam => ({ x, y, z, yaw, pitch, roll: 0, fov, vx: 0, vy: 0, vz: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Moves the camera `dt` seconds: forward follows the view (pitch included), right stays level, up is straight up. */
export function flyStep(c: FreeCam, input: FlyInput, dt: number) {
  const speed = SPEED * (input.fast ? FAST : 1);
  const cp = Math.cos(c.pitch);
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  // three.js cameras look down -z; yaw turns about y (YXZ order, as the player's camera)
  const tx = (-sy * cp * input.forward + cy * input.right) * speed;
  const ty = (Math.sin(c.pitch) * input.forward + input.up) * speed;
  const tz = (-cy * cp * input.forward - sy * input.right) * speed;
  const k = 1 - Math.exp(-EASE * dt);
  c.vx += (tx - c.vx) * k;
  c.vy += (ty - c.vy) * k;
  c.vz += (tz - c.vz) * k;
  c.x = clamp(c.x + c.vx * dt, -BOUNDS.x, BOUNDS.x);
  c.y = clamp(c.y + c.vy * dt, BOUNDS.yMin, BOUNDS.yMax);
  c.z = clamp(c.z + c.vz * dt, -BOUNDS.z, BOUNDS.z);
  rollStep(c, input.roll, dt);
}

/** Tilts the horizon (Q and E), within ±45°. */
export function rollStep(c: FreeCam, dir: number, dt: number) {
  if (dir) c.roll = clamp(c.roll + dir * ROLL_SPEED * dt, -ROLL_MAX, ROLL_MAX);
}

/** Turns the view by a mouse movement already scaled to radians. */
export function look(c: FreeCam, dYaw: number, dPitch: number) {
  c.yaw -= dYaw;
  c.pitch = clamp(c.pitch - dPitch, -PITCH_MAX, PITCH_MAX);
}

/** The field of view after a wheel movement (pixels, positive = away from you = zoom out). */
export function zoom(fov: number, deltaY: number): number {
  return clamp(fov * Math.exp(deltaY * 0.0012), FOV_MIN, FOV_MAX);
}

/** Stops dead, e.g. when an orbit takes over or ends. */
export function halt(c: FreeCam) {
  c.vx = 0;
  c.vy = 0;
  c.vz = 0;
}

// ---------- the cinematic orbit ----------

export interface Orbit {
  /** The point it circles and looks at. */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  /** Camera height above the target. */
  height: number;
  angle: number;
  /** Radians a second; slow enough to read faces. */
  speed: number;
}

/** About 45 seconds a lap. */
export const ORBIT_SPEED = (2 * Math.PI) / 45;

/** An orbit that starts where the camera is now: same distance (within reason), height and side of the target. */
export function orbitFrom(c: FreeCam, cx: number, cy: number, cz: number): Orbit {
  const dx = c.x - cx;
  const dz = c.z - cz;
  const radius = clamp(Math.hypot(dx, dz), 1.2, 12);
  return { cx, cy, cz, radius, height: clamp(c.y - cy, -0.5, 4), angle: Math.atan2(dx, dz), speed: ORBIT_SPEED };
}

/** Moves the orbit on `dt` seconds and points the camera at its target (roll and zoom are left alone). */
export function orbitStep(o: Orbit, c: FreeCam, dt: number) {
  o.angle += o.speed * dt;
  c.x = o.cx + Math.sin(o.angle) * o.radius;
  c.z = o.cz + Math.cos(o.angle) * o.radius;
  c.y = o.cy + o.height;
  aimAt(c, o.cx, o.cy, o.cz);
  halt(c);
}

/** Turns the camera to look at a point. */
export function aimAt(c: FreeCam, x: number, y: number, z: number) {
  const dx = x - c.x;
  const dy = y - c.y;
  const dz = z - c.z;
  c.yaw = Math.atan2(-dx, -dz);
  c.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_MAX, PITCH_MAX);
}
