// Ping-pong's umpire, pure: follows a rally from what the ball does (serves, hits, bounces, the net, dropping dead)
// and calls the point or a let; and keeps a game's score, who serves, and when it's over (the rules themselves, to 11
// by 2 with serves changing every 2 points, are shared/pong.ts's, which the server checks results against).

import { gamePoint, gameWinner, serverAt } from '../../../../shared/pong';
import { otherEnd, type End } from './pongPhysics';

export type RallyEvent =
  | { kind: 'serve'; by: End }
  | { kind: 'hit'; by: End }
  | { kind: 'bounce'; on: End }
  | { kind: 'net' }
  /** The ball can't be played any more: below the table top off its edge, on the floor, or stalled. */
  | { kind: 'dead' };

/** Why a point went the way it did, for the HUD and the reactions. */
export type PointWhy = 'serve-fault' | 'net' | 'out' | 'missed' | 'double-bounce' | 'own-side';

export type Call = { point: End; why: PointWhy } | { let: true };

export interface Rally {
  /** Who hit it last (the server, until it's returned), and whether that was the serve. */
  striker: End;
  serving: boolean;
  /** A serve that has bounced on the server's own half, as it must first. */
  served: boolean;
  /** Bounces on the receiver's half since the last hit. */
  bounces: number;
  /** Touched the net since the last hit (a serve that did is a let if it lands right). */
  net: boolean;
  /** Returns so far (the serve not counted). */
  hits: number;
}

export const newRally = (server: End): Rally => ({ striker: server, serving: true, served: false, bounces: 0, net: false, hits: 0 });

/** Whose turn it is to hit: the receiver once the ball has bounced on their half, else nobody yet. */
export const toHit = (r: Rally): End | null => (r.bounces === 1 && !r.serving ? otherEnd(r.striker) : null);

/**
 * One thing the ball did. Returns the call when it ends the rally (a point, or a let), else null and the rally goes
 * on. Changes `r` in place. A hit that isn't the receiver's to make (before the bounce, or twice) is ignored: the toy
 * world only lets paddles meet the ball once it's theirs.
 */
export function rallyStep(r: Rally, e: RallyEvent): Call | null {
  const receiver = otherEnd(r.striker);
  const lose = (why: PointWhy): Call => ({ point: otherEnd(r.striker), why });
  const win = (why: PointWhy): Call => ({ point: r.striker, why });
  switch (e.kind) {
    case 'serve':
      Object.assign(r, newRally(e.by));
      return null;
    case 'hit':
      if (e.by !== receiver || toHit(r) !== e.by) return null;
      r.striker = e.by;
      r.bounces = 0;
      r.net = false;
      r.hits++;
      return null;
    case 'net':
      r.net = true;
      return null;
    case 'bounce':
      if (r.serving) {
        if (!r.served) {
          if (e.on !== r.striker) return lose('serve-fault'); // a serve bounces on the server's own half first
          r.served = true;
          return null;
        }
        if (e.on === r.striker) return lose('serve-fault');
        r.serving = false;
        if (r.net) return { let: true };
        r.bounces = 1;
        return null;
      }
      if (e.on === r.striker) return lose('own-side');
      if (++r.bounces >= 2) return win('double-bounce');
      return null;
    case 'dead':
      if (r.serving) return lose(r.net ? 'net' : 'serve-fault');
      return r.bounces === 0 ? lose(r.net ? 'net' : 'out') : win('missed');
  }
}

// ---------- the game ----------

export interface Game {
  score: Record<End, number>;
  /** Who served the game's first point. */
  first: End;
}

export const newGame = (first: End): Game => ({ score: { west: 0, east: 0 }, first });

/** Who serves the next point. */
export function serverOf(g: Game): End {
  const a = g.score[g.first];
  const b = g.score[otherEnd(g.first)];
  return serverAt(a, b) === 0 ? g.first : otherEnd(g.first);
}

/** The winner, once the game is over. */
export function winnerOf(g: Game): End | null {
  const w = gameWinner(g.score.west, g.score.east);
  return w === null ? null : w === 0 ? 'west' : 'east';
}

/** Whether the next point could end the game. */
export const atGamePoint = (g: Game) => winnerOf(g) === null && gamePoint(g.score.west, g.score.east);

/** A point to `end`. Returns the winner if that ended the game. */
export function scorePoint(g: Game, end: End): End | null {
  if (winnerOf(g)) return winnerOf(g);
  g.score[end]++;
  return winnerOf(g);
}
