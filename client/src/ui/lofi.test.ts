import { describe, expect, it } from 'vitest';
import { CRACKLES_PER_SEC, CRACKLE_SECONDS, HISS, MIN_GAP, POPS_PER_SEC, WOBBLE, cracklePops, fillCrackle, wobbleCents } from './lofi';

/** A seeded source of [0, 1) numbers, so every run sees the same bed. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('cracklePops', () => {
  it('scatters small crackles and a few big pops at about the right rate', () => {
    const secs = 600;
    const pops = cracklePops(secs, seeded(1));
    const big = pops.filter((p) => p.size >= 0.6).length;
    expect(pops.length / secs).toBeGreaterThan(CRACKLES_PER_SEC * 0.85);
    expect(pops.length / secs).toBeLessThan((CRACKLES_PER_SEC + POPS_PER_SEC) * 1.1);
    expect(big / secs).toBeGreaterThan(POPS_PER_SEC * 0.6);
    expect(big / secs).toBeLessThan(POPS_PER_SEC * 1.4);
  });

  it('keeps them in order, apart, inside the bed and in range', () => {
    const pops = cracklePops(CRACKLE_SECONDS, seeded(7));
    expect(pops.length).toBeGreaterThan(10);
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      expect(p.size).toBeGreaterThan(0), expect(p.size).toBeLessThanOrEqual(1);
      expect(p.len).toBeGreaterThan(0), expect(p.len).toBeLessThan(0.005);
      expect(p.at).toBeGreaterThanOrEqual(0);
      expect(p.at + p.len).toBeLessThan(CRACKLE_SECONDS);
      if (i) expect(p.at - pops[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP);
    }
  });

  it('lets the bigger of two pops that land together win', () => {
    // a small crackle at 0.1 s and a bigger one 5 ms later, then nothing more inside half a second
    const rolls = [1 - Math.exp(-0.7), 0, 0, 1 - Math.exp(-0.035), 0.99, 0, 0.999, 0.999];
    let i = 0;
    const pops = cracklePops(0.5, () => rolls[i++]);
    expect(pops).toHaveLength(1);
    expect(pops[0].at).toBeCloseTo(0.105);
    expect(pops[0].size).toBeCloseTo(0.12 + 0.3 * 0.99);
  });
});

describe('fillCrackle', () => {
  const rate = 8000;
  const out = new Float32Array(Math.round(CRACKLE_SECONDS * rate));
  const pops = fillCrackle(out, rate, seeded(3));

  it('is a quiet hiss between the pops, with no rumble', () => {
    const quiet = out.filter((_, i) => !pops.some((p) => Math.abs(i / rate - p.at) < 0.01));
    const rms = Math.sqrt(quiet.reduce((s, v) => s + v * v, 0) / quiet.length);
    expect(rms).toBeGreaterThan(HISS * 0.2);
    expect(rms).toBeLessThan(HISS);
    const mean = out.reduce((s, v) => s + v, 0) / out.length;
    expect(Math.abs(mean)).toBeLessThan(0.005);
  });

  it('puts every pop in at its size, and never clips', () => {
    for (const p of pops) {
      const at = Math.floor(p.at * rate);
      expect(Math.abs(out[at])).toBeGreaterThan(p.size * 0.7);
    }
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

describe('the tape wobble', () => {
  it('bends the pitch slightly: a few cents, slower than once a second', () => {
    const cents = wobbleCents(WOBBLE.hz, WOBBLE.depth);
    expect(cents).toBeGreaterThan(4);
    expect(cents).toBeLessThan(15);
    expect(WOBBLE.hz).toBeLessThan(1);
    expect(WOBBLE.depth).toBeLessThan(WOBBLE.delay); // the delay never swings below zero
  });

  it('measures the bend', () => {
    expect(wobbleCents(1, 0)).toBe(0);
    expect(wobbleCents(1, 1 / (2 * Math.PI))).toBeCloseTo(1200); // ±100% speed is an octave up at the peak
  });
});
