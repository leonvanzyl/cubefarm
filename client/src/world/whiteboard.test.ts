import { describe, expect, it } from 'vitest';
import type { QaStatus, QaView } from '../../../shared/types';
import type { Agent, Focus, KanbanCard, KanbanColumns } from '../store';
import { kanbanCapacity, kanbanNoteRect } from './draw';
import { BOARD } from './layout';
import { BOARD_TEX, boardToCanvas, bodyExcerpt, canPeel, dependencyPairs, dropTarget, locateCard, noteAt, visibleCount } from './whiteboard';

const board = (over: Partial<KanbanColumns> = {}): KanbanColumns => ({ backlog: [], progress: [], qa: [], ready: [], merged: [], ...over });
const issueCard = (n: number): KanbanCard => ({ key: `i-${n}`, number: n, title: `Issue ${n}` });
const qaRec = (n: number, status: QaStatus): QaView => ({
  repoId: 'o/r',
  prNumber: n,
  status,
  round: 1,
  devAgentId: 'ada',
  qaAgentId: 'marple',
  summary: null,
  checks: [],
  commentUrl: null,
  mergeNote: null,
  ceoLooking: false,
  updatedAt: 0,
});
const prCard = (n: number, status?: QaStatus, ghost = false): KanbanCard => ({ key: `pr-${n}`, number: n, prNumber: n, title: `PR ${n}`, qa: status ? qaRec(n, status) : undefined, ghost });
const person = (id: string, role: Agent['role'], status: Agent['status'] = 'idle', issueNumber: number | null = null) =>
  ({ id, name: id[0].toUpperCase() + id.slice(1), role, status, issueNumber }) as Agent;
const middle = (ci: number, i: number) => {
  const r = kanbanNoteRect(ci, i, BOARD_TEX.w);
  return [r.x + r.w / 2, r.y + r.h / 2] as const;
};

describe('aiming at a sticky', () => {
  it('maps the middle of the board to the middle of its canvas', () => {
    const uv = boardToCanvas(0, BOARD.y + BOARD.h / 2, { u: 0, v: 0 });
    expect(uv.u).toBeCloseTo(BOARD_TEX.w / 2);
    expect(uv.v).toBeCloseTo(BOARD_TEX.h / 2);
  });

  it('finds the card drawn under the point, and nothing between cards', () => {
    const cols = board({ backlog: [issueCard(1), issueCard(2), issueCard(3)], qa: [prCard(9)] });
    expect(noteAt(cols, ...middle(0, 0))).toMatchObject({ col: 'backlog', index: 0, card: { number: 1 } });
    expect(noteAt(cols, ...middle(0, 2))).toMatchObject({ col: 'backlog', index: 2, card: { number: 3 } });
    expect(noteAt(cols, ...middle(2, 0))).toMatchObject({ col: 'qa', card: { number: 9 } });
    expect(noteAt(cols, ...middle(2, 1))).toBeNull(); // an empty slot
    const r = kanbanNoteRect(0, 0, BOARD_TEX.w);
    expect(noteAt(cols, r.x + r.w + 8, r.y + r.h / 2)).toBeNull(); // the gap between two stickies
  });

  it('never picks the "+N more" slot of a full column', () => {
    const cap = kanbanCapacity(BOARD_TEX.h);
    const cols = board({ backlog: Array.from({ length: cap + 3 }, (_, i) => issueCard(i + 1)) });
    expect(visibleCount(cap + 3)).toBe(cap - 1);
    expect(noteAt(cols, ...middle(0, cap - 2))).toMatchObject({ card: { number: cap - 1 } });
    expect(noteAt(cols, ...middle(0, cap - 1))).toBeNull();
  });
});

describe('which stickies come off the board', () => {
  it.each([
    ['backlog', issueCard(1), true],
    ['progress', issueCard(1), false],
    ['qa', prCard(9), true],
    ['qa', prCard(9, 'needs-human'), true],
    ['qa', prCard(9, 'queued'), false],
    ['qa', prCard(9, 'failed'), false],
    ['qa', prCard(9, 'testing', true), false],
    ['ready', prCard(9, 'passed'), false],
    ['merged', prCard(9), false],
  ] as const)('%s %j', (col, card, ok) => {
    expect(canPeel(col, card)).toBe(ok);
  });
});

describe('putting a carried sticky down', () => {
  const ada = person('ada', 'dev');
  const linus = person('linus', 'dev', 'working', 4);
  const marple = person('marple', 'qa');
  const agents = [ada, linus, marple];
  const issues = [
    { number: 12, body: 'Make it work' },
    { number: 13, body: 'Depends on #12' },
  ];
  const at = (action: Focus['action'] | null) => (action ? { action } : null);
  const desk = (a: Agent) => at({ kind: 'terminal', agentId: a.id });
  const issue = { number: 12, pr: false };
  const pr = { number: 20, pr: true };

  it('gives an issue to a free developer', () => {
    expect(dropTarget(issue, desk(ada), agents, issues)).toEqual({ kind: 'assign', agentId: 'ada', label: 'Give #12 to Ada', warn: null });
  });

  it('warns, as the office will, about a busy developer or an issue that waits for another', () => {
    expect(dropTarget(issue, desk(linus), agents, issues)).toMatchObject({ kind: 'assign', warn: 'Linus is already working on #4', label: '⚠️ Linus is already working on #4' });
    expect(dropTarget({ number: 13, pr: false }, desk(ada), agents, issues)).toMatchObject({ kind: 'assign', warn: '#13 waits for #12: it can start once that is closed' });
  });

  it('sends a PR to QA at the QA lab, and keeps issues and PRs where they belong', () => {
    expect(dropTarget(pr, desk(marple), agents, issues)).toEqual({ kind: 'qa', label: 'Send PR #20 to QA' });
    expect(dropTarget(pr, at({ kind: 'hire', repoId: 'o/r', role: 'qa' }), agents, issues)).toMatchObject({ kind: 'qa' });
    expect(dropTarget(issue, desk(marple), agents, issues)).toEqual({ kind: 'refuse', label: 'Marple is a QA tester; they test pull requests rather than issues.' });
    expect(dropTarget(pr, desk(ada), agents, issues)).toMatchObject({ kind: 'refuse' });
    expect(dropTarget(issue, at({ kind: 'hire', repoId: 'o/r', role: 'dev' }), agents, issues)).toMatchObject({ kind: 'refuse' });
  });

  it('goes back on the board, and leaves everything else alone', () => {
    expect(dropTarget(issue, at({ kind: 'kanban', repoId: 'o/r' }), agents, issues)).toEqual({ kind: 'back', label: 'Put #12 back' });
    expect(dropTarget(pr, at({ kind: 'card', repoId: 'o/r', key: 'i-1', number: 1, pr: false }), agents, issues)).toEqual({ kind: 'back', label: 'Put PR #20 back' });
    expect(dropTarget(issue, at({ kind: 'elevator' }), agents, issues)).toEqual({ kind: 'none' });
    expect(dropTarget(issue, desk(person('gone', 'dev')), agents, issues)).toEqual({ kind: 'none' });
    expect(dropTarget(issue, null, agents, issues)).toEqual({ kind: 'none' });
  });
});

describe('dependency strings', () => {
  const issues = [
    { number: 1, body: 'The skeleton' },
    { number: 2, body: 'Depends on #1' },
    { number: 3, body: 'Blocked by #1 and #2' },
    { number: 4, body: 'Depends on #99' }, // #99 is closed
  ];

  it('pins a string between an issue and each open one it waits for', () => {
    const cols = board({ backlog: [issueCard(1), issueCard(2), issueCard(3), issueCard(4)] });
    expect(dependencyPairs(issues, [], cols).map((p) => [p.waiter, p.blocker, p.from.index, p.to.index])).toEqual([
      [2, 1, 1, 0],
      [3, 1, 2, 0],
      [3, 2, 2, 1],
    ]);
  });

  it('follows the blocker into In progress and onto its open PR, and lets go once it closes', () => {
    const working: KanbanCard = { key: 'a-ada', number: 1, title: 'The skeleton' };
    expect(dependencyPairs(issues.slice(1, 2).concat(issues[0]), [], board({ backlog: [issueCard(2)], progress: [working] }))).toMatchObject([{ waiter: 2, blocker: 1, to: { col: 'progress', index: 0 } }]);
    const pulls = [{ number: 20, closesIssues: [1] }];
    expect(dependencyPairs(issues.slice(0, 2), pulls, board({ backlog: [issueCard(2)], qa: [prCard(20)] }))).toMatchObject([{ waiter: 2, blocker: 1, to: { col: 'qa', index: 0 } }]);
    // merged: #1 is still open for a moment on GitHub, but its sticky is in Merged, so no string
    expect(dependencyPairs(issues.slice(0, 2), pulls, board({ backlog: [issueCard(2)], merged: [prCard(20)] }))).toEqual([]);
    // closed: it's gone from the open issues
    expect(dependencyPairs(issues.slice(1, 2), [], board({ backlog: [issueCard(2)] }))).toEqual([]);
  });

  it('skips stickies the board has no room to draw', () => {
    const cap = kanbanCapacity(BOARD_TEX.h);
    const many = Array.from({ length: cap + 2 }, (_, i) => issueCard(100 + i));
    expect(dependencyPairs([{ number: 1, body: '' }, { number: 2, body: 'Depends on #1' }], [], board({ backlog: [...many, issueCard(2)], progress: [issueCard(1)] }))).toEqual([]);
  });
});

describe('reading a card', () => {
  it('finds the card by key, or the same issue or PR wherever it went', () => {
    const cols = board({ progress: [{ key: 'a-ada', number: 12, title: 'x' }], qa: [prCard(12)] });
    expect(locateCard(cols, 'i-12', 12, false)).toMatchObject({ col: 'progress', card: { key: 'a-ada' } });
    expect(locateCard(cols, 'pr-12', 12, true)).toMatchObject({ col: 'qa' });
    expect(locateCard(cols, 'm-12', 12, true)).toMatchObject({ col: 'qa' });
    expect(locateCard(cols, 'i-13', 13, false)).toBeNull();
  });

  it('shows the first lines of a body', () => {
    expect(bodyExcerpt('One\n\nTwo\nThree', 2)).toEqual({ text: 'One\n\nTwo', more: true });
    expect(bodyExcerpt('One\nTwo', 8)).toEqual({ text: 'One\nTwo', more: false });
    expect(bodyExcerpt('x'.repeat(20), 8, 10)).toEqual({ text: `${'x'.repeat(10)}…`, more: true });
    expect(bodyExcerpt('')).toEqual({ text: '', more: false });
  });
});
