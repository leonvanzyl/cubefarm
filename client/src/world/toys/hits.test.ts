import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three';
import { HIT_SPEED, REACTION, countsAsHit, flinch, hitKind, hitTargets, mayReact, onAgentHit, onTargetsChange, reactionCount, reactionWeight, registerTarget, reportHit, turnToward } from './hits';

const BALLS = ['beach-ball', 'yarn-ball'];

describe('hitKind', () => {
  it('tells balls and darts from everything else', () => {
    expect(hitKind({ toy: 'dart' }, BALLS)).toBe('dart');
    expect(hitKind({ toy: 'beach-ball' }, BALLS)).toBe('ball');
    expect(hitKind({ toy: 'roomba' }, BALLS)).toBeNull();
    expect(hitKind({ toy: 'blaster-orange' }, BALLS)).toBeNull();
    expect(hitKind(undefined, BALLS)).toBeNull();
    expect(hitKind({}, BALLS)).toBeNull();
  });
});

describe('countsAsHit', () => {
  it('counts a thrown ball and a dart in flight', () => {
    expect(countsAsHit('ball', 8, false)).toBe(true);
    expect(countsAsHit('ball', HIT_SPEED.ball, false)).toBe(true);
    expect(countsAsHit('dart', 19, false)).toBe(true);
  });

  it("doesn't count a resting or gently rolling ball, a loose dart, or a ball in your hands", () => {
    expect(countsAsHit('ball', 0, false)).toBe(false);
    expect(countsAsHit('ball', 1.2, false)).toBe(false);
    expect(countsAsHit('dart', 0.5, false)).toBe(false);
    expect(countsAsHit('ball', 12, true)).toBe(false);
    expect(countsAsHit(null, 20, false)).toBe(false);
  });
});

describe('mayReact', () => {
  it('allows one reaction per gap', () => {
    expect(mayReact(undefined, 0)).toBe(true);
    expect(mayReact(1000, 1000 + REACTION.gapMs - 1)).toBe(false);
    expect(mayReact(1000, 1000 + REACTION.gapMs)).toBe(true);
  });
});

describe('reportHit', () => {
  it('rate-limits each person on their own and counts reactions', () => {
    const seen: string[] = [];
    const offA = onAgentHit('a', () => seen.push('a'));
    const offB = onAgentHit('b', () => seen.push('b'));
    const before = reactionCount();
    expect(reportHit('a', 10_000)).toBe(true);
    expect(reportHit('a', 10_500)).toBe(false); // a rapid second hit doesn't stack
    expect(reportHit('b', 10_600)).toBe(true); // someone else still reacts
    expect(reportHit('a', 12_000)).toBe(true);
    expect(seen).toEqual(['a', 'b', 'a']);
    expect(reactionCount() - before).toBe(3);
    offA();
    offB();
    reportHit('a', 20_000);
    expect(seen).toHaveLength(3);
  });
});

describe('targets', () => {
  it('registers and unregisters, telling listeners', () => {
    let changes = 0;
    const off = onTargetsChange(() => changes++);
    const obj = {} as Object3D;
    const unregister = registerTarget('t1', obj);
    expect(hitTargets().some((t) => t.id === 't1' && t.obj === obj)).toBe(true);
    unregister();
    expect(hitTargets().some((t) => t.id === 't1')).toBe(false);
    expect(changes).toBe(2);
    off();
  });
});

describe('reaction shape', () => {
  it('rises fast, holds, and is gone after the reaction', () => {
    expect(reactionWeight(-1)).toBe(0);
    expect(reactionWeight(0)).toBe(0);
    expect(reactionWeight(60)).toBeGreaterThan(0);
    expect(reactionWeight(300)).toBe(1);
    expect(reactionWeight(1200)).toBeGreaterThan(0);
    expect(reactionWeight(1200)).toBeLessThan(1);
    expect(reactionWeight(REACTION.ms)).toBe(0);
    expect(reactionWeight(NaN)).toBe(0);
  });

  it('flinches briefly', () => {
    expect(flinch(70)).toBeCloseTo(1);
    expect(flinch(200)).toBeGreaterThan(0);
    expect(flinch(400)).toBe(0);
    expect(flinch(-Infinity)).toBe(0);
  });
});

describe('turnToward', () => {
  it('looks straight ahead at something in front', () => {
    const t = turnToward(0, -2);
    expect(t.head).toBeCloseTo(0);
    expect(t.twist).toBeCloseTo(0);
  });

  it('turns the head towards the side the point is on', () => {
    expect(turnToward(-1, -1).head).toBeCloseTo(Math.PI / 4); // front left: positive yaw turns towards -X
    expect(turnToward(1, -1).head).toBeCloseTo(-Math.PI / 4);
  });

  it('twists the upper body for points behind, within limits', () => {
    const t = turnToward(-0.1, 2);
    expect(t.head).toBeCloseTo(1.1);
    expect(t.twist).toBeCloseTo(0.5);
    expect(turnToward(0, 0)).toEqual({ head: 0, twist: 0 });
  });
});
