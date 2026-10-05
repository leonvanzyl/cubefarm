import { describe, expect, it } from 'vitest';
import { aiServe, aiShot, atContact, contactFor, landsIn, missChance, ratingOf, reachTo, REACH, READY, skillFor, standFor, swingPaddle } from './pongAi';
import { fromOwn, offLine, onHalf, otherEnd, ownFrame, solveShot, TABLE, type BallState, type End } from './pongPhysics';

const TOP = TABLE.top;

/** A small seeded random, so the numbers are the same every run. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A ball the player at `from` just hit towards the other end. */
function incoming(from: End, lat: number, speed: number, top = 100): BallState {
  const p = { ...fromOwn(from, 0.2, 0), y: TOP + 0.25 };
  const sol = solveShot(p, from, { target: onHalf(otherEnd(from), 0.9, lat), speed, top, side: 0 });
  return { p, v: sol.v, w: sol.w };
}

describe('skill', () => {
  it('everyone gets their own rating, the same every time, between 0.3 and 0.9', () => {
    const ids = ['ada', 'linus', 'grace', 'alan', 'margaret', 'dennis', 'sherlock', 'marple'];
    const ratings = ids.map(ratingOf);
    for (const r of ratings) expect(r).toBeGreaterThanOrEqual(0.3), expect(r).toBeLessThanOrEqual(0.9);
    expect(new Set(ratings).size).toBe(ids.length);
    expect(ratingOf('ada')).toBe(ratings[0]);
  });

  it('a better player reacts sooner, aims truer, misses less and moves quicker', () => {
    const lo = skillFor(0.3);
    const hi = skillFor(0.9);
    expect(hi.reaction).toBeLessThan(lo.reaction);
    expect(hi.aim).toBeLessThan(lo.aim);
    expect(hi.miss).toBeLessThan(lo.miss);
    expect(hi.move).toBeGreaterThan(lo.move);
  });

  it('fast, spun and out-of-reach balls are missed more', () => {
    const s = skillFor(0.6);
    const easy = { v: { x: 5, y: -1, z: 0 }, w: { x: 0, y: 0, z: 0 } };
    const base = missChance(s, easy);
    expect(missChance(s, { ...easy, v: { x: 11, y: -1, z: 0 } })).toBeGreaterThan(base);
    expect(missChance(s, { ...easy, w: { x: 0, y: 0, z: 350 } })).toBeGreaterThan(base);
    expect(missChance(s, easy, 0.3)).toBeGreaterThan(base + 0.3);
    expect(missChance(skillFor(0.9), easy)).toBeLessThan(missChance(skillFor(0.3), easy));
  });
});

describe('reading the ball', () => {
  it('finds where the ball meets them after it bounces on their half', () => {
    for (const lat of [-0.5, 0, 0.5]) {
      const b = incoming('east', lat, 6);
      const c = contactFor(b, 'west', false);
      expect(c, `lat ${lat}`).not.toBeNull();
      expect(atContact('west', c!.p, c!.v)).toBe(true);
      expect(ownFrame('west', c!.p.x, c!.p.z).back).toBeGreaterThan(-0.4);
      expect(c!.p.y).toBeGreaterThan(TOP);
      // standing for it puts it within reach of their forehand
      expect(reachTo('west', standFor('west', c!.p), c!.p)).toBeLessThan(REACH);
    }
  });

  it("doesn't go for a ball that won't come to them", () => {
    const long = { p: { ...fromOwn('east', 0.2, 0), y: TOP + 0.3 }, v: { x: -12, y: 2, z: 0 }, w: { x: 0, y: 0, z: 0 } };
    expect(contactFor(long, 'west', false)).toBeNull();
    const net = { p: { ...fromOwn('east', 0.2, 0), y: TOP + 0.1 }, v: { x: -6, y: -0.5, z: 0 }, w: { x: 0, y: 0, z: 0 } };
    expect(contactFor(net, 'west', false)).toBeNull();
  });

  it('stands ready behind the end, and swings the paddle back, through and forward', () => {
    const ready = fromOwn('west', READY.back, READY.lat);
    expect(standFor('west', null)).toEqual(ready);
    const c = { ...fromOwn('west', 0.1, 0.3), y: TOP + 0.3 };
    const before = swingPaddle('west', c, 1, 1.3);
    const at = swingPaddle('west', c, 1.3, 1.3);
    const after = swingPaddle('west', c, 1.55, 1.3);
    expect(ownFrame('west', before.x, before.z).back).toBeGreaterThan(ownFrame('west', at.x, at.z).back);
    expect(at).toMatchObject({ x: c.x, y: c.y, z: c.z });
    expect(ownFrame('west', after.x, after.z).back).toBeLessThan(ownFrame('west', at.x, at.z).back);
    expect(after.y).toBeGreaterThan(at.y);
  });
});

describe('returns', () => {
  /** How many of `n` returns by a player of `rating` land in, from contacts the ball really reaches. */
  function landed(rating: number, n: number, rand: () => number) {
    const s = skillFor(rating);
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const c = contactFor(incoming('east', (rand() * 2 - 1) * 0.55, 4.8 + rand() * 3), 'west', false)!;
      const { shot, wobble } = aiShot(s, 'west', c.p, rand);
      const sol = solveShot(c.p, 'west', shot);
      if (landsIn({ p: c.p, v: offLine(sol.v, wobble), w: sol.w }, 'west')) ok++;
    }
    return ok / n;
  }

  it('land in more often the better the player', () => {
    const rand = seeded(42);
    const casual = landed(0.3, 150, rand);
    const champ = landed(0.9, 150, rand);
    expect(champ).toBeGreaterThan(0.9);
    expect(casual).toBeLessThan(champ - 0.05);
    expect(casual).toBeGreaterThan(0.6);
  });

  it('serves land', () => {
    const rand = seeded(9);
    for (let i = 0; i < 20; i++) {
      for (const by of ['west', 'east'] as End[]) {
        const from = { ...fromOwn(by, 0.23, 0.1), y: TOP + 0.28 };
        const shot = aiServe(skillFor(0.95), by, rand);
        const sol = solveShot(from, by, shot);
        expect(landsIn({ p: from, v: sol.v, w: sol.w }, by, true)).toBe(true);
      }
    }
  });
});
