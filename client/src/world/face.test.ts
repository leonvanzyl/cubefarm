import { describe, expect, it } from 'vitest';
import { BLEND_S, BLINK, BROWS, DROWSY_AFTER, EXPRESSIONS, EYES, FACES, LONG_IDLE, MORPHS, MORPH_AT, MOUTH, PROUD_FOR, STRESS_ROUND, blink, expressionFor, isDrowsy, newFace, prFace, prFaceOf, stepFace, type FaceInputs } from './face';
import { DOZE_AFTER } from './fidgets';

const calm: FaceInputs = { status: 'idle', hit: false, cheering: false, asleep: false, drowsy: false, pr: null, justMerged: false };
const ex = (over: Partial<FaceInputs>) => expressionFor({ ...calm, ...over });

describe('expressionFor', () => {
  it('reads the state', () => {
    expect(ex({})).toBe('neutral');
    expect(ex({ status: 'working' })).toBe('focused');
    expect(ex({ status: 'preparing' })).toBe('focused');
    expect(ex({ pr: 'puzzled' })).toBe('puzzled');
    expect(ex({ pr: 'stressed' })).toBe('stressed');
    expect(ex({ status: 'error' })).toBe('stressed');
    expect(ex({ pr: 'proud' })).toBe('proud');
    expect(ex({ justMerged: true })).toBe('proud');
    expect(ex({ cheering: true })).toBe('joyful');
    expect(ex({ drowsy: true })).toBe('sleepy');
    expect(ex({ asleep: true })).toBe('sleepy');
    expect(ex({ hit: true })).toBe('surprised');
  });

  it('puts the strongest moment first', () => {
    // a ball beats everything, then the merge cheer
    expect(ex({ hit: true, cheering: true, status: 'error', asleep: true })).toBe('surprised');
    expect(ex({ cheering: true, pr: 'stressed', status: 'working' })).toBe('joyful');
    // asleep is asleep, whatever their PR is doing; drowsy gives way to a PR in trouble
    expect(ex({ asleep: true, pr: 'puzzled' })).toBe('sleepy');
    expect(ex({ drowsy: true, pr: 'puzzled' })).toBe('puzzled');
    // a PR in trouble shows even while they work on it
    expect(ex({ status: 'working', pr: 'puzzled' })).toBe('puzzled');
    expect(ex({ status: 'working', pr: 'stressed' })).toBe('stressed');
    expect(ex({ pr: 'puzzled', justMerged: true })).toBe('puzzled');
  });

  it('gets drowsy after a long idle: sat at the desk before the doze, or long without a task wherever they are', () => {
    expect(DROWSY_AFTER).toBeLessThan(DOZE_AFTER.min);
    expect(isDrowsy(0, 0)).toBe(false);
    expect(isDrowsy(DROWSY_AFTER - 1, LONG_IDLE - 1)).toBe(false);
    expect(isDrowsy(DROWSY_AFTER, 0)).toBe(true);
    expect(isDrowsy(5, LONG_IDLE)).toBe(true); // back from an errand, but nothing to do for ages
    expect(PROUD_FOR).toBeGreaterThan(10);
  });
});

describe('prFace', () => {
  it('is puzzled by red checks or a failed QA round, proud of a pass, stressed by a long fight', () => {
    expect(prFace('passing', null)).toBeNull();
    expect(prFace('pending', { status: 'testing', round: 1 })).toBeNull();
    expect(prFace('failing', null)).toBe('puzzled');
    expect(prFace('passing', { status: 'failed', round: 1 })).toBe('puzzled');
    expect(prFace('passing', { status: 'passed', round: 2 })).toBe('proud');
    expect(prFace('failing', { status: 'passed', round: 1 })).toBe('puzzled');
    expect(prFace('passing', { status: 'needs-human', round: 2 })).toBe('stressed');
    expect(prFace('pending', { status: 'fixing', round: STRESS_ROUND })).toBe('stressed');
    expect(prFace('pending', { status: 'fixing', round: STRESS_ROUND - 1 })).toBeNull();
    expect(prFace('passing', { status: 'passed', round: STRESS_ROUND + 1 })).toBe('proud');
  });

  it("only looks at a developer's own open PR", () => {
    const repos = [{ id: 'o/r', pulls: [{ number: 4, state: 'OPEN' as const, checks: 'failing' as const }, { number: 5, state: 'MERGED' as const, checks: 'failing' as const }] }];
    const dev = { role: 'dev', repoId: 'o/r', prNumber: 4 };
    expect(prFaceOf(dev, repos, null)).toBe('puzzled');
    expect(prFaceOf({ ...dev, role: 'qa' }, repos, null)).toBeNull(); // the PR a QA tester is testing isn't theirs
    expect(prFaceOf({ ...dev, prNumber: null }, repos, null)).toBeNull();
    expect(prFaceOf({ ...dev, prNumber: 5 }, repos, null)).toBeNull(); // merged: nothing to worry about
    // not listed yet: QA's record still counts
    expect(prFaceOf({ ...dev, prNumber: 9 }, repos, { status: 'failed', round: 1 })).toBe('puzzled');
  });
});

describe('blink', () => {
  it('blinks briefly at irregular intervals', () => {
    const closes: number[] = [];
    let was = false;
    let shut = 0;
    const step = 0.01;
    for (let t = 0; t < 400; t += step) {
      const b = blink(t, 1234);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (b > 0.5) shut += step;
      if (b > 0.5 && !was) closes.push(t);
      was = b > 0.5;
    }
    const gaps = closes.slice(1).map((t, i) => t - closes[i]);
    expect(closes.length).toBeGreaterThan(400 / BLINK.slot - 5);
    expect(Math.min(...gaps)).toBeGreaterThan(0.2);
    expect(Math.max(...gaps)).toBeLessThan(BLINK.slot * 2);
    expect(new Set(gaps.map((g) => g.toFixed(1))).size).toBeGreaterThan(10); // not a metronome
    expect(shut / 400).toBeLessThan(0.05); // eyes are open nearly all the time
  });

  it('keeps neighbours out of step', () => {
    let same = 0;
    for (let t = 0; t < 200; t += 0.05) if (blink(t, 1) > 0.5 && blink(t, 2) > 0.5) same++;
    expect(same).toBeLessThan(5);
  });
});

describe('stepFace', () => {
  it('blends to a new expression over about 200 ms', () => {
    const f = newFace('neutral');
    const to = FACES.surprised;
    const wide = MORPH_AT.eyes + EYES.wide;
    const share = () => f.w[wide] / to[wide];
    stepFace(f, 'surprised', 0.05);
    expect(share()).toBeLessThan(0.7); // not a snap
    for (let t = 0.05; t < BLEND_S - 1e-9; t += 1 / 60) stepFace(f, 'surprised', 1 / 60);
    expect(share()).toBeGreaterThan(0.9);
    for (let i = 0; i < 60; i++) stepFace(f, 'surprised', 1 / 60);
    for (let i = 0; i < MORPHS; i++) expect(f.w[i]).toBeCloseTo(to[i], 3);
    expect(f.expression).toBe('surprised');
  });

  it('blends the same however the frames fall', () => {
    const a = newFace('focused');
    const b = newFace('focused');
    for (let i = 0; i < 12; i++) stepFace(a, 'joyful', 1 / 60);
    stepFace(b, 'joyful', 0.1);
    stepFace(b, 'joyful', 0.1);
    for (let i = 0; i < MORPHS; i++) expect(a.w[i]).toBeCloseTo(b.w[i], 5);
  });

  it('keeps every weight in range, with no part over-driven', () => {
    expect(MORPHS).toBe(Object.keys(EYES).length + Object.keys(BROWS).length + Object.keys(MOUTH).length);
    for (const e of EXPRESSIONS) {
      expect(FACES[e]).toHaveLength(MORPHS);
      const parts = [FACES[e].slice(MORPH_AT.eyes, MORPH_AT.brows), FACES[e].slice(MORPH_AT.brows, MORPH_AT.mouth), FACES[e].slice(MORPH_AT.mouth)];
      for (const part of parts) {
        expect(part.every((w) => w >= 0 && w <= 1)).toBe(true);
        expect(part.reduce((n, w) => n + w, 0)).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});
