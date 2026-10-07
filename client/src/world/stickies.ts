// Stickies, the pure side: which Kanban moves send someone to the whiteboard (an agent opening a PR, an agent testing
// it picking it up or finishing, a merge), what the 3D board shows while their sticky is on its way, and the per-agent
// job queue that keeps a burst of moves orderly. StickyNotes.tsx runs it; the HTML Kanban panel never waits for it.

import type { KanbanCard, KanbanColumns } from '../store';
import { kanbanCapacity, kanbanNoteRect, KANBAN_KEYS } from './draw';
import { BOARD, deskPosition, deskRotation } from './layout';

export type Col = keyof KanbanColumns;

/**
 * toQa: its author moves their sticky from In progress to In QA. take: a tester takes it off In QA to their desk.
 * pass / fail: the tester brings it back, to Ready to merge or to the QA column. merge: its author moves it to Merged.
 */
export type MoveKind = 'toQa' | 'take' | 'pass' | 'fail' | 'merge';

export interface Spot {
  col: Col;
  index: number;
  card: KanbanCard;
}

export interface Move {
  kind: MoveKind;
  agentId: string;
  /** The card as it was, and where. */
  from: Spot;
  /** Where the sticky ends up: a column, or the tester's monitor. */
  to: Col | 'monitor';
  /** The card's key once it's there. */
  key: string;
}

/** Where a card is on the board, by key. */
export function findCard(cols: KanbanColumns, key: string): Spot | null {
  for (const col of KANBAN_KEYS) {
    const index = cols[col].findIndex((c) => c.key === key);
    if (index >= 0) return { col, index, card: cols[col][index] };
  }
  return null;
}

/** Who wrote a card's PR: QA's record, else the card's agent unless that's someone testing it. */
const authorOf = (c: KanbanCard) => c.qa?.devAgentId ?? (c.agent && c.agent.role !== 'ceo' && c.agent.task !== 'qa' ? c.agent.id : null);

/** The moves between two versions of a floor's board that someone could walk over and make. */
export function stickyMoves(prev: KanbanColumns, next: KanbanColumns): Move[] {
  const out: Move[] = [];
  for (const c of next.qa) {
    const was = findCard(prev, c.key);
    if (!was) {
      // a new PR: its author's In progress card has gone
      const author = authorOf(c);
      const index = author ? prev.progress.findIndex((p) => p.agent?.id === author) : -1;
      if (author && index >= 0) {
        const card = prev.progress[index];
        if (!next.progress.some((p) => p.key === card.key && p.number === card.number)) out.push({ kind: 'toQa', agentId: author, from: { col: 'progress', index, card }, to: 'qa', key: c.key });
      }
      continue;
    }
    if (was.col !== 'qa') continue;
    const before = was.card.qa;
    const now = c.qa;
    if (before?.status !== 'testing' && now?.status === 'testing' && now.qaAgentId) out.push({ kind: 'take', agentId: now.qaAgentId, from: was, to: 'monitor', key: c.key });
    else if (before?.status === 'testing' && now?.status !== 'testing' && before.qaAgentId) out.push({ kind: 'fail', agentId: before.qaAgentId, from: was, to: 'qa', key: c.key });
  }
  for (const c of next.ready) {
    const was = findCard(prev, c.key);
    if (was?.col === 'qa' && was.card.qa?.status === 'testing' && was.card.qa.qaAgentId) out.push({ kind: 'pass', agentId: was.card.qa.qaAgentId, from: was, to: 'ready', key: c.key });
  }
  for (const c of next.merged) {
    if (findCard(prev, c.key)) continue;
    const was = findCard(prev, `pr-${c.number}`);
    if (!was) continue;
    const author = c.agent?.id ?? authorOf(was.card);
    if (author) out.push({ kind: 'merge', agentId: author, from: was, to: 'merged', key: c.key });
  }
  return out;
}

// ---------- what the 3D board shows ----------

/** A move the board is holding back: the card stays where it was (`keep`) and its new place stays empty (`hide`). */
export interface Hold {
  keep: Spot | null;
  hide: readonly string[];
}

/**
 * While the sticky is still on the board, it shows where it was; once taken, only a tester's (a ghost) stays. A sticky
 * a tester has taken holds nothing back: the board already shows the card as theirs.
 */
export function holdFor(move: Move, taken: boolean): Hold {
  if (taken && move.kind === 'take') return { keep: null, hide: [] };
  const withTester = move.from.card.qa?.status === 'testing';
  return { keep: !taken || withTester ? move.from : null, hide: [move.key] };
}

/**
 * The columns as the 3D board draws them: the real ones with the held moves held back, and every card a tester has
 * at their desk drawn as an outline (its sticky is on their monitor).
 */
export function displayColumns(cols: KanbanColumns, holds: readonly Hold[]): KanbanColumns {
  const hidden = new Set(holds.flatMap((h) => h.hide));
  const kept = holds.flatMap((h) => (h.keep ? [h.keep] : []));
  const out = {} as KanbanColumns;
  for (const col of KANBAN_KEYS) {
    const list = cols[col].filter((c) => !hidden.has(c.key) && !kept.some((k) => k.card.key === c.key && k.card.number === c.number));
    for (const k of kept.filter((x) => x.col === col).sort((a, b) => a.index - b.index)) list.splice(Math.min(k.index, list.length), 0, k.card);
    out[col] = col === 'qa' ? list.map((c) => (c.qa?.status === 'testing' && !c.ghost ? { ...c, ghost: true } : c)) : list;
  }
  return out;
}

// ---------- the job queue ----------

/** waiting: for the errand to start. going: on their way to the board. held: the sticky is in their hand. */
export type Stage = 'waiting' | 'going' | 'held';

export interface Job {
  id: number;
  move: Move;
  /** Seconds (any clock) when the real move happened. */
  at: number;
  stage: Stage;
  /** Waiting for this job (someone else bringing the sticky to where this move starts) to finish first. */
  after?: number;
}

/** A move whose errand hasn't started this soon is skipped: the board just updates. */
export const START_BY = 6;
/** The board never lags the real state by more than this (seconds): an errand still under way gives up its sticky. */
export const HOLD_MAX = 25;
/** A tester carrying a sticky home gives up on it after this long (it then just appears on their monitor). */
export const CARRY_MAX = 60;
/** At most this many people on their way to (or busy at) the board at once. */
export const BOARD_MAX = 2;

/**
 * Adds a move to the queue. One thing at a time per person: a move waits (`after`) for the job they already have, and
 * replaces one already waiting behind it (the stale one is skipped). A move of a sticky someone else is still bringing
 * over (a tester taking the PR its author is putting up) waits for them instead, and a move of a sticky someone else
 * already has is skipped. Returns the queue to keep and the jobs dropped (the board shows those as they are).
 */
export function addMove(jobs: readonly Job[], move: Move, at: number, id: number): { jobs: Job[]; dropped: Job[] } {
  const others = jobs.filter((j) => j.move.agentId !== move.agentId);
  const mine = jobs.filter((j) => j.move.agentId === move.agentId);
  const before = others.find((j) => j.move.key === move.from.card.key);
  if (!before && others.some((j) => j.stage !== 'waiting' && (j.move.key === move.key || j.move.from.card.key === move.from.card.key))) return { jobs: [...jobs], dropped: [] };
  const stale = (j: Job) =>
    j.stage === 'waiting' && j !== before && j !== mine[0] && (j.move.agentId === move.agentId || j.move.key === move.key);
  const dropped = jobs.filter(stale);
  const after = before?.id ?? mine[0]?.id;
  const job: Job = after === undefined ? { id, move, at, stage: 'waiting' } : { id, move, at, stage: 'waiting', after };
  return { jobs: [...release(jobs.filter((j) => !stale(j)), dropped, at), job], dropped };
}

/** Someone's next job: the one they're on, else the first still waiting. */
export const nextJob = (jobs: readonly Job[], agentId: string): Job | undefined =>
  jobs.find((j) => j.move.agentId === agentId && j.stage !== 'waiting') ?? jobs.find((j) => j.move.agentId === agentId);

/** The jobs that were waiting for `gone` may set off now: their START_BY counts from `now`. */
export function release(jobs: readonly Job[], gone: readonly Job[], now: number): Job[] {
  return jobs.map((j) => (j.after !== undefined && gone.some((g) => g.id === j.after) ? { ...j, after: undefined, at: now } : j));
}

/**
 * Jobs past their time: waiting longer than START_BY (or, behind someone else's, CARRY_MAX at most), or holding the
 * board longer than HOLD_MAX.
 */
export const overdue = (j: Job, now: number) =>
  now - j.at >
  (j.stage === 'waiting' ? (j.after !== undefined ? CARRY_MAX : START_BY) : j.stage === 'held' && j.move.kind === 'take' ? CARRY_MAX : HOLD_MAX);

/** What the board holds back for the queue. A move waiting behind someone else's just keeps its card out of sight. */
export const boardHolds = (jobs: readonly Job[]): Hold[] =>
  jobs.map((j) => (j.after !== undefined ? { keep: null, hide: [j.move.key] } : holdFor(j.move, j.stage === 'held')));

/** The column someone walks up to first: where the sticky is, or where a tester brings it back to. */
export const firstColumn = (m: Move): Col => (m.kind === 'pass' || m.kind === 'fail' ? (m.to as Col) : m.from.col);

/** May this person set off on their job now? Only so many at the board at once, and one at each column. */
export function mayGo(jobs: readonly Job[], agentId: string, now: number): boolean {
  const next = nextJob(jobs, agentId);
  const mine = next?.stage === 'waiting' ? next : undefined;
  const atBoard = jobs.filter((j) => j.stage !== 'waiting' && !(j.stage === 'held' && j.move.kind === 'take')); // not those carrying one home
  if (!mine || mine.after !== undefined || overdue(mine, now) || atBoard.length >= BOARD_MAX) return false;
  const col = firstColumn(mine.move);
  return !atBoard.some((j) => firstColumn(j.move) === col || j.move.to === col);
}

// ---------- where things are ----------

/** A flat sticky in the world: its middle, yaw (0 facing +Z), pitch and roll (radians), and size (m). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  w: number;
  h: number;
}

const TEX_W = 2560; // KanbanBoard.tsx's canvas
const TEX_H = Math.round((TEX_W * BOARD.h) / BOARD.w);

/** Where the `index`th note of a column sits on the 3D board (the last slot when it's past what fits). */
export function boardPose(col: Col, index: number, number: number, out: Pose): Pose {
  const n = kanbanNoteRect(KANBAN_KEYS.indexOf(col), Math.max(0, Math.min(index, kanbanCapacity(TEX_H) - 1)), TEX_W);
  out.x = -BOARD.w / 2 + ((n.x + n.w / 2) / TEX_W) * BOARD.w;
  out.y = BOARD.y + BOARD.h - ((n.y + n.h / 2) / TEX_H) * BOARD.h;
  out.z = BOARD.z + 0.08;
  out.yaw = 0;
  out.pitch = 0;
  out.roll = -(((number * 37) % 7) - 3) * 0.006; // drawNote's tilt (canvas y points down)
  out.w = (n.w / TEX_W) * BOARD.w;
  out.h = (n.h / TEX_H) * BOARD.h;
  return out;
}

/** The little sticky on a tester's monitor (at their desk, `desk`): its top corner, facing them. */
export function monitorPose(who: { desk: number }, out: Pose): Pose {
  const { x, z } = deskPosition(who.desk);
  const lx = -0.43; // desk space (Desk.tsx): the monitor's front is at z -0.275, its top edge at y 1.645
  const lz = -0.268;
  const turn = deskRotation(who.desk);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  out.x = x + lx * c + lz * s;
  out.y = 1.6;
  out.z = z - lx * s + lz * c;
  out.yaw = turn;
  out.pitch = -0.06;
  out.roll = 0.12;
  out.w = 0.2;
  out.h = 0.093;
  return out;
}
