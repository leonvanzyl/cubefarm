import { describe, expect, it } from 'vitest';
import type { HireRequestView, PullInfo, QaStatus, QaView, RepoView } from '../../../shared/types';
import type { Agent, KanbanCard, KanbanColumns } from '../store';
import { agentActions, approvalsBadge, assignChoices, doing, pipelineOf, waitingOnYou } from './pocketData';

const qa = (prNumber: number, status: QaStatus, extra: Partial<QaView> = {}) => ({ repoId: 'acme/app', prNumber, status, ceoLooking: false, updatedAt: prNumber, ...extra }) as QaView;
const card = (n: number, rec?: QaView): KanbanCard => ({ key: `k${n}`, number: n, title: `T${n}`, qa: rec });
const cols = (over: Partial<KanbanColumns> = {}): KanbanColumns => ({ backlog: [], progress: [], qa: [], ready: [], merged: [], ...over });

describe("a floor's pipeline", () => {
  it('counts building, QA, fixing, ready and needs-you', () => {
    const p = pipelineOf(
      cols({
        backlog: [card(1), card(2)],
        progress: [card(3)],
        qa: [card(4), card(5, qa(5, 'queued')), card(6, qa(6, 'testing')), card(7, qa(7, 'failed')), card(8, qa(8, 'fixing')), card(9, qa(9, 'needs-human')), card(10, qa(10, 'needs-human', { ceoLooking: true }))],
        ready: [card(11, qa(11, 'passed'))],
      }),
    );
    expect(p).toEqual({ backlog: 2, building: 1, qa: 4, fixing: 2, ready: 1, needsYou: 1 });
  });
});

describe("an agent's actions", () => {
  const a = (status: Agent['status'], task: Agent['task'] = 'issue', branch: string | null = null) => ({ status, task, branch });

  it('match the terminal panel', () => {
    expect(agentActions(a('working'))).toEqual({ stop: true, assign: false, clear: false, message: true });
    expect(agentActions(a('preparing'))).toEqual({ stop: true, assign: false, clear: false, message: true });
    expect(agentActions(a('idle'))).toEqual({ stop: false, assign: true, clear: false, message: false });
    expect(agentActions(a('done', 'issue', 'swarm/12-x'))).toEqual({ stop: false, assign: true, clear: true, message: true });
    expect(agentActions(a('done', 'fix', 'swarm/12-x'))).toEqual({ stop: false, assign: true, clear: true, message: true });
    expect(agentActions(a('error', 'qa', 'qa/4'))).toEqual({ stop: false, assign: true, clear: true, message: false });
    expect(agentActions(a('stopped'))).toEqual({ stop: false, assign: true, clear: true, message: false });
  });

  it('offer every agent backlog issues to build and testable PRs to test', () => {
    const c = cols({ backlog: [card(1)], qa: [card(4), card(5, qa(5, 'queued')), card(6, qa(6, 'testing')), card(7, qa(7, 'failed')), card(9, qa(9, 'needs-human'))] });
    expect(assignChoices(c).map((x) => [x.kind, x.number])).toEqual([
      ['issue', 1],
      ['qa', 4],
      ['qa', 5],
      ['qa', 9],
    ]);
    expect(assignChoices(c)[0]).toEqual({ key: 'k1', kind: 'issue', number: 1, title: 'T1' });
    expect(assignChoices(null)).toEqual([]);
  });

  it('say what they are doing', () => {
    expect(doing({ status: 'idle', task: null, issueNumber: null, issueTitle: null, prNumber: null })).toBe('Free');
    expect(doing({ status: 'working', task: 'issue', issueNumber: 12, issueTitle: 'Dark mode', prNumber: null })).toBe('#12 Dark mode');
    expect(doing({ status: 'working', task: 'qa', issueNumber: null, issueTitle: 'Dark mode', prNumber: 4 })).toBe('Testing PR #4: Dark mode');
    expect(doing({ status: 'error', task: 'fix', issueNumber: 12, issueTitle: null, prNumber: 4 })).toBe('Fixing PR #4');
  });
});

describe('what waits on the manager', () => {
  const pr = (number: number, state: PullInfo['state'] = 'OPEN') => ({ number, state }) as PullInfo;
  const repo = (autoMerge: boolean, ...pulls: PullInfo[]) => ({ id: 'acme/app', autoMerge, pulls }) as RepoView;
  const req = (id: string, status: HireRequestView['status']) => ({ id, status }) as HireRequestView;

  it('lists pending proposals, stuck open PRs and PRs ready to merge by hand', () => {
    const records = { a: qa(1, 'needs-human'), b: qa(2, 'needs-human', { ceoLooking: true }), c: qa(3, 'passed'), d: qa(4, 'needs-human'), e: qa(5, 'testing') };
    const w = waitingOnYou([repo(false, pr(1), pr(2), pr(3), pr(4, 'CLOSED'), pr(5))], records, [req('x', 'pending'), req('y', 'approved')]);
    expect(w.requests.map((r) => r.id)).toEqual(['x']);
    expect(w.stuck.map((s) => s.qa.prNumber)).toEqual([1, 2]);
    expect(w.ready.map((s) => s.qa.prNumber)).toEqual([3]);
    expect(approvalsBadge(w)).toBe(2); // the proposal and #1; the CEO is still on #2
    expect(waitingOnYou([repo(true, pr(3))], { c: qa(3, 'passed') }, []).ready).toEqual([]); // it merges itself
  });
});
