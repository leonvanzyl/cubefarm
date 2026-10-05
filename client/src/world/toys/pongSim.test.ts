import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { finalScore } from '../../../../shared/pong';
import { forecast, fromOwn, spinFor, TABLE, type BallState, type V3 } from './pongPhysics';
import type { PongSim } from './pongSim';

// The match runner (pongRunner.ts) on real Rapier physics, with the table, net and floor the toy world has. Sounds
// and the gong are mocked (they need a browser), as in store.test.ts.
vi.mock('../../ui/sfx', () => ({ audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn(), noise: vi.fn(), tone: vi.fn() }));
vi.mock('../gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));

const { flyRapier, loadPhysics, pongSim } = await import('./pongSim');
const { autopilot, claimSeat, joinPong, pongMatch, readySeat, resetPong, startNpcMatch } = await import('./pongState');

beforeAll(loadPhysics);

let sim: PongSim | null = null;
afterEach(() => {
  resetPong();
  autopilot.on = false;
  sim?.free();
  sim = null;
});

/** A small seeded random, so a test plays the same game every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('the ball in Rapier', () => {
  // high over the table, so nothing but the air touches it
  const from = { ...fromOwn('west', 0.2, 0), y: TABLE.top + 0.7 };

  it('flies as the forecast says, spin and all', () => {
    const b: BallState = { p: from, v: { x: 6, y: 0.6, z: 0 }, w: spinFor({ x: 1, z: 0 }, 250, 200) };
    const real = flyRapier(b, 0.35);
    const predicted: V3[] = [];
    forecast(b, (s) => void predicted.push({ ...s.p }), 0.35);
    expect(real.length).toBeGreaterThan(15);
    for (let i = 0; i < Math.min(real.length, predicted.length); i++) {
      expect(Math.hypot(real[i].x - predicted[i].x, real[i].y - predicted[i].y, real[i].z - predicted[i].z), `step ${i}`).toBeLessThan(0.01);
    }
  });

  it('curves with sidespin and dips with topspin, visibly', () => {
    const v = { x: 6, y: 0.6, z: 0 };
    const flat = flyRapier({ p: from, v, w: { x: 0, y: 0, z: 0 } }, 0.35);
    const side = flyRapier({ p: from, v, w: spinFor({ x: 1, z: 0 }, 0, 250) }, 0.35);
    const top = flyRapier({ p: from, v, w: spinFor({ x: 1, z: 0 }, 350, 0) }, 0.35);
    const back = flyRapier({ p: from, v, w: spinFor({ x: 1, z: 0 }, -300, 0) }, 0.35);
    const last = flat.length - 1;
    // to the hitter's right (+z, looking +x) and down by well over the ball's width; backspin holds it up
    expect(side[last].z - flat[last].z).toBeGreaterThan(0.12);
    expect(flat[last].y - top[last].y).toBeGreaterThan(0.12);
    expect(back[last].y - flat[last].y).toBeGreaterThan(0.08);
  });
});

describe('a rally on the table', () => {
  it('returns land on the far half across a range of incoming balls', () => {
    sim = pongSim(seeded(7));
    joinPong('west');
    autopilot.on = true;
    autopilot.swing = { forward: 1.2, right: 0 };
    const queue: { speed: number; top: number; side: number; lat: number; depth: number }[] = [];
    for (const speed of [4.2, 6, 8]) for (const top of [-220, 0, 280]) for (const lat of [-0.5, 0.1, 0.55]) queue.push({ speed, top, side: lat > 0.3 ? -120 : 90, lat, depth: 0.55 + Math.abs(lat) * 0.6 });
    expect(sim.runner.drill(queue)).toBe(true);
    for (let i = 0; i < 60 * 120 && sim.runner.liveView().drill?.left !== 0; i++) sim.step();
    for (let i = 0; i < 60 * 4; i++) sim.step();
    const results = sim.runner.liveView().drill!.results;
    expect(results).toHaveLength(queue.length);
    const missed = results.map((r, i) => ({ ...r, ball: queue[i] })).filter((r) => !r.landed);
    expect(missed).toEqual([]);
  });

  it('returns with a swing still land, and a forward swing puts topspin on', () => {
    sim = pongSim(seeded(3));
    joinPong('east');
    autopilot.on = true;
    autopilot.swing = { forward: 2.5, right: 0.8 };
    const queue = [{ speed: 5, top: 100, side: 0, lat: 0, depth: 0.9 }, { speed: 6, top: -150, side: 60, lat: -0.4, depth: 1.0 }, { speed: 4.2, top: 0, side: 0, lat: 0.4, depth: 0.7 }];
    sim.runner.drill(queue);
    for (let i = 0; i < 60 * 30 && sim.runner.liveView().drill?.left !== 0; i++) sim.step();
    for (let i = 0; i < 60 * 4; i++) sim.step();
    expect(sim.runner.liveView().drill!.results.every((r) => r.landed)).toBe(true);
    expect(sim.runner.liveView().lastShot!.top).toBeGreaterThan(100);
  });
});

describe('two agents', () => {
  it('play a whole game to 11, won by 2, with rallies, and report it', () => {
    sim = pongSim(seeded(11));
    startNpcMatch('ada', 'west');
    claimSeat('linus');
    readySeat('ada');
    readySeat('linus');
    for (let i = 0; i < 60 * 900 && sim.reports.length === 0; i++) sim.step();
    expect(sim.reports).toHaveLength(1);
    const r = sim.reports[0];
    expect(r.players).toEqual(['ada', 'linus']);
    expect(finalScore(r.score[0], r.score[1])).toBe(true);
    expect(pongMatch()!.longest).toBeGreaterThanOrEqual(3);
    expect(pongMatch()!.phase).toBe('over');
  });

  it('with a forced rally, keep it going', () => {
    sim = pongSim(seeded(5));
    joinPong('west');
    claimSeat('ada');
    readySeat('ada');
    autopilot.on = true;
    sim.runner.forced = 20;
    for (let i = 0; i < 60 * 60 && sim.runner.forced > 0; i++) sim.step();
    expect(sim.runner.forced).toBe(0);
    expect(pongMatch()!.game.score).toEqual({ west: 0, east: 0 });
  });
});
