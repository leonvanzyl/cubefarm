// Camera poses for the overview, the building view and the follow cam, as plain numbers (rig.ts puts them on the
// three.js camera). Pure and allocation-free: every function writes into an `out` it's given. Yaw and pitch are as
// Player.tsx sets them (Euler 'YXZ', yaw 0 looking north, -Z); an orbit is a camera `dist` from a focus point, on bearing
// `yaw` (0: due south of it, looking north) and `el` radians above it.

import { angleDelta } from '../body';
import { BALCONY_OUT, HALF_D, HALF_W, WALL_H, WALL_T, roofElevation, viewElevation } from '../layout';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Vertical field of view, degrees. */
  fov: number;
  near: number;
}

export const newPose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 72, near: 0.05 });

export function copyPose(a: Pose, out: Pose) {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  out.yaw = a.yaw;
  out.pitch = a.pitch;
  out.fov = a.fov;
  out.near = a.near;
  return out;
}

export interface Orbit {
  fx: number;
  fy: number;
  fz: number;
  yaw: number;
  el: number;
  dist: number;
  fov: number;
}

export const newOrbit = (): Orbit => ({ fx: 0, fy: 0, fz: 0, yaw: 0, el: 0, dist: 10, fov: 60 });

export function copyOrbit(a: Orbit, out: Orbit) {
  out.fx = a.fx;
  out.fy = a.fy;
  out.fz = a.fz;
  out.yaw = a.yaw;
  out.el = a.el;
  out.dist = a.dist;
  out.fov = a.fov;
  return out;
}

/** The near plane for a camera this far from what it looks at: as far out as is safe, for depth precision on the rugs. */
export const nearFor = (dist: number) => Math.min(1.5, Math.max(0.05, dist * 0.02));

/** Where an orbit puts the camera, looking at its focus. */
export function orbitPose(o: Orbit, out: Pose) {
  const c = Math.cos(o.el);
  out.x = o.fx + Math.sin(o.yaw) * c * o.dist;
  out.y = o.fy + Math.sin(o.el) * o.dist;
  out.z = o.fz + Math.cos(o.yaw) * c * o.dist;
  out.yaw = o.yaw;
  out.pitch = -o.el;
  out.fov = o.fov;
  out.near = nearFor(o.dist);
  return out;
}

/** Aims a pose at (fx, fy, fz) from where it is. */
export function aimAt(p: Pose, fx: number, fy: number, fz: number) {
  const dx = p.x - fx;
  const dz = p.z - fz;
  p.yaw = Math.atan2(dx, dz);
  p.pitch = Math.atan2(fy - p.y, Math.hypot(dx, dz));
  return p;
}

/** Smooth in and out, 0 to 1. */
export const ease = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};

/**
 * Part way (t, 0 to 1) from pose a to pose b, the short way round in yaw. The near plane stays close until late, so
 * nothing near the camera is cut off while it's still close to it.
 */
export function blendPose(a: Pose, b: Pose, t: number, out: Pose) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.fov = a.fov + (b.fov - a.fov) * t;
  out.near = b.near > a.near ? a.near + (b.near - a.near) * t ** 4 : a.near + (b.near - a.near) * t;
  return out;
}

/** Eases orbit `cur` toward `goal`: `rate` per second (about 6 is snappy; `yawRate` for turning), the short way round. */
export function dampOrbit(cur: Orbit, goal: Orbit, dt: number, rate: number, yawRate = rate) {
  const k = 1 - Math.exp(-dt * rate);
  cur.fx += (goal.fx - cur.fx) * k;
  cur.fy += (goal.fy - cur.fy) * k;
  cur.fz += (goal.fz - cur.fz) * k;
  cur.yaw += angleDelta(cur.yaw, goal.yaw) * (1 - Math.exp(-dt * yawRate));
  cur.el += (goal.el - cur.el) * k;
  cur.dist += (goal.dist - cur.dist) * k;
  cur.fov += (goal.fov - cur.fov) * k;
  return cur;
}

// ---------- seeing points on screen ----------

/** Whether every point (x, y, z triples) is on screen from `p`, `margin` (0 to 1) in from the edges. */
export function allInView(p: Pose, aspect: number, points: readonly number[], margin: number) {
  const tanV = Math.tan((p.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const lim = 1 - margin;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - p.x;
    const dy = points[i + 1] - p.y;
    const dz = points[i + 2] - p.z;
    const depth = -sy * cp * dx + sp * dy - cy * cp * dz;
    if (depth <= 0) return false;
    const right = cy * dx - sy * dz;
    const up = sy * sp * dx + cp * dy + cy * sp * dz;
    if (Math.abs(right / (depth * tanH)) > lim || Math.abs(up / (depth * tanV)) > lim) return false;
  }
  return true;
}

/** The floor's corners at floor and ceiling height: what the overview fits on screen. */
const FLOOR_BOX = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, WALL_H].flatMap((y) => [sx * HALF_W, y, sz * HALF_D])));

// ---------- the overview ("dollhouse") ----------

export const OVERVIEW = {
  /** Looking down at about 49°. */
  el: 0.85,
  fov: 40,
  /** Height of the point it orbits, a little above the floor. */
  fy: 0.8,
  /** Closest zoom, metres; the furthest is MAX_ZOOM times the fitted distance. */
  minDist: 9,
  maxZoom: 1.5,
  margin: 0.06,
  /** The floor sits this much (of half the view) above the middle, clear of the toolbar along the bottom. */
  lift: 0.07,
};

/** The orbit bearing for quarter `q`: the four corners, south-east first. */
export const quadYaw = (q: number) => Math.PI / 4 + q * (Math.PI / 2);

/** The corner view closest to looking along `yaw` (so flying out keeps roughly the way you faced). */
export const nearestQuad = (yaw: number) => Math.round(angleDelta(Math.PI / 4, yaw) / (Math.PI / 2));

/** The distance at which the whole floor fits on screen from bearing `yaw` (binary search on a pure projection). */
export function fitDistance(o: Orbit, aspect: number, points: readonly number[] = FLOOR_BOX, margin = OVERVIEW.margin, scratch: Pose = newPose()) {
  const probe = { ...o };
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 40; i++) {
    probe.dist = (lo + hi) / 2;
    if (allInView(orbitPose(probe, scratch), aspect, points, margin)) hi = probe.dist;
    else lo = probe.dist;
  }
  return hi;
}

/** Where `points` land on screen from `p`: the smallest and largest normalised x and y (-1 to 1 is the view). */
export function screenBounds(p: Pose, aspect: number, points: readonly number[], out = { minX: 0, maxX: 0, minY: 0, maxY: 0 }) {
  const tanV = Math.tan((p.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  out.minX = out.minY = Infinity;
  out.maxX = out.maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - p.x;
    const dy = points[i + 1] - p.y;
    const dz = points[i + 2] - p.z;
    const depth = Math.max(1e-6, -sy * cp * dx + sp * dy - cy * cp * dz);
    const x = (cy * dx - sy * dz) / (depth * tanH);
    const y = (sy * sp * dx + cp * dy + cy * sp * dz) / (depth * tanV);
    out.minX = Math.min(out.minX, x);
    out.maxX = Math.max(out.maxX, x);
    out.minY = Math.min(out.minY, y);
    out.maxY = Math.max(out.maxY, y);
  }
  return out;
}

/**
 * The overview's starting orbit for a viewer facing `yaw`: the floor fitted to the screen and centred on it, a little
 * high (the near half looms larger, so the focus moves toward it until the floor sits where it should).
 */
export function overviewOrbit(yaw: number, aspect: number, out: Orbit) {
  out.fx = 0;
  out.fy = OVERVIEW.fy;
  out.fz = 0;
  out.yaw = quadYaw(nearestQuad(yaw));
  out.el = OVERVIEW.el;
  out.fov = OVERVIEW.fov;
  const pose = newPose();
  const tanV = Math.tan((out.fov * Math.PI) / 360);
  for (let i = 0; i < 4; i++) {
    out.dist = fitDistance(out, aspect, FLOOR_BOX, OVERVIEW.margin, pose);
    const b = screenBounds(orbitPose(out, pose), aspect, FLOOR_BOX);
    const up = (b.minY + b.maxY) / 2 - OVERVIEW.lift;
    panOrbit(out, ((b.minX + b.maxX) / 2) * out.dist * tanV * aspect, up * out.dist * (tanV / Math.sin(out.el)));
  }
  out.dist = fitDistance(out, aspect, FLOOR_BOX, OVERVIEW.margin, pose);
  return out;
}

/** Keeps a focus point over the floor. */
export function clampFocus(o: Orbit) {
  o.fx = Math.min(HALF_W, Math.max(-HALF_W, o.fx));
  o.fz = Math.min(HALF_D, Math.max(-HALF_D, o.fz));
  return o;
}

/** Moves the focus `right` and `forward` metres as the camera sees the ground. */
export function panOrbit(o: Orbit, right: number, forward: number) {
  const s = Math.sin(o.yaw);
  const c = Math.cos(o.yaw);
  o.fx += c * right - s * forward;
  o.fz += -s * right - c * forward;
  return clampFocus(o);
}

/** Metres on the ground per pixel at the focus, for dragging: `height` is the view's height in pixels. */
export const metresPerPixel = (o: Orbit, height: number) => (2 * o.dist * Math.tan((o.fov * Math.PI) / 360)) / Math.max(1, height);

export interface Sides {
  /** The near side wall: 1 east, -1 west, 0 neither. */
  x: number;
  /** The near end wall: 1 south, -1 north, 0 neither. */
  z: number;
}

/** Which walls are between a camera on bearing `yaw` and the room: those the dollhouse cuts away. */
export function nearSides(yaw: number, out: Sides) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.x = s > 0.05 ? 1 : s < -0.05 ? -1 : 0;
  out.z = c > 0.05 ? 1 : c < -0.05 ? -1 : 0;
  return out;
}

// ---------- the building view ----------

/** The tower's south face, from just in front: where each floor's slice of the cross-section is drawn. */
export const FACE_Z = HALF_D + WALL_T + 0.03;
export const FACE_HALF_W = HALF_W + WALL_T;

export const BUILDING = {
  /** A little east of due south and a little above: the face reads straight on, with a hint of depth and the roof. */
  yaw: 0.32,
  el: 0.16,
  /** Stays in the plaza in front of the tower, short of the buildings across the street. */
  dist: 34,
  minFov: 30,
  maxFov: 100,
  margin: 0.12,
};

/** Ground and roof (relative to the floor you're on, a floor number or ROOF, which is at 0) of a tower whose top floor is `top`. */
export function towerSpan(floor: number, top: number) {
  const base = -viewElevation(floor, Math.max(top, floor));
  return { bottom: base, top: base + roofElevation(Math.max(top, floor)) };
}

/** The building view's orbit: the whole south face in view, the field of view widening for tall towers (up to a cap). */
export function buildingOrbit(floor: number, top: number, aspect: number, out: Orbit, scratch: Pose = newPose()) {
  const span = towerSpan(floor, top);
  out.fx = 0;
  out.fz = 0;
  out.fy = (span.bottom + span.top) / 2;
  out.yaw = BUILDING.yaw;
  out.el = BUILDING.el;
  out.dist = BUILDING.dist;
  const pts = [-FACE_HALF_W, span.bottom, FACE_Z, FACE_HALF_W, span.bottom, FACE_Z, -FACE_HALF_W, span.top, FACE_Z, FACE_HALF_W, span.top, FACE_Z];
  let lo = BUILDING.minFov;
  let hi = BUILDING.maxFov;
  out.fov = hi;
  if (!allInView(orbitPose(out, scratch), aspect, pts, BUILDING.margin)) {
    // too tall to fit: look at your own floor and let the player pan up and down
    out.fy = WALL_H / 2;
    return out;
  }
  for (let i = 0; i < 30; i++) {
    out.fov = (lo + hi) / 2;
    if (allInView(orbitPose(out, scratch), aspect, pts, BUILDING.margin)) hi = out.fov;
    else lo = out.fov;
  }
  out.fov = hi;
  return out;
}

/** Keeps the building view's focus on the tower. */
export function clampTowerFocus(o: Orbit, floor: number, top: number) {
  const span = towerSpan(floor, top);
  o.fy = Math.min(span.top, Math.max(span.bottom, o.fy));
  return o;
}

// ---------- the follow cam ----------

export const FOLLOW = {
  /** Behind and above whoever it follows, looking at their shoulders. */
  dist: 3.4,
  el: 0.36,
  fov: 62,
  height: 1.25,
  minDist: 1.8,
  maxDist: 9,
};

/** Where you can't put a camera: inside the room, or along a balcony when they're out on one. */
export function clampFollowCamera(p: Pose, targetX: number) {
  const out = Math.abs(targetX) > HALF_W + WALL_T;
  const maxX = out ? BALCONY_OUT - 0.25 : HALF_W - 0.3;
  const minX = out ? HALF_W + WALL_T + 0.25 : -maxX;
  if (out) {
    const ax = Math.min(maxX, Math.max(minX, Math.abs(p.x)));
    p.x = Math.sign(targetX) * ax;
  } else p.x = Math.min(maxX, Math.max(minX, p.x));
  p.z = Math.min(HALF_D - 0.3, Math.max(-HALF_D + 0.3, p.z));
  p.y = Math.min(WALL_H - 0.35, Math.max(0.6, p.y));
  return p;
}

// ---------- Tab ----------

export type ViewMode = 'first' | 'overview' | 'building' | 'follow';

/** Two Tabs this close together are a double tap: the building view. */
export const DOUBLE_TAP_MS = 500;

/**
 * Where a Tab (or the pad's Select) takes the camera from `mode`: the overview and back, or on a quick second tap, the
 * building view. `lastTap` is when the previous tap was and `lastWent` where it went.
 */
export function tabTarget(mode: ViewMode, now: number, lastTap: number, lastWent: ViewMode | null): ViewMode {
  if (now - lastTap < DOUBLE_TAP_MS && lastWent !== 'building') return 'building';
  return mode === 'first' || mode === 'follow' ? 'overview' : 'first';
}
