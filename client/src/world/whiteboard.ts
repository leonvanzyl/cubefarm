// The whiteboard you work with by hand, the pure side: which sticky the crosshair is on, which stickies come off the
// board, what a carried sticky does where you put it, and the "Depends on" strings pinned between stickies.
// boardHands.ts runs it; KanbanBoard.tsx and drawKanban (draw.ts) draw it.

import { blockers, waitsMessage } from '../../../shared/issues';
import type { IssueInfo, PullInfo } from '../../../shared/types';
import type { Agent, Focus, KanbanCard, KanbanColumns } from '../store';
import { kanbanCapacity, kanbanNoteRect, KANBAN_KEYS } from './draw';
import { BOARD } from './layout';
import type { Col } from './stickies';

/** KanbanBoard.tsx's canvas, in pixels. */
export const BOARD_TEX = { w: 2560, h: Math.round((2560 * BOARD.h) / BOARD.w) };

/** A card as the board shows it: its column and its slot there. */
export interface Slot {
  col: Col;
  index: number;
}

/** How many of a column's cards the board draws (the last slot says "+N more" when they don't all fit). */
export function visibleCount(cards: number, texH = BOARD_TEX.h) {
  const capacity = kanbanCapacity(texH);
  return cards > capacity ? capacity - 1 : cards;
}

/** Where a point on the board's face (metres, the board group's own space) is on its canvas. */
export function boardToCanvas(x: number, y: number, out: { u: number; v: number }) {
  out.u = ((x + BOARD.w / 2) / BOARD.w) * BOARD_TEX.w;
  out.v = ((BOARD.y + BOARD.h - y) / BOARD.h) * BOARD_TEX.h;
  return out;
}

/** The card drawn at canvas point (u, v), if any. */
export function noteAt(cols: KanbanColumns, u: number, v: number): (Slot & { card: KanbanCard }) | null {
  for (let ci = 0; ci < KANBAN_KEYS.length; ci++) {
    const col = KANBAN_KEYS[ci];
    const n = visibleCount(cols[col].length);
    for (let i = 0; i < n; i++) {
      const r = kanbanNoteRect(ci, i, BOARD_TEX.w);
      if (u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h) return { col, index: i, card: cols[col][i] };
    }
  }
  return null;
}

/**
 * A sticky you may peel off and carry: an issue in the Backlog (for a developer's desk), or a PR in In QA that the
 * console would send to QA (never tested, or needing you) for the QA lab.
 */
export function canPeel(col: Col, card: KanbanCard) {
  if (col === 'backlog') return !card.prNumber;
  return col === 'qa' && !!card.prNumber && !card.ghost && (!card.qa || card.qa.status === 'needs-human');
}

/** What the card's number reads like: "#12" or "PR #7". */
export const cardLabel = (c: { number: number; pr?: boolean; prNumber?: number }) => `${c.pr || c.prNumber ? 'PR ' : ''}#${c.number}`;

// ---------- putting a carried sticky down ----------

/** The sticky in your hands. */
export interface Carried {
  number: number;
  pr: boolean;
}

/**
 * What putting the sticky down at `focus` does. assign: the issue goes to that developer through the assign API (warn
 * is what the server will refuse with, shown before you try). qa: the PR goes to QA. back: onto the board again.
 * refuse: a desk that can't take it (the warning, then it floats back). none: not a place for stickies.
 */
export type Drop =
  | { kind: 'assign'; agentId: string; label: string; warn: string | null }
  | { kind: 'qa'; label: string }
  | { kind: 'back'; label: string }
  | { kind: 'refuse'; label: string }
  | { kind: 'none' };

const busy = (a: Pick<Agent, 'status'>) => a.status === 'preparing' || a.status === 'working';

export function dropTarget(s: Carried, focus: Pick<Focus, 'action'> | null, agents: readonly Agent[], issues: readonly Pick<IssueInfo, 'number' | 'body'>[]): Drop {
  const a = focus?.action;
  const what = cardLabel(s);
  if (!a) return { kind: 'none' };
  if (a.kind === 'kanban' || a.kind === 'card') return { kind: 'back', label: `Put ${what} back` };
  const qa = { kind: 'qa', label: `Send ${what} to QA` } as const;
  if (a.kind === 'hire') {
    if (a.role === 'qa') return s.pr ? qa : { kind: 'refuse', label: 'The QA lab tests pull requests: give issues to a developer' };
    return { kind: 'refuse', label: 'Nobody sits at this desk yet' };
  }
  if (a.kind !== 'terminal') return { kind: 'none' };
  const who = agents.find((x) => x.id === a.agentId);
  if (!who) return { kind: 'none' };
  if (who.role === 'qa') return s.pr ? qa : { kind: 'refuse', label: `${who.name} is a QA tester; they test pull requests rather than issues.` };
  if (who.role !== 'dev') return { kind: 'none' };
  if (s.pr) return { kind: 'refuse', label: 'Pull requests go to the QA lab, along the east wall' };
  const issue = issues.find((i) => i.number === s.number);
  const waits = issue ? blockers(issue.body, new Set(issues.map((i) => i.number))) : [];
  const warn = busy(who) ? `${who.name} is already working on #${who.issueNumber}` : waits.length ? waitsMessage(s.number, waits) : null;
  return { kind: 'assign', agentId: who.id, label: warn ? `⚠️ ${warn}` : `Give #${s.number} to ${who.name}`, warn };
}

// ---------- dependency strings ----------

/** A red string from an issue's sticky to the sticky of an open issue it waits for. */
export interface Pair {
  waiter: number;
  blocker: number;
  from: Slot;
  to: Slot;
}

/**
 * The "Depends on #N" pairs whose stickies are both on the board. An issue's sticky is its Backlog or In progress card,
 * or the open PR that closes it; merged ones are done. Only open blockers count, so a string goes when its blocker closes.
 */
export function dependencyPairs(issues: readonly Pick<IssueInfo, 'number' | 'body'>[], pulls: readonly Pick<PullInfo, 'number' | 'closesIssues'>[], cols: KanbanColumns): Pair[] {
  const slots = new Map<number, Slot>();
  for (const col of KANBAN_KEYS) {
    if (col === 'merged') continue;
    const cards = cols[col];
    const n = visibleCount(cards.length);
    for (let index = 0; index < n; index++) {
      const c = cards[index];
      const nums = c.prNumber ? (pulls.find((p) => p.number === c.prNumber)?.closesIssues ?? []) : [c.number];
      for (const num of nums) if (!slots.has(num)) slots.set(num, { col, index });
    }
  }
  const open = new Set(issues.map((i) => i.number));
  const out: Pair[] = [];
  for (const i of issues) {
    const from = slots.get(i.number);
    if (!from) continue;
    for (const b of blockers(i.body, open)) {
      const to = slots.get(b);
      if (to && (to.col !== from.col || to.index !== from.index)) out.push({ waiter: i.number, blocker: b, from, to });
    }
  }
  return out;
}

// ---------- reading a card ----------

/** The card a card view is about, wherever it is now: by key, else the same issue or PR by number. */
export function locateCard(cols: KanbanColumns, key: string, number: number, pr: boolean): (Slot & { card: KanbanCard }) | null {
  let byNumber: (Slot & { card: KanbanCard }) | null = null;
  for (const col of KANBAN_KEYS) {
    const cards = cols[col];
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      if (card.key === key) return { col, index, card };
      if (!byNumber && card.number === number && !!card.prNumber === pr) byNumber = { col, index, card };
    }
  }
  return byNumber;
}

/** The first lines of an issue's body, for the card view: at most `lines` non-blank lines and `chars` characters. */
export function bodyExcerpt(body: string, lines = 8, chars = 600): { text: string; more: boolean } {
  const all = (body ?? '').split(/\r?\n/);
  const out: string[] = [];
  let kept = 0;
  let used = 0;
  let i = 0;
  for (; i < all.length && kept < lines && used < chars; i++) {
    const line = all[i];
    if (line.trim()) kept++;
    out.push(used + line.length > chars ? `${line.slice(0, Math.max(0, chars - used)).trimEnd()}…` : line);
    used += line.length + 1;
  }
  const more = all.slice(i).some((l) => l.trim()) || used > chars;
  return { text: out.join('\n').trim(), more };
}
