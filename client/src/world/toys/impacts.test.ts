import { describe, expect, it } from 'vitest';
import { HALF_D } from '../layout';
import { HOOP, hoopRim } from './hoopScore';
import { IMPACT, hoopPart, impactLevel, offCooldown } from './impacts';

describe('impactLevel', () => {
  it('is silent for resting, rolling and nudged balls', () => {
    for (const dv of [0, 0.05, 0.16, 0.5, IMPACT.min - 0.01, NaN]) expect(impactLevel(dv)).toBeNull();
  });

  it('gets louder and brighter the harder the hit', () => {
    const speeds = [IMPACT.min, 1.5, 3, 5, 8];
    const levels = speeds.map((dv) => impactLevel(dv)!);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].gain).toBeGreaterThan(levels[i - 1].gain);
      expect(levels[i].bright).toBeGreaterThan(levels[i - 1].bright);
    }
  });

  it('stays within 0-1 and tops out at full', () => {
    const quiet = impactLevel(IMPACT.min)!;
    expect(quiet.gain).toBeGreaterThan(0);
    expect(quiet.gain).toBeLessThan(0.2);
    expect(quiet.bright).toBe(0);
    expect(impactLevel(IMPACT.full)).toEqual({ gain: 1, bright: 1 });
    expect(impactLevel(100)).toEqual({ gain: 1, bright: 1 });
  });

  it('fades a settling bounce out gradually', () => {
    // each hop of a ball with restitution 0.75 comes back slower
    let dv = 8;
    let prev = Infinity;
    const gains: number[] = [];
    for (let hop = 0; hop < 20; hop++, dv *= 0.75) {
      const l = impactLevel(dv);
      if (!l) break;
      expect(l.gain).toBeLessThan(prev);
      prev = l.gain;
      gains.push(l.gain);
    }
    expect(gains.length).toBeGreaterThan(4);
    expect(gains.at(-1)!).toBeLessThan(0.35);
  });
});

describe('offCooldown', () => {
  it('lets a ball sound again only after the cooldown', () => {
    expect(offCooldown(-Infinity, 0)).toBe(true);
    expect(offCooldown(1000, 1000 + IMPACT.cooldownMs - 1)).toBe(false);
    expect(offCooldown(1000, 1000 + IMPACT.cooldownMs)).toBe(true);
  });
});

describe('hoopPart', () => {
  const rim = hoopRim('office');
  const r = HOOP.ball.r;
  const face = HALF_D - HOOP.standoff - HOOP.board.t;

  it('finds a ball resting on the front of the rim', () => {
    expect(hoopPart({ x: rim.x, y: rim.y + r, z: rim.z - rim.r }, r, rim)).toBe('rim');
    expect(hoopPart({ x: rim.x + rim.r + r, y: rim.y, z: rim.z }, r, rim)).toBe('rim');
  });

  it('finds a ball against the backboard above the rim', () => {
    expect(hoopPart({ x: rim.x + 0.3, y: 3.0, z: face - r }, r, rim)).toBe('board');
  });

  it('finds a ball that hit the rim or board from below and has already rebounded', () => {
    // read after the step: a ball that hit the underside of the rim is back down about 0.06 m below the tube
    const underRim = { x: rim.x, y: rim.y - HOOP.rim.tube - r - 0.06, z: rim.z - rim.r };
    expect(hoopPart(underRim, r, rim, 0.06)).toBe('rim');
    // under the board, between its face and the wall
    const underBoard = { x: rim.x + 0.3, y: HOOP.board.bottom - r - 0.02, z: face + 0.1 };
    expect(hoopPart(underBoard, r, rim)).toBe('board');
    expect(hoopPart({ ...underBoard, y: HOOP.board.bottom - r - 0.1 }, r, rim, 0.06)).toBe('board');
  });

  it('only widens the touch by how far the ball moved, and only so far', () => {
    const below = (gap: number) => ({ x: rim.x, y: rim.y - HOOP.rim.tube - r - gap, z: rim.z - rim.r });
    expect(hoopPart(below(0.1), r, rim)).toBeNull();
    expect(hoopPart(below(0.1), r, rim, 0.06)).toBe('rim');
    expect(hoopPart(below(0.3), r, rim, 5)).toBeNull();
  });

  it('ignores a ball dropping through the middle of the rim, or anywhere else', () => {
    expect(hoopPart({ x: rim.x, y: rim.y, z: rim.z }, r, rim)).toBeNull();
    expect(hoopPart({ x: rim.x, y: r, z: rim.z }, r, rim)).toBeNull(); // on the floor under the hoop
    expect(hoopPart({ x: rim.x + 2, y: 3.0, z: face - r }, r, rim)).toBeNull(); // the wall beside the board
    expect(hoopPart({ x: rim.x, y: 1.2, z: HALF_D - r }, r, rim)).toBeNull(); // the wall below it
  });

  it('works for the big balls and on the lobby hoop', () => {
    const lobby = hoopRim('lobby');
    expect(hoopPart({ x: lobby.x, y: 3.3, z: face - 0.4 }, 0.4, lobby)).toBe('board');
    expect(hoopPart({ x: rim.x, y: 3.3, z: face - 0.4 }, 0.4, lobby)).toBeNull();
  });
});
