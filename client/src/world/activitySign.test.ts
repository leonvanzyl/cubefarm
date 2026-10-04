import { describe, expect, it } from 'vitest';
import { BUBBLE, SIGN_HEIGHT, SIGN_SIZE, signHeight } from './activitySign';

// Character.tsx's standing name tag and SpeechBubble.tsx's bubble, for the tallest people (height 1.06).
const TAG_TOP = 0.815 + 1.06 * 0.86 + 0.26 + 0.216 / 2;
const BUBBLE_SPAN = [0.815 + 1.06 * 0.86 + 0.4, 0.815 + 1.06 * 0.86 + 0.4 + 0.156 + 0.344 / 2];

describe('signHeight', () => {
  it('floats over a seated head and over a standing name tag', () => {
    expect(signHeight(1, false)).toBe(SIGN_HEIGHT.seated);
    expect(signHeight(0, false)).toBe(SIGN_HEIGHT.standing);
    expect(signHeight(0, false) - SIGN_SIZE.h / 2).toBeGreaterThan(TAG_TOP);
    expect(signHeight(0.5, false)).toBeCloseTo((SIGN_HEIGHT.seated + SIGN_HEIGHT.standing) / 2);
  });

  it('stacks above a speech bubble instead of covering it', () => {
    expect(signHeight(0, true)).toBe(BUBBLE.clear);
    expect(signHeight(0, true) - SIGN_SIZE.h / 2).toBeGreaterThan(BUBBLE_SPAN[1]);
    // seated, the bubble floats well above the sign already
    expect(signHeight(1, true)).toBe(SIGN_HEIGHT.seated);
    expect(signHeight(1, true) + SIGN_SIZE.h / 2).toBeLessThan(BUBBLE_SPAN[0]);
  });
});
