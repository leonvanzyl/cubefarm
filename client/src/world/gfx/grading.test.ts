import { describe, expect, it } from 'vitest';
import { AFTERNOON_T, SUNSET_T } from '../sky/time';
import { bloomAt, gradeAt } from './grading';

const NOON = 0.5;
const GOLDEN = 0.73;
const NIGHT = 0.02;
const luma = (g: { r: number; g: number; b: number }) => 0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b;

describe('gradeAt', () => {
  it('leaves noon and the afternoon untouched', () => {
    for (const t of [NOON, AFTERNOON_T]) {
      const g = gradeAt(t);
      for (const tint of [g.shadows, g.highlights]) {
        expect(tint.r).toBeCloseTo(1, 6);
        expect(tint.g).toBeCloseTo(1, 6);
        expect(tint.b).toBeCloseTo(1, 6);
      }
      expect(g.saturation).toBeCloseTo(1, 6);
      expect(g.contrast).toBeCloseTo(1, 6);
    }
  });

  it('warms golden hour and sunset', () => {
    for (const t of [GOLDEN, SUNSET_T]) {
      const g = gradeAt(t);
      expect(g.highlights.r).toBeGreaterThan(1);
      expect(g.highlights.b).toBeLessThan(1);
      expect(g.saturation).toBeGreaterThan(1);
    }
  });

  it('cools the shadows towards blue at night and leaves the lamplight alone', () => {
    const g = gradeAt(NIGHT);
    expect(g.shadows.b).toBeGreaterThan(1);
    expect(g.shadows.b).toBeGreaterThan(g.shadows.r);
    for (const v of [g.highlights.r, g.highlights.g, g.highlights.b]) expect(v).toBeCloseTo(1, 6);
    expect(g.saturation).toBeLessThan(1);
  });

  it('only tints: the white balance never brightens or darkens the picture', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const g = gradeAt(t);
      expect(luma(g.shadows)).toBeCloseTo(1, 6);
      expect(luma(g.highlights)).toBeCloseTo(1, 6);
    }
  });

  it('stays subtle and finite all day', () => {
    for (let t = 0; t < 1; t += 0.005) {
      const g = gradeAt(t);
      for (const v of [g.shadows.r, g.shadows.g, g.shadows.b, g.highlights.r, g.highlights.g, g.highlights.b]) expect(Math.abs(v - 1)).toBeLessThan(0.15);
      expect(g.saturation).toBeGreaterThan(0.9);
      expect(g.saturation).toBeLessThan(1.12);
      expect(g.contrast).toBeGreaterThanOrEqual(1);
      expect(g.contrast).toBeLessThan(1.06);
    }
  });

  it('fills `out` instead of allocating', () => {
    const out = { shadows: { r: 0, g: 0, b: 0 }, highlights: { r: 0, g: 0, b: 0 }, saturation: 0, contrast: 0 };
    expect(gradeAt(NIGHT, out)).toBe(out);
    expect(out.shadows.b).toBeGreaterThan(1);
  });
});

describe('bloomAt', () => {
  it('is faint and picky by day so daylight stays clean', () => {
    const day = bloomAt(NOON);
    const night = bloomAt(NIGHT);
    expect(day.intensity).toBeLessThan(0.5);
    expect(day.threshold).toBeGreaterThan(0.75);
    expect(night.intensity).toBeGreaterThan(1);
    expect(night.threshold).toBeLessThan(day.threshold);
  });

  it('eases through dusk', () => {
    const vals = [0.7, 0.74, 0.77, 0.8].map((t) => bloomAt(t).intensity);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
  });
});
