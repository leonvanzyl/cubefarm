import { describe, expect, it } from 'vitest';
import { FILTER_LABELS, FILTERS, GRADES, isFilter, needsGrade } from './filters';

describe('photo filters', () => {
  it('has a label and a grade for every filter', () => {
    for (const f of FILTERS) {
      expect(FILTER_LABELS[f]).toBeTruthy();
      expect(GRADES[f]).toBeTruthy();
    }
  });

  it("leaves the picture alone with 'none', and every other filter changes it", () => {
    expect(needsGrade(GRADES.none)).toBe(false);
    for (const f of FILTERS.filter((x) => x !== 'none')) expect(needsGrade(GRADES[f])).toBe(true);
  });

  it('keeps every grade in a sane range', () => {
    for (const f of FILTERS) {
      const g = GRADES[f];
      expect(g.saturation).toBeGreaterThanOrEqual(0);
      expect(g.saturation).toBeLessThanOrEqual(1.6);
      expect(g.contrast).toBeGreaterThan(0.8);
      expect(g.contrast).toBeLessThan(1.3);
      for (const v of g.gain) expect(v).toBeGreaterThan(0.6);
      for (const v of g.lift) expect(v).toBeLessThan(0.1);
      expect(g.vignette).toBeLessThanOrEqual(0.6);
      expect(g.grain).toBeLessThanOrEqual(0.1);
    }
  });

  it('only the polaroid has a frame, black & white has no colour, and the comic inks its edges', () => {
    expect(FILTERS.filter((f) => GRADES[f].frame)).toEqual(['polaroid']);
    expect(GRADES.mono.saturation).toBe(0);
    expect(GRADES.comic.ink).toBeGreaterThan(0);
    expect(GRADES.comic.posterize).toBeGreaterThan(1);
  });

  it('recognises filter names', () => {
    expect(isFilter('warm')).toBe(true);
    expect(isFilter('sepia')).toBe(false);
  });
});
