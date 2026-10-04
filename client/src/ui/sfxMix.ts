// The mixer's pure decisions (no WebAudio, so they can be unit tested): how loud a sound placed in the world is from
// where you stand, where it sits left/right, when it's too far away to bother with, and which sound gives way when
// too many play at once.

/** A point in the world, in metres. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Full volume up to this distance (metres). Shared with the PannerNodes, so the estimate matches what you hear. */
export const REF_DISTANCE = 1.5;
/** Inverse-distance rolloff: a desk 10 m away plays at about 8% (-22 dB). */
export const ROLLOFF = 2;
/** Sounds farther than this aren't played at all. */
export const MAX_DISTANCE = 16;
/** How many sounds may be alive at once. */
export const VOICE_CAP = 24;

export function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** WebAudio's 'inverse' distance model: 1 within REF_DISTANCE, then falling off as 1/distance. */
export function distanceGain(d: number) {
  return REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (Math.max(d, REF_DISTANCE) - REF_DISTANCE));
}

/** False when a sound is too far away to play (cheap culling before any nodes are made). */
export const audible = (d: number) => d <= MAX_DISTANCE;

/**
 * Where a sound sits from -1 (left) to 1 (right) for a listener at `pos` facing `fwd` with `up` overhead (for QA;
 * the PannerNode does the real panning). 0 for a sound right on top of you.
 */
export function panOf(pos: Vec3, fwd: Vec3, up: Vec3, at: Vec3) {
  // right = forward × up
  const rx = fwd.y * up.z - fwd.z * up.y;
  const ry = fwd.z * up.x - fwd.x * up.z;
  const rz = fwd.x * up.y - fwd.y * up.x;
  const dx = at.x - pos.x;
  const dy = at.y - pos.y;
  const dz = at.z - pos.z;
  const len = Math.hypot(dx, dy, dz) * Math.hypot(rx, ry, rz);
  return len < 1e-6 ? 0 : Math.max(-1, Math.min(1, (rx * dx + ry * dy + rz * dz) / len));
}

/** `voiceToDrop` results besides an index into `alive`. */
export const PLAY = -1;
export const DROP_NEW = -2;

/**
 * The voice cap. With room left the new sound just plays (PLAY). Over the cap the quietest sound gives way: the new
 * one is dropped (DROP_NEW) unless it's louder than the quietest one alive, which is then stopped (its index).
 * `loud` is a sound's peak after distance, so far-away sounds count as quiet.
 */
export function voiceToDrop(alive: readonly { loud: number }[], loud: number, cap = VOICE_CAP): number {
  if (alive.length < cap) return PLAY;
  let quietest = -1;
  for (let i = 0; i < alive.length; i++) if (quietest < 0 || alive[i].loud < alive[quietest].loud) quietest = i;
  return quietest < 0 || loud <= alive[quietest].loud ? DROP_NEW : quietest;
}
