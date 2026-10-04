import { describe, expect, it } from 'vitest';
import { HALF_D, HALF_W, SIDE_OPENINGS, WINDOW } from '../layout';
import { indoorLight } from './indoor';
import { PATCH_MAX, apertures, sunPatch, type Aperture } from './windowLight';

const out = new Float32Array(PATCH_MAX * 2);
const corners = (a: Aperture, dir: readonly [number, number, number]) => {
  const n = sunPatch(a, dir, out);
  return Array.from({ length: n }, (_, i) => [out[i * 2], out[i * 2 + 1]] as const);
};
const dirAt = (t: number) => [...indoorLight(t).dir] as [number, number, number];
const west = apertures('office').filter((a) => a.side === 'west');
const pane = west.find((a) => a.y0 > 0)!;
const door = west.find((a) => a.y0 === 0)!;

describe('apertures', () => {
  it('has both panes of every window and the door on each side wall', () => {
    for (const kind of ['office', 'lobby'] as const) {
      const { west: w, east: e } = SIDE_OPENINGS[kind];
      expect(apertures(kind)).toHaveLength(2 * (w.windows.length + e.windows.length) + 2);
    }
    for (const a of apertures('office')) {
      expect(a.z1).toBeGreaterThan(a.z0);
      expect(a.y1).toBeGreaterThan(a.y0);
      if (a.y0 > 0) expect(a.z1 - a.z0).toBeLessThan(WINDOW.w / 2);
    }
  });
});

describe('sunPatch', () => {
  it('lights nothing through the wall the sun is behind, nor through the side walls at noon', () => {
    const evening = dirAt(0.73);
    expect(evening[0]).toBeLessThan(0);
    for (const a of apertures('office').filter((a) => a.side === 'east')) expect(sunPatch(a, evening, out)).toBe(0);
    // due south at noon: at most a sliver along the wall
    for (const a of apertures('office')) for (const [x] of corners(a, dirAt(0.5))) expect(HALF_W - Math.abs(x)).toBeLessThan(0.01);
    expect(sunPatch(pane, [-0.5, 0, 0.5], out)).toBe(0);
  });

  it('lands golden-hour light from the west windows on the floor, a sill-height throw in from the wall', () => {
    const d = dirAt(0.73);
    const c = corners(pane, d);
    expect(c.length).toBeGreaterThanOrEqual(3);
    for (const [x, z] of c) {
      expect(Math.abs(x)).toBeLessThanOrEqual(HALF_W + 1e-4);
      expect(Math.abs(z)).toBeLessThanOrEqual(HALF_D + 1e-4);
    }
    const nearest = Math.min(...c.map(([x]) => x));
    expect(nearest).toBeCloseTo(-HALF_W - (d[0] * pane.y0) / d[1], 4);
    // the door's light starts at the wall
    expect(Math.min(...corners(door, d).map(([x]) => x))).toBeCloseTo(-HALF_W, 4);
  });

  it('stretches further into the room as the sun goes down', () => {
    const reach = (t: number) => Math.max(...corners(pane, dirAt(t)).map(([x]) => x));
    expect(reach(0.73)).toBeGreaterThan(reach(0.7));
    expect(reach(0.7)).toBeGreaterThan(reach(0.66));
  });

  it('clips a patch that runs past the floor to the far wall', () => {
    const c = corners(pane, [-0.999, 0.04, 0]);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c.length).toBeLessThanOrEqual(PATCH_MAX);
    expect(Math.max(...c.map(([x]) => x))).toBeCloseTo(HALF_W, 4);
  });

  it('lights the east windows in the morning', () => {
    const east = apertures('office').filter((a) => a.side === 'east' && a.y0 > 0);
    for (const a of east) expect(sunPatch(a, dirAt(0.3), out)).toBeGreaterThanOrEqual(3);
  });
});
