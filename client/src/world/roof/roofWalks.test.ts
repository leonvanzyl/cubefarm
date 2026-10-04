import { describe, expect, it } from 'vitest';
import {
  collide,
  DECK_CHAIRS,
  DECKING,
  deckChairFront,
  ELEVATOR,
  floorElevation,
  FLOOR_HEIGHT,
  GRILL,
  HALF_D,
  HELIPAD,
  PLAYER_RADIUS,
  PICNIC,
  ROOF,
  ROOF_EDGE,
  roofColliders,
  roofElevation,
  shellColliders,
  SPAWN,
  surfaceAt,
  TELESCOPE,
  viewElevation,
  type Rect,
} from '../layout.ts';
import { CALL_SPOTS, findRoofPath, LIFT } from './roofWalks.ts';

const rects = roofColliders();
const overlaps = (p: { x: number; z: number }, r = PLAYER_RADIUS) => rects.some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r);

describe('the roof terrace', () => {
  it('is always the stop above the top floor', () => {
    expect(roofElevation(0)).toBe(FLOOR_HEIGHT); // over the lobby when there are no floors yet
    for (const top of [1, 3, 9]) expect(roofElevation(top)).toBeCloseTo(floorElevation(top) + FLOOR_HEIGHT);
    expect(viewElevation(ROOF, 4)).toBe(roofElevation(4));
    expect(viewElevation(2, 4)).toBe(floorElevation(2));
  });

  it('has a railing all round: walking any way from the middle, you never get past it', () => {
    const { x: X, z: Z, t: T } = ROOF_EDGE;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      let p = { x: 0, z: 0 };
      for (let i = 0; i < 400; i++) p = collide(p.x + Math.cos(a) * 0.1, p.z + Math.sin(a) * 0.1, rects);
      const inCabin = Math.abs(p.x) < ELEVATOR.cabinHalf && p.z > HALF_D;
      expect(Math.abs(p.x)).toBeLessThanOrEqual(X - T - PLAYER_RADIUS + 1e-6);
      if (!inCabin) expect(Math.abs(p.z)).toBeLessThanOrEqual(Z - T - PLAYER_RADIUS + 1e-6);
      else expect(p.z).toBeLessThan(HALF_D + ELEVATOR.depth);
    }
  });

  it('opens the elevator onto it through the same doorway and cabin as every floor', () => {
    const cabin = (r: Rect[]) => r.filter((b) => b.minZ >= HALF_D && b.maxZ > HALF_D + 1).map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ }));
    expect(cabin(rects)).toEqual(cabin(shellColliders('office')));
    expect(overlaps({ x: 0, z: HALF_D + 0.9 })).toBe(false); // you can step into the cabin
    expect(overlaps(SPAWN)).toBe(false); // and out of it onto the roof
  });

  it('keeps the helipad clear for a landing', () => {
    for (const b of rects) {
      const cx = Math.max(b.minX, Math.min(HELIPAD.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(HELIPAD.z, b.maxZ));
      expect(Math.hypot(cx - HELIPAD.x, cz - HELIPAD.z)).toBeGreaterThan(HELIPAD.r);
    }
  });

  it('leaves room to stand in front of every deck chair, the telescope and the grill', () => {
    for (let i = 0; i < DECK_CHAIRS.xs.length; i++) expect(overlaps(deckChairFront(i))).toBe(false);
    expect(overlaps({ x: TELESCOPE.x, z: TELESCOPE.z + 1.05 })).toBe(false);
    expect(overlaps({ x: GRILL.x - 1.1, z: GRILL.z })).toBe(false);
  });

  it('lets visitors walk from the elevator to every chair and the CEO to the railing', () => {
    expect(overlaps(LIFT)).toBe(false);
    for (let i = 0; i < DECK_CHAIRS.xs.length; i++) expect(findRoofPath(LIFT, deckChairFront(i))).not.toBeNull();
    for (const s of CALL_SPOTS) {
      expect(overlaps(s)).toBe(false);
      expect(findRoofPath(LIFT, s)).not.toBeNull();
    }
    // between the call spots it's a straight walk
    expect(findRoofPath(CALL_SPOTS[0], CALL_SPOTS[1])).toHaveLength(1);
  });

  it('sounds like wood on the decking and paving everywhere else', () => {
    expect(surfaceAt('roof', (DECKING.minX + DECKING.maxX) / 2, PICNIC.z)).toBe('wood');
    expect(surfaceAt('roof', HELIPAD.x, HELIPAD.z)).toBe('lobby');
    expect(surfaceAt('roof', 0, HALF_D + 1)).toBe('cabin');
  });
});
