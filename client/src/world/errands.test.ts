import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../shared/types';
import {
  MAX_WALKERS,
  QUEUE_MAX,
  QUEUE_SECONDS,
  admit,
  enqueue,
  errandNamed,
  errands,
  headingFor,
  homeSpotId,
  isFree,
  mayContinue,
  mayStart,
  nextWaypoint,
  pickSpot,
  prune,
  registerErrand,
  restlessSeconds,
  spotChoices,
  wanted,
  type ErrandState,
  type Queued,
} from './errands';
import { findPath, spot, walkways, type FloorKind } from './walkways';

const STATUSES: AgentStatus[] = ['idle', 'preparing', 'working', 'done', 'error', 'stopped'];
const idleErrand = { work: false };
const workErrand = { work: true };
const state = (over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 0, restless: 30, ...over });
const dev = (status: AgentStatus) => ({ id: 'a', status, role: 'dev' });

describe('who may leave their desk', () => {
  it('idle, done and stopped people are free; working, preparing and error ones are not', () => {
    expect(STATUSES.filter(isFree)).toEqual(['idle', 'done', 'stopped']);
  });

  it('free people may go on any errand; preparing ones only on work errands; working ones on none', () => {
    for (const s of STATUSES) {
      expect(mayStart(s, idleErrand), s).toBe(isFree(s));
      expect(mayStart(s, workErrand), s).toBe(isFree(s) || s === 'preparing');
    }
  });

  it('work arriving sends people back from idle errands, but a work errand may finish', () => {
    for (const s of ['working', 'preparing', 'error'] as const) expect(mayContinue(s, idleErrand), s).toBe(false);
    expect(mayContinue('preparing', workErrand)).toBe(true);
    expect(mayContinue('working', workErrand)).toBe(true);
    expect(mayContinue('error', workErrand)).toBe(false);
    for (const s of ['idle', 'done', 'stopped'] as const) expect(mayContinue(s, idleErrand), s).toBe(true);
  });

  it('idle people get restless after tens of seconds, sooner when you have just arrived', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(restlessSeconds(r)).toBeGreaterThanOrEqual(20);
      expect(restlessSeconds(r)).toBeLessThanOrEqual(75);
      expect(restlessSeconds(r, true)).toBeLessThan(restlessSeconds(r));
    }
    expect(restlessSeconds(0, true)).toBeGreaterThan(0);
  });
});

describe('the walker cap', () => {
  const waiting = (at: number, id: string) => ({ id, queue: [{ name: 'stretch', at }] });

  it(`lets at most ${MAX_WALKERS} people be away at once, longest waiting first`, () => {
    const all = [waiting(5, 'e'), waiting(1, 'a'), waiting(3, 'c'), waiting(2, 'b'), waiting(4, 'd'), waiting(6, 'f')];
    expect(admit(all, 0).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(admit(all, 3).map((p) => p.id)).toEqual(['a']);
    expect(admit(all, MAX_WALKERS)).toEqual([]);
    expect(admit(all, MAX_WALKERS + 2)).toEqual([]);
  });

  it('skips people with nothing queued', () => {
    expect(admit([{ id: 'x', queue: [] as Queued[] }, waiting(9, 'y')], 0).map((p) => p.id)).toEqual(['y']);
  });

  it('a floor of idle people never has more than the cap away, however restless they get', () => {
    // A tiny director: everyone wants to go all the time; errands take 20 s.
    const people = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, queue: [] as Queued[], backAt: -1 }));
    let most = 0;
    for (let t = 0; t < 600; t += 0.5) {
      for (const p of people) if (p.backAt >= 0 && t >= p.backAt) p.backAt = -1;
      const away = people.filter((p) => p.backAt >= 0).length;
      for (const p of people) if (p.backAt < 0) p.queue = prune(enqueue(p.queue, 'stretch', t), t, () => true);
      for (const p of admit(people.filter((x) => x.backAt < 0), away)) {
        p.queue = p.queue.slice(1);
        p.backAt = t + 20;
      }
      most = Math.max(most, people.filter((p) => p.backAt >= 0).length);
    }
    expect(most).toBe(MAX_WALKERS);
  });
});

describe('the queue', () => {
  it('holds a couple of different errands and skips the rest', () => {
    let q = enqueue([], 'stretch', 0);
    q = enqueue(q, 'stretch', 1);
    expect(q).toEqual([{ name: 'stretch', at: 0 }]);
    for (let i = 0; i < 5; i++) q = enqueue(q, `e${i}`, 2);
    expect(q).toHaveLength(QUEUE_MAX);
  });

  it('drops errands that waited too long or may no longer go, keeping the rest in order', () => {
    const q: Queued[] = [
      { name: 'old', at: 0 },
      { name: 'board', at: 10 },
      { name: 'stretch', at: 12 },
    ];
    expect(prune(q, QUEUE_SECONDS + 5, (n) => n !== 'stretch')).toEqual([{ name: 'board', at: 10 }]);
    expect(prune(q, 1, () => true)).toBe(q);
  });
});

describe('where to', () => {
  it('matches spot ids and prefixes, leaving out the ones in use', () => {
    const ids = ['cooler', 'window-w0', 'window-w1', 'window-e0', 'couch', 'desk-0'];
    expect(spotChoices(['cooler', 'window-*'], ids, new Set(['window-w1']))).toEqual(['cooler', 'window-w0', 'window-e0']);
    expect(spotChoices(['window-*'], ids, new Set(['window-w0', 'window-w1', 'window-e0']))).toEqual([]);
  });

  it('picks one of the nearest spots', () => {
    const spots = [
      { id: 'far', x: 20, z: 0 },
      { id: 'near', x: 1, z: 0 },
      { id: 'mid', x: 5, z: 0 },
    ];
    expect(pickSpot(spots, { x: 0, z: 0 }, 0)!.id).toBe('near');
    expect(pickSpot(spots, { x: 0, z: 0 }, 0.99)!.id).toBe('mid');
    expect(pickSpot(spots, { x: 0, z: 0 }, 0.5, 1)!.id).toBe('near');
    expect(pickSpot([], { x: 0, z: 0 }, 0.5)).toBeNull();
  });

  it("finds everyone's desk, station or office, and nobody else's", () => {
    expect(homeSpotId('office', { role: 'dev', desk: 7 })).toBe('desk-7');
    expect(homeSpotId('office', { role: 'qa', desk: 1 })).toBe('qa-1');
    expect(homeSpotId('lobby', { role: 'ceo', desk: 0 })).toBe('ceo');
    expect(homeSpotId('lobby', { role: 'dev', desk: 0 })).toBeNull();
    expect(homeSpotId('office', { role: 'ceo', desk: 0 })).toBeNull();
  });

  it('turns walkways facings into body headings', () => {
    expect(headingFor(-Math.PI / 2)).toBeCloseTo(0); // north: -Z
    expect(headingFor(0)).toBeCloseTo(-Math.PI / 2); // east
    expect(Math.abs(headingFor(Math.PI / 2))).toBeCloseTo(Math.PI); // south, +Z
    expect(headingFor(Math.PI)).toBeCloseTo(Math.PI / 2); // west
  });

  it('moves on past waypoints already reached, but never past the last', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 3 },
    ];
    expect(nextWaypoint(path, 0, { x: 0.1, z: 0 })).toBe(1);
    expect(nextWaypoint(path, 1, { x: 0.95, z: 0.1 })).toBe(2);
    expect(nextWaypoint(path, 2, { x: 1, z: 3 })).toBe(2);
    expect(nextWaypoint(path, 0, { x: -2, z: 0 })).toBe(0);
  });
});

describe('the registry', () => {
  it('ships with stretching legs: idle people, once restless, and never busy ones', () => {
    const e = errandNamed('stretch')!;
    expect(e).toBeDefined();
    expect(e.work).toBeFalsy();
    expect(wanted(errands(), dev('idle'), state({ seatedFor: 31 })).map((x) => x.name)).toContain('stretch');
    expect(wanted(errands(), dev('idle'), state({ seatedFor: 10 }))).toEqual([]);
    for (const s of ['working', 'preparing', 'error'] as const) expect(wanted(errands(), dev(s), state({ seatedFor: 999 })), s).toEqual([]);
    expect(e.steps.reduce((t, s) => t + s.seconds, 0)).toBeGreaterThan(2);
  });

  it.each<FloorKind>(['office', 'lobby'])('on the %s floor, everyone can walk to somewhere to stretch and back', (floor) => {
    const w = walkways(floor);
    const e = errandNamed('stretch')!;
    const ids = spotChoices(e.spot, w.spots.map((s) => s.id), new Set());
    expect(ids.length).toBeGreaterThanOrEqual(floor === 'office' ? 3 : 2);
    for (const home of w.homes) {
      for (const id of ids) {
        const to = spot(w, id)!;
        expect(findPath(w, home, to), `${home.id} → ${id}`).not.toBeNull();
        expect(findPath(w, to, home), `${id} → ${home.id}`).not.toBeNull();
      }
    }
  });

  it('later errands register by name, and work ones may go while preparing', () => {
    registerErrand({ name: 'test-board', work: true, when: (a) => a.status === 'preparing', spot: ['board-*'], steps: [{ gesture: 'reach', seconds: 2 }] });
    registerErrand({ name: 'test-board', work: true, when: (a) => a.status === 'preparing', spot: ['board-*'], steps: [{ gesture: 'reach', seconds: 3 }] });
    expect(errands().filter((e) => e.name === 'test-board')).toHaveLength(1);
    expect(errandNamed('test-board')!.steps[0].seconds).toBe(3);
    expect(wanted(errands(), dev('preparing'), state()).map((e) => e.name)).toEqual(['test-board']);
    expect(wanted(errands(), dev('working'), state())).toEqual([]);
  });
});
