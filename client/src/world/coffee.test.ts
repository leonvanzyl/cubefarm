import { describe, expect, it } from 'vitest';
import { BREW, BREW_CUES, EMPTY, FULL_SIPS, canPlace, cuesPassed, level, placeMug, pouring, pressButton, progress, takeMug, tick, type BrewState } from './coffee';

const T0 = 10_000;
const placed = (sips = 0): BrewState => placeMug(EMPTY, { id: 'mug-1', sips });
const brewing = (sips = 0) => pressButton(placed(sips), T0).state;

describe('coffee machine', () => {
  it('takes an empty or part-full mug, but not a full one or a second one', () => {
    expect(placed(0)).toEqual({ kind: 'mugPlaced', mug: { id: 'mug-1', sips: 0 } });
    expect(placed(2).kind).toBe('mugPlaced');
    expect(placed(FULL_SIPS)).toBe(EMPTY);
    expect(canPlace(placed(0), 0)).toBe(false);
    expect(placeMug(placed(0), { id: 'mug-2', sips: 0 })).toEqual(placed(0));
  });

  it('the button does nothing without a mug, mid-brew or once ready', () => {
    expect(pressButton(EMPTY, T0)).toEqual({ state: EMPTY, result: 'noMug' });
    const b = brewing();
    expect(pressButton(b, T0 + 1000)).toEqual({ state: b, result: 'busy' });
    const ready = tick(b, T0 + BREW.ms);
    expect(ready.kind).toBe('ready');
    expect(pressButton(ready, T0 + BREW.ms + 10).result).toBe('full');
  });

  it('brews for about 4 to 5 seconds, then is ready', () => {
    expect(BREW.ms).toBeGreaterThanOrEqual(4000);
    expect(BREW.ms).toBeLessThanOrEqual(5000);
    const b = brewing();
    expect(b.kind).toBe('brewing');
    expect(tick(b, T0 + BREW.ms - 1)).toBe(b);
    expect(tick(b, T0 + BREW.ms)).toEqual({ kind: 'ready', mug: { id: 'mug-1', sips: 0 } });
    expect(progress(b, T0 + BREW.ms / 2)).toBeCloseTo(0.5);
  });

  it('grinds first, then the coffee rises steadily to full', () => {
    const b = brewing();
    expect(level(b, T0 + 100)).toBe(0);
    expect(pouring(progress(b, T0 + 100))).toBe(false);
    const mid = T0 + BREW.ms * ((BREW.grind + BREW.pourEnd) / 2);
    expect(pouring(progress(b, mid))).toBe(true);
    expect(level(b, mid)).toBeCloseTo(FULL_SIPS / 2);
    expect(level(b, T0 + BREW.ms * BREW.pourEnd)).toBeCloseTo(FULL_SIPS);
    expect(level(tick(b, T0 + BREW.ms), T0 + BREW.ms)).toBe(FULL_SIPS);
  });

  it('tops up a part-full mug from where it was', () => {
    const b = brewing(2);
    expect(level(b, T0)).toBe(2);
    expect(level(b, T0 + BREW.ms * ((BREW.grind + BREW.pourEnd) / 2))).toBeCloseTo(2.5);
  });

  it('gives back a full mug when done, and the slot is empty again', () => {
    const r = takeMug(tick(brewing(), T0 + BREW.ms), T0 + BREW.ms);
    expect(r).toEqual({ state: EMPTY, mug: { id: 'mug-1', sips: FULL_SIPS } });
    expect(takeMug(EMPTY, T0)).toBeNull();
  });

  it('a mug taken mid-brew keeps the level it reached, to the nearest sip', () => {
    const p = BREW.grind + (BREW.pourEnd - BREW.grind) * 0.6; // 1.8 sips poured
    expect(takeMug(brewing(), T0 + BREW.ms * p)?.mug.sips).toBe(2);
    expect(takeMug(brewing(), T0 + 50)?.mug.sips).toBe(0);
    expect(takeMug(placed(1), T0)?.mug.sips).toBe(1);
    // left in long after it finished: still full
    expect(takeMug(brewing(), T0 + 60_000)?.mug.sips).toBe(FULL_SIPS);
  });

  it('plays each brew sound once as the brew passes it', () => {
    expect(cuesPassed(0, 0)).toBe(1);
    expect(cuesPassed(1, 0.1)).toBe(1);
    expect(cuesPassed(1, BREW.grind)).toBe(2);
    expect(cuesPassed(2, 1)).toBe(BREW_CUES.length);
    expect(BREW_CUES.every((c, i) => i === 0 || c.at >= BREW_CUES[i - 1].at)).toBe(true);
  });
});
