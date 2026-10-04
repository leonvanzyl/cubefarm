// Sunlight through the side windows and doors: where each pane's light lands on the floor for a light coming from
// `dir` (the key light's, indoor.ts), as a convex polygon clipped to the floor. SunPatches.tsx draws them. Pure and
// allocation-free, so the frame loop can call it.
import { HALF_D, HALF_W, SIDE_DOOR, SIDE_OPENINGS, SIDES, WINDOW, sideSign, type Side } from '../layout';

type FloorKind = 'office' | 'lobby';

/** A pane the light comes in through, on the inside face of side wall `side`: z0..z1 along it, y0..y1 up. */
export interface Aperture {
  side: Side;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** The window frame round the glass (Shell.tsx `frames`): sill, head, sides and the middle mullion's half. */
const SILL = 0.06;
const HEAD = 0.1;
const JAMB = 0.08;
const MULLION = 0.06;

/** The glass on a floor's side walls: each window's two panes, either side of its mullion, and the glass door. */
export function apertures(kind: FloorKind): Aperture[] {
  const { w, h, y } = WINDOW;
  return SIDES.flatMap((side) => {
    const { door, windows } = SIDE_OPENINGS[kind][side];
    const y0 = y - h / 2 + SILL;
    const y1 = y + h / 2 - HEAD;
    return [
      ...windows.flatMap((z) => [
        { side, z0: z - w / 2 + JAMB, z1: z - MULLION, y0, y1 },
        { side, z0: z + MULLION, z1: z + w / 2 - JAMB, y0, y1 },
      ]),
      { side, z0: door - SIDE_DOOR.half, z1: door + SIDE_DOOR.half, y0: 0, y1: SIDE_DOOR.h },
    ];
  });
}

/** The most corners a patch has: a parallelogram clipped by the floor's four edges. */
export const PATCH_MAX = 8;

const scratch = [new Float32Array(PATCH_MAX * 2), new Float32Array(PATCH_MAX * 2)];

/** Clips polygon `src` (n corners, x/z pairs) to the side of the line `axis` (0: x, 1: z) = `bound` towards `keep` (±1). */
function clip(src: Float32Array, n: number, dst: Float32Array, axis: 0 | 1, bound: number, keep: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = (src[i * 2 + axis] - bound) * keep;
    const b = (src[j * 2 + axis] - bound) * keep;
    if (a >= 0) {
      dst[m * 2] = src[i * 2];
      dst[m * 2 + 1] = src[i * 2 + 1];
      m++;
    }
    if (a >= 0 !== b >= 0) {
      const k = a / (a - b);
      dst[m * 2] = src[i * 2] + (src[j * 2] - src[i * 2]) * k;
      dst[m * 2 + 1] = src[i * 2 + 1] + (src[j * 2 + 1] - src[i * 2 + 1]) * k;
      m++;
    }
  }
  return m;
}

/**
 * Writes the patch of floor lit through `a` by a light towards `dir` (a unit vector, y > 0) into `out` as x/z pairs
 * and returns how many corners it has: 0 when the light is on the other side of the building or misses the floor.
 */
export function sunPatch(a: Aperture, dir: readonly [number, number, number], out: Float32Array): number {
  const s = sideSign(a.side);
  const [dx, dy, dz] = dir;
  if (dy <= 0 || dx * s <= 0) return 0;
  const x = s * HALF_W;
  let p = scratch[0];
  // the pane's corners, slid down the light's ray to the floor, round the pane
  for (let i = 0; i < 4; i++) {
    const y = i === 0 || i === 3 ? a.y0 : a.y1;
    const z = i < 2 ? a.z0 : a.z1;
    p[i * 2] = x - (dx * y) / dy;
    p[i * 2 + 1] = z - (dz * y) / dy;
  }
  let n = 4;
  let q = scratch[1];
  // to the floor's four edges
  for (let e = 0; e < 4; e++) {
    n = clip(p, n, q, e < 2 ? 0 : 1, e < 2 ? HALF_W * (e === 0 ? -1 : 1) : HALF_D * (e === 2 ? -1 : 1), e % 2 === 0 ? 1 : -1);
    const t = p;
    p = q;
    q = t;
    if (n === 0) return 0;
  }
  for (let i = 0; i < n * 2; i++) out[i] = p[i];
  return n;
}
