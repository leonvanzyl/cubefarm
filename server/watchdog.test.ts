import { describe, expect, it } from 'vitest';
import {
  diagnose,
  finding,
  forget,
  NUDGE_WAIT_MS,
  ORPHAN_GRACE_MS,
  PREPARING_MS,
  QUIET_MS,
  REMEDY_EVERY_MS,
  triage,
  UNCLOSED_GRACE_MS,
  unclosedIssues,
  type WatchAgent,
  type WatchMemory,
  type WatchQa,
} from './watchdog.ts';

const NOW = 10_000_000_000;
const MIN = 60_000;

const agent = (over: Partial<WatchAgent> = {}): WatchAgent => ({
  id: 'a1',
  name: 'Dennis',
  repoId: 'r1',
  role: 'dev',
  status: 'working',
  task: 'issue',
  issueNumber: 207,
  prNumber: null,
  startedAt: NOW - 60 * MIN,
  activeAt: NOW - MIN,
  work: 'open',
  ...over,
});

const rec = (over: Partial<WatchQa> = {}): WatchQa => ({ repoId: 'r1', prNumber: 181, status: 'testing', qaAgentId: 'q1', devAgentId: 'a1', updatedAt: NOW - 10 * MIN, ...over });
const memory = (): WatchMemory => ({ remedied: new Map(), nudged: new Map() });

describe('diagnose', () => {
  it('finds a session with no output or tool activity for 20 minutes', () => {
    expect(diagnose([agent({ activeAt: NOW - QUIET_MS + 1 })], [], [], NOW)).toEqual([]);
    expect(diagnose([agent({ activeAt: NOW - QUIET_MS })], [], [], NOW)).toMatchObject([{ kind: 'quiet', agentId: 'a1', issueNumber: 207 }]);
  });

  it('finds a desk being set up for more than 10 minutes', () => {
    expect(diagnose([agent({ status: 'preparing', startedAt: NOW - PREPARING_MS + MIN })], [], [], NOW)).toEqual([]);
    expect(diagnose([agent({ status: 'preparing', startedAt: NOW - PREPARING_MS })], [], [], NOW)).toMatchObject([{ kind: 'preparing' }]);
  });

  it('finds a failed or stopped agent still holding finished work', () => {
    expect(diagnose([agent({ status: 'error', work: 'merged' })], [], [], NOW)).toMatchObject([{ kind: 'stale' }]);
    expect(diagnose([agent({ status: 'stopped', work: 'closed' })], [], [], NOW)).toMatchObject([{ kind: 'stale' }]);
    expect(diagnose([agent({ status: 'error', work: 'open' }), agent({ status: 'done', work: 'merged' })], [], [], NOW)).toEqual([]);
  });

  it('never flags the CEO or someone without a task', () => {
    expect(diagnose([agent({ role: 'ceo', activeAt: 0 }), agent({ task: null, activeAt: 0 })], [], [], NOW)).toEqual([]);
  });

  it('finds a PR in "testing" whose tester is idle, after a grace for the report to post', () => {
    const tester = (status: string) => agent({ id: 'q1', role: 'qa', task: 'qa', prNumber: 181, status });
    expect(diagnose([tester('working')], [rec()], [], NOW)).toEqual([]);
    expect(diagnose([tester('idle')], [rec()], [], NOW)).toMatchObject([{ kind: 'qa-orphan', prNumber: 181, agentId: 'q1' }]);
    expect(diagnose([tester('idle')], [rec({ updatedAt: NOW - ORPHAN_GRACE_MS + 1 })], [], NOW)).toEqual([]);
  });

  it('finds a PR in "fixing" whose developer is on something else', () => {
    const fixing = rec({ status: 'fixing' });
    expect(diagnose([agent({ task: 'fix', prNumber: 181 })], [fixing], [], NOW)).toEqual([]);
    expect(diagnose([agent({ task: 'issue', issueNumber: 300 })], [fixing], [], NOW)).toMatchObject([{ kind: 'fix-orphan', agentId: 'a1' }]);
  });

  it('finds an issue left open well after the PR that closes it merged', () => {
    const u = { repoId: 'r1', issue: 207, pr: 215, mergedAt: NOW - UNCLOSED_GRACE_MS };
    expect(diagnose([], [], [u], NOW)).toMatchObject([{ kind: 'unclosed', issueNumber: 207, prNumber: 215 }]);
    expect(diagnose([], [], [{ ...u, mergedAt: NOW - MIN }], NOW)).toEqual([]);
  });
});

describe('unclosedIssues', () => {
  it('lists open issues that merged PRs resolve', () => {
    const at = new Date(NOW).toISOString();
    const pulls = [
      { number: 215, state: 'MERGED', mergedAt: at, closesIssues: [207, 208] },
      { number: 216, state: 'OPEN', mergedAt: null, closesIssues: [209] },
    ];
    expect(unclosedIssues('r1', [207, 209], pulls)).toEqual([{ repoId: 'r1', issue: 207, pr: 215, mergedAt: NOW }]);
  });
});

describe('triage', () => {
  it('nudges a quiet session once, then requeues its work if it stays (or goes) quiet again', () => {
    const m = memory();
    const [p] = diagnose([agent({ activeAt: NOW - QUIET_MS })], [], [], NOW);
    expect(triage([p], m, NOW).auto).toEqual([{ problem: p, remedy: 'nudge' }]);
    m.nudged.set(p.key, NOW);
    expect(triage([p], m, NOW + NUDGE_WAIT_MS - 1)).toEqual({ auto: [], doctor: [] });
    expect(triage([p], m, NOW + NUDGE_WAIT_MS).auto).toEqual([{ problem: p, remedy: 'requeue' }]);
  });

  it('heals the rest on its own', () => {
    const problems = diagnose(
      [agent({ status: 'preparing', startedAt: 0 }), agent({ id: 'a2', status: 'error', work: 'merged' }), agent({ id: 'q1', role: 'qa', status: 'idle', task: null })],
      [rec(), rec({ prNumber: 182, status: 'fixing' })],
      [],
      NOW,
    );
    expect(triage(problems, memory(), NOW).auto.map((x) => x.remedy)).toEqual(['requeue', 'clear', 'retry-qa', 'refix']);
  });

  it('remedies an item at most once an hour: after that it is a doctor finding', () => {
    const m = memory();
    const [p] = diagnose([agent({ status: 'preparing', startedAt: 0 })], [], [], NOW);
    m.remedied.set(p.key, NOW - REMEDY_EVERY_MS + 1);
    expect(triage([p], m, NOW)).toEqual({ auto: [], doctor: [p] });
    expect(triage([p], m, NOW + 1).auto).toHaveLength(1);
  });

  it('never closes an issue on its own', () => {
    const problems = diagnose([], [], [{ repoId: 'r1', issue: 207, pr: 215, mergedAt: 0 }], NOW);
    expect(triage(problems, memory(), NOW)).toEqual({ auto: [], doctor: problems });
  });
});

describe('forget', () => {
  it('forgets nudges and remedies older than an hour', () => {
    const m = memory();
    m.nudged.set('old', NOW - REMEDY_EVERY_MS);
    m.nudged.set('new', NOW - MIN);
    m.remedied.set('old', NOW - REMEDY_EVERY_MS);
    m.remedied.set('new', NOW - MIN);
    forget(m, NOW);
    expect([...m.nudged.keys()]).toEqual(['new']);
    expect([...m.remedied.keys()]).toEqual(['new']);
  });
});

describe('finding', () => {
  const name = (id: string | null) => (id === 'a1' ? 'Margaret' : null);

  it('words each finding plainly, with the console actions that fix it', () => {
    const [stale] = diagnose([agent({ status: 'error', work: 'merged' })], [], [], NOW);
    expect(finding(stale, name, 'merged', NOW)).toMatchObject({ text: "Margaret's last task #207 is already merged. Clear the desk?", fixes: ['clear'] });
    const [quiet] = diagnose([agent({ activeAt: NOW - 45 * MIN })], [], [], NOW);
    expect(finding(quiet, name, 'open', NOW)).toMatchObject({ text: 'Margaret has been quiet for 45 minutes on #207, even after a nudge. Stop them, or put the work back in line?', fixes: ['stop', 'requeue'] });
    const [unclosed] = diagnose([], [], [{ repoId: 'r1', issue: 207, pr: 215, mergedAt: NOW - 15 * MIN }], NOW);
    expect(finding(unclosed, name, null, NOW)).toMatchObject({ id: unclosed.key, fixes: ['close-issue'] });
    expect(finding(unclosed, name, null, NOW).text).toBe('Issue #207 is still open, but PR #215, which closes it, was merged 15 minutes ago. Close it?');
  });
});
