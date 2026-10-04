import { describe, expect, it } from 'vitest';
import { cacheLabel, clampKeepDays } from './voiceClips.ts';

describe('clampKeepDays', () => {
  it('is a whole number of days from 1 to 90, 7 when unreadable', () => {
    expect(clampKeepDays(14)).toBe(14);
    expect(clampKeepDays('30')).toBe(30);
    expect(clampKeepDays(3.6)).toBe(4);
    expect(clampKeepDays(0)).toBe(1);
    expect(clampKeepDays(-5)).toBe(1);
    expect(clampKeepDays(365)).toBe(90);
    expect(clampKeepDays('lots')).toBe(7);
    expect(clampKeepDays('')).toBe(7);
    expect(clampKeepDays(undefined)).toBe(7);
    expect(clampKeepDays(null)).toBe(7);
  });
});

describe('cacheLabel', () => {
  it('counts the clips and their size', () => {
    expect(cacheLabel(12, 3.4 * 1024 * 1024)).toBe('12 clips · 3.4 MB');
    expect(cacheLabel(1, 40_000)).toBe('1 clip · 39 KB');
    expect(cacheLabel(1, 100)).toBe('1 clip · 1 KB');
    expect(cacheLabel(0, 0)).toBe('0 clips · 0 KB');
  });
});
