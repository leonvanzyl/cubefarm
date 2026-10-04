import { describe, expect, it } from 'vitest';
import type { AgentView, LogLine, PullInfo, QaView, RepoView } from '../../../shared/types';
import { CI_SLOW, DEMO_CI_SLOW, LOG_FRESH_MS, authorOf, currentWork, greeting, lastFile, logNews, slowChecks, storeNews, type OfficeSlice } from './chatterEvents';

type Agent = Omit<AgentView, 'log'>;
const REPO = 'demo-co/pixel-todo';
const NOW = Date.parse('2026-10-05T12:00:00Z');

const agent = (id: string, patch: Partial<Agent> = {}): Agent =>
  ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    repoId: REPO,
    role: 'dev',
    status: 'idle',
    task: null,
    issueNumber: null,
    prNumber: null,
    branch: null,
    look: 'masculine',
    ...patch,
  }) as Agent;

const pull = (number: number, patch: Partial<PullInfo> = {}): PullInfo =>
  ({ number, title: `PR ${number}`, headRefName: `swarm/issue-${number}`, state: 'OPEN', mergeable: 'MERGEABLE', checks: 'passing', mergedAt: null, ...patch }) as PullInfo;

const repo = (pulls: PullInfo[]): RepoView => ({ id: REPO, pulls }) as RepoView;

const qa = (prNumber: number, status: QaView['status'], patch: Partial<QaView> = {}): QaView =>
  ({ repoId: REPO, prNumber, status, round: 1, devAgentId: 'ken', qaAgentId: 'marple', updatedAt: NOW, ...patch }) as QaView;

const office = (agents: Agent[], pulls: PullInfo[] = [], records: QaView[] = []): OfficeSlice => ({
  agents: Object.fromEntries(agents.map((a) => [a.id, a])),
  repos: [repo(pulls)],
  qa: Object.fromEntries(records.map((q) => [`${q.repoId}#${q.prNumber}`, q])),
});

const kinds = (s: ReturnType<typeof storeNews>) => s.map((x) => `${x.who}:${x.event.kind}`);

describe('storeNews', () => {
  const ken = agent('ken', { branch: 'swarm/issue-212', prNumber: 212 });
  const marple = agent('marple', { role: 'qa' });

  it('a developer starting an issue says so', () => {
    const before = office([agent('ken')]);
    const after = office([agent('ken', { status: 'preparing', task: 'issue', issueNumber: 204 })]);
    expect(storeNews(before, after).map((s) => s.event)).toEqual([{ kind: 'start', issue: 204 }]);
    // and not again as they go from preparing to working
    expect(storeNews(after, office([agent('ken', { status: 'working', task: 'issue', issueNumber: 204 })]))).toEqual([]);
  });

  it('a new PR: its author says it is up for QA, once, as the office learns its number', () => {
    const working = agent('ken', { status: 'working', task: 'issue', issueNumber: 204, branch: 'swarm/issue-212' });
    const done = { ...working, status: 'done' as const, prNumber: 212 };
    expect(storeNews(office([working], []), office([working], [pull(212)]))).toEqual([]);
    const news = storeNews(office([working], [pull(212)]), office([done], [pull(212)]));
    expect(news.map((s) => [s.who, s.event])).toEqual([['ken', { kind: 'prOpened', pr: 212 }]]);
    expect(storeNews(office([done], [pull(212)]), office([{ ...done, status: 'idle' }], [pull(212)]))).toEqual([]);
    // a tester's or a fixer's PR isn't theirs to open
    const tester = agent('marple', { role: 'qa', status: 'working', task: 'qa' });
    expect(storeNews(office([tester]), office([{ ...tester, prNumber: 212 }]))).toEqual([]);
  });

  it('going to QA: the developer asks the tester by name, and the tester answers a moment later', () => {
    const news = storeNews(office([ken, marple], [pull(212)], [qa(212, 'queued')]), office([ken, marple], [pull(212)], [qa(212, 'testing')]));
    expect(news.map((s) => [s.who, s.event, s.delay > 0])).toEqual([
      ['ken', { kind: 'askQa', pr: 212, tester: 'Marple' }, false],
      ['marple', { kind: 'qaStart', pr: 212 }, true],
    ]);
  });

  it("QA's verdict, from the tester", () => {
    const testing = office([ken, marple], [pull(212)], [qa(212, 'testing')]);
    expect(kinds(storeNews(testing, office([ken, marple], [pull(212)], [qa(212, 'passed')])))).toEqual(['marple:qaPassed']);
    expect(kinds(storeNews(testing, office([ken, marple], [pull(212)], [qa(212, 'failed')])))).toEqual(['marple:qaFailed']);
    expect(kinds(storeNews(testing, office([ken, marple], [pull(212)], [qa(212, 'needs-human')])))).toEqual(['marple:qaFailed']);
  });

  it('a merge: the author cheers once the gong has rung, then the nearest teammate says nice one', () => {
    const news = storeNews(office([ken, marple], [pull(212)]), office([ken, marple], [pull(212, { state: 'MERGED', mergedAt: '2026-10-05T12:00:00Z' })]));
    expect(news.map((s) => ({ who: s.who, near: !!s.near, kind: s.event.kind }))).toEqual([
      { who: 'ken', near: false, kind: 'merged' },
      { who: 'ken', near: true, kind: 'congrats' },
    ]);
    expect(news[1].event).toEqual({ kind: 'congrats', to: 'Ken', pr: 212 });
    expect(news[1].delay).toBeGreaterThan(news[0].delay);
  });

  it('a conflict names the file the author last touched; red CI is grumbled about', () => {
    const before = office([ken], [pull(212)]);
    const after = office([ken], [pull(212, { mergeable: 'CONFLICTING', checks: 'failing' })]);
    const news = storeNews(before, after, (id) => (id === 'ken' ? 'store.ts' : null));
    expect(news.map((s) => s.event)).toEqual([
      { kind: 'conflict', pr: 212, file: 'store.ts' },
      { kind: 'ciRed', pr: 212 },
    ]);
  });

  it('a fix starting, and an error', () => {
    const before = office([agent('ken', { prNumber: 212 }), agent('ada', { status: 'working' })]);
    const after = office([agent('ken', { prNumber: 212, status: 'working', task: 'fix' }), agent('ada', { status: 'error' })]);
    expect(kinds(storeNews(before, after))).toEqual(['ken:fixing', 'ada:error']);
  });

  it('stays quiet about PRs nobody on the floor wrote, new hires and nothing changing', () => {
    const outside = pull(300, { headRefName: 'someone/else' });
    expect(storeNews(office([ken], []), office([ken], [outside]))).toEqual([]);
    expect(storeNews(office([]), office([agent('newbie', { status: 'working', task: 'issue', issueNumber: 1 })]))).toEqual([]);
    const same = office([ken, marple], [pull(212)], [qa(212, 'testing')]);
    expect(storeNews(same, same)).toEqual([]);
  });
});

describe('authorOf', () => {
  it("finds the developer by QA's record, their PR number or their branch", () => {
    const agents = { ken: agent('ken', { prNumber: 9 }), ada: agent('ada', { branch: 'swarm/issue-5' }) };
    expect(authorOf(agents, REPO, pull(9))?.id).toBe('ken');
    expect(authorOf(agents, REPO, pull(5, { headRefName: 'swarm/issue-5' }))?.id).toBe('ada');
    expect(authorOf(agents, REPO, pull(7), qa(7, 'testing', { devAgentId: 'ada' }))?.id).toBe('ada');
    expect(authorOf(agents, 'other/repo', pull(9))).toBeUndefined();
    // a developer testing someone's PR has its number too, but didn't write it
    expect(authorOf({ ada: agent('ada', { prNumber: 9, task: 'qa' }) }, REPO, pull(9))).toBeUndefined();
  });
});

describe('slowChecks', () => {
  it('grumbles once when checks stay pending, and again only after a new wait', () => {
    const agents = { ken: agent('ken', { prNumber: 212 }) };
    const since = new Map<string, number>();
    const done = new Set<string>();
    const pending = [repo([pull(212, { checks: 'pending' })])];
    expect(slowChecks(pending, agents, since, done, NOW)).toEqual([]);
    expect(slowChecks(pending, agents, since, done, NOW + (CI_SLOW - 1) * 1000)).toEqual([]);
    expect(slowChecks(pending, agents, since, done, NOW + CI_SLOW * 1000).map((s) => [s.who, s.event])).toEqual([['ken', { kind: 'ciSlow', pr: 212 }]]);
    expect(slowChecks(pending, agents, since, done, NOW + CI_SLOW * 3000)).toEqual([]);
    // the checks finish: forgotten, so the next push's wait counts afresh
    expect(slowChecks([repo([pull(212)])], agents, since, done, NOW + CI_SLOW * 4000)).toEqual([]);
    expect(since.size + done.size).toBe(0);
    slowChecks(pending, agents, since, done, NOW + CI_SLOW * 5000);
    expect(slowChecks(pending, agents, since, done, NOW + CI_SLOW * 6000)).toHaveLength(1);
  });

  it('grumbles sooner in the demo, whose clock runs fast', () => {
    const agents = { ken: agent('ken', { prNumber: 212 }) };
    const since = new Map<string, number>();
    const pending = [repo([pull(212, { checks: 'pending' })])];
    slowChecks(pending, agents, since, new Set(), NOW, DEMO_CI_SLOW);
    expect(slowChecks(pending, agents, since, new Set(), NOW + DEMO_CI_SLOW * 1000, DEMO_CI_SLOW)).toHaveLength(1);
    expect(DEMO_CI_SLOW).toBeLessThan(CI_SLOW);
  });
});

const line = (id: number, kind: LogLine['kind'], text: string, tool?: string, t = NOW): LogLine => ({ id, t, kind, text, ...(tool ? { tool } : {}) });

describe('logNews', () => {
  it('reports the last bit of news in the new lines', () => {
    const ken = agent('ken', { status: 'working', task: 'issue' });
    const lines = [line(1, 'tool', '⏺ $ npm test -- --run', 'Bash'), line(2, 'result', '    Test Files  7 passed (7)')];
    expect(logNews(ken, lines, NOW).map((s) => s.event)).toEqual([{ kind: 'testsGreen' }]);
    expect(logNews(ken, [...lines, line(3, 'result', '  Tests  1 failed | 6 passed')], NOW).map((s) => s.event)).toEqual([{ kind: 'testsRed' }]);
  });

  it('a push while fixing is "found the bug"; a push on an issue is not news', () => {
    const push = [line(1, 'tool', '⏺ $ git commit -am "fix" && git push origin HEAD', 'Bash')];
    expect(logNews(agent('ken', { task: 'fix', prNumber: 212 }), push, NOW).map((s) => s.event)).toEqual([{ kind: 'fixPushed', pr: 212 }]);
    expect(logNews(agent('ken', { task: 'issue' }), push, NOW)).toEqual([]);
  });

  it('ignores old lines (a reconnect replays the whole log)', () => {
    const old = [line(1, 'result', '    Test Files  7 passed (7)', undefined, NOW - LOG_FRESH_MS - 1)];
    expect(logNews(agent('ken'), old, NOW)).toEqual([]);
  });
});

describe('lastFile and currentWork', () => {
  const log = [
    line(1, 'tool', '⏺ Edit src/components/TodoList.tsx', 'Edit', NOW - 60_000),
    line(2, 'result', '  ⎿ Updated', undefined, NOW - 59_000),
    line(3, 'tool', '⏺ Read src/App.tsx', 'Read', NOW - 10_000),
  ];

  it('knows the file someone last edited', () => {
    expect(lastFile(log)).toBe('TodoList.tsx');
    expect(lastFile([])).toBeNull();
  });

  it('knows what someone is doing right now, and not from stale lines', () => {
    expect(currentWork(log, NOW)).toEqual({ work: 'read', detail: 'App.tsx' });
    expect(currentWork(log, NOW + 60_000)).toBeNull();
  });
});

describe('greeting', () => {
  const merged = repo([pull(212, { state: 'MERGED', mergedAt: '2026-10-05T11:58:00Z' }), pull(213)]);
  const slice = { repos: [merged], qa: { [`${REPO}#213`]: qa(213, 'testing') } };

  it('quips about their work', () => {
    expect(greeting(agent('ken', { prNumber: 212 }), slice, 'Leon', NOW)).toMatchObject({ mood: 'shipped', pr: 212, manager: 'Leon' });
    expect(greeting(agent('ken', { prNumber: 213, status: 'done' }), slice, 'Leon', NOW)).toMatchObject({ mood: 'inQa', pr: 213 });
    expect(greeting(agent('ken', { prNumber: 213, status: 'working', task: 'fix' }), slice, 'Leon', NOW)).toMatchObject({ mood: 'fixing' });
    expect(greeting(agent('ken', { status: 'working', task: 'issue', issueNumber: 4 }), slice, 'Leon', NOW)).toMatchObject({ mood: 'working', issue: 4 });
    expect(greeting(agent('marple', { role: 'qa', status: 'working', prNumber: 213 }), slice, 'Leon', NOW)).toMatchObject({ mood: 'testing' });
    expect(greeting(agent('ada', { status: 'working', task: 'qa', prNumber: 212 }), slice, 'Leon', NOW)).toMatchObject({ mood: 'testing', pr: 212 });
    expect(greeting(agent('ceo', { role: 'ceo' }), slice, 'Leon', NOW)).toMatchObject({ mood: 'ceo' });
  });

  it('just says hi when there is no news', () => {
    expect(greeting(agent('ada'), slice, '', NOW)).toMatchObject({ kind: 'greet', mood: 'free', manager: '' });
    // an old merge is no longer news
    expect(greeting(agent('ken', { prNumber: 212 }), slice, 'Leon', NOW + 60 * 60_000)).toMatchObject({ mood: 'free' });
  });
});
