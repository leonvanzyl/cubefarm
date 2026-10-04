import { describe, expect, it } from 'vitest';
import { BITE, LAST_BITE, biteFor, cuesDue, eAction, lift } from './sip';

// A sausage from the roof's grill is eaten like coffee is sipped (sip.ts): E takes a bite, the last finishes it.

const sausage = (bites: number) => ({ kind: 'sausage', id: 'sausage-1', bites, charred: false });

describe('eating a sausage', () => {
  it('takes a bite on E, whatever the crosshair is on (the grill included)', () => {
    expect(eAction(sausage(3), null)).toBe('sip');
    expect(eAction(sausage(1), 'roof')).toBe('sip');
    expect(eAction(sausage(2), 'coffee')).toBe('sip');
  });

  it('acts on the target once it is all gone', () => {
    expect(eAction(sausage(0), 'roof')).toBe('target');
    expect(eAction(sausage(0), null)).toBe('empty');
  });

  it('takes three bites, the last one finishing it', () => {
    expect(biteFor(3)).toBe(BITE);
    expect(biteFor(2)).toBe(BITE);
    expect(biteFor(1)).toBe(LAST_BITE);
    expect(biteFor(0)).toBeNull();
    expect(BITE.cues.map((c) => c.cue)).toEqual(['chomp', 'drink', 'munch']);
    expect(LAST_BITE.cues.at(-1)?.cue).toBe('drop');
    // nothing to tip back: it goes up to the mouth level
    expect(BITE.tilt).toBe(0);
    expect(lift(BITE, BITE.up + 0.01)).toBe(1);
    expect(cuesDue(LAST_BITE, 0, LAST_BITE.dur)).toBe(LAST_BITE.cues.length);
  });
});
