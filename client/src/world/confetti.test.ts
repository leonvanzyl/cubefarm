import { describe, expect, it } from 'vitest';
import type { PullInfo, QaView, RepoView } from '../../../shared/types';
import { canBurst, emitMerge, mergeAuthor, mergeBursts, newlyMerged, onMerge, recentQaRecord, rememberQa } from './confetti';

const pr = (number: number, state: PullInfo['state'], headRefName = `swarm/issue-${number}-ada`) => ({ number, state, headRefName }) as PullInfo;
const repo = (pulls: PullInfo[]) => ({ id: 'o/r', pulls }) as RepoView;
const qa = (devAgentId: string | null) => ({ repoId: 'o/r', prNumber: 7, devAgentId }) as QaView;
const agents = [
  { id: 'a1', name: 'Ada', role: 'dev' as const, repoId: 'o/r' },
  { id: 'a2', name: 'Grace Hopper', role: 'dev' as const, repoId: 'o/r' },
  { id: 'q1', name: 'Linus', role: 'qa' as const, repoId: 'o/r' },
  { id: 'x1', name: 'Ada', role: 'dev' as const, repoId: 'o/other' },
];

describe('newlyMerged', () => {
  it('only counts PRs that were open before', () => {
    expect(newlyMerged([pr(1, 'OPEN'), pr(2, 'MERGED')], [pr(1, 'MERGED'), pr(2, 'MERGED'), pr(3, 'MERGED')]).map((p) => p.number)).toEqual([1]);
    expect(newlyMerged(undefined, [pr(1, 'MERGED')])).toEqual([]);
    expect(newlyMerged([pr(1, 'OPEN')], [pr(1, 'CLOSED')])).toEqual([]);
  });
});

describe('mergeAuthor', () => {
  it('uses the QA record first', () => {
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-ada'), qa('a2'), agents)).toBe('a2');
  });

  it('falls back to the branch name, ignoring case', () => {
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-ADA'), undefined, agents)).toBe('a1');
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-grace-hopper'), qa(null), agents)).toBe('a2');
    // a QA record whose developer left the floor
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-ada'), qa('gone'), agents)).toBe('a1');
  });

  it('finds nobody for PRs opened outside the office', () => {
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'feature/login'), undefined, agents)).toBeNull();
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-linus'), undefined, agents)).toBeNull(); // QA, not a dev
    expect(mergeAuthor('o/r', pr(7, 'MERGED', 'swarm/issue-7-nobody'), undefined, agents)).toBeNull();
  });
});

describe('mergeBursts', () => {
  const before = repo([pr(7, 'OPEN'), pr(8, 'OPEN', 'main-hotfix')]);
  const after = repo([pr(7, 'MERGED'), pr(8, 'MERGED', 'main-hotfix')]);

  it('fires once per new merge with its author', () => {
    expect(mergeBursts(true, before, after, () => undefined, agents)).toEqual([
      { repoId: 'o/r', prNumber: 7, agentId: 'a1' },
      { repoId: 'o/r', prNumber: 8, agentId: null },
    ]);
  });

  it('never fires before the first snapshot or for merges a snapshot already had', () => {
    expect(mergeBursts(false, before, after, () => undefined, agents)).toEqual([]);
    expect(mergeBursts(true, after, after, () => undefined, agents)).toEqual([]);
  });

  it('remembers a QA record dropped just before the merge shows up', () => {
    rememberQa('o/r#7', qa('a2'));
    expect(mergeBursts(true, before, after, (n) => recentQaRecord(`o/r#${n}`), agents)[0].agentId).toBe('a2');
  });
});

describe('canBurst', () => {
  const open = { hidden: false, covered: false, reducedMotion: false };

  it('bursts only while the office is on screen and moving', () => {
    expect(canBurst(open)).toBe(true);
    expect(canBurst({ ...open, hidden: true })).toBe(false);
    expect(canBurst({ ...open, covered: true })).toBe(false); // terminal, Kanban or manager's console open
    expect(canBurst({ ...open, reducedMotion: true })).toBe(false);
  });
});

describe('merge event', () => {
  it('reaches listeners until they unsubscribe', () => {
    const got: number[] = [];
    const off = onMerge((b) => got.push(b.prNumber));
    emitMerge({ repoId: 'o/r', prNumber: 1, agentId: null });
    off();
    emitMerge({ repoId: 'o/r', prNumber: 2, agentId: null });
    expect(got).toEqual([1]);
  });
});
