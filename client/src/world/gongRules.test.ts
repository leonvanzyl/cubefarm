import { describe, expect, it } from 'vitest';
import { CELEBRATE_MS, GONG_GAP_MS, SWING, celebrating, createGong, flashLevel, strike, swingAngle, twistAngle } from './gongRules';

describe('strike', () => {
  it('booms only on the floor whose gong is on screen', () => {
    const g = createGong();
    expect(strike(g, 1000)).toBe('absent'); // the lobby: no gong
    g.here = 'acme/app';
    expect(strike(g, 1000, { repoId: 'acme/other', celebrate: true })).toBe('absent');
    expect(celebrating(g, 'acme/other', 1000)).toBe(false);
    expect(strike(g, 1000)).toBe('boom');
    expect(g.hits).toBe(1);
  });

  it('is rate-limited: strikes inside the gap do nothing, the next one after it booms', () => {
    const g = createGong();
    g.here = 'acme/app';
    expect(strike(g, 5000)).toBe('boom');
    for (let t = 5000; t < 5000 + GONG_GAP_MS; t += 100) expect(strike(g, t)).toBe('ringing');
    expect(g.hits).toBe(1);
    expect(strike(g, 5000 + GONG_GAP_MS)).toBe('boom');
    expect(g.hits).toBe(2);
  });

  it('celebrates only when asked (a merge), and for CELEBRATE_MS', () => {
    const g = createGong();
    g.here = 'acme/app';
    strike(g, 1000);
    expect(celebrating(g, 'acme/app', 1001)).toBe(false); // the player banging it for fun
    strike(g, 10_000, { repoId: 'acme/app', celebrate: true });
    expect(celebrating(g, 'acme/app', 10_001)).toBe(true);
    expect(celebrating(g, 'acme/app', 10_000 + CELEBRATE_MS - 1)).toBe(true);
    expect(celebrating(g, 'acme/app', 10_000 + CELEBRATE_MS)).toBe(false);
    expect(celebrating(g, 'acme/other', 10_001)).toBe(false);
  });

  it('a merge while the gong is still ringing still starts the party, without a second boom', () => {
    const g = createGong();
    g.here = 'acme/app';
    strike(g, 1000);
    expect(strike(g, 1500, { celebrate: true })).toBe('ringing');
    expect(g.hits).toBe(1);
    expect(celebrating(g, 'acme/app', 1600)).toBe(true);
    expect(celebrating(g, 'acme/app', 1500 + CELEBRATE_MS - 1)).toBe(true);
  });
});

describe('the swing', () => {
  it('starts at rest, swings back first, stays within its amplitude and settles', () => {
    expect(swingAngle(0)).toBe(0);
    expect(swingAngle(0.2)).toBeGreaterThan(0);
    let max = 0;
    for (let t = 0; t <= SWING.settle + 1; t += 0.01) {
      max = Math.max(max, Math.abs(swingAngle(t)), Math.abs(twistAngle(t)));
      expect(flashLevel(t)).toBeGreaterThanOrEqual(0);
      expect(flashLevel(t)).toBeLessThanOrEqual(1);
    }
    expect(max).toBeLessThanOrEqual(SWING.amp);
    expect(Math.abs(swingAngle(SWING.settle - 0.01))).toBeLessThan(0.01);
    expect(swingAngle(SWING.settle + 0.1)).toBe(0);
    expect(flashLevel(SWING.settle + 0.1)).toBe(0);
    expect(flashLevel(Infinity)).toBe(0); // never struck
  });

  it('flashes bright right at the strike', () => {
    expect(flashLevel(0)).toBe(1);
    expect(flashLevel(1)).toBeLessThan(0.3);
  });
});
