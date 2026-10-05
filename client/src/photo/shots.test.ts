import { describe, expect, it } from 'vitest';
import { caption, clockTime, fileName, MAX_PIXELS, MAX_SIDE, overBudget, shotSize, slug, tiles } from './shots';

describe('shot size', () => {
  it('is the screen in real pixels, times the scale', () => {
    expect(shotSize(1280, 720, 1, 1)).toEqual({ width: 1280, height: 720, scale: 1 });
    expect(shotSize(1280, 720, 1, 2)).toEqual({ width: 2560, height: 1440, scale: 2 });
    expect(shotSize(1280, 720, 1.5, 2)).toEqual({ width: 3840, height: 2160, scale: 2 });
  });

  it('shrinks a 4× shot of a big screen to what a canvas can hold', () => {
    const s = shotSize(2560, 1440, 2, 4);
    expect(s.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(s.width * s.height).toBeLessThanOrEqual(MAX_PIXELS * 1.001);
    expect(s.scale).toBeLessThan(4);
    expect(s.width / s.height).toBeCloseTo(2560 / 1440, 2);
  });
});

describe('tiles', () => {
  /** Every pixel of the shot is covered exactly once. */
  const coverage = (w: number, h: number, list: ReturnType<typeof tiles>) => {
    const seen = new Uint8Array(w * h);
    for (const t of list) for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) seen[y * w + x]++;
    return seen.every((n) => n === 1);
  };

  it('is a single render when the shot fits the canvas', () => {
    expect(tiles(1280, 720, 1280, 720, 16)).toEqual([{ x: 0, y: 0, w: 1280, h: 720, viewX: 0, viewY: 0 }]);
  });

  it('covers a 2× shot exactly once, each part inside its render with the margin round it', () => {
    const list = tiles(2560, 1440, 1280, 720, 16);
    expect(coverage(2560, 1440, list)).toBe(true);
    for (const t of list) {
      expect(t.x - t.viewX).toBe(16);
      expect(t.y - t.viewY).toBe(16);
      expect(t.x + t.w).toBeLessThanOrEqual(t.viewX + 1280);
      expect(t.y + t.h).toBeLessThanOrEqual(t.viewY + 720);
    }
  });

  it('works for odd sizes and no margin', () => {
    expect(coverage(1001, 333, tiles(1001, 333, 400, 300, 0))).toBe(true);
    expect(coverage(1001, 333, tiles(1001, 333, 400, 300, 7))).toBe(true);
  });

  it('caps the margin so tiles always make progress', () => {
    const list = tiles(500, 500, 40, 40, 1000);
    expect(coverage(500, 500, list)).toBe(true);
    expect(list.length).toBeLessThan(2000);
  });
});

describe('names and words', () => {
  it('names files safely, with the place and the time', () => {
    const at = new Date(2026, 9, 5, 14, 3, 22);
    expect(fileName('acme/web', at, 'png')).toBe('cubefarm-acme-web-2026-10-05-140322.png');
    expect(fileName('???', at, 'webm')).toBe('cubefarm-office-2026-10-05-140322.webm');
    expect(slug('A'.repeat(100)).length).toBe(40);
  });

  it('captions the floor and the date', () => {
    const at = new Date(2026, 9, 5);
    expect(caption('acme/web', 2, at)).toBe('acme/web · Floor 2 · 5 Oct 2026');
    expect(caption('Initech', 0, at)).toBe('Initech · Lobby · 5 Oct 2026');
  });

  it('shows the day phase as a clock time', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(0.5)).toBe('12:00');
    expect(clockTime(0.73)).toBe('17:31');
    expect(clockTime(0.99999)).toBe('00:00');
  });
});

describe('gallery budget', () => {
  it('drops the oldest until the rest fit, but never the newest', () => {
    const items = [
      { id: 1, bytes: 80 },
      { id: 2, bytes: 80 },
      { id: 3, bytes: 80 },
    ];
    expect(overBudget(items, 200)).toEqual([1]);
    expect(overBudget(items, 240)).toEqual([]);
    expect(overBudget(items, 10)).toEqual([1, 2]);
    expect(overBudget([{ id: 9, bytes: 999 }], 10)).toEqual([]);
  });
});
