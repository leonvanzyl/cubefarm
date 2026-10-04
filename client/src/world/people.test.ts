import { describe, expect, it } from 'vitest';
import { newBodyState } from './body';
import { isSeated, seatBody, setBody, trackBody } from './people';

describe('isSeated', () => {
  it('is true for anyone nobody has moved, drawn or not', () => {
    expect(isSeated('nobody')).toBe(true);
  });

  it('is false from the moment someone is told to get up until they are back in their chair', () => {
    const s = newBodyState();
    const untrack = trackBody('a', s);
    setBody('a', { mode: 'standing', x: 1, z: 2 });
    expect(isSeated('a')).toBe(false);
    seatBody('a');
    s.stage = 'sitting'; // still walking back and sitting down
    expect(isSeated('a')).toBe(false);
    s.stage = 'seated';
    expect(isSeated('a')).toBe(true);
    untrack();
  });
});
