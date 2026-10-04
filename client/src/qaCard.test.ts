import { describe, expect, it } from 'vitest';
import type { PullInfo, QaStatus } from '../../shared/types';
import { elapsedLabel, needsManager, qaCardNote, testingLabel } from './qaCard';

const pr: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'> = { isDraft: false, mergeable: 'MERGEABLE', checks: 'passing' };
const rec = (status: QaStatus, mergeNote: string | null = null, round = 2, ceoLooking = false) => ({ status, round, mergeNote, ceoLooking });
const STALE = 'the fix was never pushed';

describe('qaCardNote', () => {
  it.each([
    ['queued', 'waiting for QA · round 2', undefined],
    ['testing', '🔍 testing · round 2', undefined],
    ['failed', '🔧 back to the developer', 'warn'],
    ['fixing', '🔧 fixing · round 2', 'warn'],
    ['needs-human', '⚠️ needs you', 'bad'],
    ['passed', '✅ QA passed', 'good'],
  ] as const)('%s without a mergeNote', (status, note, tone) => {
    expect(qaCardNote(rec(status), pr, true)).toEqual({ note, tone });
  });

  it.each([
    ['queued', 'waiting for QA · round 2', undefined],
    ['testing', '🔍 testing · round 2', undefined],
    ['failed', '🔧 back to the developer', 'warn'],
    ['fixing', '🔧 fixing · round 2', 'warn'],
    ['needs-human', `⚠️ needs you · ${STALE}`, 'bad'],
    ['passed', `QA ✓ · ${STALE}`, 'good'],
  ] as const)('%s with a mergeNote shows it only when it matters', (status, note, tone) => {
    expect(qaCardNote(rec(status, STALE), pr, true)).toEqual({ note, tone });
  });

  it('only needs-human is red', () => {
    const statuses: QaStatus[] = ['queued', 'testing', 'failed', 'fixing', 'needs-human', 'passed'];
    expect(statuses.filter((s) => qaCardNote(rec(s, 'x'), pr, true).tone === 'bad')).toEqual(['needs-human']);
  });

  it('a needs-human PR the CEO is triaging is amber and says so, until it is escalated', () => {
    expect(qaCardNote(rec('needs-human', STALE, 3, true), pr, true)).toEqual({ note: '🧭 CEO is looking', tone: 'warn' });
    expect(qaCardNote(rec('needs-human', STALE, 3, false), pr, true)).toEqual({ note: `⚠️ needs you · ${STALE}`, tone: 'bad' });
  });

  it('a first-round queued PR has no round', () => {
    expect(qaCardNote(rec('queued', null, 1), pr, true).note).toBe('waiting for QA');
  });

  it('a passed PR says why it is not merging yet', () => {
    expect(qaCardNote(rec('passed'), { ...pr, mergeable: 'CONFLICTING' }, true)).toEqual({ note: 'QA ✓ · conflicts', tone: 'warn' });
    expect(qaCardNote(rec('passed'), { ...pr, checks: 'failing' }, true)).toEqual({ note: 'QA ✓ · CI failing', tone: 'warn' });
    expect(qaCardNote(rec('passed'), { ...pr, checks: 'pending' }, true).note).toBe('QA ✓ · waiting for checks');
    expect(qaCardNote(rec('passed'), { ...pr, checks: 'pending' }, false).note).toBe('✅ QA passed');
  });

  it('an untested PR is amber, a draft says so', () => {
    expect(qaCardNote(undefined, pr, true)).toEqual({ note: 'not tested yet', tone: 'warn' });
    expect(qaCardNote(null, { ...pr, isDraft: true }, true).note).toBe('draft');
  });
});

describe('elapsedLabel', () => {
  it.each([
    [0, '<1 min'],
    [59_999, '<1 min'],
    [60_000, '1 min'],
    [12 * 60_000 + 30_000, '12 min'],
    [59 * 60_000, '59 min'],
    [65 * 60_000, '1 h 5 min'],
    [-5_000, '<1 min'],
  ])('%i ms reads %s', (ms, label) => {
    expect(elapsedLabel(ms)).toBe(label);
  });
});

describe('testingLabel', () => {
  const now = 1_000_000_000;

  it('says who has it, its round and how long, longest wording first', () => {
    expect(testingLabel('Marple', 2, now - 12 * 60_000, now)).toEqual({ who: '🔍 Marple · testing', meta: ['round 2 · 12 min', 'R2 · 12 min', '12 min'] });
  });

  it('shows no time without a usable start', () => {
    for (const since of [null, undefined, 0, Number.NaN, now + 10 * 60_000]) {
      expect(testingLabel('Marple', 1, since, now).meta).toEqual(['round 1', 'R1']);
    }
  });

  it('a start a few seconds ahead (clock skew) reads as just started', () => {
    expect(testingLabel('Marple', 1, now + 5_000, now).meta[0]).toBe('round 1 · <1 min');
  });

  it('copes with no tester or round', () => {
    expect(testingLabel(undefined, 0, now - 60_000, now)).toEqual({ who: '🔍 testing', meta: ['1 min'] });
    expect(testingLabel(undefined, 0, null, now).meta).toEqual([]);
  });
});

describe('needsManager', () => {
  it('counts needs-human only', () => {
    const statuses: QaStatus[] = ['queued', 'testing', 'failed', 'fixing', 'needs-human', 'passed'];
    expect(statuses.filter((status) => needsManager({ status, ceoLooking: false }))).toEqual(['needs-human']);
    expect(needsManager(undefined)).toBe(false);
  });

  it('leaves out a PR the CEO is still triaging', () => {
    expect(needsManager({ status: 'needs-human', ceoLooking: true })).toBe(false);
  });
});
