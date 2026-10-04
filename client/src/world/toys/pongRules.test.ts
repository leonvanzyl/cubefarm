import { describe, expect, it } from 'vitest';
import { atGamePoint, newGame, newRally, rallyStep, scorePoint, serverOf, toHit, winnerOf, type Call, type RallyEvent } from './pongRules';

/** Plays events into a fresh rally served by `server`; returns the first call (and the events after it are ignored). */
function play(server: 'west' | 'east', events: RallyEvent[]): Call | null {
  const r = newRally(server);
  for (const e of events) {
    const call = rallyStep(r, e);
    if (call) return call;
  }
  return null;
}

const W = 'west' as const;
const E = 'east' as const;

describe('the serve', () => {
  it('bounces on the server’s half, then the receiver’s, and the receiver must return it', () => {
    const r = newRally(W);
    expect(rallyStep(r, { kind: 'bounce', on: W })).toBeNull();
    expect(toHit(r)).toBeNull();
    expect(rallyStep(r, { kind: 'bounce', on: E })).toBeNull();
    expect(toHit(r)).toBe(E);
  });

  it('is a fault straight onto the far half, twice on its own half, or off the table', () => {
    expect(play(W, [{ kind: 'bounce', on: E }])).toEqual({ point: E, why: 'serve-fault' });
    expect(play(W, [{ kind: 'bounce', on: W }, { kind: 'bounce', on: W }])).toEqual({ point: E, why: 'serve-fault' });
    expect(play(W, [{ kind: 'dead' }])).toEqual({ point: E, why: 'serve-fault' });
    expect(play(E, [{ kind: 'bounce', on: E }, { kind: 'dead' }])).toEqual({ point: W, why: 'serve-fault' });
  });

  it('is a let when it clips the net and lands right, and a fault when it clips it and doesn’t', () => {
    expect(play(W, [{ kind: 'bounce', on: W }, { kind: 'net' }, { kind: 'bounce', on: E }])).toEqual({ let: true });
    expect(play(W, [{ kind: 'bounce', on: W }, { kind: 'net' }, { kind: 'dead' }])).toEqual({ point: E, why: 'net' });
  });

  it('wins the point when the receiver misses it', () => {
    expect(play(W, [{ kind: 'bounce', on: W }, { kind: 'bounce', on: E }, { kind: 'dead' }])).toEqual({ point: W, why: 'missed' });
    expect(play(W, [{ kind: 'bounce', on: W }, { kind: 'bounce', on: E }, { kind: 'bounce', on: E }])).toEqual({ point: W, why: 'double-bounce' });
  });
});

describe('a rally', () => {
  const served: RallyEvent[] = [{ kind: 'bounce', on: W }, { kind: 'bounce', on: E }];

  it('goes back and forth while each return lands on the other half', () => {
    const r = newRally(W);
    for (const e of served) rallyStep(r, e);
    for (let i = 0; i < 6; i++) {
      const by = i % 2 ? W : E;
      expect(rallyStep(r, { kind: 'hit', by })).toBeNull();
      expect(rallyStep(r, { kind: 'bounce', on: by === W ? E : W })).toBeNull();
    }
    expect(r.hits).toBe(6);
  });

  it('is lost by whoever sends it long, into the net or onto their own half', () => {
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'dead' }])).toEqual({ point: W, why: 'out' });
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'net' }, { kind: 'dead' }])).toEqual({ point: W, why: 'net' });
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'bounce', on: E }])).toEqual({ point: W, why: 'own-side' });
  });

  it('is won when the other side lets it bounce twice or can’t get it back', () => {
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'bounce', on: W }, { kind: 'bounce', on: W }])).toEqual({ point: E, why: 'double-bounce' });
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'bounce', on: W }, { kind: 'dead' }])).toEqual({ point: E, why: 'missed' });
  });

  it('a return clipping the net that drops over is fine', () => {
    expect(play(W, [...served, { kind: 'hit', by: E }, { kind: 'net' }, { kind: 'bounce', on: W }])).toBeNull();
  });

  it('ignores a paddle meeting the ball before it bounced, or the striker hitting it again', () => {
    const r = newRally(W);
    rallyStep(r, { kind: 'bounce', on: W });
    expect(rallyStep(r, { kind: 'hit', by: E })).toBeNull(); // still the serve, on its way
    expect(r.striker).toBe(W);
    rallyStep(r, { kind: 'bounce', on: E });
    rallyStep(r, { kind: 'hit', by: E });
    expect(rallyStep(r, { kind: 'hit', by: E })).toBeNull();
    expect(r.hits).toBe(1);
  });
});

describe('a game', () => {
  it('goes to 11, won by 2, serves changing every 2 points and every point from 10-10', () => {
    const g = newGame(E);
    const servers: string[] = [];
    // trade points up to 10-10
    for (let i = 0; i < 20; i++) {
      servers.push(serverOf(g));
      expect(scorePoint(g, i % 2 ? W : E)).toBeNull();
    }
    expect(servers.slice(0, 8)).toEqual([E, E, W, W, E, E, W, W]);
    expect(g.score).toEqual({ west: 10, east: 10 });
    expect(atGamePoint(g)).toBe(false);
    expect(serverOf(g)).toBe(E);
    expect(scorePoint(g, W)).toBeNull(); // 11-10: not yet
    expect(atGamePoint(g)).toBe(true);
    expect(serverOf(g)).toBe(W);
    expect(scorePoint(g, E)).toBeNull(); // 11-11
    expect(serverOf(g)).toBe(E);
    expect(scorePoint(g, E)).toBeNull(); // 11-12
    expect(scorePoint(g, E)).toBe(E); // 11-13
    expect(winnerOf(g)).toBe(E);
    expect(scorePoint(g, W)).toBe(E); // over is over
    expect(g.score).toEqual({ west: 11, east: 13 });
  });

  it('ends at 11-9 but not 11-10', () => {
    const g = newGame(W);
    g.score = { west: 10, east: 9 };
    expect(atGamePoint(g)).toBe(true);
    expect(scorePoint(g, W)).toBe(W);
    const h = newGame(W);
    h.score = { west: 10, east: 10 };
    expect(scorePoint(h, W)).toBeNull();
  });
});
