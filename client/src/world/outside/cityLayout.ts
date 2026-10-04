// The city around the building, as plain numbers: a seeded street grid, the buildings on its blocks (with roofs,
// water towers, antennas and three landmarks), a park, and the routes the little cars drive. Pure (no three.js),
// so the same seed always gives the same city and the tests can check it. City.tsx draws it. Units are metres,
// x/z as in layout.ts (our building is centred on the origin), y up from street level. Colours are 0xrrggbb.

import { BALCONY_OUT, HALF_D } from '../layout';

export const CITY = {
  seed: 165,
  /** Street centreline to centreline. */
  pitch: 52,
  roadHalf: 4,
  pavement: 2.5,
  /** Our own block (the plaza the building stands on), from the centre to its pavement. */
  homeHalfX: 30,
  homeHalfZ: 26,
  /** Streets on each side of our block. */
  rings: 6,
  /** Blocks further than this from the building stay empty (the haze has them by then). */
  radius: 330,
  /** Nothing is built within this distance of our building and its balconies. */
  gap: 20,
};

/** Half a street: the road and the pavement on one side. */
export const CORRIDOR_HALF = CITY.roadHalf + CITY.pavement;

/** Our building with its balconies on the west and east sides: what the gap is kept from. */
export const HOME_FOOTPRINT = { halfX: BALCONY_OUT, halfZ: HALF_D };

export interface CityBox {
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Bottom. */
  y: number;
  /** Width along x, height, depth along z (diameters for cylinders and cones). */
  w: number;
  h: number;
  d: number;
  color: number;
}

export interface CityBuilding extends CityBox {
  /** The share of its windows lit at night, 0..1. */
  lit: number;
  /** Which of the 16 offsets into the shared window texture it uses, so neighbours don't light up alike. */
  pattern: number;
}

export interface Span {
  min: number;
  max: number;
}

export interface CityLayout {
  /** Boxes with windows: towers and their setback tiers. */
  buildings: CityBuilding[];
  /** Plain boxes: roof huts, water-tower stands, park lawns. */
  boxes: CityBox[];
  cylinders: CityBox[];
  cones: CityBox[];
  /** Street centrelines: roads along z at these x, and roads along x at these z. */
  streetsX: number[];
  streetsZ: number[];
  parks: { x: Span; z: Span }[];
  /** The outer edge of the street grid (the outermost pavements), on either axis. */
  extentX: number;
  extentZ: number;
}

/** mulberry32: a stream of numbers in [0, 1) from a seed. */
export function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Street centrelines on one axis, from west/north to east/south. */
export function streetLines(homeHalf: number): number[] {
  const out: number[] = [];
  for (let k = CITY.rings; k >= 0; k--) out.push(-(homeHalf + CORRIDOR_HALF + k * CITY.pitch));
  for (let k = 0; k <= CITY.rings; k++) out.push(homeHalf + CORRIDOR_HALF + k * CITY.pitch);
  return out;
}

/** The blocks between the streets on one axis; index 0 is our own block. */
function blockSpans(lines: number[]): { index: number; span: Span }[] {
  const home = lines.length / 2 - 1; // lines[home] < 0 < lines[home + 1]
  const out: { index: number; span: Span }[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    out.push({ index: i - home, span: { min: lines[i] + CORRIDOR_HALF, max: lines[i + 1] - CORRIDOR_HALF } });
  }
  return out;
}

const FACADES = [0xe8d5b7, 0xd9a679, 0xc97b63, 0x9fb4c7, 0xb8c4a8, 0xe3c4a8, 0xa7a3b8, 0xf0e0c0, 0x8ea4b8, 0xd6b8a0, 0xc0d0d8, 0xe6b8a2, 0xb5a48c];
const ROOF_HUT = 0x8f8a86;
const TOWER_STAND = 0x5e4a3c;
const TOWER_TANK = 0xa0704a;
const TOWER_HAT = 0x6b4a33;
const ANTENNA = 0xdadde3;
const LAWN = 0x8fc46a;
const TREE = [0x5fa84f, 0x4f9a48, 0x6cb35a];
const TRUNK = 0x7a5a3c;
const WATER = 0x8fcbe6;
const STONE = 0xd9d2c4;

/** Where the tall towers cluster: north-east, so the skyline is behind the east windows' view of the street. */
const DOWNTOWN = { x: 150, z: -170 };

const round = (v: number, step = 0.5) => Math.round(v / step) * step;

/** The city for a seed: the same seed always gives the same city. */
export function cityLayout(seed = CITY.seed): CityLayout {
  const r = rng(seed);
  const pickOf = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const streetsX = streetLines(CITY.homeHalfX);
  const streetsZ = streetLines(CITY.homeHalfZ);
  const out: CityLayout = {
    buildings: [],
    boxes: [],
    cylinders: [],
    cones: [],
    streetsX,
    streetsZ,
    parks: [],
    extentX: streetsX[streetsX.length - 1] + CORRIDOR_HALF,
    extentZ: streetsZ[streetsZ.length - 1] + CORRIDOR_HALF,
  };

  const blocks: { ix: number; iz: number; x: Span; z: Span; cx: number; cz: number }[] = [];
  for (const bx of blockSpans(streetsX))
    for (const bz of blockSpans(streetsZ)) {
      if (bx.index === 0 && bz.index === 0) continue; // our plaza
      const cx = (bx.span.min + bx.span.max) / 2;
      const cz = (bz.span.min + bz.span.max) / 2;
      if (Math.hypot(cx, cz) > CITY.radius) continue;
      blocks.push({ ix: bx.index, iz: bz.index, x: bx.span, z: bz.span, cx, cz });
    }

  // The three blocks nearest downtown get a landmark each; the block west of ours is the park.
  const byDowntown = [...blocks].sort((a, b) => Math.hypot(a.cx - DOWNTOWN.x, a.cz - DOWNTOWN.z) - Math.hypot(b.cx - DOWNTOWN.x, b.cz - DOWNTOWN.z));
  const landmarks = new Map(byDowntown.slice(0, 3).map((b, i) => [b, i]));

  for (const b of blocks) {
    const roll = r();
    const landmark = landmarks.get(b);
    if (landmark !== undefined) addLandmark(out, landmark, b.cx, b.cz);
    else if ((b.ix === -1 && b.iz === 0) || roll < 0.05) addPark(out, r, b.x, b.z);
    else addBlock(out, r, pickOf, b.x, b.z);
  }
  return out;
}

function addBlock(out: CityLayout, r: () => number, pickOf: <T>(arr: readonly T[]) => T, bx: Span, bz: Span) {
  const nx = r() < 0.25 ? 1 : r() < 0.75 ? 2 : 3;
  const nz = r() < 0.25 ? 1 : r() < 0.75 ? 2 : 3;
  const lotW = (bx.max - bx.min) / nx;
  const lotD = (bz.max - bz.min) / nz;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (r() < 0.08) continue; // an empty lot: a car park or a yard
      const inset = 1.2 + r() * 2;
      const w = round(lotW - inset * 2 - r() * lotW * 0.15);
      const d = round(lotD - inset * 2 - r() * lotD * 0.15);
      const x = bx.min + lotW * (i + 0.5);
      const z = bz.min + lotD * (j + 0.5);
      addBuilding(out, r, pickOf, x, z, Math.max(5, w), Math.max(5, d));
    }
}

function addBuilding(out: CityLayout, r: () => number, pickOf: <T>(arr: readonly T[]) => T, x: number, z: number, w: number, d: number) {
  const fromHome = Math.hypot(x, z);
  const fromDowntown = Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z);
  let h = (12 + 80 * Math.exp(-fromDowntown / 110)) * (0.55 + r() * 0.9);
  // Low-rise around us, so the upper floors look out over rooftops.
  if (fromHome < 120) h = Math.min(h, 10 + r() * 18);
  h = round(Math.max(7, h));
  const color = pickOf(FACADES);
  const building = (bx: number, bz: number, y: number, bw: number, bh: number, bd: number) =>
    out.buildings.push({ x: bx, z: bz, y, w: bw, h: bh, d: bd, color, lit: round(0.2 + r() * 0.65, 0.01), pattern: Math.floor(r() * 16) });
  building(x, z, 0, w, h, d);
  let top = h;
  let tw = w;
  let td = d;
  if (h > 40 && r() < 0.6) {
    // a setback tier
    tw = round(w * 0.7);
    td = round(d * 0.7);
    const th = round(h * (0.2 + r() * 0.2));
    building(x, z, top, tw, th, td);
    top += th;
  }
  const kind = r();
  const ox = (r() - 0.5) * tw * 0.4;
  const oz = (r() - 0.5) * td * 0.4;
  if (top > 55) {
    out.cylinders.push({ x: x + ox * 0.5, z: z + oz * 0.5, y: top, w: 0.5, h: round(6 + r() * 10), d: 0.5, color: ANTENNA });
  } else if (kind < 0.3 && tw > 8 && td > 8) {
    out.boxes.push({ x: x + ox, z: z + oz, y: top, w: 2.6, h: 1.6, d: 2.6, color: TOWER_STAND });
    out.cylinders.push({ x: x + ox, z: z + oz, y: top + 1.6, w: 3, h: 3, d: 3, color: TOWER_TANK });
    out.cones.push({ x: x + ox, z: z + oz, y: top + 4.6, w: 3.6, h: 1.4, d: 3.6, color: TOWER_HAT });
  } else if (kind < 0.7) {
    out.boxes.push({ x: x + ox, z: z + oz, y: top, w: round(Math.min(5, tw * 0.3)), h: 2.2, d: round(Math.min(5, td * 0.3)), color: ROOF_HUT });
  }
}

/** One of the three landmarks, centred in its block. */
function addLandmark(out: CityLayout, which: number, x: number, z: number) {
  const tower = (y: number, w: number, h: number, color: number) => out.buildings.push({ x, z, y, w, h, d: w, color, lit: 0.6, pattern: (which * 5) % 16 });
  if (which === 0) {
    // the spire
    tower(0, 26, 120, 0xcfd6e0);
    tower(120, 18, 30, 0xcfd6e0);
    tower(150, 10, 14, 0xcfd6e0);
    out.cones.push({ x, z, y: 164, w: 4, h: 26, d: 4, color: 0xe8ecf2 });
  } else if (which === 1) {
    // the round tower on a podium
    tower(0, 34, 10, 0xb5a48c);
    out.cylinders.push({ x, z, y: 10, w: 24, h: 85, d: 24, color: 0x9fb4c7 });
    out.cylinders.push({ x, z, y: 95, w: 16, h: 12, d: 16, color: 0x8ea4b8 });
    out.cones.push({ x, z, y: 107, w: 4, h: 18, d: 4, color: ANTENNA });
  } else {
    // the stepped one
    tower(0, 30, 70, 0xe3c9a0);
    tower(70, 22, 30, 0xe3c9a0);
    tower(100, 14, 20, 0xe3c9a0);
    out.cylinders.push({ x, z, y: 120, w: 1, h: 20, d: 1, color: ANTENNA });
  }
}

function addPark(out: CityLayout, r: () => number, bx: Span, bz: Span) {
  const w = bx.max - bx.min;
  const d = bz.max - bz.min;
  const x = (bx.min + bx.max) / 2;
  const z = (bz.min + bz.max) / 2;
  out.parks.push({ x: bx, z: bz });
  out.boxes.push({ x, z, y: 0, w, h: 0.15, d, color: LAWN });
  out.cylinders.push({ x, z, y: 0.15, w: 9, h: 0.5, d: 9, color: STONE });
  out.cylinders.push({ x, z, y: 0.2, w: 8, h: 0.5, d: 8, color: WATER });
  // trees on a jittered grid, leaving the fountain clear
  const step = 7;
  for (let tx = bx.min + 4.5; tx <= bx.max - 4.5; tx += step)
    for (let tz = bz.min + 4.5; tz <= bz.max - 4.5; tz += step) {
      const jx = tx + (r() - 0.5) * 2;
      const jz = tz + (r() - 0.5) * 2;
      if (Math.hypot(jx - x, jz - z) < 8 || r() < 0.3) continue;
      const s = 0.8 + r() * 0.5;
      out.cylinders.push({ x: jx, z: jz, y: 0.15, w: 0.5, h: 1.4 * s, d: 0.5, color: TRUNK });
      out.cones.push({ x: jx, z: jz, y: 0.15 + 1.2 * s, w: 3.6 * s, h: 5 * s, d: 3.6 * s, color: TREE[Math.floor(r() * TREE.length)] });
    }
}

// ---------- traffic ----------

/** One car or bus going back and forth along one lane of one street, wrapping at ±CAR_RANGE. */
export interface CarRoute {
  /** The axis it drives along. */
  axis: 'x' | 'z';
  /** The street's centreline on the other axis. */
  line: number;
  dir: 1 | -1;
  /** m/s */
  speed: number;
  /** Where it is at time 0, along its axis. */
  start: number;
  /** Size: width, height, length. */
  w: number;
  h: number;
  len: number;
  color: number;
  bus: boolean;
}

export const CAR_RANGE = 300;
/** Lane centre from the street's centreline (cars keep right). */
export const LANE = CITY.roadHalf / 2;
export const MAX_CARS = 12;

const CAR_COLORS = [0xe8534a, 0x4a90d9, 0xf2c94c, 0xffffff, 0x6fcf97, 0xbb6bd9, 0x2d3142, 0xf2994a];
const BUS_COLOR = 0xf2b632;

/** A dozen vehicles, one per lane of the streets nearest the building, so no two ever share a lane. */
export function carRoutes(seed = CITY.seed): CarRoute[] {
  const r = rng(seed * 7 + 1);
  const xs = streetLines(CITY.homeHalfX);
  const zs = streetLines(CITY.homeHalfZ);
  const mx = xs.length / 2;
  const mz = zs.length / 2;
  // roads along z at x = ±(first ring), roads along x at z = ±(first ring), then one of each further out
  const streets: { axis: 'x' | 'z'; line: number }[] = [
    { axis: 'z', line: xs[mx - 1] },
    { axis: 'z', line: xs[mx] },
    { axis: 'x', line: zs[mz - 1] },
    { axis: 'x', line: zs[mz] },
    { axis: 'z', line: xs[mx + 1] },
    { axis: 'x', line: zs[mz - 2] },
  ];
  const out: CarRoute[] = [];
  for (const s of streets)
    for (const dir of [1, -1] as const) {
      const bus = out.length === 2 || out.length === 9;
      out.push({
        axis: s.axis,
        line: s.line,
        dir,
        speed: bus ? 7 : 9 + r() * 6,
        start: (r() * 2 - 1) * CAR_RANGE,
        w: bus ? 2.5 : 1.9,
        h: bus ? 3 : 1.5,
        len: bus ? 9 : 4.2,
        color: bus ? BUS_COLOR : CAR_COLORS[Math.floor(r() * CAR_COLORS.length)],
        bus,
      });
    }
  return out.slice(0, MAX_CARS);
}

/** Where a car is at `time` seconds: written into `out` (no allocation, it runs every frame). yaw turns +z to its heading. */
export function carPose(car: CarRoute, time: number, out: { x: number; z: number; yaw: number }) {
  const span = CAR_RANGE * 2;
  const s = ((((car.start + CAR_RANGE + car.dir * car.speed * time) % span) + span) % span) - CAR_RANGE;
  if (car.axis === 'z') {
    out.x = car.line - car.dir * LANE; // facing +z, your right is -x
    out.z = s;
    out.yaw = car.dir > 0 ? 0 : Math.PI;
  } else {
    out.x = s;
    out.z = car.line + car.dir * LANE; // facing +x, your right is +z
    out.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  return out;
}
