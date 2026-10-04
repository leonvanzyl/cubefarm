import { describe, expect, it } from 'vitest';
import { KEYBOARDS, MOUSE_CLICK, WHEEL_NOTCH, keyboardFor, renderKey } from './keyboards';

describe('keyboards', () => {
  it('renders short, normalized, click-free samples', () => {
    for (const sound of [...KEYBOARDS.flatMap((k) => [k.key, k.thunk]), MOUSE_CLICK, WHEEL_NOTCH]) {
      const s = renderKey(sound, 48000, 7);
      expect(s.length).toBeGreaterThan(48);
      expect(s.length).toBeLessThan(48000 * 0.3);
      let peak = 0;
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeCloseTo(1, 5);
      expect(Math.abs(s[s.length - 1])).toBe(0);
    }
  });

  it('renders the same sample for the same seed, and a different one otherwise', () => {
    const k = KEYBOARDS[1].key;
    expect(renderKey(k, 44100, 3)).toEqual(renderKey(k, 44100, 3));
    expect(renderKey(k, 44100, 3)).not.toEqual(renderKey(k, 44100, 4));
  });

  it('spreads people over the keyboards', () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => keyboardFor(i * 2654435761)));
    expect(used.size).toBe(KEYBOARDS.length);
  });
});
