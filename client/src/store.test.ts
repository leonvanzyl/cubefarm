import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, PullInfo, QaStatus, QaView, RepoView, WorldSnapshot } from '../../shared/types';

// The merge trigger, through the store's own apply(): sounds and the gong are mocked (they need a browser).
vi.mock('./ui/sfx', () => ({ audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
vi.mock('./world/gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));

const { floorPrCounts, kanbanFor, qaKey, useStore } = await import('./store');
const { cue } = await import('./ui/sfx');
const { gongForMerge } = await import('./world/gongRunner');
const { onMerge } = await import('./world/confetti');

const pr = (number: number, state: PullInfo['state'], headRefName = `feature/${number}`) => ({ number, state, headRefName }) as PullInfo;
const repo = (floor: number, ...pulls: PullInfo[]) => ({ id: `acme/floor${floor}`, floor, pulls }) as RepoView;
const snapshot = (repos: RepoView[], agents: Partial<AgentView>[] = []) =>
  ({ type: 'snapshot', data: { repos, agents, qa: [], requests: [], messages: [], phoneReadAt: 0, settings: {}, ceo: {}, usage: {}, clis: [] } as unknown as WorldSnapshot }) as const;

describe('the merge gong trigger', () => {
  beforeEach(() => {
    useStore.setState({ loaded: false, repos: [] });
    vi.mocked(gongForMerge).mockClear().mockReturnValue('solo');
    vi.mocked(cue).mockClear();
  });

  it('never fires for merges in the first snapshot, or in a snapshot after a reconnect', () => {
    const { apply } = useStore.getState();
    apply(snapshot([repo(1, pr(1, 'MERGED'), pr(2, 'OPEN'))]));
    apply(snapshot([repo(1, pr(1, 'MERGED'), pr(2, 'MERGED'))])); // #2 merged while we were disconnected
    expect(gongForMerge).not.toHaveBeenCalled();
    expect(cue).not.toHaveBeenCalled();
  });

  it('fires on open → MERGED, for that repo’s floor', () => {
    const { apply } = useStore.getState();
    apply(snapshot([repo(1, pr(1, 'MERGED'), pr(2, 'OPEN'))]));
    apply({ type: 'repo', repo: repo(1, pr(1, 'MERGED'), pr(2, 'OPEN')) }); // nothing new
    expect(gongForMerge).not.toHaveBeenCalled();
    apply({ type: 'repo', repo: repo(1, pr(1, 'MERGED'), pr(2, 'MERGED')) });
    expect(gongForMerge).toHaveBeenCalledTimes(1);
    expect(gongForMerge).toHaveBeenCalledWith({ repoId: 'acme/floor1', prNumber: 2, agentId: null }, false);
    expect(cue).not.toHaveBeenCalledWith('merged'); // the gong is the merge cue now
  });

  it('still sends the merge confetti (confetti.ts) along with the gong', () => {
    const bursts: unknown[] = [];
    const off = onMerge((b) => bursts.push(b));
    const { apply } = useStore.getState();
    apply(snapshot([repo(1, pr(5, 'OPEN'))]));
    apply({ type: 'repo', repo: repo(1, pr(5, 'MERGED')) });
    off();
    expect(gongForMerge).toHaveBeenCalledTimes(1);
    expect(bursts).toEqual([{ repoId: 'acme/floor1', prNumber: 5, agentId: null }]);
  });

  it('sends the PR’s author, one call per merge in order', () => {
    const { apply } = useStore.getState();
    const ada = { id: 'a1', name: 'Ada', role: 'dev', repoId: 'acme/floor1', log: [] } as Partial<AgentView>;
    apply(snapshot([repo(1, pr(4, 'OPEN', 'swarm/issue-4-ada'), pr(5, 'OPEN'))], [ada]));
    apply({ type: 'repo', repo: repo(1, pr(4, 'MERGED', 'swarm/issue-4-ada'), pr(5, 'MERGED')) });
    expect(vi.mocked(gongForMerge).mock.calls.map(([b]) => b)).toEqual([
      { repoId: 'acme/floor1', prNumber: 4, agentId: 'a1' },
      { repoId: 'acme/floor1', prNumber: 5, agentId: null },
    ]);
  });

  it('chimes instead when the merge is on a floor whose gong is not on screen', () => {
    vi.mocked(gongForMerge).mockReturnValue('absent');
    const { apply } = useStore.getState();
    apply(snapshot([repo(2, pr(7, 'OPEN'))]));
    apply({ type: 'repo', repo: repo(2, pr(7, 'MERGED')) });
    expect(cue).toHaveBeenCalledWith('merged');
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

  it('does not count a needs-human PR the CEO is still triaging as needing you', () => {
    const r = floor(pr(1, 'OPEN'), pr(2, 'OPEN'));
    const qa = records([1, 'needs-human'], [2, 'needs-human']);
    qa[qaKey('acme/floor1', 1)] = { ...qa[qaKey('acme/floor1', 1)], ceoLooking: true };
    expect(floorPrCounts(r, qa)).toEqual({ inQa: 2, ready: 0, needsYou: 1 });
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

describe('kanbanFor: In progress', () => {
  const r = (...pulls: PullInfo[]) => ({ ...repo(1, ...pulls), issues: [{ number: 192, title: 'Cancelled', body: '', labels: [] }], autoMerge: false }) as unknown as RepoView;
  const barbara = (patch: Partial<AgentView>) => ({ id: 'b', name: 'Barbara', role: 'dev', task: 'issue', status: 'working', issueNumber: 192, issueTitle: 'Cancelled', prNumber: null, branch: 'swarm/issue-192-barbara', ...patch }) as AgentView;

  it('shows a developer working on an issue, and one who finished without a PR', () => {
    expect(kanbanFor(r(), [barbara({})], {}).progress.map((c) => c.note)).toEqual(['working']);
    expect(kanbanFor(r(), [barbara({ status: 'done' })], {}).progress.map((c) => c.note)).toEqual(['finished · no PR']);
  });

  it('shows no card once their PR is open, closed or merged: never "finished · no PR" for a PR that was closed', () => {
    const done = barbara({ status: 'done', prNumber: 198 });
    expect(kanbanFor(r(pr(198, 'OPEN')), [done], {}).progress).toEqual([]);
    expect(kanbanFor(r(), [done], {}).progress).toEqual([]); // GitHub's list leaves closed PRs out
    expect(kanbanFor(r(pr(198, 'CLOSED')), [done], {}).progress).toEqual([]);
    expect(kanbanFor(r(pr(198, 'MERGED')), [done], {}).progress).toEqual([]);
  });

  it('shows nothing for an agent whose task was cleared', () => {
    expect(kanbanFor(r(), [barbara({ status: 'idle', task: null, issueNumber: null, prNumber: null, branch: null })], {}).progress).toEqual([]);
  });

  it('marks an issue whose PR was closed as waiting for the manager, in the backlog', () => {
    const held = { ...r(), held: [{ issue: 192, pr: 198 }] } as RepoView;
    expect(kanbanFor(held, [], {}).backlog).toMatchObject([{ number: 192, note: '⏸ PR #198 closed · assign by hand', tone: 'warn' }]);
    expect(kanbanFor(r(), [], {}).backlog[0].tone).toBeUndefined();
  });
});
