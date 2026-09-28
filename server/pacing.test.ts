import { describe, expect, it } from 'vitest';
import { clampPacingSessions, clock, mayStart, pacingMessage, usageLabel, usageView, type WorkKind } from './pacing.ts';

const NOW = new Date(2026, 8, 28, 12, 0).getTime();
const HOUR = 60 * 60_000;
const at = (over: Partial<Parameters<typeof mayStart>[1]> = {}) => ({ now: NOW, pausedUntil: 0, pacingUntil: 0, running: 0, pacingSessions: 3, ...over });
const KINDS: WorkKind[] = ['issue', 'qa', 'fix', 'ceo'];

describe('mayStart', () => {
  it('starts everything when usage is normal, however much is running', () => {
    for (const kind of KINDS) expect(mayStart(kind, at({ running: 20 }))).toBe(true);
  });

  it('starts new issues while pacing only under the cap', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 2 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 3 }))).toBe(false);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 9, pacingSessions: 10 }))).toBe(true);
  });

  it('keeps starting QA, fixes and CEO jobs while pacing', () => {
    for (const kind of ['qa', 'fix', 'ceo'] as const) expect(mayStart(kind, at({ pacingUntil: NOW + HOUR, running: 12 }))).toBe(true);
  });

  it('starts nothing at all once Claude rejects a session, pacing or not', () => {
    for (const kind of KINDS) {
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR }))).toBe(false);
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR }))).toBe(false);
    }
  });

  it('stops pacing when it expires', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW, running: 10 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW - 1, pausedUntil: NOW - 1, running: 10 }))).toBe(true);
  });
});

describe('usageView and usageLabel', () => {
  it('is normal, pacing or paused, with the pause first', () => {
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: 0 })).toEqual({ state: 'normal', until: null });
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR })).toEqual({ state: 'pacing', until: NOW + HOUR });
    expect(usageView({ now: NOW, pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR })).toEqual({ state: 'paused', until: NOW + HOUR });
    expect(usageView({ now: NOW, pausedUntil: NOW, pacingUntil: NOW })).toEqual({ state: 'normal', until: null });
  });

  it('reads as the CEO sees it in company_status', () => {
    expect(usageLabel({ state: 'normal', until: null }, NOW)).toBe('normal');
    expect(usageLabel({ state: 'pacing', until: NOW + 150 * 60_000 }, NOW)).toBe('pacing until 14:30');
    expect(usageLabel({ state: 'paused', until: NOW + 5 * 60_000 }, NOW)).toBe('paused until 12:05');
  });

  it('names the day when the window resets on another day', () => {
    expect(clock(NOW + 3 * 24 * HOUR, NOW)).toMatch(/^[A-Z][a-z]{2} 12:00$/);
  });
});

describe('pacingMessage', () => {
  it('says which limit, how full, until when and how many sessions', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'five_hour', utilization: 0.82 }, NOW + 150 * 60_000, 3, NOW)).toBe(
      "🐢 Claude's usage is getting high (5-hour limit, 82%). Until 14:30 the office finishes open work first and starts at most 3 sessions at a time.",
    );
  });

  it('copes with a percentage and with missing details', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('(weekly limit, 91%)');
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('at most 1 session at a time');
    expect(pacingMessage({ resetsAt: null, rateLimitType: null, utilization: null }, NOW + HOUR, 3, NOW)).toMatch(/^🐢 Claude's usage is getting high\. Until 13:00/);
  });
});

it('clamps the pacing cap to 1-32, default 3', () => {
  expect(clampPacingSessions(5)).toBe(5);
  expect(clampPacingSessions('7')).toBe(7);
  expect(clampPacingSessions(100)).toBe(32);
  expect(clampPacingSessions(0)).toBe(3);
  expect(clampPacingSessions(-4)).toBe(3);
  expect(clampPacingSessions('lots')).toBe(3);
  expect(clampPacingSessions(2.6)).toBe(3);
});
