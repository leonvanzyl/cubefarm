import { describe, expect, it } from 'vitest';
import type { PullInfo, QaView } from '../../../../shared/types';
import { FRESH, STAY, arrival, arriveAt, createWhere, hardTimes, pickFloor, settle, troubledPr } from './dogTravel';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('the dog between floors', () => {
  it("stays put while you watch it, and moves on after a while when you don't", () => {
    const w = createWhere(1, 0, 0);
    expect(w.stay).toBe(STAY.min);
    expect(settle(w, STAY.max * 2, true, [0, 1, 2], 1, new Set(), seq(0.5))).toBe(false);
    expect(settle(w, STAY.min - 1, false, [0, 1, 2], 2, new Set(), seq(0.5))).toBe(false);
    expect(settle(w, STAY.min + 1, false, [0, 1, 2], 2, new Set(), seq(0.5))).toBe(true);
    expect(w.floor).not.toBe(1);
    expect(w.rides).toBe(1);
    expect(w.arriving).toBe('cabin');
  });

  it("goes to another floor, preferring yours and ones where someone's struggling", () => {
    expect(pickFloor(0, [0], 0, new Set(), 0.3)).toBe(0);
    const count = (player: number, troubled: Set<number>) => {
      const n = new Map<number, number>();
      for (let r = 0; r < 1; r += 0.001) {
        const f = pickFloor(0, [0, 1, 2, 3], player, troubled, r);
        n.set(f, (n.get(f) ?? 0) + 1);
      }
      return n;
    };
    const plain = count(-1, new Set());
    expect(plain.get(0)).toBeUndefined();
    expect(Math.abs(plain.get(1)! - plain.get(3)!)).toBeLessThan(10);
    expect(count(2, new Set()).get(2)!).toBeGreaterThan(plain.get(2)! * 1.3);
    const troubled = count(-1, new Set([3]));
    expect(troubled.get(3)!).toBeGreaterThan(troubled.get(1)! * 2.5);
  });

  it('comes out of the elevator when you are there as it arrives, else it is just about', () => {
    const w = createWhere(0, 0, 0);
    arriveAt(w, 2, 1000, 'cabin', 0);
    expect(arrival(w, 1000 + FRESH / 2)).toBe('cabin');
    expect(arrival(w, 1000 + FRESH * 2)).toBe('here');
    arriveAt(w, 1, 5000, 'player', 0);
    expect(arrival(w, 5000 + FRESH * 10)).toBe('player');
  });

  it("leaves a floor that's gone for one that's there", () => {
    const w = createWhere(4, 0, 0);
    expect(settle(w, 10, true, [0, 1], 1, new Set(), seq(0))).toBe(true);
    expect(w.floor).toBe(1);
  });
});

const pr = (number: number, over: Partial<PullInfo> = {}): PullInfo =>
  ({ number, title: '', url: '', headRefName: `swarm/issue-${number}-x`, state: 'OPEN', checks: 'passing', ...over }) as PullInfo;
const rec = (prNumber: number, over: Partial<QaView>): QaView =>
  ({ repoId: 'o/r', prNumber, status: 'testing', round: 1, devAgentId: null, qaAgentId: null, summary: null, checks: [], commentUrl: null, mergeNote: null, ceoLooking: false, updatedAt: 0, ...over }) as QaView;

describe('who is having a hard time', () => {
  const agents = [
    { id: 'ada', role: 'agent' as const, task: 'issue' as const, repoId: 'o/r', prNumber: 1, branch: 'swarm/issue-1-ada' },
    { id: 'bob', role: 'agent' as const, task: null, repoId: 'o/r', prNumber: null, branch: 'swarm/issue-2-bob' },
    { id: 'cy', role: 'agent' as const, task: null, repoId: 'o/r', prNumber: 3, branch: null },
    // testing PR 4: its number, but not its author
    { id: 'qa1', role: 'agent' as const, task: 'qa' as const, repoId: 'o/r', prNumber: 4, branch: null },
    { id: 'eve', role: 'agent' as const, task: null, repoId: 'x/y', prNumber: 1, branch: null },
  ];

  it('red checks, needs-human and a third round of fixes count; the rest does not', () => {
    expect(troubledPr({ state: 'OPEN', checks: 'failing' }, undefined)).toBe(true);
    expect(troubledPr({ state: 'MERGED', checks: 'failing' }, undefined)).toBe(false);
    expect(troubledPr({ state: 'OPEN', checks: 'pending' }, rec(1, { status: 'needs-human' }))).toBe(true);
    expect(troubledPr({ state: 'OPEN', checks: 'passing' }, rec(1, { status: 'fixing', round: 3 }))).toBe(true);
    expect(troubledPr({ state: 'OPEN', checks: 'passing' }, rec(1, { status: 'fixing', round: 2 }))).toBe(false);
    expect(troubledPr({ state: 'OPEN', checks: 'passing' }, rec(1, { status: 'testing', round: 4 }))).toBe(false);
  });

  it("finds each troubled PR's author on the floor, by QA record, PR number or branch", () => {
    const repo = {
      id: 'o/r',
      pulls: [pr(1, { checks: 'failing' }), pr(2, { headRefName: 'swarm/issue-2-bob' }), pr(3), pr(4, { checks: 'failing', headRefName: 'someone-else' })],
    };
    const qa = { 'o/r#2': rec(2, { status: 'needs-human' }), 'o/r#3': rec(3, { status: 'failed', round: 3, devAgentId: 'cy', qaAgentId: 'qa1' }) };
    expect(hardTimes(repo, agents, qa)).toEqual(['ada', 'bob', 'cy']);
    expect(hardTimes({ id: 'o/r', pulls: [] }, agents, {})).toEqual([]);
    // QA's probe: forced red
    expect(hardTimes({ id: 'o/r', pulls: [] }, agents, {}, new Set(['bob', 'eve']))).toEqual(['bob']);
  });
});
