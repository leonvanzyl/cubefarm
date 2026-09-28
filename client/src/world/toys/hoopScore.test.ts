import { describe, expect, it } from 'vitest';
import { HALF_D } from '../layout';
import { HOOP, hoopRim, newTrack, stepHoop, type Rim, type Vec3 } from './hoopScore';

const rim: Rim = { x: 0, y: 2.7, z: 0, r: 0.23 };

/** Run a path of ball centres through a fresh track; returns how many baskets it scored. */
function baskets(path: Vec3[], track = newTrack()) {
  let n = 0;
  for (const p of path) if (stepHoop(track, p, rim)) n++;
  return n;
}

/** Points from a to b in `steps` even steps (both ends included). */
function line(a: Vec3, b: Vec3, steps = 20): Vec3[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps }));
}

describe('stepHoop', () => {
  it('counts a ball falling straight down through the rim exactly once', () => {
    expect(baskets([...line({ x: 0, y: 3.5, z: 0 }, { x: 0, y: 0.12, z: 0 }), ...line({ x: 0, y: 0.12, z: 0 }, { x: 0, y: 1.2, z: 0 }, 5)])).toBe(1);
  });

  it('counts a swish on an arc, and a fast step that jumps over the rim plane', () => {
    expect(baskets(line({ x: 0, y: 3.2, z: -0.6 }, { x: 0, y: 2.2, z: 0.3 }))).toBe(1);
    expect(baskets([{ x: 0.05, y: 2.9, z: 0 }, { x: -0.05, y: 2.4, z: 0.1 }])).toBe(1);
  });

  it("doesn't count rim-outs or backboard misses that fall outside the rim", () => {
    // off the front of the rim, then down in front of it
    expect(baskets([...line({ x: 0, y: 3.2, z: -1.5 }, { x: 0, y: 2.78, z: -0.3 }, 8), ...line({ x: 0, y: 2.78, z: -0.3 }, { x: 0, y: 0.12, z: -0.6 })])).toBe(0);
    // off the backboard above the rim, dropping beside it
    expect(baskets(line({ x: 0.4, y: 3.1, z: 0.3 }, { x: 0.45, y: 0.12, z: -0.2 }))).toBe(0);
  });

  it("doesn't count a ball pushed up through the net from below, or it falling back in", () => {
    const track = newTrack();
    expect(baskets(line({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 3.0, z: 0 }), track)).toBe(0);
    expect(baskets(line({ x: 0, y: 3.0, z: 0 }, { x: 0, y: 1.5, z: 0 }), track)).toBe(0);
  });

  it('scores again once the ball has left the rim and comes back from above', () => {
    const track = newTrack();
    expect(baskets(line({ x: 0, y: 3.2, z: 0 }, { x: 0, y: 2.0, z: 0 }), track)).toBe(1);
    // bounce straight back up through the net and down: still only one
    expect(baskets([...line({ x: 0, y: 2.0, z: 0 }, { x: 0, y: 2.9, z: 0 }, 6), ...line({ x: 0, y: 2.9, z: 0 }, { x: 0, y: 2.0, z: 0 }, 6)], track)).toBe(0);
    // rolls away, gets carried back and thrown in again
    expect(baskets(line({ x: 0, y: 2.0, z: 0 }, { x: 0, y: 0.12, z: 2 }), track)).toBe(0);
    expect(baskets([...line({ x: 0, y: 1.2, z: 3 }, { x: 0, y: 3.4, z: -0.2 }), ...line({ x: 0, y: 3.4, z: -0.2 }, { x: 0, y: 2.2, z: 0 })], track)).toBe(1);
  });

  it('ignores a respawn that teleports the ball across the rim', () => {
    expect(baskets([{ x: 0, y: 5, z: 0 }, { x: 0, y: 0.12, z: 0 }])).toBe(0);
  });
});

describe('hoopRim', () => {
  it('hangs the rim at about 2.7 m, sticking out from the south wall, clear of the backboard', () => {
    for (const floor of ['office', 'lobby'] as const) {
      const r = hoopRim(floor);
      expect(r.y).toBeCloseTo(2.7);
      expect(r.z).toBeLessThan(HALF_D - HOOP.standoff - HOOP.board.t - r.r);
      expect(r.r).toBeGreaterThan(HOOP.ball.r + HOOP.rim.tube);
    }
    expect(hoopRim('office').x).toBeCloseTo(10.5);
    expect(hoopRim('lobby').x).toBeCloseTo(-9);
  });
});
