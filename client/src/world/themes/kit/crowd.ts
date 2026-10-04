import type { Gesture } from '../../body';
import { bodyState, claimBody, isSeated, onErrand, seatBody } from '../../people';
import type { Pt } from '../../toys/roombaBrain';
import { deskSpot, findPath, qaSpot, spot, standable, walkways, type FloorKind } from '../../walkways';
import { stopWalk, walkAlong } from './walker';

// Getting the floor's people up for a moment of a theme (everyone to the windows for the New Year fireworks, one of
// them across the room with a Valentine's sticky): the errand director lets go of them (claimBody), they walk round
// the furniture to their spots, and back to their chairs after.

export interface Person {
  id: string;
  role: string;
  desk: number;
}

/** A walkways facing (0 east, π/2 south) as a body heading (0 facing -Z). */
export const headingOf = (facing: number) => Math.atan2(-Math.cos(facing), -Math.sin(facing));

/** Where someone sits down again: behind their chair (developers, testers) or the CEO's desk. */
function home(kind: FloorKind, p: Person): Pt | undefined {
  if (kind === 'lobby') return spot(walkways('lobby'), 'ceo');
  return p.role === 'qa' ? qaSpot(p.desk) : deskSpot(p.desk);
}

/** Whether someone's free to join in: in their chair, not off on an errand. */
export const free = (id: string) => isSeated(id) && !onErrand(id);

/** Walks `p` from wherever they are to `to` round the furniture, then has them face `heading` with `gesture`. */
export function sendTo(kind: FloorKind, p: Person, to: Pt, heading: number, gesture: Gesture, done?: () => void) {
  claimBody(p.id);
  const w = walkways(kind);
  const at = bodyState(p.id) ?? home(kind, p) ?? to;
  // seated people step back from their chair first, to behind it, and set off from there
  const seated = isSeated(p.id) ? home(kind, p) : undefined;
  const path = findPath(w, seated ?? at, to) ?? [to];
  walkAlong(p.id, seated ? [seated, ...path] : path, heading, gesture, done);
}

/** Walks `p` back to their chair and sits them down. */
export function sendHome(kind: FloorKind, p: Person) {
  const h = home(kind, p);
  const at = bodyState(p.id);
  if (!h || !at) {
    stopWalk(p.id);
    seatBody(p.id);
    return;
  }
  walkAlong(p.id, findPath(walkways(kind), at, h) ?? [h], 0, 'none', () => {
    stopWalk(p.id);
    seatBody(p.id);
  });
}

/** The windows' spots on a floor kind (walkways.ts), each with room for three people side by side. */
export function windowPlaces(kind: FloorKind): { x: number; z: number; heading: number }[] {
  const w = walkways(kind);
  return w.spots
    .filter((s) => s.id.startsWith('window-'))
    .flatMap((s) => [0, -0.7, 0.7].map((dz) => ({ x: s.x, z: s.z + dz, heading: headingOf(s.facing) })))
    .filter((p) => standable(w, p.x, p.z));
}
