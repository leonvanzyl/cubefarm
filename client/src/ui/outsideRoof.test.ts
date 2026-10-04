import { describe, expect, it } from 'vitest';
import { HALF_D } from '../world/layout';
import { roomAt, zoneAt } from './acoustics';
import { DOOR_LEVEL, outsideHearing, outsideLayers, ROOF_WIND } from './outsideMix';

// What it sounds like up on the roof: the outside ambience (outsideMix.ts) all round, clear and a little windier, and
// open-air acoustics (acoustics.ts) everywhere but the elevator cabin.

const shut = { west: 0, east: 0 };

describe('the outside on the roof', () => {
  it('is full and clear everywhere on the deck, side doors or not', () => {
    for (const [x, z] of [
      [0, 0],
      [-14, -10],
      [15, 11],
    ])
      expect(outsideHearing('roof', x, z, shut)).toEqual({ level: 1, clarity: 1, from: null });
  });

  it('comes in through the doorway when you stand in the elevator', () => {
    const h = outsideHearing('roof', 0, HALF_D + 1, shut);
    expect(h.level).toBe(DOOR_LEVEL);
    expect(h.clarity).toBeLessThan(1);
    expect(h.from).toEqual({ x: 0, z: HALF_D });
  });

  it('is windier than on a balcony, day and night, with the rest the same', () => {
    for (const t of [0, 0.3, 0.5, 0.76]) {
      const roof = outsideLayers(t, 'roof');
      const balcony = outsideLayers(t);
      expect(roof.wind).toBeCloseTo(balcony.wind * ROOF_WIND);
      expect({ ...roof, wind: 0 }).toEqual({ ...balcony, wind: 0 });
    }
  });
});

describe('the acoustics on the roof', () => {
  it('are open air on the whole deck, one space, and the cabin is still a metal box', () => {
    for (const [x, z] of [
      [0, 0],
      [-10, -10],
      [12, 8],
    ]) {
      expect(roomAt('roof', x, z)).toBe('outside');
      expect(zoneAt('roof', x, z)).toBe('floor');
    }
    expect(roomAt('roof', 0, HALF_D + 1)).toBe('cabin');
    expect(zoneAt('roof', 0, HALF_D + 1)).toBe('cabin');
  });
});
