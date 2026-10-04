import { describe, expect, it } from 'vitest';
import { branchIssue, issueTaken, issuesResolvedBy, RECENT_MERGE_MS, type ClaimAgent, type ClaimPull } from './issueClaims.ts';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const pull = (p: Partial<ClaimPull>): ClaimPull => ({ state: 'OPEN', headRefName: 'feature', closesIssues: [], mergedAt: null, ...p });
const dev = (a: Partial<ClaimAgent>): ClaimAgent => ({ role: 'dev', task: 'issue', issueNumber: null, status: 'working', ...a });

describe('branchIssue', () => {
  it('reads the issue from a swarm branch only', () => {
    expect(branchIssue('swarm/issue-12-ada')).toBe(12);
    expect(branchIssue('swarm/issue-12')).toBeNull();
    expect(branchIssue('fix/issue-12-ada')).toBeNull();
  });
});

describe('issuesResolvedBy', () => {
  it('adds the swarm branch issue to the linked ones', () => {
    expect(issuesResolvedBy({ headRefName: 'swarm/issue-12-x', closesIssues: [] })).toEqual([12]);
    expect(issuesResolvedBy({ headRefName: 'swarm/issue-12-x', closesIssues: [12, 14] })).toEqual([12, 14]);
  });

  it("only closes what a person's PR formally links", () => {
    expect(issuesResolvedBy({ headRefName: 'issue-12-fix', closesIssues: [] })).toEqual([]);
    expect(issuesResolvedBy({ headRefName: 'issue-12-fix', closesIssues: [3] })).toEqual([3]);
  });
});

describe('issueTaken', () => {
  it('is free with nothing on it', () => {
    expect(issueTaken(12, [], [], NOW)).toBe(false);
  });

  it('is taken while a developer works on it', () => {
    expect(issueTaken(12, [dev({ issueNumber: 12 })], [], NOW)).toBe(true);
    expect(issueTaken(12, [dev({ issueNumber: 12, status: 'idle' })], [], NOW)).toBe(false);
    expect(issueTaken(12, [dev({ issueNumber: 12, task: 'qa' })], [], NOW)).toBe(false);
  });

  it('is taken by an open PR that closes it', () => {
    expect(issueTaken(12, [], [pull({ closesIssues: [12] })], NOW)).toBe(true);
  });

  it('is done once a PR for it merged recently', () => {
    expect(issueTaken(12, [], [pull({ state: 'MERGED', closesIssues: [12], mergedAt: ago(2_000) })], NOW)).toBe(true);
  });

  it('forgets a merge after a few hours', () => {
    expect(issueTaken(12, [], [pull({ state: 'MERGED', closesIssues: [12], mergedAt: ago(RECENT_MERGE_MS + 1) })], NOW)).toBe(false);
  });

  it('counts a swarm branch without "Closes #N", open or merged', () => {
    expect(issueTaken(12, [], [pull({ headRefName: 'swarm/issue-12-ada' })], NOW)).toBe(true);
    expect(issueTaken(12, [], [pull({ state: 'MERGED', headRefName: 'swarm/issue-12-ada', mergedAt: ago(1_000) })], NOW)).toBe(true);
    expect(issueTaken(1, [], [pull({ headRefName: 'swarm/issue-12-ada' })], NOW)).toBe(false);
  });

  it('leaves the issue free when its PR was closed without merging', () => {
    expect(issueTaken(12, [], [pull({ state: 'CLOSED', headRefName: 'swarm/issue-12-ada', closesIssues: [12] })], NOW)).toBe(false);
  });

  it("only counts what a person's PR links", () => {
    expect(issueTaken(12, [], [pull({ headRefName: 'leon/issue-12-fix' })], NOW)).toBe(false);
    expect(issueTaken(12, [], [pull({ state: 'MERGED', headRefName: 'leon/fix', closesIssues: [12], mergedAt: ago(1_000) })], NOW)).toBe(true);
  });
});
