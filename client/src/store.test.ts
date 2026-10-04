import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, IssueInfo, LogLine, OpsAlarm, PullInfo, QaStatus, QaView, RepoView, WorldSnapshot } from '../../shared/types';

// The merge trigger, through the store's own apply(): sounds and the gong are mocked (they need a browser).
vi.mock('./ui/sfx', () => ({ alarm: vi.fn(), audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
vi.mock('./world/gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));

const { floorPrCounts, kanbanFor, qaKey, useStore } = await import('./store');
const { alarm, cue } = await import('./ui/sfx');
const { EMPTY_OPS } = await import('./ops');
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

  it('fires the same for a merge in a batch of floor patches, which keep what they leave out', () => {
    const { apply } = useStore.getState();
    apply(snapshot([{ ...repo(1, pr(3, 'OPEN')), fullName: 'acme/floor1' }, repo(2)]));
    apply({ type: 'repos', repos: [{ id: 'acme/floor1', pulls: [pr(3, 'MERGED')] }, { id: 'acme/gone', pulls: [] }] });
    expect(gongForMerge).toHaveBeenCalledWith({ repoId: 'acme/floor1', prNumber: 3, agentId: null }, false);
    expect(useStore.getState().repos.map((r) => [r.id, r.fullName])).toEqual([
      ['acme/floor1', 'acme/floor1'],
      ['acme/floor2', undefined],
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

describe('mission control in the store', () => {
  const alarmFor = (id: string): OpsAlarm => ({ id, kind: 'pr', repoId: 'acme/floor1', floor: 1, prNumber: 7, agentId: null, text: 'PR #7 needs you', since: 1 });
  const ops = (...ids: string[]) => ({ type: 'ops', ops: { ...EMPTY_OPS, alarms: ids.map(alarmFor) } }) as const;

  beforeEach(() => {
    useStore.setState({ loaded: false, repos: [], ops: EMPTY_OPS });
    vi.mocked(alarm).mockClear();
  });

  it('sounds the alarm when a new alarm arrives, never for the snapshot or one already ringing', () => {
    const { apply } = useStore.getState();
    apply({ ...snapshot([]), data: { ...snapshot([]).data, ops: { ...EMPTY_OPS, alarms: [alarmFor('pr:a#1')] } } });
    expect(alarm).not.toHaveBeenCalled();
    apply(ops('pr:a#1'));
    expect(alarm).not.toHaveBeenCalled();
    apply(ops('pr:a#1', 'agent:x'));
    expect(alarm).toHaveBeenCalledTimes(1);
    apply(ops('agent:x')); // handled: the beacon stops, nothing sounds
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(useStore.getState().ops.alarms.map((a) => a.id)).toEqual(['agent:x']);
  });

  it('marks backlog issues auto-assign would start as paced while Claude usage holds them back', () => {
    const issue = (number: number, body = '', labels: string[] = []) => ({ number, title: `#${number}`, body, url: '', labels, createdAt: '' }) as IssueInfo;
    const r = { ...repo(1), issues: [issue(1), issue(2, 'Depends on #1'), issue(3, '', ['swarm:frontend'])], autoAssign: true, autoMerge: true } as RepoView;
    const notes = (usage?: { state: 'normal' | 'pacing' | 'paused' }, autoAssign = true) => kanbanFor({ ...r, autoAssign }, [], {}, usage).backlog.map((c) => c.note);
    expect(notes()).toEqual([undefined, '⏳ after #1', '🎯 frontend']);
    expect(notes({ state: 'normal' })).toEqual([undefined, '⏳ after #1', '🎯 frontend']);
    expect(notes({ state: 'pacing' })).toEqual(['⏸ paced', '⏳ after #1', '⏸ paced · 🎯 frontend']);
    expect(notes({ state: 'paused' })).toEqual(['⏸ paused', '⏳ after #1', '⏸ paused · 🎯 frontend']);
    expect(notes({ state: 'pacing' }, false)).toEqual([undefined, '⏳ after #1', '🎯 frontend']); // nothing starts on its own there anyway
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

describe('batched agents and watched terminal lines (#228)', () => {
  const line = (id: number, kind: LogLine['kind'] = 'tool') => ({ id, t: id, kind, text: `line ${id}` }) as LogLine;
  const ken = { id: 'ken', name: 'Ken', role: 'dev', status: 'working', currentTool: 'Read', repoId: 'acme/floor1', log: [] } as Partial<AgentView>;

  beforeEach(() => {
    useStore.setState({ loaded: false });
    useStore.getState().apply(snapshot([repo(1)], [ken]));
    vi.mocked(cue).mockClear();
  });

  it('merges a batch of agent changes in one update, and makes someone new from a full view', () => {
    const { apply } = useStore.getState();
    apply({ type: 'agents', agents: [{ id: 'ken', currentTool: 'Edit' }, { ...ken, id: 'ada', name: 'Ada' } as AgentView, { id: 'gone', currentTool: 'Bash' }] });
    const s = useStore.getState();
    expect(s.agents.ken).toMatchObject({ name: 'Ken', currentTool: 'Edit', status: 'working' });
    expect(s.agents.ada.name).toBe('Ada');
    expect(s.agents.gone).toBeUndefined();
    expect(cue).toHaveBeenCalledWith('welcome');
    apply({ type: 'agents', agents: [{ id: 'ken', status: 'error' }] });
    expect(cue).toHaveBeenCalledWith('error');
  });

  it('appends live lines once, replaces the buffer on a catch-up, and keeps the latest listed line', () => {
    const { apply } = useStore.getState();
    apply({ type: 'logs', catchUp: true, tails: { ken: [line(1), line(2, 'result')] } });
    // a line the catch-up already had arrives again with the batch after it
    apply({ type: 'logs', tails: { ken: [line(2, 'result'), line(3, 'text')] } });
    expect(useStore.getState().logs.ken.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(useStore.getState().latest.ken.id).toBe(3);
    apply({ type: 'latest', lines: { grace: line(9) } });
    expect(useStore.getState().latest).toMatchObject({ ken: { id: 3 }, grace: { id: 9 } });
    apply({ type: 'logs', catchUp: true, tails: { ken: [line(7)] } });
    expect(useStore.getState().logs.ken.map((l) => l.id)).toEqual([7]);
  });
});
