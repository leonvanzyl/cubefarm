// Somewhere the player is held still instead of walking: a deck chair or the telescope's eyepiece (roof/). While a
// perch is set, Player.tsx puts the eye there, stops walking and keeps the perch's yaw and pitch current for its owner;
// a movement key, Space or E (without food in hand) gets up. Plain module state, read every frame.

export interface Perch {
  id: string;
  /** Where the eye is (metres, the floor you're on). */
  x: number;
  y: number;
  z: number;
  /** Added to the view's pitch: a deck chair tips your head back towards the sky. */
  tilt: number;
  /** Mouse look speed as a share of normal (finer through a telescope); the owner may change it while perched. */
  look: number;
  /** How far up and down you can look from here (radians). */
  minPitch: number;
  maxPitch: number;
  /** Where you stand once you get up. */
  exit: { x: number; z: number };
  /** The view's direction (Player.tsx's yaw and pitch), kept current by Player.tsx. */
  yaw: number;
  pitch: number;
  /** Called once the player has got up (or was made to: the floor changed). */
  onLeave(): void;
}

let current: Perch | null = null;
let turn = false;

/** The player's perch, or null while they're on their feet. */
export const perch = () => current;

/** Sits the player down at `p`, turning the view to its yaw and pitch (getting up from any other perch first). */
export function setPerch(p: Perch) {
  if (current && current !== p) leavePerch();
  current = p;
  turn = true;
}

/** Turns the perched view to yaw/pitch (the probe aiming the telescope). */
export function aimPerch(yaw: number, pitch: number) {
  if (!current) return;
  current.yaw = yaw;
  current.pitch = Math.max(current.minPitch, Math.min(current.maxPitch, pitch));
  turn = true;
}

/** True once after the perch was set or aimed: Player.tsx then turns the view to the perch's yaw and pitch. */
export function takePerchTurn() {
  const was = turn;
  turn = false;
  return was;
}

/** Gets up: back on your feet at the perch's exit. Returns where to stand, or null when you weren't perched. */
export function leavePerch(): { x: number; z: number } | null {
  const p = current;
  if (!p) return null;
  current = null;
  turn = false;
  p.onLeave();
  return p.exit;
}
