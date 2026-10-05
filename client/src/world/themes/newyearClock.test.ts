import { describe, expect, it } from 'vitest';
import { COUNTDOWN_S, SHOW_S, countdownNumber, newYearState, timeToGo } from './newyearClock';

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();

describe('newYearState', () => {
  it("waits through New Year's Eve, counting the time to local midnight", () => {
    const s = newYearState(at(2026, 12, 31, 12));
    expect(s.phase).toBe('waiting');
    expect(s.year).toBe(2027);
    expect(s.seconds).toBeCloseTo(12 * 3600);
  });

  it('counts down the last ten seconds', () => {
    expect(newYearState(at(2026, 12, 31, 23, 59, 49)).phase).toBe('waiting');
    const ten = newYearState(at(2026, 12, 31, 23, 59, 60 - COUNTDOWN_S));
    expect(ten.phase).toBe('countdown');
    expect(countdownNumber(ten)).toBe(10);
    expect(countdownNumber(newYearState(at(2026, 12, 31, 23, 59, 55, 500)))).toBe(5);
    expect(countdownNumber(newYearState(at(2026, 12, 31, 23, 59, 59, 900)))).toBe(1);
  });

  it('fires the show at local midnight, then wishes a happy new year all day', () => {
    const midnight = newYearState(at(2027, 1, 1, 0, 0, 0));
    expect(midnight).toEqual({ phase: 'show', seconds: 0, year: 2027 });
    expect(newYearState(at(2027, 1, 1, 0, 0, SHOW_S - 1)).phase).toBe('show');
    expect(newYearState(at(2027, 1, 1, 0, 0, SHOW_S + 1)).phase).toBe('newyear');
    expect(newYearState(at(2027, 1, 1, 23, 59)).phase).toBe('newyear');
    expect(newYearState(at(2027, 1, 2, 0, 0, 1)).phase).toBe('waiting');
  });

  it('crosses any year', () => {
    expect(newYearState(at(2099, 12, 31, 23, 59, 58)).year).toBe(2100);
    expect(newYearState(at(2100, 1, 1, 0, 0, 5)).year).toBe(2100);
  });
});

describe('timeToGo', () => {
  it('reads as h:mm:ss, or days when far off', () => {
    expect(timeToGo(3 * 3600 + 12 * 60 + 5.7)).toBe('3:12:05');
    expect(timeToGo(59)).toBe('0:00:59');
    expect(timeToGo(-3)).toBe('0:00:00');
    expect(timeToGo(5 * 86_400 + 10)).toBe('5 days');
  });
});
