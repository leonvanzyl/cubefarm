import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, PullInfo, RepoView, WorldSnapshot } from '../../shared/types';

// The merge trigger, through the store's own apply(): sounds and the gong are mocked (they need a browser).
vi.mock('./ui/sfx', () => ({ chirp: vi.fn(), cue: vi.fn() }));
vi.mock('./world/gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));

const { useStore } = await import('./store');
const { cue } = await import('./ui/sfx');
const { gongForMerge } = await import('./world/gongRunner');

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
