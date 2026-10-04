// The Easter egg hunt, the pure side: where today's 12 eggs hide across the lobby and the office floors. Hiding places
// are tucked against furniture and walls (too close for a person to stand, so they're a little hidden), never inside
// anything, and always within reach of somewhere you can walk to from the elevator. A fresh seeded set every day.

import { hashId } from '../appearance';
import { HALF_D, HALF_W, lobbyColliders, officeColliders, type Rect } from '../layout';
import { clear, type Pt } from '../toys/roombaBrain';
import { spot, walkways, WALK_R, type FloorKind } from '../walkways';
import { decorColliders } from './themes';

export const EGG_COUNT = 12;
/** An egg's radius on the floor: nothing may overlap it. */
export const EGG_R = 0.1;
/** Within this of an egg, somewhere a person can stand and reach it from. */
export const REACH = 1.2;

const COLORS = ['#ffafcc', '#a0c4ff', '#caffbf', '#fdffb6', '#ffc6ff', '#9bf6ff', '#ffd6a5', '#bdb2ff'];

export interface Egg {
  id: string;
  floor: number;
  x: number;
  z: number;
  color: string;
  band: string;
}

const solids = (kind: FloorKind): Rect[] =>
  [...(kind === 'office' ? officeColliders() : lobbyColliders()), ...decorColliders('easter', kind)].filter((r) => Math.abs((r.minX + r.maxX) / 2) < HALF_W + 0.5);

/** Walk-grid cells reachable from the elevator, as a lookup (the roomba's grid, sized for a person). */
function reachable(kind: FloorKind): (x: number, z: number) => boolean {
  const w = walkways(kind);
  const { cols, rows, blocked } = w.nav;
  const cw = (HALF_W * 2) / cols;
  const ch = (HALF_D * 2) / rows;
  const cell = (x: number, z: number) => Math.floor((z + HALF_D) / ch) * cols + Math.floor((x + HALF_W) / cw);
  const start = spot(w, 'elevator')!;
  const seen = new Uint8Array(cols * rows);
  const queue = [cell(start.x, start.z)];
  seen[queue[0]] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % cols;
    const j = Math.floor(c / cols);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (seen[n] || blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return (x, z) => Math.abs(x) < HALF_W && Math.abs(z) < HALF_D && seen[cell(x, z)] === 1;
}

const cache = new Map<FloorKind, Pt[]>();

/** Every place an egg may hide on a floor kind (computed once). */
export function hidingPlaces(kind: FloorKind): Pt[] {
  const hit = cache.get(kind);
  if (hit) return hit;
  const rects = solids(kind);
  const canReach = reachable(kind);
  const out: Pt[] = [];
  for (let x = -HALF_W + 0.35; x < HALF_W - 0.3; x += 0.5) {
    for (let z = -HALF_D + 0.35; z < HALF_D - 0.3; z += 0.5) {
      if (!clear(rects, x, z, EGG_R)) continue; // inside or touching something
      if (clear(rects, x, z, WALK_R + 0.1)) continue; // out in the open: not hidden
      if (Math.abs(x) < 2.5 && z > HALF_D - 3) continue; // not right by the elevator
      // somewhere reachable to stand within reach
      let ok = false;
      for (let a = 0; a < 16 && !ok; a++) {
        for (const d of [0.5, 0.8, REACH]) {
          const px = x + Math.cos((a / 16) * Math.PI * 2) * d;
          const pz = z + Math.sin((a / 16) * Math.PI * 2) * d;
          if (canReach(px, pz) && clear(rects, px, pz, WALK_R)) {
            ok = true;
            break;
          }
        }
      }
      if (ok) out.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
    }
  }
  cache.set(kind, out);
  return out;
}

/** mulberry32 from a string seed. */
function rng(seed: string) {
  let a = hashId(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many of the 12 hide on each floor: a third in the lobby (all of them with no office floors), the rest shared. */
export function eggShare(floors: readonly number[]): Map<number, number> {
  const offices = [...new Set(floors.filter((f) => f > 0))].sort((a, b) => a - b);
  const share = new Map<number, number>([[0, offices.length ? 4 : EGG_COUNT]]);
  const rest = EGG_COUNT - share.get(0)!;
  offices.forEach((f, i) => {
    const n = Math.floor(rest / offices.length) + (i < rest % offices.length ? 1 : 0);
    if (n > 0) share.set(f, n);
  });
  return share;
}

/** Today's eggs (`day` is YYYY-MM-DD) for a building with these office floors: the same in every browser all day. */
export function eggsFor(day: string, floors: readonly number[]): Egg[] {
  const out: Egg[] = [];
  for (const [floor, n] of eggShare(floors)) {
    const places = hidingPlaces(floor === 0 ? 'lobby' : 'office');
    const r = rng(`${day}:${floor}`);
    const picked: Pt[] = [];
    for (let tries = 0; picked.length < n && tries < 400; tries++) {
      const p = places[Math.floor(r() * places.length)];
      // spread out: no two on a floor within 3 m (relaxed if the floor runs short)
      const gap = tries < 300 ? 3 : 0.5;
      if (picked.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= gap)) picked.push(p);
    }
    picked.forEach((p, i) => out.push({ id: `${floor}-${i}`, floor, x: p.x, z: p.z, color: COLORS[Math.floor(r() * COLORS.length)], band: COLORS[Math.floor(r() * COLORS.length)] }));
  }
  return out;
}
