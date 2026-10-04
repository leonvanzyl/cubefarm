import { describe, expect, it } from 'vitest';
import { HALF_D, HALF_W, WALL_H } from '../layout';
import { indoorLight, MIN_ELEVATION, newIndoorLight, shadowBox, type IndoorLight } from './indoor';
import { skyAt, sunDirection } from './time';

const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
/** Roughly how much fill light reaches a character's face (hemisphere + ambient, through the exposure). */
const fill = (l: IndoorLight) => {
  const [r, g, b] = rgb(l.hemiSky);
  return ((l.hemiIntensity * (r + g + b)) / 765 + l.ambient) * l.exposure;
};
const sample = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe('indoorLight', () => {
  it('lights noon from high above with the neutral sun and the lamps off', () => {
    const l = indoorLight(0.5);
    expect(l.dir[1]).toBeGreaterThan(0.8);
    expect(l.keyIntensity).toBeCloseTo(skyAt(0.5).sunIntensity, 5);
    expect(l.keyColor).toBe(0xffffff);
    expect(l.lamps).toBe(0);
    expect(l.exposure).toBe(1);
  });

  it('keeps the afternoon as the office looked before the clock', () => {
    const l = indoorLight(0.6);
    expect(l.keyIntensity).toBeCloseTo(1.55, 5);
    expect(l.hemiSky).toBe(0xfffaf0);
    expect(l.hemiGround).toBe(0xa48a6a);
    expect(l.hemiIntensity).toBe(0.95);
    expect(l.ambient).toBeCloseTo(0.18, 5);
  });

  it('casts long, warm shadows from the west at golden hour', () => {
    const l = indoorLight(0.73);
    expect(l.dir[0]).toBeLessThan(-0.9); // the sun sets in the west (−x)
    expect(l.dir[1]).toBe(MIN_ELEVATION);
    const [r, , b] = rgb(l.keyColor);
    expect(r - b).toBeGreaterThan(80);
    expect(l.keyIntensity).toBeGreaterThan(0.8);
    expect(l.lamps).toBeLessThan(0.05);
  });

  it('swaps in a faint, cool moon at night, with the lamps on and a warm fill', () => {
    for (const t of [0.85, 0.95, 0.05]) {
      const l = indoorLight(t);
      expect(sunDirection(t)[1]).toBeLessThan(0);
      expect(l.dir[1]).toBeGreaterThanOrEqual(MIN_ELEVATION);
      expect(l.keyIntensity).toBeLessThan(0.4);
      const [kr, , kb] = rgb(l.keyColor);
      expect(kb).toBeGreaterThan(kr);
      expect(l.lamps).toBe(1);
      const [hr, , hb] = rgb(l.hemiSky);
      expect(hr).toBeGreaterThan(hb);
      expect(l.ambient).toBeGreaterThan(indoorLight(0.5).ambient);
    }
  });

  it('switches the lamps on through dusk and off through dawn', () => {
    let prev = 0;
    for (let t = 0.7; t <= 0.85; t += 0.001) {
      const l = indoorLight(t).lamps;
      expect(l).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = l;
    }
    expect(indoorLight(0.76).lamps).toBeGreaterThan(0.2);
    expect(indoorLight(0.3).lamps).toBe(0);
  });

  it('is never too dark to play', () => {
    const noon = fill(indoorLight(0.5));
    for (const t of sample(400)) expect(fill(indoorLight(t))).toBeGreaterThan(noon * 0.75);
  });

  it('keeps the key a unit vector at least MIN_ELEVATION up', () => {
    for (const t of sample(400)) {
      const [x, y, z] = indoorLight(t).dir;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
      expect(y).toBeGreaterThanOrEqual(MIN_ELEVATION - 1e-12);
    }
  });

  it('changes smoothly, and the sun hands over to the moon only while the key is dark', () => {
    const step = 1e-4;
    let prev = indoorLight(0);
    for (let i = 1; i <= 1 / step; i++) {
      const l = indoorLight(i * step);
      for (const k of ['keyIntensity', 'hemiIntensity', 'ambient', 'exposure', 'lamps'] as const) expect(Math.abs(l[k] - prev[k])).toBeLessThan(0.02);
      for (const k of ['keyColor', 'hemiSky', 'hemiGround', 'ambientColor'] as const) {
        const a = rgb(l[k]);
        const b = rgb(prev[k]);
        for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThanOrEqual(3);
      }
      const jump = Math.hypot(l.dir[0] - prev.dir[0], l.dir[1] - prev.dir[1], l.dir[2] - prev.dir[2]);
      if (jump > 0.01) expect(Math.max(l.keyIntensity, prev.keyIntensity)).toBeLessThan(0.01);
      prev = l;
    }
  });

  it('fills the given object instead of allocating', () => {
    const out = newIndoorLight();
    expect(indoorLight(0.4, out)).toBe(out);
  });
});

describe('shadowBox', () => {
  const DIST = 30;
  /** A point's coordinates in the light camera's space (three's lookAt from dir * DIST to the origin, +y up). */
  function toLight(dir: readonly number[], p: number[]) {
    const [zx, zy, zz] = dir;
    const l = Math.hypot(zz, zx);
    const x = [zz / l, 0, -zx / l];
    const y = [zy * x[2], zz * x[0] - zx * x[2], -zy * x[0]];
    const dot = (a: number[]) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
    return [dot(x), dot(y), DIST - dot(dir as number[])];
  }

  it('covers the whole floor up to the ceiling, and no more than a margin round it, at any time of day', () => {
    for (const t of sample(97)) {
      const { dir } = indoorLight(t);
      const b = shadowBox(dir, DIST);
      expect(b.near).toBeGreaterThan(0);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const x of [-HALF_W, HALF_W])
        for (const y of [0, WALL_H])
          for (const z of [-HALF_D, HALF_D]) {
            const q = toLight(dir, [x, y, z]);
            expect(q[0]).toBeGreaterThanOrEqual(b.left);
            expect(q[0]).toBeLessThanOrEqual(b.right);
            expect(q[1]).toBeGreaterThanOrEqual(b.bottom);
            expect(q[1]).toBeLessThanOrEqual(b.top);
            expect(q[2]).toBeGreaterThanOrEqual(b.near);
            expect(q[2]).toBeLessThanOrEqual(b.far);
            for (let i = 0; i < 3; i++) {
              lo[i] = Math.min(lo[i], q[i]);
              hi[i] = Math.max(hi[i], q[i]);
            }
          }
      // tight: within the 0.5 m margin of the floor's own extent
      expect(lo[0] - b.left).toBeLessThan(0.75);
      expect(b.right - hi[0]).toBeLessThan(0.75);
      expect(lo[1] - b.bottom).toBeLessThan(0.75);
      expect(b.top - hi[1]).toBeLessThan(0.75);
    }
  });
});
