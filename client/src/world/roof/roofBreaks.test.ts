import { afterEach, describe, expect, it } from 'vitest';
import { endVisit, freeChair, planVisit, ROOF_BREAK, roofVisit, roofVisits, roomFor, startVisit, updateVisit, visitOn, visitStage, type RoofVisit } from './roofBreaks.ts';

const S = 1000;
const visit = (id: string, kind: RoofVisit['kind'], chair: number, arrive = 0, leave = 60 * S): RoofVisit => ({ id, kind, chair, arrive, leave });
const o = { chairs: 4, playerChair: null };

afterEach(() => {
  for (const v of roofVisits(0)) endVisit(v.id);
});

describe('roof visits', () => {
  it('ride up, stay up there, then ride back down', () => {
    const v = visit('a', 'break', 0, 4 * S, 64 * S);
    expect(visitStage(v, 0)).toBe('riding');
    expect(visitStage(v, 5 * S)).toBe('up');
    expect(visitStage(v, 64 * S)).toBe('down');
    expect(visitOn(v, 64 * S + (ROOF_BREAK.ride - 1) * S)).toBe(true);
    expect(visitOn(v, 64 * S + ROOF_BREAK.ride * S)).toBe(false);
  });

  it('give each break a chair nobody else (nor you) is in', () => {
    const taken = [visit('a', 'break', 0), visit('b', 'break', 2)];
    for (const r of [0, 0.3, 0.6, 0.99]) expect([1, 3]).toContain(freeChair(taken, 4, null, r));
    expect(freeChair(taken, 4, 1, 0.5)).toBe(3);
    expect(freeChair([...taken, visit('c', 'break', 3)], 4, 1, 0.5)).toBe(-1);
    // the CEO's call takes no chair
    expect(freeChair([visit('ceo', 'call', -1)], 4, null, 0)).toBe(0);
  });

  it('keep a few on breaks at most, one call, and nobody up twice', () => {
    const two = [visit('a', 'break', 0), visit('b', 'break', 1)];
    expect(roomFor(two.slice(0, 1), 'c', 'break', 0)).toBe(true);
    expect(roomFor(two, 'c', 'break', 0)).toBe(false);
    expect(roomFor(two, 'ceo', 'call', 0)).toBe(true);
    expect(roomFor([visit('ceo', 'call', -1)], 'boss', 'call', 0)).toBe(false);
    expect(roomFor(two.slice(0, 1), 'a', 'break', 0)).toBe(false);
    // a visit that's over doesn't count
    expect(roomFor(two, 'c', 'break', 2 * 60 * S)).toBe(true);
  });

  it('plan a visit after the ride, for a while', () => {
    const v = planVisit([], 'a', 'break', 1000, 0.5, o)!;
    expect(v.arrive).toBe(1000 + ROOF_BREAK.ride * S);
    const [lo, hi] = ROOF_BREAK.stay;
    expect((v.leave - v.arrive) / S).toBeCloseTo((lo + hi) / 2);
    expect(v.chair).toBeGreaterThanOrEqual(0);
    const call = planVisit([], 'ceo', 'call', 0, 0, { ...o, ride: 2, stay: 30 })!;
    expect(call).toMatchObject({ kind: 'call', chair: -1, arrive: 2 * S, leave: 32 * S });
    expect(planVisit([visit('a', 'break', 0), visit('b', 'break', 1)], 'c', 'break', 0, 0.5, o)).toBeNull();
    expect(planVisit([], 'c', 'break', 0, 0.5, { chairs: 1, playerChair: 0 })).toBeNull();
  });

  it('are shared by every floor until they end, or their time is up', () => {
    startVisit(visit('a', 'break', 1, 0, 10 * S));
    expect(roofVisit('a', 5 * S)?.chair).toBe(1);
    updateVisit('a', { leave: 6 * S });
    expect(roofVisit('a', 6 * S + ROOF_BREAK.ride * S)).toBeNull();
    expect(roofVisits(6 * S + ROOF_BREAK.ride * S)).toEqual([]);
    startVisit(visit('b', 'break', 2));
    endVisit('b');
    expect(roofVisit('b', 0)).toBeNull();
  });
});
