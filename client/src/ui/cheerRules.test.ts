import { describe, expect, it } from 'vitest';
import { CHEER_GAP_MS, CHEER_LATE_MS, CHEER_VOICES, cheerVoice, crowdLevel, hashSeed, mayCheer, planCheer, STAGGER_MAX, stagger } from './cheerRules.ts';
import { MAX_DISTANCE } from './sfxMix.ts';

describe('cheerVoice', () => {
  it('is the same voice every time for the same agent', () => {
    expect(cheerVoice('dev-ada', 'feminine')).toEqual(cheerVoice('dev-ada', 'feminine'));
    expect(hashSeed('dev-ada')).toBe(hashSeed('dev-ada'));
  });

  it('gives different agents different voices', () => {
    const voices = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(cheerVoice(`agent-${i}`, 'masculine'))));
    expect(voices.size).toBe(20);
    const words = new Set(Array.from({ length: 40 }, (_, i) => cheerVoice(`agent-${i}`).word));
    expect(words).toEqual(new Set(['woo', 'yay', 'hey']));
  });

  it('keeps pitch and timbre in a cartoon range, higher for a feminine look', () => {
    for (let i = 0; i < 50; i++) {
      const m = cheerVoice(`a${i}`, 'masculine');
      const f = cheerVoice(`a${i}`, 'feminine');
      expect(m.pitch).toBeGreaterThanOrEqual(210);
      expect(m.pitch).toBeLessThanOrEqual(310);
      expect(f.pitch).toBeGreaterThanOrEqual(300);
      expect(f.pitch).toBeLessThanOrEqual(430);
      for (const v of [m, f]) {
        expect(v.formant).toBeGreaterThan(0.9);
        expect(v.formant).toBeLessThan(1.25);
        expect(v.bright).toBeGreaterThanOrEqual(0);
        expect(v.bright).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has some agents add a second woo or a clap, but not everyone', () => {
    const extras = Array.from({ length: 200 }, (_, i) => cheerVoice(`x${i}`).extra);
    for (const e of ['none', 'woo', 'clap'] as const) expect(extras.filter((x) => x === e).length).toBeGreaterThan(20);
  });
});

describe('planCheer', () => {
  it('voices the nearest six and blends the rest into the crowd', () => {
    const people = [9, 2, 14, 5, 1, 7, 3, 12, 4, 8, 6, 10, 11, 13, 15].map((d) => ({ d }));
    const plan = planCheer(people);
    expect(plan.voiced).toHaveLength(CHEER_VOICES);
    expect(plan.voiced.map((i) => people[i].d)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.crowd.map((i) => people[i].d)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('voices everyone on a small floor, with no crowd', () => {
    const plan = planCheer([{ d: 3 }, { d: 1 }]);
    expect(plan.voiced).toEqual([1, 0]);
    expect(plan.crowd).toEqual([]);
  });

  it("leaves out anyone too far away to hear", () => {
    const plan = planCheer([{ d: MAX_DISTANCE + 1 }, { d: 2 }, { d: MAX_DISTANCE }]);
    expect(plan.voiced).toEqual([1, 2]);
    expect(plan.crowd).toEqual([]);
  });

  it('is empty for nobody', () => {
    expect(planCheer([])).toEqual({ voiced: [], crowd: [] });
  });
});

describe('stagger', () => {
  it('scatters starts across 0-350 ms', () => {
    expect(STAGGER_MAX).toBe(0.35);
    expect(stagger(0)).toBe(0);
    expect(stagger(0.5)).toBeCloseTo(0.175);
    for (const r of [0.999999, 1, 2, -1]) {
      expect(stagger(r)).toBeGreaterThanOrEqual(0);
      expect(stagger(r)).toBeLessThanOrEqual(STAGGER_MAX);
    }
  });
});

describe('crowdLevel', () => {
  it('is silent for nobody and grows slowly, never past 1', () => {
    expect(crowdLevel(0)).toBe(0);
    expect(crowdLevel(1)).toBeGreaterThan(0);
    expect(crowdLevel(4)).toBeGreaterThan(crowdLevel(1));
    expect(crowdLevel(4)).toBeLessThan(crowdLevel(1) * 4);
    expect(crowdLevel(100)).toBe(1);
  });
});

describe('mayCheer', () => {
  it('lets the first cheer through right after the merge', () => {
    expect(mayCheer(-Infinity, 1000, 980)).toBe(true);
  });

  it('holds back cheers for merges in a row', () => {
    expect(mayCheer(1000, 1000 + CHEER_GAP_MS - 1, 1000 + CHEER_GAP_MS - 20)).toBe(false);
    expect(mayCheer(1000, 1000 + CHEER_GAP_MS, 1000 + CHEER_GAP_MS - 20)).toBe(true);
  });

  it('stays silent when the arms go up long after the merge (the view was covered)', () => {
    expect(mayCheer(-Infinity, 5000, 5000 - CHEER_LATE_MS - 1)).toBe(false);
  });
});
