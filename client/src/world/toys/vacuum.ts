// The roomba vacuuming foam darts: which floor darts it picks up, and a session count for window.__swarmToys.
// Pure, so it can be tested (and light, since probe.ts loads it up front); RoombaVacuum.tsx does the picking up.

import type { LooseDart } from './darts';
import type { RoombaState } from './roombaBrain';

/** How far past its rim (m) the suction reaches (its bumper shoves darts along, so it has to reach a little beyond), and how long a dart takes to disappear into it (ms). */
export const PICKUP = { reach: 0.1, animMs: 350 };

/** Whether the roomba sucks up darts in this state: whenever it's driving about, not while parked on its dock. */
export const vacuums = (state: RoombaState) => state !== 'charging';

/** Is a dart lying at (x, z) within `radius` of a roomba centred at (rx, rz)? */
export const inPickup = (rx: number, rz: number, d: { x: number; z: number }, radius: number) => Math.hypot(d.x - rx, d.z - rz) <= radius;

/**
 * The floor darts (from floorDarts(), so stuck ones are never among them) that a roomba of radius `r` at (rx, rz)
 * in `state` picks up now.
 */
export function toVacuum(state: RoombaState, rx: number, rz: number, darts: readonly LooseDart[], r: number): LooseDart[] {
  return vacuums(state) ? darts.filter((d) => inPickup(rx, rz, d, r + PICKUP.reach)) : [];
}

let vacuumed = 0;

/** Count darts the roomba vacuumed. */
export const countVacuumed = (n = 1) => void (vacuumed += n);

/** Darts vacuumed so far this session (every floor). */
export const vacuumedCount = () => vacuumed;
