import { beforeAll, describe, expect, it } from 'vitest';
import { HOOP, hoopSquare } from './hoopScore';
import { chargeWindow, loadPhysics, shoot } from './throwSim';

// Free-throw distance and either side of it, straight on and from 30° round, aiming at the painted square.
const SPOTS = [3, 4, 5].flatMap((distance) => [0, 30].map((angle) => ({ distance, angle })));

/** A small seeded generator (mulberry32) and normal samples from it, so the casual player is the same every run. */
function rng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()) };
}

beforeAll(() => loadPhysics());

describe('basketball throws (Rapier)', () => {
  it('used to fall short of the rim when aimed at the painted square, however long it was charged', () => {
    const throwSpeed = HOOP.ball.throwSpeed;
    HOOP.ball.throwSpeed = 8.5; // before #67
    try {
      for (const spot of SPOTS) expect(chargeWindow({ ...spot, plain: true }, 10).width).toBe(0);
    } finally {
      HOOP.ball.throwSpeed = throwSpeed;
    }
  });

  it('scores from 3 to 5 m, straight on and at 30°, with a charge window of at least 150 ms', () => {
    for (const spot of SPOTS) {
      const w = chargeWindow(spot);
      expect(w.width, `${spot.distance} m at ${spot.angle}°`).toBeGreaterThanOrEqual(150);
      // a mid-length charge, not a tap and not "hold it as long as you can"
      expect(w.from).toBeGreaterThan(400);
      expect(w.to).toBeLessThan(900);
    }
  });

  it('still needs the right charge: a tap falls short, and a full charge flies long (bar the odd lucky bank shot)', () => {
    for (const spot of SPOTS) expect(shoot({ ...spot, chargeMs: 100 }).scored).toBe(false);
    expect(SPOTS.filter((spot) => shoot({ ...spot, chargeMs: 1000 }).scored).length).toBeLessThanOrEqual(2);
  });

  it("doesn't help a throw aimed away from the hoop", () => {
    const sq = hoopSquare('office');
    const wide = { ...sq, x: sq.x + 1.5 };
    expect(chargeWindow({ distance: 4, angle: 0, aim: wide }, 10).width).toBe(0);
  });

  it('lets a casual player from the free-throw line score about one throw in three', () => {
    // Someone who has found roughly the right charge: their hold time wanders by 220 ms either way and their aim by 3°.
    const { from, to } = chargeWindow({ distance: 4, angle: 0 });
    const sq = hoopSquare('office');
    const r = rng(67);
    const tries = 300;
    let baskets = 0;
    for (let i = 0; i < tries; i++) {
      const aimOff = 4 * Math.tan((3 * Math.PI) / 180);
      const aim = { x: sq.x + r.normal() * aimOff, y: sq.y + r.normal() * aimOff, z: sq.z };
      if (shoot({ distance: 4, angle: 0, aim, chargeMs: (from + to) / 2 + r.normal() * 220 }).scored) baskets++;
    }
    const rate = baskets / tries;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.65);
  });
});
