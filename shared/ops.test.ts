import { describe, expect, it } from 'vitest';
import { needsManager, prStage } from './ops.ts';
import { clock, limitName, usedPercent } from './usage.ts';

describe('needsManager and prStage', () => {
  it('counts a stuck PR as needing the manager only once the CEO has handed it on', () => {
    expect(needsManager({ status: 'needs-human', ceoLooking: false })).toBe(true);
    expect(needsManager({ status: 'needs-human', ceoLooking: true })).toBe(false);
    expect(needsManager({ status: 'failed', ceoLooking: false })).toBe(false);
    expect(needsManager(null)).toBe(false);
  });

  it('puts every open PR in exactly one stage', () => {
    expect(prStage(null)).toBe('inQa');
    expect(prStage({ status: 'queued', ceoLooking: false })).toBe('inQa');
    expect(prStage({ status: 'testing', ceoLooking: false })).toBe('inQa');
    expect(prStage({ status: 'failed', ceoLooking: false })).toBe('fixing');
    expect(prStage({ status: 'fixing', ceoLooking: false })).toBe('fixing');
    expect(prStage({ status: 'passed', ceoLooking: false })).toBe('toMerge');
    expect(prStage({ status: 'needs-human', ceoLooking: false })).toBe('needsYou');
    expect(prStage({ status: 'needs-human', ceoLooking: true })).toBe('triage');
  });
});

describe('usage wording', () => {
  const NOW = new Date(2026, 8, 28, 12, 0).getTime();
  it('names the day only when it is not today', () => {
    expect(clock(NOW + 150 * 60_000, NOW)).toBe('14:30');
    expect(clock(new Date(2026, 8, 29, 0, 0).getTime(), NOW)).toMatch(/^[A-Z][a-z]{2} 00:00$/);
  });

  it("says Claude's limits the way people do", () => {
    expect(limitName('five_hour')).toBe('5-hour limit');
    expect(limitName('seven_day')).toBe('weekly limit');
    expect(limitName('some_new_limit')).toBe('some new limit');
  });

  it('reads a fraction or a percentage', () => {
    expect(usedPercent(0.82)).toBe(82);
    expect(usedPercent(91)).toBe(91);
    expect(usedPercent(1)).toBe(100);
  });
});
