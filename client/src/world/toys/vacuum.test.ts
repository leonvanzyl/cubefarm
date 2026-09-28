import { describe, expect, it } from 'vitest';
import type { LooseDart } from './darts';
import { ROOMBA } from './roombaBrain';
import { PICKUP, countVacuumed, inPickup, toVacuum, vacuumedCount, vacuums } from './vacuum';

const dart = (id: number, x: number, z: number): LooseDart => ({ id, x, y: 0.03, z, color: '#3a86ff', q: { x: 0, y: 0, z: 0, w: 1 } });
const R = ROOMBA.r;

describe('inPickup', () => {
  it('is a plain radius test on the floor plane', () => {
    expect(inPickup(0, 0, { x: 0, z: 0 }, 0.2)).toBe(true);
    expect(inPickup(1, 1, { x: 1.19, z: 1 }, 0.2)).toBe(true);
    expect(inPickup(1, 1, { x: 1, z: 1.21 }, 0.2)).toBe(false);
  });
});

describe('toVacuum', () => {
  const darts = [dart(1, 0.1, 0), dart(2, 2, 2), dart(3, -0.05, 0.2), dart(4, 0, R + PICKUP.reach + 0.02)];

  it('picks up the darts under and just in front of a driving roomba', () => {
    expect(toVacuum('cleaning', 0, 0, darts, R).map((d) => d.id)).toEqual([1, 3]);
    expect(toVacuum('returning', 2, 2, darts, R).map((d) => d.id)).toEqual([2]);
  });

  it('reaches a little past its rim, where its bumper pushes darts', () => {
    expect(toVacuum('cleaning', 0, 0, [dart(5, R + 0.03, 0)], R)).toHaveLength(1);
  });

  it('leaves darts alone while it sits on its dock', () => {
    expect(vacuums('charging')).toBe(false);
    expect(toVacuum('charging', 0, 0, darts, R)).toEqual([]);
  });
});

describe('vacuumedCount', () => {
  it('counts up', () => {
    const before = vacuumedCount();
    countVacuumed();
    countVacuumed(2);
    expect(vacuumedCount() - before).toBe(3);
  });
});
