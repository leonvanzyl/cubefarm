import { describe, expect, it } from 'vitest';
import { lobbyColliders, officeColliders } from '../layout';
import { clear } from '../toys/roombaBrain';
import { findPath, standable, walkways, type FloorKind } from '../walkways';
import { EGG_COUNT, EGG_R, REACH, eggShare, eggsFor, hidingPlaces } from './eggs';
import { decorColliders } from './themes';

const KINDS: FloorKind[] = ['office', 'lobby'];

/** A spot within reach of (x, z) where a person can stand and that they can walk to from the elevator. */
function reachableFrom(kind: FloorKind, x: number, z: number) {
  const w = walkways(kind);
  const from = w.spots.find((s) => s.id === 'elevator')!;
  for (let a = 0; a < 16; a++) {
    for (const d of [0.5, 0.8, REACH]) {
      const p = { x: x + Math.cos((a / 16) * Math.PI * 2) * d, z: z + Math.sin((a / 16) * Math.PI * 2) * d };
      if (standable(w, p.x, p.z) && findPath(w, from, p)) return true;
    }
  }
  return false;
}

describe('hidingPlaces', () => {
  it.each(KINDS)('every %s hiding place is clear of everything and within reach of the elevator', (kind) => {
    const places = hidingPlaces(kind);
    expect(places.length).toBeGreaterThan(30);
    const rects = [...(kind === 'office' ? officeColliders() : lobbyColliders()), ...decorColliders('easter', kind)];
    // a sample, so the walk check stays quick
    for (const p of places.filter((_, i) => i % 7 === 0)) {
      expect(clear(rects, p.x, p.z, EGG_R), `${p.x},${p.z} overlaps something`).toBe(true);
      expect(reachableFrom(kind, p.x, p.z), `${p.x},${p.z} is out of reach`).toBe(true);
    }
  });
});

describe('eggsFor', () => {
  it.each([[[]], [[1]], [[1, 2]], [[1, 2, 3, 4, 5]]])('hides 12 eggs across the lobby and floors %j', (floors) => {
    const eggs = eggsFor('2026-04-05', floors);
    expect(eggs).toHaveLength(EGG_COUNT);
    expect(new Set(eggs.map((e) => e.id)).size).toBe(EGG_COUNT);
    const share = eggShare(floors);
    for (const [floor, n] of share) expect(eggs.filter((e) => e.floor === floor), `floor ${floor}`).toHaveLength(n);
    for (const e of eggs) {
      expect([0, ...floors]).toContain(e.floor);
      const places = hidingPlaces(e.floor === 0 ? 'lobby' : 'office');
      expect(places.some((p) => p.x === e.x && p.z === e.z), e.id).toBe(true);
    }
  });

  it('shares them out: a third in the lobby, the rest over the office floors', () => {
    expect([...eggShare([])]).toEqual([[0, 12]]);
    expect([...eggShare([1])]).toEqual([[0, 4], [1, 8]]);
    expect([...eggShare([2, 1])]).toEqual([[0, 4], [1, 4], [2, 4]]);
    expect([...eggShare([1, 2, 3])].map(([, n]) => n).reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('is the same all day in every browser, and a fresh set the next day', () => {
    const today = eggsFor('2026-04-05', [1, 2]);
    expect(eggsFor('2026-04-05', [1, 2])).toEqual(today);
    const tomorrow = eggsFor('2026-04-06', [1, 2]);
    expect(tomorrow.map((e) => `${e.x},${e.z}`)).not.toEqual(today.map((e) => `${e.x},${e.z}`));
  });

  it('spreads the eggs on a floor out', () => {
    const eggs = eggsFor('2027-03-28', [1]);
    for (const floor of [0, 1]) {
      const on = eggs.filter((e) => e.floor === floor);
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) expect(Math.hypot(on[i].x - on[j].x, on[i].z - on[j].z)).toBeGreaterThanOrEqual(0.5);
    }
  });
});
