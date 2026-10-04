import { describe, expect, it } from 'vitest';
import { CLOUD_COUNT, CLOUD_REACH, CLOUD_WRAP, cloudScale, cloudZ, makeClouds, MAX_PUFFS, starField } from './skyLayout';

describe('makeClouds', () => {
  it('is the same sky every visit', () => {
    expect(makeClouds(7)).toEqual(makeClouds(7));
    expect(makeClouds(7)).not.toEqual(makeClouds(8));
  });

  it('makes a handful of puffy clouds on both sides of the building', () => {
    const clouds = makeClouds();
    expect(clouds).toHaveLength(CLOUD_COUNT);
    for (const c of clouds) {
      expect(c.puffs.length).toBeGreaterThanOrEqual(4);
      expect(c.puffs.length).toBeLessThanOrEqual(MAX_PUFFS);
      expect(c.y).toBeGreaterThan(5); // above the eye, in the sky
      expect(Math.abs(c.x)).toBeLessThan(CLOUD_REACH);
    }
    expect(clouds.some((c) => c.x < -20)).toBe(true); // seen from the west windows
    expect(clouds.some((c) => c.x > 20)).toBe(true); // and the east
  });

  it('keeps every puff inside the camera far plane (90) wherever the cloud drifts', () => {
    for (const c of makeClouds()) {
      for (let drift = 0; drift < 400; drift += 0.5) {
        const z = cloudZ(c, drift);
        const s = cloudScale(c.x, z);
        for (const p of c.puffs) {
          const px = c.x + p.dx * c.size * s;
          const py = c.y + p.dy * c.size * s;
          const pz = z + p.dz * c.size * s;
          expect(Math.hypot(px, py, pz) + p.r * c.size * s).toBeLessThan(90);
        }
      }
    }
  });
});

describe('cloud drift and wrap', () => {
  const [c] = makeClouds();

  it('drifts along the wind at its speed', () => {
    const a = cloudZ(c, 0);
    const b = cloudZ(c, 2);
    if (b > a) expect(b - a).toBeCloseTo(c.speed * 2, 9);
  });

  it('visibly moves within 10 seconds', () => {
    let moved = 0;
    for (let s = 0; s < 10; s += 0.5) moved += Math.abs(cloudZ(c, s + 0.5) - cloudZ(c, s)) % (2 * CLOUD_WRAP);
    expect(moved).toBeGreaterThan(5); // metres, ~5° of sky at 60 m
  });

  it('wraps around within [-CLOUD_WRAP, CLOUD_WRAP)', () => {
    for (let drift = 0; drift < 2000; drift += 3.7) {
      const z = cloudZ(c, drift);
      expect(z).toBeGreaterThanOrEqual(-CLOUD_WRAP);
      expect(z).toBeLessThan(CLOUD_WRAP);
    }
    const lap = (2 * CLOUD_WRAP) / c.speed;
    expect(cloudZ(c, 37 + lap)).toBeCloseTo(cloudZ(c, 37), 6);
  });

  it('only wraps where the cloud has already shrunk away', () => {
    expect(cloudScale(0, CLOUD_WRAP)).toBe(0);
    expect(cloudScale(0, -CLOUD_WRAP)).toBe(0);
    expect(cloudScale(20, 0)).toBe(1);
  });

  it('shrinks smoothly towards the edge of the sky', () => {
    let prev = 1;
    for (let d = 40; d <= CLOUD_REACH + 2; d += 0.5) {
      const s = cloudScale(d, 0);
      expect(s).toBeLessThanOrEqual(prev);
      expect(prev - s).toBeLessThan(0.08);
      prev = s;
    }
  });
});

describe('starField', () => {
  it('puts unit-length stars all round the sky, with sizes and phases', () => {
    const { positions, sizes, phases } = starField(500);
    expect(positions).toHaveLength(1500);
    let up = 0;
    for (let i = 0; i < 500; i++) {
      expect(Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])).toBeCloseTo(1, 5);
      if (positions[i * 3 + 1] > 0) up++;
      expect(sizes[i]).toBeGreaterThan(0);
      expect(phases[i]).toBeGreaterThanOrEqual(0);
    }
    expect(up).toBeGreaterThan(200);
    expect(up).toBeLessThan(300);
    expect(starField(500).positions).toEqual(positions);
  });
});
