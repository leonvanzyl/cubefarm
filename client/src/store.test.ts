import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullInfo, QaStatus, QaView, RepoView, WorldSnapshot } from '../../shared/types';

// The merge trigger, through the store's own apply(): sounds and the gong are mocked (they need a browser).
vi.mock('./ui/sfx', () => ({ audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
vi.mock('./world/gongState', () => ({ hitGong: vi.fn(() => 'boom') }));

const { floorPrCounts, kanbanFor, qaKey, useStore } = await import('./store');
const { cue } = await import('./ui/sfx');
const { hitGong } = await import('./world/gongState');
const { onMerge } = await import('./world/confetti');

const pr = (number: number, state: PullInfo['state']) => ({ number, state, headRefName: `swarm/issue-${number}-nobody` }) as PullInfo;
const repo = (floor: number, ...pulls: PullInfo[]) => ({ id: `acme/floor${floor}`, floor, pulls }) as RepoView;
const snapshot = (...repos: RepoView[]) =>
  ({ type: 'snapshot', data: { repos, agents: [], qa: [], requests: [], messages: [], phoneReadAt: 0, settings: {}, ceo: {}, usage: {}, clis: [] } as unknown as WorldSnapshot }) as const;

describe('the merge gong trigger', () => {
  beforeEach(() => {
    useStore.setState({ loaded: false, repos: [] });
    vi.mocked(hitGong).mockClear().mockReturnValue('boom');
    vi.mocked(cue).mockClear();
  });

  it('never fires for merges in the first snapshot, or in a snapshot after a reconnect', () => {
    const { apply } = useStore.getState();
    apply(snapshot(repo(1, pr(1, 'MERGED'), pr(2, 'OPEN'))));
    apply(snapshot(repo(1, pr(1, 'MERGED'), pr(2, 'MERGED')))); // #2 merged while we were disconnected
    expect(hitGong).not.toHaveBeenCalled();
    expect(cue).not.toHaveBeenCalled();
  });

  it('fires on open → MERGED, celebrating on that repo’s floor', () => {
    const { apply } = useStore.getState();
    apply(snapshot(repo(1, pr(1, 'MERGED'), pr(2, 'OPEN'))));
    apply({ type: 'repo', repo: repo(1, pr(1, 'MERGED'), pr(2, 'OPEN')) }); // nothing new
    expect(hitGong).not.toHaveBeenCalled();
    apply({ type: 'repo', repo: repo(1, pr(1, 'MERGED'), pr(2, 'MERGED')) });
    expect(hitGong).toHaveBeenCalledTimes(1);
    expect(hitGong).toHaveBeenCalledWith({ repoId: 'acme/floor1', celebrate: true });
    expect(cue).not.toHaveBeenCalledWith('merged'); // the gong is the merge cue now
  });

  it('still sends the merge confetti (confetti.ts) along with the gong', () => {
    const bursts: unknown[] = [];
    const off = onMerge((b) => bursts.push(b));
    const { apply } = useStore.getState();
    apply(snapshot(repo(1, pr(5, 'OPEN'))));
    apply({ type: 'repo', repo: repo(1, pr(5, 'MERGED')) });
    off();
    expect(hitGong).toHaveBeenCalledTimes(1);
    expect(bursts).toEqual([{ repoId: 'acme/floor1', prNumber: 5, agentId: null }]);
  });

  it('chimes instead when the merge is on a floor whose gong is not on screen', () => {
    vi.mocked(hitGong).mockReturnValue('absent');
    const { apply } = useStore.getState();
    apply(snapshot(repo(2, pr(7, 'OPEN'))));
    apply({ type: 'repo', repo: repo(2, pr(7, 'MERGED')) });
    expect(cue).toHaveBeenCalledWith('merged');
  });

  it('a strike while the gong still rings is not "absent", so there is no extra chime', () => {
    vi.mocked(hitGong).mockReturnValue('ringing');
    const { apply } = useStore.getState();
    apply(snapshot(repo(1, pr(3, 'OPEN'))));
    apply({ type: 'repo', repo: repo(1, pr(3, 'MERGED')) });
    expect(hitGong).toHaveBeenCalledTimes(1);
    expect(cue).not.toHaveBeenCalled();
  });
});

describe('floorPrCounts', () => {
  const floor = (...pulls: PullInfo[]) => ({ ...repo(1, ...pulls), issues: [], autoMerge: false }) as RepoView;
  const draft = (number: number) => ({ ...pr(number, 'OPEN'), isDraft: true }) as PullInfo;
  const records = (...recs: [number, QaStatus][]) =>
    Object.fromEntries(recs.map(([n, status]) => [qaKey('acme/floor1', n), { repoId: 'acme/floor1', prNumber: n, status, round: 1 } as QaView]));

  it('counts an open passed PR as ready, but never a merged or closed one', () => {
    const r = floor(pr(1, 'OPEN'), pr(2, 'MERGED'), pr(3, 'CLOSED'));
    expect(floorPrCounts(r, records([1, 'passed'], [2, 'passed'], [3, 'failed']))).toEqual({ inQa: 0, ready: 1, needsYou: 0 });
  });

  it('counts needs-human separately, as well as in QA', () => {
    const r = floor(pr(1, 'OPEN'), pr(2, 'OPEN'), pr(3, 'OPEN'));
    expect(floorPrCounts(r, records([1, 'needs-human'], [2, 'fixing']))).toEqual({ inQa: 3, ready: 0, needsYou: 1 });
  });

  it('matches the Kanban In QA and Ready to merge columns, drafts included', () => {
    const r = floor(pr(1, 'OPEN'), draft(2), draft(3), pr(4, 'OPEN'), pr(5, 'OPEN'), pr(6, 'MERGED'), pr(7, 'CLOSED'));
    const qa = records([1, 'passed'], [2, 'passed'], [4, 'testing'], [5, 'needs-human'], [6, 'passed'], [7, 'needs-human']);
    const cols = kanbanFor(r, [], qa);
    const counts = floorPrCounts(r, qa);
    expect(counts).toEqual({ inQa: 3, ready: 2, needsYou: 1 });
    expect([counts.inQa, counts.ready]).toEqual([cols.qa.length, cols.ready.length]);
  });
});
