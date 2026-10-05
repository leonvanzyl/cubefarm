// Ping-pong's scoring and each floor's leaderboard. Shared: the client plays matches by these rules
// (client/src/world/toys/pongRules.ts) and the server keeps the leaderboards (swarm.ts), accepting only games that
// really ended. Pure.

import type { PongRow } from './types.ts';

/** A game goes to 11, and must be won by 2. */
export const PONG_POINTS = 11;
/** The manager's id on a leaderboard (agents use their own). */
export const PONG_PLAYER = 'player';
/** Rows kept per floor; past that, whoever played longest ago drops off. */
export const PONG_KEEP = 30;

/** The winner of a game standing at a–b: 0 (a), 1 (b), or null while it goes on. */
export function gameWinner(a: number, b: number): 0 | 1 | null {
  if (Math.max(a, b) < PONG_POINTS || Math.abs(a - b) < 2) return null;
  return a > b ? 0 : 1;
}

/** Whether a–b is how a game can really end: 11 with the other on 9 or less, or 2 clear past 10-10 (12-10, 13-11…). */
export function finalScore(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi === PONG_POINTS ? lo <= PONG_POINTS - 2 : hi > PONG_POINTS && hi - lo === 2;
}

/** Who serves at a–b: whoever served first (0) or the other (1). Two serves each, then one each from 10-10. */
export function serverAt(a: number, b: number): 0 | 1 {
  const n = a + b;
  return (n < 2 * (PONG_POINTS - 1) ? Math.floor(n / 2) % 2 : n % 2) as 0 | 1;
}

/** Whether the next point could win the game for someone. */
export const gamePoint = (a: number, b: number) => gameWinner(a + 1, b) !== null || gameWinner(a, b + 1) !== null;

/** A finished game as the client reports it (POST /api/repos/:repo/pong): two player ids and their points, in order. */
export interface PongResult {
  players: [string, string];
  score: [number, number];
}

/** A request body as a PongResult, or what's wrong with it. */
export function parsePongResult(body: unknown): PongResult | { error: string } {
  const { players, score } = (body ?? {}) as { players?: unknown; score?: unknown };
  if (!Array.isArray(players) || players.length !== 2 || !players.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 100) || players[0] === players[1]) {
    return { error: 'players must be two different ids' };
  }
  if (!Array.isArray(score) || score.length !== 2 || !finalScore(score[0], score[1])) return { error: 'score must be a finished game: to 11, won by 2' };
  return { players: [players[0], players[1]], score: [score[0], score[1]] };
}

/** One finished game, for the leaderboard: the two players (id and name) and their points, in the same order. */
export interface PongGame {
  players: [{ id: string; name: string }, { id: string; name: string }];
  score: [number, number];
  at: number;
}

const blank = (id: string, name: string): PongRow => ({ id, name, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, lastAt: 0 });

/** Best first: most wins, then the better win rate, then the bigger points difference, then whoever played last. */
export function rankBoard(rows: readonly PongRow[]): PongRow[] {
  const rate = (r: PongRow) => r.wins / Math.max(1, r.wins + r.losses);
  return [...rows].sort((a, b) => b.wins - a.wins || rate(b) - rate(a) || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) || b.lastAt - a.lastAt);
}

/** The leaderboard after `game` (a new array; rows are copied, never changed in place), ranked, at most `keep` long. */
export function recordGame(board: readonly PongRow[], game: PongGame, keep = PONG_KEEP): PongRow[] {
  const rows = board.map((r) => ({ ...r }));
  const won = gameWinner(game.score[0], game.score[1]);
  game.players.forEach((p, i) => {
    let row = rows.find((r) => r.id === p.id);
    if (!row) rows.push((row = blank(p.id, p.name)));
    row.name = p.name;
    row.pointsFor += game.score[i];
    row.pointsAgainst += game.score[1 - i];
    if (won === i) row.wins++;
    else row.losses++;
    row.lastAt = Math.max(row.lastAt, game.at);
  });
  const kept = rows.length > keep ? [...rows].sort((a, b) => b.lastAt - a.lastAt).slice(0, keep) : rows;
  return rankBoard(kept);
}
