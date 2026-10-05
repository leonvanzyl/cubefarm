import { COFFEE_CORNER, ELEVATOR, GONG_SPOT, HALF_D, HALF_W, JUKEBOX, RECEPTION, type Rect } from '../layout';
import { walkways, type FloorKind } from '../walkways';
import { PLANTS, clear, type Pt } from './roombaBrain';

// Where the office dog goes on each kind of floor: things to sniff (the plants, the kitchenette, the cooler), places
// to nap (the couch or a rug), the elevator, and the spot beside someone's chair for a visit. Pure, and built once
// per floor kind. Headings follow the roomba's (roombaBrain.ts): facing h looks along (cos h, sin h).

/** How far the dog keeps its middle off walls and furniture. */
export const DOG_R = 0.3;

const EAST = 0;
const SOUTH = Math.PI / 2;
const WEST = Math.PI;
const NORTH = -Math.PI / 2;

export interface DogSpot extends Pt {
  id: string;
  heading: number;
}

/** A nap spot: lying at (x, z), `y` up (the couch's seat), reached from `from` with a hop when it's up off the floor. */
export interface NapSpot extends DogSpot {
  y: number;
  from: Pt | null;
}

export interface DogPlaces {
  floor: FloorKind;
  rects: Rect[];
  naps: NapSpot[];
  sniffs: DogSpot[];
  /** Just inside the elevator doors, and in the cabin beside where people stand. */
  door: Pt;
  cabin: Pt;
}

/** The couch's seat top (Props.tsx), where a nap on it lies. */
const SEAT_Y = 0.46;

/** Whether (x, z) is in front of the elevator doors, where the dog never sits about (it's in the way there). */
export const byDoors = (x: number, z: number) => Math.abs(x) < ELEVATOR.doorHalf + 0.8 && z > HALF_D - 2.2;

/**
 * A clear spot `dist` from (x, z), trying the side facing `toward` first; null when every side is blocked. Written into
 * `out` when given (the brain asks every step), else a new point.
 */
export function standNear(rects: Rect[], x: number, z: number, dist: number, toward: Pt, out?: Pt): Pt | null {
  const base = Math.atan2(toward.z - z, toward.x - x);
  for (let i = 0; i < 16; i++) {
    // 0, +1, -1, +2, -2 … steps of 22.5° away from straight towards `toward`
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
    const px = x + Math.cos(a) * dist;
    const pz = z + Math.sin(a) * dist;
    if (!clear(rects, px, pz, DOG_R) || byDoors(px, pz)) continue;
    const p = out ?? { x: 0, z: 0 };
    p.x = px;
    p.z = pz;
    return p;
  }
  return null;
}

const ROOM: Pt = { x: 0, z: 0 };

function plantSniffs(floor: FloorKind, rects: Rect[]): DogSpot[] {
  const out: DogSpot[] = [];
  PLANTS[floor].forEach(([x, z, s], i) => {
    const p = standNear(rects, x, z, 0.3 * s + DOG_R + 0.12, ROOM);
    if (p) out.push({ id: `plant-${i}`, ...p, heading: Math.atan2(z - p.z, x - p.x) });
  });
  return out;
}

function officePlaces(rects: Rect[]): Omit<DogPlaces, 'floor' | 'rects' | 'door' | 'cabin'> {
  return {
    naps: [
      // the north end of the couch's seat, clear of whoever sits at its south end; up from between it and the coffee table
      { id: 'couch', x: -HALF_W + 1.05, z: 5.6, heading: SOUTH, y: SEAT_Y, from: { x: -HALF_W + 1.8, z: 5.3 } },
      // the desk rugs, in the gaps between desks
      ...[-7, 0, 7].map((x) => ({ id: `rug-${x}`, x, z: 3.35, heading: x < 0 ? EAST : WEST, y: 0, from: null })),
      ...[-7, 7].map((x) => ({ id: `rug-${x}-mid`, x, z: -1.25, heading: x < 0 ? EAST : WEST, y: 0, from: null })),
    ],
    sniffs: [
      ...plantSniffs('office', rects),
      { id: 'kitchen', x: HALF_W - 1.3, z: 9.4, heading: EAST }, // the fridge end of the kitchenette counter
      { id: 'cooler', x: HALF_W - 1.3, z: -9.5, heading: EAST },
      { id: 'jukebox', x: JUKEBOX.officeX, z: HALF_D - JUKEBOX.d - 0.45, heading: SOUTH },
      { id: 'gong', x: GONG_SPOT.x + 0.85, z: GONG_SPOT.z - 0.35, heading: NORTH },
      { id: 'board', x: 2.5, z: -HALF_D + 1, heading: NORTH },
      { id: 'balls', x: 9.5, z: 7.2, heading: SOUTH },
    ],
  };
}

function lobbyPlaces(rects: Rect[]): Omit<DogPlaces, 'floor' | 'rects' | 'door' | 'cabin'> {
  return {
    naps: [
      // the sofa's east end (people sit at its west end); up from between it and its table
      { id: 'couch', x: 12.4, z: 4.05, heading: WEST, y: SEAT_Y, from: { x: 12.4, z: 5.15 } },
      { id: 'rug-west', x: -2.5, z: 6.5, heading: EAST, y: 0, from: null },
      { id: 'rug-east', x: 6.5, z: 6.6, heading: WEST, y: 0, from: null },
      { id: 'rug-north', x: -2, z: 0.5, heading: SOUTH, y: 0, from: null },
    ],
    sniffs: [
      ...plantSniffs('lobby', rects),
      { id: 'coffee', x: COFFEE_CORNER.x - COFFEE_CORNER.w / 2 - 0.75, z: HALF_D - 0.7, heading: EAST },
      { id: 'reception', x: RECEPTION.x - 2, z: RECEPTION.z + RECEPTION.d / 2 + 0.4, heading: NORTH },
      { id: 'trophies', x: 12, z: -HALF_D + 1.55, heading: NORTH },
      { id: 'bookshelf', x: -HALF_W + 1.2, z: -8.2, heading: WEST },
      { id: 'jukebox', x: JUKEBOX.lobbyX, z: HALF_D - JUKEBOX.d - 0.45, heading: SOUTH },
    ],
  };
}

const cache = new Map<FloorKind, DogPlaces>();

/** The dog's places on a floor kind (built once, then cached). */
export function dogPlaces(floor: FloorKind): DogPlaces {
  let p = cache.get(floor);
  if (p) return p;
  const rects = walkways(floor).nav.rects;
  const spots = floor === 'office' ? officePlaces(rects) : lobbyPlaces(rects);
  p = { floor, rects, ...spots, door: { x: 0, z: HALF_D - 0.9 }, cabin: { x: 0.55, z: HALF_D + 1.1 } };
  cache.set(floor, p);
  return p;
}

/** A random open spot to wander to: clear of everything by a good margin and away from the doors; null if none was found. */
export function randomSpot(p: DogPlaces, rand: () => number): Pt | null {
  for (let i = 0; i < 12; i++) {
    const x = (rand() * 2 - 1) * (HALF_W - 1);
    const z = (rand() * 2 - 1) * (HALF_D - 1);
    if (clear(p.rects, x, z, DOG_R + 0.25) && !byDoors(x, z)) return { x, z };
  }
  return null;
}

/**
 * Where the dog sits to rest its head on a seated person's lap: beside their chair on their left (they get up on their
 * right), a little forward, facing them. `seatHeading` is body.ts's (0 faces -Z). Heading in the dog's convention.
 */
export function lapSpot(seatX: number, seatZ: number, seatHeading: number): DogSpot {
  const fx = -Math.sin(seatHeading);
  const fz = -Math.cos(seatHeading);
  // their right is (cos, -sin); the dog sits on the left, facing right
  const rx = Math.cos(seatHeading);
  const rz = -Math.sin(seatHeading);
  return { id: 'lap', x: seatX - rx * 0.62 + fx * 0.12, z: seatZ - rz * 0.62 + fz * 0.12, heading: Math.atan2(rz, rx) };
}
