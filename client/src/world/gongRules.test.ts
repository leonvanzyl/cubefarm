import { describe, expect, it } from 'vitest';
import type { PullInfo, RepoView } from '../../../shared/types';
import { CELEBRATE_MS, GONG_GAP_MS, SWING, celebrating, createGong, flashLevel, newlyMerged, strike, swingAngle, twistAngle } from './gongRules';

const pr = (number: number, state: PullInfo['state']) => ({ number, state }) as PullInfo;
const repo = (...pulls: PullInfo[]) => ({ id: 'acme/app', pulls }) as RepoView;

describe('newlyMerged', () => {
  it('finds the PRs that went from open to merged', () => {
    expect(newlyMerged(repo(pr(1, 'OPEN'), pr(2, 'OPEN'), pr(3, 'OPEN')), repo(pr(1, 'MERGED'), pr(2, 'OPEN'), pr(3, 'MERGED')))).toEqual([1, 3]);
  });

  it('ignores merges it never saw open: already merged, closed first, or new to it', () => {
    expect(newlyMerged(repo(pr(1, 'MERGED')), repo(pr(1, 'MERGED')))).toEqual([]);
    expect(newlyMerged(repo(pr(1, 'CLOSED')), repo(pr(1, 'MERGED')))).toEqual([]);
    expect(newlyMerged(repo(), repo(pr(4, 'MERGED')))).toEqual([]);
    expect(newlyMerged(undefined, repo(pr(1, 'MERGED')))).toEqual([]);
  });

  it('ignores PRs that were closed without merging', () => {
    expect(newlyMerged(repo(pr(1, 'OPEN')), repo(pr(1, 'CLOSED')))).toEqual([]);
  });
});

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
    expect(g.burstAt).toBe(1500);
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
