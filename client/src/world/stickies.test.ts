import { describe, expect, it } from 'vitest';
import type { QaStatus, QaView } from '../../../shared/types';
import type { Agent, KanbanCard, KanbanColumns } from '../store';
import { KANBAN_KEYS } from './draw';
import { mayStart } from './errands';
import { BOARD, deskPosition, qaDeskPosition, QA_ROTATION } from './layout';
import {
  addMove,
  BOARD_MAX,
  boardHolds,
  CARRY_MAX,
  boardPose,
  displayColumns,
  HOLD_MAX,
  holdFor,
  mayGo,
  monitorPose,
  nextJob,
  overdue,
  release,
  START_BY,
  stickyMoves,
  type Job,
  type Move,
  type Pose,
} from './stickies';
import { spot, walkways } from './walkways';

const person = (id: string, role: 'dev' | 'qa') => ({ id, role, name: id, color: '#3a86ff' }) as Agent;
const dev = person('dev', 'dev');
const tester = person('qa', 'qa');
const qaRec = (n: number, status: QaStatus): QaView => ({
  repoId: 'o/r',
  prNumber: n,
  status,
  round: 1,
  devAgentId: 'dev',
  qaAgentId: 'qa',
  summary: null,
  checks: [],
  commentUrl: null,
  mergeNote: null,
  ceoLooking: false,
  updatedAt: 0,
});
const working = (issue = 7): KanbanCard => ({ key: 'a-dev', number: issue, title: 'Fix it', agent: dev, note: 'working' });
const pr = (n: number, status?: QaStatus): KanbanCard => ({
  key: `pr-${n}`,
  number: n,
  prNumber: n,
  title: 'Fix it',
  agent: status === 'testing' ? tester : dev,
  qa: status ? qaRec(n, status) : undefined,
});
const merged = (n: number): KanbanCard => ({ key: `m-${n}`, number: n, prNumber: n, title: 'Fix it', agent: dev });
const board = (over: Partial<KanbanColumns> = {}): KanbanColumns => ({ backlog: [], progress: [], qa: [], ready: [], merged: [], ...over });

describe('which moves send someone to the board', () => {
  it('a developer opening a PR moves their sticky from In progress to In QA', () => {
    const other: KanbanCard = { key: 'a-x', number: 3, title: 'Other', agent: person('x', 'dev') };
    const moves = stickyMoves(board({ progress: [other, working()] }), board({ progress: [other], qa: [pr(12, 'queued')] }));
    expect(moves).toEqual([{ kind: 'toQa', agentId: 'dev', from: { col: 'progress', index: 1, card: working() }, to: 'qa', key: 'pr-12' }]);
  });

  it('a PR from someone still busy on their card, or from nobody on the floor, sends no one', () => {
    expect(stickyMoves(board({ progress: [working()] }), board({ progress: [working()], qa: [pr(12, 'queued')] }))).toEqual([]);
    expect(stickyMoves(board(), board({ qa: [{ ...pr(12), agent: undefined }] }))).toEqual([]);
  });

  it('a tester picking up a PR takes its sticky to their monitor', () => {
    const [m] = stickyMoves(board({ qa: [pr(12, 'queued')] }), board({ qa: [pr(12, 'testing')] }));
    expect(m).toMatchObject({ kind: 'take', agentId: 'qa', to: 'monitor', key: 'pr-12', from: { col: 'qa', index: 0 } });
  });

  it('a pass goes to Ready to merge and a fail back to the QA column, by the tester', () => {
    expect(stickyMoves(board({ qa: [pr(12, 'testing')] }), board({ ready: [pr(12, 'passed')] }))).toMatchObject([{ kind: 'pass', agentId: 'qa', to: 'ready' }]);
    expect(stickyMoves(board({ qa: [pr(12, 'testing')] }), board({ qa: [pr(12, 'failed')] }))).toMatchObject([{ kind: 'fail', agentId: 'qa', to: 'qa' }]);
  });

  it('a merge sends its developer to move it to Merged', () => {
    expect(stickyMoves(board({ ready: [pr(12, 'passed')] }), board({ merged: [merged(12)] }))).toMatchObject([
      { kind: 'merge', agentId: 'dev', to: 'merged', key: 'm-12', from: { col: 'ready', index: 0 } },
    ]);
  });

  it('nothing moves when nothing changed, or when testing came and went unseen', () => {
    const b = board({ progress: [working()], qa: [pr(12, 'queued')], ready: [pr(13, 'passed')], merged: [merged(9)] });
    expect(stickyMoves(b, b)).toEqual([]);
    expect(stickyMoves(board({ qa: [pr(12, 'queued')] }), board({ ready: [pr(12, 'passed')] }))).toEqual([]);
  });
});

describe('what the 3D board shows', () => {
  const toQa: Move = { kind: 'toQa', agentId: 'dev', from: { col: 'progress', index: 0, card: working() }, to: 'qa', key: 'pr-12' };
  const real = board({ qa: [pr(11, 'queued'), pr(12, 'queued')] });

  it('holds a move back: the card where it was until it is peeled off, its new place empty until it is placed', () => {
    const waiting = displayColumns(real, [holdFor(toQa, false)]);
    expect(waiting.progress.map((c) => c.key)).toEqual(['a-dev']);
    expect(waiting.qa.map((c) => c.key)).toEqual(['pr-11']);
    const carried = displayColumns(real, [holdFor(toQa, true)]);
    expect(carried.progress).toEqual([]);
    expect(carried.qa.map((c) => c.key)).toEqual(['pr-11']);
    expect(displayColumns(real, []).qa.map((c) => c.key)).toEqual(['pr-11', 'pr-12']);
  });

  it("keeps the old card in place of the new one, but not a developer's next issue under the same key", () => {
    const take: Move = { kind: 'take', agentId: 'qa', from: { col: 'qa', index: 1, card: pr(12, 'queued') }, to: 'monitor', key: 'pr-12' };
    const now = board({ qa: [pr(11, 'queued'), pr(12, 'testing')] });
    expect(displayColumns(now, [holdFor(take, false)]).qa.map((c) => c.qa?.status)).toEqual(['queued', 'queued']);
    // once in the tester's hand, the board already has it right: an outline, the sticky is theirs
    expect(displayColumns(now, [holdFor(take, true)]).qa.map((c) => c.ghost ?? false)).toEqual([false, true]);
    expect(displayColumns(board({ progress: [working(8)], qa: [pr(12)] }), [holdFor(toQa, false)]).progress.map((c) => c.number)).toEqual([7, 8]);
  });

  it("draws a tester's card as an outline while its sticky is on their monitor, also on the way back", () => {
    expect(displayColumns(board({ qa: [pr(12, 'testing')] }), []).qa[0].ghost).toBe(true);
    const pass: Move = { kind: 'pass', agentId: 'qa', from: { col: 'qa', index: 0, card: pr(12, 'testing') }, to: 'ready', key: 'pr-12' };
    const shown = displayColumns(board({ ready: [pr(12, 'passed')] }), [holdFor(pass, true)]);
    expect(shown.ready).toEqual([]);
    expect(shown.qa[0]).toMatchObject({ key: 'pr-12', ghost: true });
  });
});

describe('the queue', () => {
  const move = (agentId: string, key: string, kind: Move['kind'] = 'toQa'): Move => ({ kind, agentId, from: { col: 'progress', index: 0, card: { ...working(), key: `a-${agentId}` } }, to: 'qa', key });

  it('one thing at a time per person: a newer move waits for their job, and replaces one already waiting behind it', () => {
    let r = addMove([], move('a', 'pr-1'), 0, 1);
    r = addMove(r.jobs, move('a', 'pr-2'), 1, 2);
    expect(r.jobs.map((j) => [j.id, j.after])).toEqual([
      [1, undefined],
      [2, 1],
    ]);
    r = addMove(r.jobs, move('a', 'pr-3'), 2, 3);
    expect(r.jobs.map((j) => [j.id, j.after])).toEqual([
      [1, undefined],
      [3, 1],
    ]);
    expect(r.dropped.map((j) => j.id)).toEqual([2]);
    expect(mayGo(r.jobs, 'a', 3)).toBe(true); // the first one goes first
    const going: Job[] = [{ ...r.jobs[0], stage: 'going' }];
    expect(addMove(going, move('a', 'pr-4'), 2, 4).jobs.map((j) => [j.id, j.after])).toEqual([
      [1, undefined],
      [4, 1],
    ]);
    expect(mayGo(addMove(going, move('a', 'pr-4'), 2, 4).jobs, 'a', 3)).toBe(false); // not while they're on their way
    expect(addMove(going, move('b', 'pr-1', 'merge'), 2, 5).jobs).toEqual(going); // someone already has that sticky
    expect(addMove(going, move('b', 'pr-5'), 2, 6).jobs.map((j) => j.id)).toEqual([1, 6]);
  });

  it("a tester's take waits for the developer still putting that sticky up on In QA", () => {
    const toQa = move('dev', 'pr-12');
    const take: Move = { kind: 'take', agentId: 'qa', from: { col: 'qa', index: 0, card: pr(12, 'queued') }, to: 'monitor', key: 'pr-12' };
    let r = addMove([], toQa, 0, 1);
    r = addMove(r.jobs, take, 0.2, 2);
    expect(r.dropped).toEqual([]);
    expect(r.jobs.map((j) => [j.id, j.after])).toEqual([
      [1, undefined],
      [2, 1],
    ]);
    // the developer goes first; the tester doesn't, and isn't skipped for waiting
    expect(mayGo(r.jobs, 'dev', 1)).toBe(true);
    expect(mayGo(r.jobs, 'qa', 1)).toBe(false);
    expect(overdue(r.jobs[1], 0.2 + START_BY + 1)).toBe(false);
    // the board shows the card in In progress only, not in In QA as well
    const shown = displayColumns(board({ qa: [pr(12, 'testing')] }), boardHolds(r.jobs));
    expect(shown.progress.map((c) => c.key)).toEqual(['a-dev']);
    expect(shown.qa).toEqual([]);
    // also while the developer is on their way, and once placed the take may go, its START_BY from then
    const going = r.jobs.map((j) => (j.id === 1 ? { ...j, stage: 'going' as const } : j));
    expect(addMove(going, take, 0.3, 3).jobs.find((j) => j.id === 3)?.after).toBe(1);
    const after = release(going.slice(1), [going[0]], 15);
    expect(after[0]).toMatchObject({ id: 2, at: 15, after: undefined });
    expect(mayGo(after, 'qa', 16)).toBe(true);
    expect(displayColumns(board({ qa: [pr(12, 'testing')] }), boardHolds(after)).qa.map((c) => c.qa?.status)).toEqual(['queued']);
  });

  it('a developer who also tests puts their own PR up before taking the next one off the board', () => {
    const take: Move = { kind: 'take', agentId: 'dev', from: { col: 'qa', index: 0, card: pr(7, 'queued') }, to: 'monitor', key: 'pr-7' };
    let r = addMove([], move('dev', 'pr-8'), 0, 1);
    r = addMove(r.jobs, take, 0.2, 2);
    expect(r.dropped).toEqual([]);
    expect(nextJob(r.jobs, 'dev')?.move.kind).toBe('toQa');
    // their toQa skipped (too late): the take may go at once, with its own START_BY
    const left = release(r.jobs.slice(1), [r.jobs[0]], 7);
    expect(left).toMatchObject([{ id: 2, at: 7, after: undefined }]);
    expect(mayGo(left, 'dev', 8)).toBe(true);
  });

  it('skips a move whose errand has not started soon, and never holds the board longer than HOLD_MAX', () => {
    const j: Job = { id: 1, move: move('a', 'pr-1'), at: 100, stage: 'waiting' };
    expect(overdue(j, 100 + START_BY - 0.1)).toBe(false);
    expect(overdue(j, 100 + START_BY + 0.1)).toBe(true);
    expect(overdue({ ...j, stage: 'held' }, 100 + START_BY + 1)).toBe(false);
    expect(overdue({ ...j, stage: 'held' }, 100 + HOLD_MAX + 0.1)).toBe(true);
    expect(HOLD_MAX).toBeLessThanOrEqual(25);
    const carrying: Job = { ...j, move: { ...j.move, kind: 'take', to: 'monitor' }, stage: 'held' };
    expect(overdue(carrying, 100 + HOLD_MAX + 1)).toBe(false); // the board isn't waiting for it any more
    expect(overdue(carrying, 100 + CARRY_MAX + 1)).toBe(true);
  });

  it(`lets at most ${BOARD_MAX} people head for the board at once, however many moves come in`, () => {
    let jobs: Job[] = [];
    const cols = ['backlog', 'progress', 'ready', 'merged'] as const; // different columns, so only the cap holds them back
    for (let i = 0; i < 8; i++) jobs = addMove(jobs, { ...move(`p${i}`, `pr-${i}`), from: { col: cols[i % 4], index: 0, card: { ...working(), key: `a-p${i}` } } }, 0, i).jobs;
    let away = 0;
    for (const j of jobs) {
      if (!mayGo(jobs, j.move.agentId, 1)) continue;
      j.stage = 'going';
      away++;
    }
    expect(away).toBe(BOARD_MAX);
    jobs[0].move.kind = 'take';
    jobs[0].stage = 'held'; // carrying it home, away from the board: someone else may go
    expect(mayGo(jobs, jobs[BOARD_MAX].move.agentId, 1)).toBe(true);
    expect(mayGo(jobs, 'p0', START_BY + 1)).toBe(false); // too late anyway
  });

  it('sends one person at a time to each column', () => {
    const take = (agentId: string, key: string): Move => ({ kind: 'take', agentId, from: { col: 'qa', index: 0, card: pr(Number(key.slice(3)), 'queued') }, to: 'monitor', key });
    const jobs: Job[] = [
      { id: 1, move: take('a', 'pr-1'), at: 0, stage: 'going' },
      { id: 2, move: take('b', 'pr-2'), at: 0, stage: 'waiting' },
      { id: 3, move: move('c', 'pr-3'), at: 0, stage: 'waiting' }, // In progress to In QA: also at In QA
      { id: 4, move: { ...move('d', 'm-4', 'merge'), from: { col: 'ready', index: 0, card: pr(4, 'passed') }, to: 'merged' }, at: 0, stage: 'waiting' },
    ];
    expect(mayGo(jobs, 'b', 1)).toBe(false);
    expect(mayGo(jobs, 'c', 1)).toBe(true); // starts at In progress; In QA is only where it ends up
    expect(mayGo(jobs, 'd', 1)).toBe(true);
  });

  it('board errands may start while preparing, or within their grace once work starts', () => {
    const e = { work: true, grace: 5 };
    expect(mayStart('preparing', e)).toBe(true);
    expect(mayStart('working', e, 2)).toBe(true);
    expect(mayStart('working', e, 6)).toBe(false);
    expect(mayStart('working', { work: true }, 2)).toBe(false);
    expect(mayStart('error', e, 0)).toBe(false);
  });
});

describe('where the stickies are', () => {
  const p = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, w: 0, h: 0 });

  it('every note slot is on the whiteboard, in its column, in front of where people stand to reach it', () => {
    const w = walkways('office');
    for (const col of KANBAN_KEYS) {
      const s = spot(w, `board-${col}`)!;
      for (let i = 0; i < 40; i++) {
        const b = boardPose(col, i, 12, p());
        expect(Math.abs(b.x - s.x), `${col} ${i}`).toBeLessThan(1.2);
        expect(b.y - b.h / 2).toBeGreaterThan(BOARD.y);
        expect(b.y + b.h / 2).toBeLessThan(BOARD.y + BOARD.h);
        expect(b.z).toBeGreaterThan(BOARD.z);
        expect(b.z).toBeLessThan(s.z);
      }
    }
    expect(boardPose('qa', 99, 1, p())).toEqual(boardPose('qa', 1000, 1, p())); // past what fits: the last slot
  });

  it("the monitor sticky sits on the tester's monitor, facing them", () => {
    for (const slot of [0, 1, 2]) {
      const m = monitorPose({ role: 'qa', desk: slot }, p());
      const desk = qaDeskPosition(slot);
      expect(Math.hypot(m.x - desk.x, m.z - desk.z)).toBeLessThan(0.6);
      expect(m.x).toBeGreaterThan(desk.x); // testers sit west of their desk and face east, so the screen faces west
      expect(m.yaw).toBe(QA_ROTATION);
      expect(m.y).toBeGreaterThan(1.3);
    }
    // a developer testing a PR at their own desk: its monitor faces south, towards their chair
    const d = monitorPose({ role: 'dev', desk: 5 }, p());
    const desk = deskPosition(5);
    expect(Math.hypot(d.x - desk.x, d.z - desk.z)).toBeLessThan(0.6);
    expect(d.z).toBeLessThan(desk.z);
    expect(d.yaw).toBe(0);
  });
});
