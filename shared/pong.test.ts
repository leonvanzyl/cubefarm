import { describe, expect, it } from 'vitest';
import { finalScore, gamePoint, gameWinner, parsePongResult, PONG_PLAYER, rankBoard, recordGame, serverAt, type PongGame } from './pong.ts';
import type { PongRow } from './types.ts';

describe('scoring', () => {
  it('a game goes to 11', () => {
    expect(gameWinner(10, 3)).toBeNull();
    expect(gameWinner(11, 3)).toBe(0);
    expect(gameWinner(4, 11)).toBe(1);
    expect(gameWinner(11, 9)).toBe(0);
  });

  it('and must be won by 2', () => {
    expect(gameWinner(11, 10)).toBeNull();
    expect(gameWinner(12, 11)).toBeNull();
    expect(gameWinner(12, 10)).toBe(0);
    expect(gameWinner(14, 16)).toBe(1);
  });

  it('knows a game point', () => {
    expect(gamePoint(10, 3)).toBe(true);
    expect(gamePoint(9, 9)).toBe(false);
    expect(gamePoint(10, 10)).toBe(false);
    expect(gamePoint(11, 10)).toBe(true);
    expect(gamePoint(3, 10)).toBe(true);
  });

  it('accepts only scores a game can really end on', () => {
    for (const [a, b] of [[11, 0], [11, 9], [9, 11], [12, 10], [13, 11], [20, 22]]) expect(finalScore(a, b), `${a}-${b}`).toBe(true);
    for (const [a, b] of [[11, 10], [10, 8], [12, 9], [13, 10], [12, 12], [-1, 11], [11.5, 3], [NaN, 11]]) expect(finalScore(a, b), `${a}-${b}`).toBe(false);
  });
});

describe('serving', () => {
  it('alternates every two points', () => {
    const order = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1];
    order.forEach((who, n) => expect(serverAt(n, 0), `after ${n} points`).toBe(who));
    // it's the total that counts, not who won them
    expect(serverAt(1, 1)).toBe(1);
    expect(serverAt(3, 1)).toBe(0);
  });

  it('alternates every point from 10-10, carrying on the order', () => {
    expect(serverAt(9, 9)).toBe(1);
    expect(serverAt(10, 9)).toBe(1);
    expect(serverAt(10, 10)).toBe(0);
    expect(serverAt(11, 10)).toBe(1);
    expect(serverAt(11, 11)).toBe(0);
    expect(serverAt(12, 11)).toBe(1);
  });
});

describe('the leaderboard', () => {
  const game = (a: string, b: string, score: [number, number], at = 1): PongGame => ({ players: [{ id: a, name: a.toUpperCase() }, { id: b, name: b.toUpperCase() }], score, at });

  it('adds both players with their wins, losses and points', () => {
    const board = recordGame([], game(PONG_PLAYER, 'ada', [11, 7], 5));
    expect(board).toEqual([
      { id: PONG_PLAYER, name: 'PLAYER', wins: 1, losses: 0, pointsFor: 11, pointsAgainst: 7, lastAt: 5 },
      { id: 'ada', name: 'ADA', wins: 0, losses: 1, pointsFor: 7, pointsAgainst: 11, lastAt: 5 },
    ]);
  });

  it('adds up over games without changing the board it was given', () => {
    const one = recordGame([], game('ada', 'linus', [11, 4]));
    const frozen = JSON.stringify(one);
    const two = recordGame(one, game('linus', 'ada', [12, 10], 2));
    expect(JSON.stringify(one)).toBe(frozen);
    const ada = two.find((r) => r.id === 'ada')!;
    expect(ada).toMatchObject({ wins: 1, losses: 1, pointsFor: 21, pointsAgainst: 16, lastAt: 2 });
  });

  it('ranks by wins, then win rate, then points difference', () => {
    const rows: PongRow[] = [
      { id: 'a', name: 'A', wins: 2, losses: 5, pointsFor: 50, pointsAgainst: 60, lastAt: 1 },
      { id: 'b', name: 'B', wins: 3, losses: 0, pointsFor: 33, pointsAgainst: 10, lastAt: 1 },
      { id: 'c', name: 'C', wins: 2, losses: 1, pointsFor: 30, pointsAgainst: 25, lastAt: 1 },
      { id: 'd', name: 'D', wins: 2, losses: 1, pointsFor: 30, pointsAgainst: 20, lastAt: 1 },
    ];
    expect(rankBoard(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('keeps the people who played most recently once it is full', () => {
    let board: PongRow[] = [];
    for (let i = 0; i < 6; i++) board = recordGame(board, game(`p${i}`, `q${i}`, [11, 3], i), 8);
    expect(board).toHaveLength(8);
    expect(board.map((r) => r.id)).not.toContain('p0');
    expect(board.map((r) => r.id)).toContain('q5');
  });

  it('keeps the latest name', () => {
    const one = recordGame([], game('ada', 'linus', [11, 4]));
    const two = recordGame(one, { players: [{ id: 'ada', name: 'Ada L.' }, { id: 'linus', name: 'LINUS' }], score: [3, 11], at: 3 });
    expect(two.find((r) => r.id === 'ada')!.name).toBe('Ada L.');
  });
});

describe('a reported game', () => {
  it('is two different players and a finished score', () => {
    expect(parsePongResult({ players: ['player', 'ada'], score: [11, 6] })).toEqual({ players: ['player', 'ada'], score: [11, 6] });
    expect(parsePongResult({ players: ['ada', 'linus'], score: [10, 12], extra: 1 })).toEqual({ players: ['ada', 'linus'], score: [10, 12] });
  });

  it('turns away anything else', () => {
    for (const body of [
      null,
      {},
      { players: ['ada'], score: [11, 3] },
      { players: ['ada', 'ada'], score: [11, 3] },
      { players: ['ada', 7], score: [11, 3] },
      { players: ['ada', ''], score: [11, 3] },
      { players: ['ada', 'linus'], score: [11, 10] },
      { players: ['ada', 'linus'], score: ['11', '3'] },
      { players: ['ada', 'linus'], score: [11] },
    ]) expect(parsePongResult(body), JSON.stringify(body)).toHaveProperty('error');
  });
});
