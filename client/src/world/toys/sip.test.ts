import { describe, expect, it } from 'vitest';
import { CLUNK, GULP, SIP, clunkPeak, cuesDue, eAction, impactSpeed, lift, planFor, pose } from './sip';

const mug = (sips: number) => ({ kind: 'mug', id: 'mug-1', sips });

describe('what E does', () => {
  it('sips coffee whatever the crosshair is on', () => {
    expect(eAction(mug(3), null)).toBe('sip');
    expect(eAction(mug(1), 'pickup')).toBe('sip');
    expect(eAction(mug(2), 'terminal')).toBe('sip');
  });

  it('leaves the coffee machine to the machine', () => {
    expect(eAction(mug(2), 'coffee')).toBe('target');
    expect(eAction(mug(0), 'coffee')).toBe('target');
  });

  it('acts on the target with an empty mug, and hints when there is none', () => {
    expect(eAction(mug(0), 'pickup')).toBe('target');
    expect(eAction(mug(0), null)).toBe('empty');
  });

  it('is unchanged without a mug', () => {
    expect(eAction(null, 'pickup')).toBe('target');
    expect(eAction({ kind: 'ball' }, null)).toBe('target');
  });
});

describe('sip plans', () => {
  it('makes the last sip the gulp', () => {
    expect(planFor(3)).toBe(SIP);
    expect(planFor(2)).toBe(SIP);
    expect(planFor(1)).toBe(GULP);
    expect(planFor(0)).toBeNull();
    expect(planFor(NaN)).toBeNull();
  });

  it('sips in about 0.7 s and gulps for longer, tipping further', () => {
    expect(SIP.dur).toBeCloseTo(0.7);
    expect(GULP.dur).toBeGreaterThan(SIP.dur * 2);
    expect(GULP.tilt).toBeGreaterThan(SIP.tilt * 2);
    expect(SIP.head).toBe(0);
    expect(GULP.head).toBeGreaterThan(0);
  });

  for (const [name, plan] of [['sip', SIP], ['gulp', GULP]] as const) {
    it(`${name}: cues in order, within the animation, drinking while the mug is at the mouth`, () => {
      const ats = plan.cues.map((c) => c.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
      expect(ats.every((at) => at > 0 && at < plan.dur)).toBe(true);
      const drink = plan.cues.find((c) => c.cue === 'drink')!;
      expect(drink.at).toBeGreaterThanOrEqual(plan.up);
      expect(drink.at).toBeLessThanOrEqual(plan.down);
      expect(plan.cues.filter((c) => c.cue === 'drink')).toHaveLength(1);
    });
  }

  it('lets go of the mug only at the end of the gulp, after the "ahh"', () => {
    expect(SIP.cues.some((c) => c.cue === 'drop')).toBe(false);
    const order = GULP.cues.map((c) => c.cue);
    expect(order.indexOf('drink')).toBeLessThan(order.indexOf('ahh'));
    expect(order.at(-1)).toBe('drop');
    expect(lift(GULP, GULP.cues.at(-1)!.at)).toBeLessThan(0.2); // the mug is nearly back down when it goes
  });
});

describe('cuesDue', () => {
  it('walks through the cues as time passes, each once', () => {
    let next = 0;
    const seen: string[] = [];
    for (let t = 0; t <= GULP.dur + 0.1; t += 1 / 60) {
      const to = cuesDue(GULP, next, t);
      for (let i = next; i < to; i++) seen.push(GULP.cues[i].cue);
      next = to;
    }
    expect(seen).toEqual(['gulp', 'drink', 'ahh', 'drop']);
  });

  it('catches up on a long frame', () => {
    expect(cuesDue(SIP, 0, 10)).toBe(SIP.cues.length);
    expect(cuesDue(SIP, 0, 0)).toBe(0);
  });
});

describe('pose', () => {
  it('raises the mug, holds it at the mouth, then puts it back', () => {
    expect(lift(SIP, 0)).toBe(0);
    expect(lift(SIP, SIP.up / 2)).toBeGreaterThan(0);
    expect(lift(SIP, SIP.up / 2)).toBeLessThan(1);
    expect(lift(SIP, (SIP.up + SIP.down) / 2)).toBe(1);
    expect(lift(SIP, SIP.dur)).toBe(0);
    expect(lift(SIP, -1)).toBe(0);
  });

  it('tips and tilts the view in proportion', () => {
    const p = pose(GULP, (GULP.up + GULP.down) / 2);
    expect(p).toEqual({ lift: 1, tilt: GULP.tilt, head: GULP.head });
    expect(pose(SIP, 0.1).head).toBe(0);
  });
});

describe('clunk', () => {
  it('turns a contact force into a change of speed', () => {
    expect(impactSpeed(60, 1 / 60, 0.5)).toBeCloseTo(2);
    expect(impactSpeed(60, 1 / 60, 0)).toBe(0);
  });

  it('stays quiet for resting and rocking mugs', () => {
    expect(clunkPeak(0, 1e9)).toBe(0);
    expect(clunkPeak(CLUNK.min - 0.01, 1e9)).toBe(0);
    expect(clunkPeak(NaN, 1e9)).toBe(0);
  });

  it('gets louder with the impact, up to a cap', () => {
    const soft = clunkPeak(CLUNK.min, 1e9);
    const mid = clunkPeak((CLUNK.min + CLUNK.max) / 2, 1e9);
    const hard = clunkPeak(CLUNK.max, 1e9);
    expect(soft).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(soft);
    expect(hard).toBeGreaterThan(mid);
    expect(clunkPeak(CLUNK.max * 5, 1e9)).toBe(hard);
    expect(hard).toBe(CLUNK.peak);
  });

  it('waits out the cooldown between clunks of one mug', () => {
    expect(clunkPeak(3, CLUNK.cooldown - 1)).toBe(0);
    expect(clunkPeak(3, CLUNK.cooldown)).toBeGreaterThan(0);
  });
});
