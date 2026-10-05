import { describe, expect, it } from 'vitest';
import { wrapIndex } from './dialogFocus';

describe('wrapIndex', () => {
  it('steps forward and back through a dialog, wrapping at the ends', () => {
    expect(wrapIndex(0, 3, false)).toBe(1);
    expect(wrapIndex(2, 3, false)).toBe(0);
    expect(wrapIndex(0, 3, true)).toBe(2);
    expect(wrapIndex(1, 3, true)).toBe(0);
  });

  it('brings focus from outside the dialog to its first control, or its last going back', () => {
    expect(wrapIndex(-1, 4, false)).toBe(0);
    expect(wrapIndex(-1, 4, true)).toBe(3);
  });

  it('has nowhere to go in a dialog without controls', () => {
    expect(wrapIndex(-1, 0, false)).toBe(-1);
  });
});
