// The whiteboard by hand: aim at a sticky (it lifts and E reads it), peel one off (G, or hold the click) and carry it to
// an agent's desk (they start the issue, through the assign API, or test the PR), or back to the board. Player.tsx,
// hands.ts and the HUD call in here; KanbanBoard.tsx keeps it up to date with what the board shows.
// window.__swarmBoard shows what's aimed at and held, the last hand-over, the strings and the stats, for QA.

import * as THREE from 'three';
import { api } from '../api';
import { useStore, type Agent, type Focus, type KanbanColumns } from '../store';
import type { IssueInfo, PullInfo } from '../../../shared/types';
import { statsChips, type BoardStats } from './boardStats';
import { boardPose, findCard, type Pose } from './stickies';
import { giveMine, peelForPlayer, returnMine, type StickyCtrl } from './StickyNotes';
import { boardToCanvas, canPeel, cardLabel, dropTarget, noteAt, visibleCount, type Drop, type Pair, type Slot } from './whiteboard';
import { KANBAN_KEYS } from './draw';

/** Holding the click this long on a sticky peels it off; a shorter click reads it. */
export const HOLD_MS = 350;

/** The floor's whiteboard, as KanbanBoard.tsx last drew it. */
export interface BoardHands {
  repoId: string;
  ctrl: StickyCtrl;
  /** The columns as the 3D board shows them. */
  cols: KanbanColumns;
  agents: Agent[];
  issues: IssueInfo[];
  pulls: PullInfo[];
  strings: readonly Pair[];
  stats: BoardStats | null;
  /** The aim target for the board's interactable: the card under the crosshair, or null for the board itself. */
  pick: (point: THREE.Vector3, root: THREE.Object3D) => Focus | null;
}

let board: BoardHands | null = null;
const paints = { count: 0, last: 0 };

const local = new THREE.Vector3();
const uv = { u: 0, v: 0 };

export function makeBoardHands(repoId: string, ctrl: StickyCtrl): BoardHands {
  // one Focus per card and peelability, so aiming along a card doesn't make new ones
  let cache = new Map<string, Focus>();
  let cachedFor: KanbanColumns | null = null;
  const hands: BoardHands = {
    repoId,
    ctrl,
    cols: { backlog: [], progress: [], qa: [], ready: [], merged: [] },
    agents: [],
    issues: [],
    pulls: [],
    strings: [],
    stats: null,
    pick(point, root) {
      root.worldToLocal(local.copy(point));
      boardToCanvas(local.x, local.y, uv);
      const spot = noteAt(hands.cols, uv.u, uv.v);
      if (!spot) return null;
      if (cachedFor !== hands.cols) {
        cache = new Map();
        cachedFor = hands.cols;
      }
      const peel = canPeel(spot.col, spot.card);
      const id = `card:${spot.card.key}${peel ? ':peel' : ''}`;
      let f = cache.get(id);
      if (!f) {
        f = { id, label: `Read ${cardLabel(spot.card)}`, action: { kind: 'card', repoId, key: spot.card.key, number: spot.card.number, pr: !!spot.card.prNumber, peel } };
        cache.set(id, f);
      }
      return f;
    },
  };
  return hands;
}

/** KanbanBoard.tsx's board is the one on this floor; returns the cleanup. */
export function activateBoard(b: BoardHands) {
  board = b;
  return () => {
    if (board === b) board = null;
  };
}

/** The board's canvas was painted (for the probe: it repaints only when what's on it changes). */
export function notePaint() {
  paints.count++;
  paints.last = Date.now();
}

/** What putting the carried sticky down at `focus` would do (the HUD's hint), or null when you don't carry one. */
export function stickyDrop(focus: Focus | null): Drop | null {
  const held = useStore.getState().held;
  if (held?.kind !== 'sticky' || !board || board.repoId !== held.repoId) return null;
  return dropTarget(held, focus, board.agents, board.issues);
}

// ---------- peeling one off ----------

/** Peel the sticky `focus` is on into your hands (G, or holding the click). False when `focus` isn't a sticky. */
export function peelAimed(focus: Focus | null): boolean {
  const a = focus?.action;
  const s = useStore.getState();
  if (a?.kind !== 'card' || !board || a.repoId !== board.repoId || s.held) return false;
  const at = findCard(board.cols, a.key);
  if (!at || !canPeel(at.col, at.card)) {
    s.pushToast('info', '📌 Only Backlog issues, and PRs waiting to go to QA, come off the board');
    return true;
  }
  if (!peelForPlayer(board.ctrl, at)) return true;
  s.setHeld({ kind: 'sticky', id: `sticky:${at.card.key}`, repoId: board.repoId, key: at.card.key, number: at.card.number, pr: !!at.card.prNumber });
  return true;
}

let press: { focus: Focus; timer: ReturnType<typeof setTimeout> } | null = null;

/** The mouse went down on a sticky: holding it peels it off, letting go sooner reads it. False for anything else. */
export function pressBoard(focus: Focus): boolean {
  if (focus.action.kind !== 'card') return false;
  if (press) clearTimeout(press.timer);
  const p = {
    focus,
    timer: setTimeout(() => {
      // nothing to peel (letting go reads it), or the mouse was freed meanwhile
      if (press !== p || focus.action.kind !== 'card' || !focus.action.peel || !document.pointerLockElement) return;
      press = null;
      peelAimed(focus);
    }, HOLD_MS),
  };
  press = p;
  return true;
}

/** The mouse came up: a click on a sticky reads it (through `open`, Player's runFocusAction). */
export function releaseBoard(open: (focus: Focus) => void) {
  const p = press;
  if (!p) return;
  press = null;
  clearTimeout(p.timer);
  open(p.focus);
}

// ---------- putting it down ----------

/** A sticky put down at a desk, and what the office said. */
interface Handover {
  at: number;
  kind: 'assign' | 'qa';
  agent: string | null;
  number: number;
  result: 'pending' | 'ok' | 'refused';
  error?: string;
}

let stowing = false;
let last: Handover | null = null;

/** The sticky leaves your hands without floating back: the office has it now. */
function stow() {
  stowing = true;
  try {
    useStore.getState().setHeld(null);
  } finally {
    stowing = false;
  }
}

// Every other way a sticky leaves your hands (G away from a desk, Esc, a panel opening, a new floor) sends it back.
useStore.subscribe((s, prev) => {
  const was = prev.held;
  if (stowing || was?.kind !== 'sticky' || (s.held?.kind === 'sticky' && s.held.id === was.id)) return;
  if (board?.repoId === was.repoId) returnMine(board.ctrl);
});

/**
 * Put the carried sticky down where you're aiming (E, G or a click). An agent's desk starts the issue there, or has
 * them test the PR; a desk that can't take it says why, and the board takes it back. `anywhere`: anywhere else
 * sends it back too (G, a click); otherwise (E) it's left for the target's own action. True when the sticky was used.
 */
export function placeSticky(focus: Focus | null, anywhere: boolean): boolean {
  const s = useStore.getState();
  const held = s.held;
  if (held?.kind !== 'sticky') return false;
  const b = board;
  const drop = b && b.repoId === held.repoId ? dropTarget(held, focus, b.agents, b.issues) : ({ kind: 'none' } as const);
  if (drop.kind === 'none' && !anywhere) return false;
  if (!b || drop.kind === 'none' || drop.kind === 'back') {
    s.setHeld(null);
    return true;
  }
  if (drop.kind === 'refuse') {
    s.pushToast('error', drop.label);
    s.setHeld(null);
    return true;
  }
  stow();
  const n = held.number;
  const agent = b.agents.find((a) => a.id === drop.agentId);
  if (drop.kind === 'qa') {
    const rec: Handover = { at: Date.now(), kind: 'qa', agent: agent?.name ?? drop.agentId, number: n, result: 'pending' };
    last = rec;
    // The office decides: busy or out of session slots, it refuses with the console's words.
    api
      .sendToQa(b.repoId, n, drop.agentId)
      .then(() => {
        rec.result = 'ok';
        s.pushToast('success', `📌 ${agent?.name ?? 'They'} will test PR #${n}`);
      })
      .catch((err: Error) => Object.assign(rec, { result: 'refused', error: err.message }))
      .finally(() => returnMine(b.ctrl)); // it waits on the board for them to come and take it
    return true;
  }
  const rec: Handover = { at: Date.now(), kind: 'assign', agent: agent?.name ?? drop.agentId, number: n, result: 'pending' };
  last = rec;
  // The office decides: busy, waiting on other issues or out of session slots, it refuses with the console's words.
  api
    .assign(drop.agentId, n, undefined, true)
    .then(() => {
      rec.result = 'ok';
      if (agent) giveMine(b.ctrl, agent);
      else returnMine(b.ctrl);
      s.pushToast('success', `📌 ${agent?.name ?? 'They'} started #${n}`);
    })
    .catch((err: Error) => {
      Object.assign(rec, { result: 'refused', error: err.message });
      returnMine(b.ctrl);
    });
  return true;
}

// ---------- the probe ----------

const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, w: 0, h: 0 };
const round = (n: number) => Math.round(n * 100) / 100;
const slotName = (s: Slot) => `${s.col}:${s.index}`;

const probe = {
  /** The sticky under the crosshair. */
  aim() {
    const a = useStore.getState().focus?.action;
    return a?.kind === 'card' ? { key: a.key, number: a.number, pr: a.pr, peel: !!a.peel } : null;
  },
  /** The sticky in your hands (and where the board's copy of it is). */
  held() {
    const h = useStore.getState().held;
    return { held: h?.kind === 'sticky' ? { key: h.key, number: h.number, pr: h.pr } : null, mine: board?.ctrl.mine ? { ...board.ctrl.mine } : null };
  },
  /** The last sticky put down at a desk: to whom, and what the office said. */
  lastAssign() {
    return last ? { ...last } : null;
  },
  /** The "Depends on" strings on the board. */
  strings() {
    return (board?.strings ?? []).map((p) => ({ waiter: p.waiter, blocker: p.blocker, from: slotName(p.from), to: slotName(p.to) }));
  },
  /** The stats corner, and how often the board's canvas has been painted. */
  stats() {
    return board?.stats ? { ...board.stats, chips: statsChips(board.stats).map((c) => c.text), paints: { ...paints } } : null;
  },
  /** Every sticky the board draws, with the middle of it in the world (to aim at). */
  cards() {
    if (!board) return [];
    const out: { key: string; number: number; col: string; index: number; peel: boolean; x: number; y: number; z: number }[] = [];
    for (const col of KANBAN_KEYS) {
      const cards = board.cols[col];
      for (let index = 0; index < visibleCount(cards.length); index++) {
        const c = cards[index];
        boardPose(col, index, c.number, pose);
        out.push({ key: c.key, number: c.number, col, index, peel: canPeel(col, c), x: round(pose.x), y: round(pose.y), z: round(pose.z) });
      }
    }
    return out;
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmBoard = probe;
