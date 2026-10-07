import { describe, expect, it } from 'vitest';
import { TICKER_KEEP, Ticker, agentTicks, qaTicks, repoFacts, repoTicks, type AgentFacts } from './ticker.ts';
import type { AgentView, IssueInfo, PullInfo, QaView, RepoView } from '../shared/types.ts';

const R = 'acme/app';
const dev = (patch: Partial<AgentFacts> = {}): AgentFacts => ({ name: 'Ken', repoId: R, role: 'agent', status: 'idle', task: null, issueNumber: null, prNumber: null, ...patch });
const pull = (number: number, patch: Partial<PullInfo> = {}): PullInfo => ({
  number,
  title: `PR ${number}`,
  url: '',
  headRefName: 'b',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  closesIssues: [],
  createdAt: '',
  mergedAt: null,
  additions: 0,
  deletions: 0,
  checks: 'pending',
  headSha: '',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
  ...patch,
});
const issue = (number: number, title = `Issue ${number}`): IssueInfo => ({ number, title, body: '', url: '', labels: [], createdAt: '' });
const repo = (pulls: PullInfo[], issues: IssueInfo[] = [], patch: Partial<RepoView> = {}) => ({ id: R, pulls, issues, lastSync: 1, ...patch }) as RepoView;
const qa = (status: QaView['status'], patch: Partial<QaView> = {}): QaView => ({ repoId: R, prNumber: 12, status, round: 1, devAgentId: 'ken', qaAgentId: 'marple', summary: null, checks: [], commentUrl: null, mergeNote: null, ceoLooking: false, updatedAt: 0, ...patch });
const texts = (ticks: { text: string }[]) => ticks.map((t) => t.text);

describe('agentTicks', () => {
  it('an agent picking up an issue, opening a PR, fixing it and hitting a snag', () => {
    expect(texts(agentTicks(dev(), dev({ status: 'preparing', task: 'issue', issueNumber: 205 })))).toEqual(['Ken picked up #205']);
    expect(agentTicks(dev({ status: 'preparing', task: 'issue', issueNumber: 205 }), dev({ status: 'working', task: 'issue', issueNumber: 205 }))).toEqual([]);
    expect(agentTicks(dev({ status: 'working', task: 'issue', issueNumber: 205 }), dev({ status: 'done', task: 'issue', issueNumber: 205, prNumber: 212 }))).toEqual([
      { repoId: R, text: 'Ken opened PR #212', tone: 'good', key: `opened:${R}#212` },
    ]);
    expect(texts(agentTicks(dev({ status: 'done', task: 'issue', prNumber: 212 }), dev({ status: 'working', task: 'fix', prNumber: 212 })))).toEqual(['Ken is fixing PR #212']);
    expect(texts(agentTicks(dev({ status: 'working', task: 'issue', issueNumber: 9 }), dev({ status: 'error', task: 'issue', issueNumber: 9 })))).toEqual(['Ken hit a snag on #9']);
  });

  it('someone first seen says only what they are on', () => {
    expect(texts(agentTicks(undefined, dev({ status: 'working', task: 'issue', issueNumber: 3 })))).toEqual(['Ken picked up #3']);
    expect(agentTicks(undefined, dev({ status: 'done', task: 'issue', issueNumber: 3, prNumber: 4 }))).toEqual([]);
    expect(agentTicks(undefined, dev({ status: 'error' }))).toEqual([]);
  });

  it('leaves the CEO, and agents testing a PR, to their own lines', () => {
    expect(agentTicks(dev(), dev({ role: 'ceo', repoId: '', status: 'working' }))).toEqual([]);
    expect(agentTicks(dev(), dev({ status: 'working', task: 'qa', issueNumber: 7, prNumber: 12 }))).toEqual([]);
  });
});

describe('qaTicks', () => {
  const names = (id: string | null) => (id === 'marple' ? 'Marple' : null);
  it('follows a PR through QA', () => {
    expect(texts(qaTicks(undefined, qa('queued'), names))).toEqual(['PR #12 is queued for QA']);
    expect(texts(qaTicks('queued', qa('testing'), names))).toEqual(['Marple is testing PR #12']);
    expect(qaTicks('testing', qa('passed'), names)).toEqual([{ repoId: R, text: 'Marple passed PR #12 ✅', tone: 'good' }]);
    expect(texts(qaTicks('testing', qa('failed', { round: 2 }), names))).toEqual(['Marple failed PR #12 · round 2']);
    expect(texts(qaTicks('failed', qa('needs-human'), names))).toEqual(['PR #12 needs you 🙋']);
    expect(qaTicks('failed', qa('fixing'), names)).toEqual([]);
    expect(qaTicks('testing', qa('testing'), names)).toEqual([]);
    expect(texts(qaTicks('fixing', qa('queued', { round: 2 }), names))).toEqual(['PR #12 is queued for QA (round 2)']);
  });

  it("doesn't pin the office's own calls on whoever tested it", () => {
    expect(texts(qaTicks('passed', qa('failed'), names))).toEqual(['PR #12 was sent back']);
    expect(texts(qaTicks(undefined, qa('passed'), names))).toEqual(['PR #12 passed QA ✅']);
  });
});

describe('repoTicks', () => {
  const nobody = () => null;
  it('PRs opening, merging and closing, and CI turning red or green', () => {
    const before = repoFacts(repo([pull(1), pull(2, { checks: 'pending' }), pull(3, { checks: 'failing' }), pull(4)]));
    const after = repo([pull(1, { state: 'MERGED' }), pull(2, { checks: 'failing' }), pull(3, { checks: 'passing' }), pull(4, { state: 'CLOSED' }), pull(5)]);
    expect(texts(repoTicks(before, after, (n) => (n === 5 ? 'Ken' : null)))).toEqual(['#1 merged 🎉', 'CI red on #2', 'CI green on #3', 'PR #4 closed', 'Ken opened PR #5']);
  });

  it('PRs and issues closed, as they drop off the open lists (the cleanup after a close)', () => {
    const before = repoFacts(repo([pull(1), pull(2), pull(3)], [issue(10), issue(11), issue(12)]));
    const after = repo([pull(1), pull(3, { state: 'MERGED', closesIssues: [12] })], [issue(10)]);
    expect(texts(repoTicks(before, after, nobody))).toEqual(['#3 merged 🎉', 'PR #2 closed', 'Issue #11 closed']);
  });

  it("doesn't call something closed when a full list may have pushed it off", () => {
    const many = Array.from({ length: 50 }, (_, i) => pull(100 + i));
    expect(repoTicks(repoFacts(repo([pull(1), ...many])), repo(many), nobody)).toEqual([]);
  });

  it('only recent merges of PRs it never saw open', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    const after = repo([pull(7, { state: 'MERGED', mergedAt: '2026-10-04T11:58:00Z' }), pull(8, { state: 'MERGED', mergedAt: '2026-10-03T11:58:00Z' })]);
    expect(texts(repoTicks(repoFacts(repo([])), after, nobody, now))).toEqual(['#7 merged 🎉']);
  });

  it('new issues, a few at a time, with their titles redacted', () => {
    const after = repo([], [issue(1), issue(2, 'Rotate ghp_0123456789abcdefABCDEF0123 now'), issue(3), issue(4), issue(5)]);
    const lines = texts(repoTicks(repoFacts(repo([], [issue(1)])), after, nobody));
    expect(lines).toEqual(['New issue #2: Rotate ••• now', 'New issue #3: Issue 3', 'New issue #4: Issue 4', '+1 more new issues']);
  });
});

describe('Ticker', () => {
  const lookups = { name: (id: string) => ({ marple: 'Marple', ken: 'Ken' })[id] ?? null, author: (_: string, pr: number) => (pr === 212 ? 'Ken' : null) };
  const agentEv = (id: string, facts: AgentFacts) => ({ type: 'agent' as const, agent: { id, ...facts } as unknown as Omit<AgentView, 'log'> });

  it('seeds a floor on its first sync, then reports what changed', () => {
    const t = new Ticker(lookups);
    expect(t.observe({ type: 'repo', repo: repo([], [], { lastSync: null }) })).toEqual([]);
    expect(t.observe({ type: 'repo', repo: repo([pull(1)]) })).toEqual([]);
    const items = t.observe({ type: 'repo', repo: repo([pull(1, { state: 'MERGED' })]) }, 5000);
    expect(items).toEqual([{ id: 1, repoId: R, at: 5000, text: '#1 merged 🎉', tone: 'good' }]);
    expect(t.recent()).toEqual(items);
  });

  it('tells of a PR opening once, whether the agent or the sync says so first', () => {
    const t = new Ticker(lookups);
    t.observe({ type: 'repo', repo: repo([]) });
    t.observe(agentEv('ken', dev({ status: 'working', task: 'issue', issueNumber: 205 })));
    expect(texts(t.observe(agentEv('ken', dev({ status: 'done', task: 'issue', issueNumber: 205, prNumber: 212 }))))).toEqual(['Ken opened PR #212']);
    expect(t.observe({ type: 'repo', repo: repo([pull(212)]) })).toEqual([]);
  });

  it('names the agent testing it and ignores the events it makes itself', () => {
    const t = new Ticker(lookups);
    expect(texts(t.observe({ type: 'qa', qa: qa('testing') }))).toEqual(['Marple is testing PR #12']);
    const [item] = t.recent();
    expect(t.observe({ type: 'ticker', item })).toEqual([]);
    expect(t.observe({ type: 'logs', tails: { ken: [] } })).toEqual([]);
  });

  it('keeps the last lines per floor and forgets a floor that goes', () => {
    const t = new Ticker(lookups);
    for (let i = 0; i < TICKER_KEEP + 5; i++) t.observe({ type: 'qa', qa: qa(i % 2 ? 'testing' : 'queued') });
    t.observe({ type: 'qa', qa: qa('testing', { repoId: 'acme/other' }) });
    expect(t.recent().filter((i) => i.repoId === R)).toHaveLength(TICKER_KEEP);
    expect(t.recent().filter((i) => i.repoId === 'acme/other')).toHaveLength(1);
    t.observe({ type: 'repoRemoved', repoId: R });
    expect(t.recent().map((i) => i.repoId)).toEqual(['acme/other']);
  });
});
