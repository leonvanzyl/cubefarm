// What the telescope finds in the night sky (Telescope.tsx): named constellations picked out of the sky's own stars
// (Sky.tsx draws starField(STARS)), where the turning sky puts them at a time of day, and where the moon is. Pure and
// seeded, so it's the same sky every night and the tests check it without a browser. Directions are unit vectors.

import { starField } from '../sky/skyLayout';
import { sunDirection } from '../sky/time';

/** How many stars Sky.tsx draws (its STARS): the constellations are picked from the same field. */
export const STARS = 700;

type V3 = [number, number, number];

/** The axis the stars wheel round, as Sky.tsx turns them: the sun's path's, so night after night they rise and set. */
export function starAxis(): V3 {
  const [, y, z] = sunDirection(0.5);
  // (1, 0, 0) × (0, y, z), normalised
  const l = Math.hypot(y, z);
  return [0, -z / l, y / l];
}

/** How far the sky has turned about starAxis() at day phase t (radians), as Sky.tsx turns it. */
export const skyTurn = (t: number) => 2 * Math.PI * (t - 0.5);

/** Where the star at `dir` (in the sky's own frame) is at day phase t. */
export function starAt(dir: Readonly<V3>, t: number, axis: Readonly<V3> = starAxis()): V3 {
  const a = skyTurn(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [kx, ky, kz] = axis;
  const [x, y, z] = dir;
  const dot = kx * x + ky * y + kz * z;
  // Rodrigues: v cos a + (k × v) sin a + k (k · v)(1 − cos a)
  return [
    x * c + (ky * z - kz * y) * s + kx * dot * (1 - c),
    y * c + (kz * x - kx * z) * s + ky * dot * (1 - c),
    z * c + (kx * y - ky * x) * s + kz * dot * (1 - c),
  ];
}

/** The moon's direction at day phase t: opposite the sun, as Sky.tsx paints it. */
export function moonDirection(t: number): V3 {
  const [x, y, z] = sunDirection(t);
  return [-x, -y, -z];
}

export interface Constellation {
  name: string;
  /** Indices into the star field, brightest first. */
  stars: number[];
  /** The figure's lines, as pairs of star indices. */
  lines: [number, number][];
  /** The middle of the figure (in the sky's frame), for its name. */
  centre: V3;
}

/** Which way to look (degrees, as the probe aims the telescope: yaw 0 north and 90 west, pitch up from level) for `dir`. */
export function aimAt(dir: Readonly<V3>): { yaw: number; pitch: number } {
  const deg = (r: number) => Math.round((r * 1800) / Math.PI) / 10;
  return { yaw: deg(Math.atan2(-dir[0], -dir[2])), pitch: deg(Math.asin(Math.max(-1, Math.min(1, dir[1])))) };
}

/** Office-sky names, in the order the constellations are found. */
export const NAMES = ['The Coffee Mug', 'The Rubber Duck', 'The Merge Arrow', 'The Little Bug', 'The Gong', 'The Roomba', 'The Sticky Note', 'The Keyboard'];

/** A constellation's stars lie within this angle (radians) of its brightest, so it fits the telescope's widest view. */
export const SPAN = (9 * Math.PI) / 180;
/** Constellations' brightest stars are at least this far apart (radians), so they spread over the sky. */
const APART = (22 * Math.PI) / 180;
/** Up through the middle of the night (y of the direction above MIN_UP): an hour or so either side of midnight. */
const NIGHT = [0.9, 0, 0.1];
const MIN_UP = 0.17; // about 10° up

const angle = (a: Readonly<V3>, b: Readonly<V3>) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/**
 * The constellations: round each bright star that's up through the middle of the night, the nearest stars within SPAN (four to six of
 * them), joined by their shortest connecting lines (a minimum spanning tree), named from NAMES. At most `count`.
 */
export function constellations(count = 6, field = starField(STARS)): Constellation[] {
  const n = field.sizes.length;
  const dir = (i: number): V3 => [field.positions[i * 3], field.positions[i * 3 + 1], field.positions[i * 3 + 2]];
  const axis = starAxis();
  const upAtNight = (i: number) => NIGHT.every((t) => starAt(dir(i), t, axis)[1] > MIN_UP);
  const bright = Array.from({ length: n }, (_, i) => i)
    .filter((i) => field.sizes[i] >= 3 && upAtNight(i))
    .sort((a, b) => field.sizes[b] - field.sizes[a] || starAt(dir(b), 0, axis)[1] - starAt(dir(a), 0, axis)[1]);
  const used = new Set<number>();
  const out: Constellation[] = [];
  for (const anchor of bright) {
    if (out.length >= count) break;
    if (used.has(anchor) || out.some((c) => angle(dir(c.stars[0]), dir(anchor)) < APART)) continue;
    const near = Array.from({ length: n }, (_, i) => i)
      .filter((i) => i !== anchor && !used.has(i) && angle(dir(i), dir(anchor)) < SPAN)
      .sort((a, b) => angle(dir(a), dir(anchor)) - angle(dir(b), dir(anchor)))
      .slice(0, 5);
    if (near.length < 3) continue;
    const stars = [anchor, ...near.sort((a, b) => field.sizes[b] - field.sizes[a])];
    // Prim's: grow the figure from its brightest star, always by the shortest line to a star not yet in it
    const lines: [number, number][] = [];
    const inFigure = new Set([anchor]);
    while (inFigure.size < stars.length) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const a of inFigure)
        for (const b of stars) {
          if (inFigure.has(b)) continue;
          const d = angle(dir(a), dir(b));
          if (d < bd) {
            bd = d;
            best = [a, b];
          }
        }
      lines.push(best!);
      inFigure.add(best![1]);
    }
    const sum = stars.reduce<V3>((s, i) => [s[0] + dir(i)[0], s[1] + dir(i)[1], s[2] + dir(i)[2]], [0, 0, 0]);
    const l = Math.hypot(...sum);
    for (const i of stars) used.add(i);
    out.push({ name: NAMES[out.length % NAMES.length], stars, lines, centre: [sum[0] / l, sum[1] / l, sum[2] / l] });
  }
  return out;
}

let figures: Constellation[] | null = null;
/** The constellations Telescope.tsx draws (found once). */
export const skyFigures = () => (figures ??= constellations());
