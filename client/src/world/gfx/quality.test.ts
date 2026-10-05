import { describe, expect, it } from 'vitest';
import { effectNames, GOVERNOR, governorSample, governorSettle, newGovernor, normalizePreset, tierEffects, type GovernorChange, type GovernorState, type Tier } from './quality';

/** Feeds `seconds` of half-second samples at `fps`; returns every change made on the way. */
function run(s: GovernorState, fps: number, seconds: number) {
  const changes: GovernorChange[] = [];
  for (let t = 0; t < seconds * 1000; t += 500) {
    const c = governorSample(s, fps, 500);
    if (c) changes.push(c);
  }
  return changes;
}

/** A governor past its start-up wait, with one fast sample in. */
function started(tier: Tier = 'high') {
  const s = newGovernor(tier);
  run(s, 60, GOVERNOR.startMs / 1000 + 0.5);
  return s;
}

describe('normalizePreset', () => {
  it('keeps the four presets', () => {
    for (const p of ['low', 'medium', 'high', 'auto']) expect(normalizePreset(p)).toBe(p);
  });
  it('forgives case and spaces', () => {
    expect(normalizePreset(' High ')).toBe('high');
  });
  it('falls back to Auto for anything else', () => {
    for (const bad of [null, undefined, '', 'ultra', 'LOWEST', 3, {}, [], '{"tier":"low"}']) expect(normalizePreset(bad)).toBe('auto');
  });
});

describe('tierEffects', () => {
  it('Low turns everything off: the office as it always was', () => {
    expect(effectNames('low')).toEqual([]);
  });
  it('Medium adds bloom and the screen glow', () => {
    expect(tierEffects('medium')).toEqual({ bloom: true, screenGlow: true, ao: false, contactShadows: false, grading: false });
  });
  it('High adds ambient occlusion, contact shadows and grading on top', () => {
    expect(effectNames('high')).toEqual(['bloom', 'screenGlow', 'ao', 'contactShadows', 'grading']);
  });
});

describe('the Auto governor', () => {
  it('starts at High and ignores the first seconds while the office loads in', () => {
    const s = newGovernor();
    expect(s.tier).toBe('high');
    expect(run(s, 5, GOVERNOR.startMs / 1000)).toEqual([]);
    expect(s.slowMs).toBe(0);
    expect(run(s, 5, GOVERNOR.downAfterMs / 1000)).toHaveLength(1);
  });

  it('steps down after a few seconds under 50 fps, one tier at a time', () => {
    const s = started();
    const changes = run(s, 30, 2.5);
    expect(changes).toEqual([]);
    const next = run(s, 30, 1);
    expect(next.map((c) => [c.from, c.to])).toEqual([['high', 'medium']]);
    expect(s.tier).toBe('medium');
  });

  it('settles on Low when even Medium is slow (software WebGL), and stays there', () => {
    const s = newGovernor();
    const changes = run(s, 4, 60);
    expect(changes.map((c) => c.to)).toEqual(['medium', 'low']);
    expect(s.tier).toBe('low');
  });

  it('a single fast sample breaks a slow run', () => {
    const s = started();
    run(s, 30, 2.5);
    governorSample(s, 60, 500);
    expect(run(s, 30, 2.5)).toEqual([]);
    expect(s.tier).toBe('high');
  });

  it('frame rates between the thresholds hold the tier where it is', () => {
    const s = newGovernor('medium');
    expect(run(s, 53, 600)).toEqual([]);
    expect(s.tier).toBe('medium');
  });

  it('steps back up only after sustained headroom', () => {
    const s = started('low');
    expect(run(s, 60, GOVERNOR.upAfterMs / 1000 - 1)).toEqual([]);
    const up = run(s, 60, 1);
    expect(up.map((c) => [c.from, c.to])).toEqual([['low', 'medium']]);
  });

  it('never goes past High or below Low', () => {
    const top = newGovernor('high');
    expect(run(top, 144, 600)).toEqual([]);
    const bottom = newGovernor('low');
    expect(run(bottom, 2, 600)).toEqual([]);
  });

  it('a step up that fails doubles the wait before the next try, up to a cap', () => {
    const s = started('medium');
    run(s, 60, GOVERNOR.upAfterMs / 1000); // up to High
    expect(s.tier).toBe('high');
    run(s, 30, 6); // too slow: straight back down
    expect(s.tier).toBe('medium');
    expect(s.upAfterMs).toBe(GOVERNOR.upAfterMs * 2);
    // the old wait is no longer enough...
    run(s, 60, GOVERNOR.upAfterMs / 1000 + 3);
    expect(s.tier).toBe('medium');
    // ...the doubled one is
    run(s, 60, GOVERNOR.upAfterMs / 1000);
    expect(s.tier).toBe('high');
    for (let i = 0; i < 10; i++) {
      run(s, 30, 6);
      run(s, 60, s.upAfterMs / 1000 + 3);
    }
    expect(s.upAfterMs).toBe(GOVERNOR.maxUpAfterMs);
  });

  it('a step up that holds resets the wait', () => {
    const s = started('medium');
    run(s, 60, GOVERNOR.upAfterMs / 1000);
    run(s, 30, 6);
    expect(s.upAfterMs).toBe(GOVERNOR.upAfterMs * 2);
    run(s, 60, s.upAfterMs / 1000 + 3); // up again
    expect(s.tier).toBe('high');
    run(s, 55, GOVERNOR.failWindowMs / 1000 + 1); // holds
    expect(s.upAfterMs).toBe(GOVERNOR.upAfterMs);
    expect(s.sinceUpMs).toBeNull();
    // a much later slowdown is an ordinary step down, not a failed step up
    run(s, 30, 6);
    expect(s.tier).toBe('medium');
    expect(s.upAfterMs).toBe(GOVERNOR.upAfterMs);
  });

  it('settling (a pause, effects loading) restarts both runs', () => {
    const s = started();
    run(s, 30, 2.5);
    governorSettle(s);
    expect(run(s, 30, 3)).toEqual([]);
    expect(s.tier).toBe('high');
  });

  it('ignores nonsense samples', () => {
    const s = started();
    for (const [fps, ms] of [
      [NaN, 500],
      [30, 0],
      [30, -5],
      [Infinity, 500],
    ])
      expect(governorSample(s, fps, ms)).toBeNull();
    expect(s.slowMs).toBe(0);
  });

  it('says why it moved', () => {
    const s = newGovernor();
    const [down] = run(s, 20, 15);
    expect(down.reason).toMatch(/20 fps/);
  });
});
