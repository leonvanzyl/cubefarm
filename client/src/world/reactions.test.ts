import { describe, expect, it } from 'vitest';
import { mergedBy, neighboursOf, newlyErrored, newlyMerged, newlyPassed } from './reactions';

const pull = (number: number, state: 'OPEN' | 'MERGED' | 'CLOSED', headRefName = `swarm/issue-${number}-ada`) => ({ number, state, headRefName });

describe('desk reactions', () => {
  it('facepalms only when a status turns to error', () => {
    expect(newlyErrored({ a: { status: 'working' }, b: { status: 'error' } }, { a: { status: 'error' }, b: { status: 'error' }, c: { status: 'error' } })).toEqual(['a']);
    expect(newlyErrored({ a: { status: 'error' } }, { a: { status: 'idle' } })).toEqual([]);
  });

  it('fist pumps for the developer whose PR just passed QA', () => {
    const prev = { 'o/r#1': { status: 'testing' as const, devAgentId: 'ada' }, 'o/r#2': { status: 'passed' as const, devAgentId: 'bob' } };
    const next = { 'o/r#1': { status: 'passed' as const, devAgentId: 'ada' }, 'o/r#2': { status: 'passed' as const, devAgentId: 'bob' }, 'o/r#3': { status: 'passed' as const, devAgentId: null } };
    expect(newlyPassed(prev, next)).toEqual(['ada']);
    expect(newlyPassed(next, { 'o/r#1': { status: 'failed', devAgentId: 'ada' } })).toEqual([]);
  });

  it('finds PRs that were open and are now merged', () => {
    const prev = [{ id: 'o/r', pulls: [pull(1, 'OPEN'), pull(2, 'OPEN'), pull(3, 'MERGED')] }];
    const next = [
      { id: 'o/r', pulls: [pull(1, 'MERGED'), pull(2, 'CLOSED'), pull(3, 'MERGED')] },
      { id: 'o/new', pulls: [pull(9, 'MERGED')] },
    ];
    expect(newlyMerged(prev, next)).toEqual([{ repoId: 'o/r', number: 1, headRefName: 'swarm/issue-1-ada' }]);
  });

  it('works out who merged from QA, their PR number or their branch', () => {
    const pr = { repoId: 'o/r', number: 4, headRefName: 'swarm/issue-7-cy' };
    const agents = [
      { id: 'bob', repoId: 'o/other', prNumber: 4, branch: null },
      { id: 'cy', repoId: 'o/r', prNumber: null, branch: 'swarm/issue-7-cy' },
    ];
    expect(mergedBy(pr, 'ada', agents)).toBe('ada');
    expect(mergedBy(pr, null, agents)).toBe('cy');
    expect(mergedBy(pr, undefined, [{ id: 'dee', repoId: 'o/r', prNumber: 4, branch: null }])).toBe('dee');
    expect(mergedBy(pr, null, [])).toBeNull();
  });

  it('neighbours are the desks around yours, nearest first', () => {
    const seats = new Map([
      ['me', { seatX: 0, seatZ: 0 }],
      ['beside', { seatX: 7, seatZ: 0 }],
      ['behind', { seatX: 0, seatZ: 4.6 }],
      ['diagonal', { seatX: 7, seatZ: 4.6 }],
      ['far', { seatX: 14, seatZ: 0 }],
    ]);
    expect(neighboursOf('me', seats)).toEqual(['behind', 'beside']);
    expect(neighboursOf('nobody', seats)).toEqual([]);
  });
});
