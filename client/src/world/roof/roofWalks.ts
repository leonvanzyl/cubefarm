// Where people walk on the roof (RoofPeople.tsx): its walk grid, a person wide, and the spots they walk to. Pure, like
// walkways.ts for the floors (the same grid and A*, roombaBrain.ts's).

import { HALF_D, elevatorDoorway, roofColliders } from '../layout';
import { makeNav, planPath, type Nav, type Pt } from '../toys/roombaBrain';
import { WALK_R } from '../walkways';

/** In front of the elevator's doors, where visitors step out and go back in. */
export const LIFT: Pt = { x: 0, z: HALF_D - 1 };
/** Where the CEO paces on a call: by the west railing, beside the helipad, looking out over the city. */
export const CALL_SPOTS: Pt[] = [
  { x: -14.4, z: -4.8 },
  { x: -14.4, z: -1.2 },
];

let nav: Nav | null = null;

/** The roof's walk grid: its colliders and the elevator's doorway (built once). */
export const roofNav = () => (nav ??= makeNav([...roofColliders(), elevatorDoorway()], { planR: WALK_R + 0.1, lineR: WALK_R + 0.03, greed: 1.3 }));

/** A walk from `from` to `to` round the furniture, as waypoints after `from`; null when there's no way. */
export const findRoofPath = (from: Pt, to: Pt): Pt[] | null => planPath(roofNav(), from, to);
