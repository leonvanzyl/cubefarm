import { DOOR_SENSOR, HALF_W, SIDE_OPENINGS, SIDES, WALL_T, outsideAt, sideDoorway, sideSign, type Rect, type Side } from './layout';

// The side doors: a glass door in the west and east wall of every floor that slides open when the player comes near
// and closes behind them. The pure rules are tested; the state below is the floor you're on, stepped by SideDoors
// (Outside.tsx) every frame, read by Player.tsx's collisions, the toy physics and window.__swarmOutside.

type FloorKind = 'office' | 'lobby';

/** Seconds from shut to fully open (and back). */
export const DOOR_SLIDE_S = 0.45;
/** Less open than this, a door blocks its doorway. */
export const DOOR_PASSABLE = 0.6;

export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';

/** Whether the player at (x, z) is close enough to `side`'s door for it to open. */
export function nearDoor(kind: FloorKind, side: Side, x: number, z: number) {
  const wallX = sideSign(side) * (HALF_W + WALL_T / 2);
  return Math.abs(x - wallX) < DOOR_SENSOR.across && Math.abs(z - SIDE_OPENINGS[kind][side].door) < DOOR_SENSOR.along;
}

/** How open a door is (0 shut, 1 open) after `dt` seconds more of wanting to be open or shut. */
export const stepDoor = (open: number, want: boolean, dt: number) => Math.min(1, Math.max(0, open + (want ? dt : -dt) / DOOR_SLIDE_S));

export const doorPhase = (open: number, want: boolean): DoorPhase => (want ? (open >= 1 ? 'open' : 'opening') : open <= 0 ? 'closed' : 'closing');

// ---------- the doors on the floor you're on ----------

interface Door {
  open: number;
  want: boolean;
  doorway: Rect;
}

const doors: Record<Side, Door> = {
  west: { open: 0, want: false, doorway: sideDoorway('office', 'west') },
  east: { open: 0, want: false, doorway: sideDoorway('office', 'east') },
};
const player = { x: 0, z: 0, floor: 0, kind: 'office' as FloorKind, live: false };
const shut: Rect[] = [];

/** A floor came into view: both doors shut. `live` is false once it's gone. */
export function resetDoors(kind: FloorKind, floor: number, live = true) {
  player.kind = kind;
  player.floor = floor;
  player.live = live;
  for (const side of SIDES) Object.assign(doors[side], { open: 0, want: false, doorway: sideDoorway(kind, side) });
}

/**
 * Steps both doors towards open or shut by where the player stands, and anyone else on foot (`walkers`: a candidate
 * leaving the lobby). Calls `moved` when one starts to open or close.
 */
export function tickDoors(x: number, z: number, dt: number, moved: (side: Side, opening: boolean) => void, walkers: Iterable<{ x: number; z: number }> = []) {
  player.x = x;
  player.z = z;
  const near = (side: Side) => {
    if (nearDoor(player.kind, side, x, z)) return true;
    for (const w of walkers) if (nearDoor(player.kind, side, w.x, w.z)) return true;
    return false;
  };
  for (const side of SIDES) {
    const d = doors[side];
    const want = near(side);
    if (want !== d.want && (want ? d.open < 1 : d.open > 0)) moved(side, want);
    d.want = want;
    d.open = stepDoor(d.open, want, dt);
  }
}

/** How open `side`'s door is, 0-1. */
export const doorOpen = (side: Side) => doors[side].open;

/** The doorways whose doors are too shut to walk through, for collide(). The same array every call: don't keep it. */
export function shutDoorways(): Rect[] {
  shut.length = 0;
  if (player.live) for (const side of SIDES) if (doors[side].open < DOOR_PASSABLE) shut.push(doors[side].doorway);
  return shut;
}

// ---------- probe ----------

export interface OutsideSnapshot {
  floor: number;
  kind: FloorKind;
  doors: Record<Side, { open: number; phase: DoorPhase }>;
  /** Whether the player is out on a balcony (or the lobby's patio), and which. */
  out: boolean;
  side: Side | null;
  x: number;
  z: number;
}

function snapshot(): OutsideSnapshot {
  const side = outsideAt(player.x);
  const door = (s: Side) => ({ open: doors[s].open, phase: doorPhase(doors[s].open, doors[s].want) });
  return { floor: player.floor, kind: player.kind, doors: { west: door('west'), east: door('east') }, out: side !== null, side, x: player.x, z: player.z };
}

// window.__swarmOutside: the side doors and whether you're out, for QA and Playwright (a fresh snapshot per read).
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmOutside')) {
  Object.defineProperty(window, '__swarmOutside', { get: snapshot, enumerable: false, configurable: false });
}
