import { describe, expect, it } from 'vitest';
import { createStepTracker, trackSteps, vary } from './footstepRules.ts';

/** Feed the tracker a run of frames, collecting what it asks to play. */
function run(frames: [bobPhase: number, moving: boolean][]) {
  const t = createStepTracker();
  return { t, out: frames.map(([phase, moving]) => trackSteps(t, phase, moving)).filter(Boolean) };
}

describe('trackSteps', () => {
  it('is silent while standing still', () => {
    expect(run([[0, false], [0, false], [0, false]]).out).toEqual([]);
  });

  it('steps once per half bob cycle while moving, feet taking turns', () => {
    const t = createStepTracker();
    const feet: number[] = [];
    for (let phase = 0; phase < 4 * Math.PI; phase += 0.3) if (trackSteps(t, phase, true) === 'step') feet.push(t.foot);
    expect(feet).toEqual([0, 1, 0]); // phase crosses π, 2π and 3π
  });

  it('scuffs once when stopping after walking, then goes quiet', () => {
    const { out } = run([[0, true], [3.2, true], [3.3, false], [3.3, false], [3.3, false]]);
    expect(out).toEqual(['step', 'scuff']);
  });

  it("doesn't scuff after a nudge too short to take a step", () => {
    expect(run([[0, true], [0.4, true], [0.4, false]]).out).toEqual([]);
  });
});

describe('vary', () => {
  it('stays within ±10%', () => {
    expect(vary(0)).toBeCloseTo(0.9);
    expect(vary(0.5)).toBeCloseTo(1);
    expect(vary(0.9999)).toBeLessThan(1.1);
  });
});
