// The ping-pong match as plain module state (like npc.ts): who plays at which end, the game's phase and score, the
// player's paddle and view, what each agent at the table does with their feet and paddle, and window.__swarmPong.
// The toy world (PingPong.tsx) runs the match and writes here; the errands (pongErrands.ts), Character.tsx, the HUD,
// the table's scoreboard and the player's controls (Player.tsx) read it. Kept out of the physics chunk so they can.

import { PONG_PLAYER } from '../../../../shared/pong';
import { useStore } from '../../store';
import type { Gesture } from '../body';
import { fromOwn, otherEnd, TABLE, type End, type Swing, type V3 } from './pongPhysics';
import { atGamePoint, newGame, serverOf, type Game, type PointWhy } from './pongRules';
import type { PongLive } from './pongRunner';

export type Seat = { kind: 'player' } | { kind: 'agent'; id: string; ready: boolean };

/**
 * waiting: for both ends to be ready · serve: the server has the ball · rally: it's in play · point: a point was just
 * won (the ball still rolling about) · over: the game is over, a rematch on offer for a moment.
 */
export type Phase = 'waiting' | 'serve' | 'rally' | 'point' | 'over';

export interface Match {
  id: number;
  seats: Record<End, Seat | null>;
  game: Game;
  phase: Phase;
  /** performance.now() when the phase started. */
  since: number;
  /** The last point (who won it and why), or the game's winner once it's over. */
  last: { winner: End; why: PointWhy | 'game' } | null;
  /** Returns in the rally under way, and the longest this game. */
  rally: number;
  longest: number;
  /** The player asked for a rematch (after a game), or to serve (the toss). */
  ask: 'rematch' | 'serve' | null;
}

let match: Match | null = null;
let seq = 1;
const listeners = new Set<() => void>();

/** The match on this floor, or null. Mutated in place by the toy world; call `pongChanged` after a change the HUD shows. */
export const pongMatch = () => match;

/** Something the HUD or the scoreboard shows changed (a point, a seat, the phase). */
export function pongChanged() {
  cached = null;
  for (const fn of listeners) fn();
}

export function subscribePong(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// ---------- seats ----------

const isPlayer = (s: Seat | null | undefined) => s?.kind === 'player';
const isAgent = (s: Seat | null | undefined, id: string) => s?.kind === 'agent' && s.id === id;

/** The end the player is at, or null. */
export const playerEnd = (): End | null => (isPlayer(match?.seats.west) ? 'west' : isPlayer(match?.seats.east) ? 'east' : null);

/** The end agent `id` plays (or is on the way to), or null. */
export function seatOf(id: string): End | null {
  if (!match) return null;
  return isAgent(match.seats.west, id) ? 'west' : isAgent(match.seats.east, id) ? 'east' : null;
}

function newMatch(seats: Match['seats']): Match {
  return { id: seq++, seats, game: newGame('west'), phase: 'waiting', since: performance.now(), last: null, rally: 0, longest: 0, ask: null };
}

/** Back to waiting with a fresh score: someone left mid-game, or a new pair is about to start. */
function reset(m: Match) {
  m.phase = 'waiting';
  m.since = performance.now();
  m.game = newGame('west');
  m.last = null;
  m.rally = 0;
  m.longest = 0;
  m.ask = null;
}

/**
 * The player picks up a paddle at `end`. A free end is theirs; at an end someone's waiting at, they take the other;
 * with two agents mid-game, they step in for whoever is at `end`. Returns the end they play, or null.
 */
export function joinPong(end: End): End | null {
  if (!match) match = newMatch({ west: null, east: null });
  const m = match;
  const here = m.seats[end];
  const there = m.seats[otherEnd(end)];
  let mine = end;
  if (here?.kind === 'agent' && !there) mine = otherEnd(end);
  else if (isPlayer(there)) return otherEnd(end); // already playing at the other end
  if (m.seats[mine]?.kind === 'agent' || m.phase !== 'waiting') reset(m);
  m.seats[mine] = { kind: 'player' };
  centrePaddle();
  pongChanged();
  useStore.getState().setHeld({ kind: 'paddle', id: mine });
  return mine;
}

/** The player put the paddle down (G, Esc, a panel, the elevator): their end is free and the game stops. */
function playerLeft() {
  const m = match;
  const end = playerEnd();
  if (!m || !end) return;
  m.seats[end] = null;
  reset(m);
  if (!m.seats.west && !m.seats.east) match = null;
  autopilot.on = false;
  pongChanged();
}

useStore.subscribe((s, prev) => {
  if (prev.held?.kind === 'paddle' && s.held?.kind !== 'paddle') playerLeft();
});

/** Puts the paddle down (probe, or the floor going away). */
export function leavePong() {
  if (useStore.getState().held?.kind === 'paddle') useStore.getState().setHeld(null);
  else playerLeft();
}

/** The end that's waiting for someone to come and play (nobody on the way yet), or null. */
export function wantsOpponent(): End | null {
  const m = match;
  if (!m || m.phase !== 'waiting') return null;
  if (m.seats.west && !m.seats.east) return 'east';
  if (m.seats.east && !m.seats.west) return 'west';
  return null;
}

/** Whether the table is free for two agents to start a game: nobody at it at all. */
export const tableFree = () => !match;

/** An agent heading over to take the waiting end. Returns that end, or null when it's gone. */
export function claimSeat(id: string): End | null {
  const end = wantsOpponent();
  if (!end || !match) return null;
  match.seats[end] = { kind: 'agent', id, ready: false };
  pongChanged();
  return end;
}

/** An agent sets off to start a game at `end` of the free table; someone else free then comes to the other end. */
export function startNpcMatch(id: string, end: End): End | null {
  if (match) return null;
  match = newMatch({ west: null, east: null });
  match.seats[end] = { kind: 'agent', id, ready: false };
  pongChanged();
  return end;
}

/** They're at their end, paddle in hand. */
export function readySeat(id: string) {
  const end = seatOf(id);
  const s = end && match?.seats[end];
  if (s && s.kind === 'agent' && !s.ready) {
    s.ready = true;
    pongChanged();
  }
}

/** An agent leaves the table (their errand ended, however): their end is free and the game stops. */
export function leaveSeat(id: string) {
  const m = match;
  const end = seatOf(id);
  npc.delete(id);
  if (!m || !end) return;
  m.seats[end] = null;
  if (m.phase !== 'over') reset(m);
  if (!m.seats.west && !m.seats.east) match = null;
  pongChanged();
}

/** Both ends taken and everyone there. */
export const bothReady = (m: Match) => (['west', 'east'] as const).every((e) => isPlayer(m.seats[e]) || (m.seats[e]?.kind === 'agent' && (m.seats[e] as { ready: boolean }).ready));

/** A fresh game for the same two (the player clicked for a rematch). */
export function rematch(m: Match, first: End) {
  reset(m);
  m.game = newGame(first);
  pongChanged();
}

/** The toy world went away (another floor): nobody plays here any more. */
export function resetPong() {
  if (playerEnd()) leavePong();
  match = null;
  npc.clear();
  pongChanged();
}

// ---------- the agents' feet and paddles ----------

/** What an agent at the table does: where they step to, which way they face, their hands, and where their paddle is. */
export interface NpcPong {
  x: number;
  z: number;
  heading: number;
  speed: number;
  gesture: Gesture;
  paddle: V3 | null;
}

const npc = new Map<string, NpcPong>();

/** The toy world moves an agent at the table (null: they just stand there). */
export function setNpcPong(id: string, cmd: NpcPong | null) {
  if (cmd) npc.set(id, cmd);
  else npc.delete(id);
}

export const npcPong = (id: string) => npc.get(id) ?? null;

/** Where agent `id`'s paddle is (world), for Character.tsx to reach for; null when they aren't holding one. */
export const pongPaddle = (id: string) => npc.get(id)?.paddle ?? null;

/** Whether agent `id` is at the table with a paddle in hand. */
export function holdsPaddle(id: string): boolean {
  const end = seatOf(id);
  const s = end ? match?.seats[end] : null;
  return s?.kind === 'agent' && s.ready;
}

/** Whether the paddle hanging at `end` has been taken: someone is playing there. */
export function paddleTaken(end: End): boolean {
  const s = match?.seats[end];
  return s?.kind === 'player' || (s?.kind === 'agent' && s.ready);
}

// ---------- the player's paddle and view ----------

/**
 * The player's paddle in their own frame (pongPhysics ownFrame): to their right (`lat`), behind the end line
 * (`back`, negative over the table), its height, and its velocity (m/s, smoothed), which shapes the shot.
 */
export const paddle = { lat: 0, back: 0.25, y: TABLE.top + 0.2, vLat: 0, vBack: 0, lastLat: 0, lastBack: 0.25 };
const PADDLE_RANGE = { lat: 1.0, backMin: -0.45, backMax: 0.95 };
/** Metres the paddle moves per pixel of mouse movement. */
const PER_PX = 0.0024;

/** Mouse movement while playing (pointer-lock deltas): right moves the paddle right, up moves it towards the net. */
export function pongMouse(dx: number, dy: number, sensitivity = 1) {
  paddle.lat = Math.min(PADDLE_RANGE.lat, Math.max(-PADDLE_RANGE.lat, paddle.lat + dx * PER_PX * sensitivity));
  paddle.back = Math.min(PADDLE_RANGE.backMax, Math.max(PADDLE_RANGE.backMin, paddle.back + dy * PER_PX * sensitivity));
}

/** Once a frame: the paddle's velocity from how far it moved. */
export function tickPaddle(dt: number) {
  if (dt <= 0) return;
  const k = 1 - Math.exp(-dt / 0.05);
  paddle.vLat += ((paddle.lat - paddle.lastLat) / dt - paddle.vLat) * k;
  paddle.vBack += ((paddle.back - paddle.lastBack) / dt - paddle.vBack) * k;
  paddle.lastLat = paddle.lat;
  paddle.lastBack = paddle.back;
}

/** The paddle's swing right now: forward is towards the net (the paddle's `back` shrinking). */
export const paddleSwing = (): Swing => (autopilot.on ? autopilot.swing : { forward: -paddle.vBack, right: paddle.vLat });

/** Where the player's paddle is in the world. */
export function paddleAt(end: End): V3 {
  return { ...fromOwn(end, paddle.back, paddle.lat), y: paddle.y };
}

/** Puts the paddle back in the middle, ready (a new game, or picking it up). */
export function centrePaddle() {
  Object.assign(paddle, { lat: 0, back: 0.25, y: TABLE.top + 0.2, vLat: 0, vBack: 0, lastLat: 0, lastBack: 0.25 });
}

/** The probe's autopilot: the toy world moves the player's paddle to meet every ball and swings it like this. */
export const autopilot = { on: false, swing: { forward: 1.2, right: 0 } as Swing };

const VIEW = { back: 1.3, y: 1.8, follow: 0.35, lookBack: -TABLE.len * 0.8, lookY: TABLE.top + 0.02 };
let shake = { at: -Infinity, power: 0 };

/** A smash shakes the view a little (Player.tsx leaves it still under reduced motion: Settings → Accessibility, or the system's). */
export function shakeView(power: number) {
  shake = { at: performance.now(), power };
}

/** Where the camera sits while the player plays at `end`: behind it, a little high, looking down the table. */
export function pongCamera(end: End, now = performance.now()): { x: number; y: number; z: number; yaw: number; pitch: number; shake: V3 } {
  const lat = paddle.lat * VIEW.follow;
  const at = fromOwn(end, VIEW.back, lat);
  const yaw = end === 'west' ? -Math.PI / 2 : Math.PI / 2;
  const pitch = Math.atan2(VIEW.lookY - VIEW.y, VIEW.back - VIEW.lookBack);
  const t = (now - shake.at) / 1000;
  const k = t < 0.35 ? shake.power * (1 - t / 0.35) : 0;
  return { ...at, y: VIEW.y, yaw, pitch, shake: { x: (Math.random() - 0.5) * 0.05 * k, y: (Math.random() - 0.5) * 0.05 * k, z: (Math.random() - 0.5) * 0.05 * k } };
}

/** A click (or F) while playing: toss and serve when it's the player's serve, or a rematch once a game is over. */
export function pongClick() {
  const m = match;
  const end = playerEnd();
  if (!m || !end) return;
  if (m.phase === 'serve' && serverOf(m.game) === end) m.ask = 'serve';
  else if (m.phase === 'over') m.ask = 'rematch';
}

// ---------- what the HUD and the scoreboard show ----------

export interface PongView {
  phase: Phase;
  /** Who is at each end: 'player' for you, else the agent's id; null for nobody (or nobody yet). */
  west: string | null;
  east: string | null;
  ready: Record<End, boolean>;
  score: Record<End, number>;
  server: End;
  you: End | null;
  last: Match['last'];
  rally: number;
  longest: number;
  gamePoint: boolean;
}

let cached: PongView | null = null;
const seatId = (s: Seat | null) => (s ? (s.kind === 'player' ? PONG_PLAYER : s.id) : null);

/** The match as the HUD shows it (the same object until something changes), or null with nobody at the table. */
export function pongView(): PongView | null {
  const m = match;
  if (!m) return null;
  if (cached) return cached;
  const ready = (e: End) => isPlayer(m.seats[e]) || (m.seats[e]?.kind === 'agent' && (m.seats[e] as { ready: boolean }).ready);
  cached = {
    phase: m.phase,
    west: seatId(m.seats.west),
    east: seatId(m.seats.east),
    ready: { west: ready('west'), east: ready('east') },
    score: { ...m.game.score },
    server: serverOf(m.game),
    you: playerEnd(),
    last: m.last,
    rally: m.rally,
    longest: m.longest,
    gamePoint: atGamePoint(m.game),
  };
  return cached;
}

// ---------- the toy world's side, for the probe ----------

/** What the mounted toy world's match runner (pongRunner.ts) offers the probe. */
export interface PongRunnerProbe {
  liveView(): PongLive;
  drill(queue: { speed: number; top: number; side: number; lat: number; depth: number }[]): boolean;
  serveNow(): boolean;
  forced: number;
}

let runner: PongRunnerProbe | null = null;

/** The toy world registers its match runner here; null when there's none (loading, another floor, the lobby). */
export function setPongLive(r: PongRunnerProbe | null) {
  runner = r;
}

export const pongRunner = () => runner;
