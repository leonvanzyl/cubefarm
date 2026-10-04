import { describe, expect, it } from 'vitest';
import type { PullInfo, QaStatus } from '../../shared/types';
import { needsManager, qaCardNote } from './qaCard';

const pr: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'> = { isDraft: false, mergeable: 'MERGEABLE', checks: 'passing' };
const rec = (status: QaStatus, mergeNote: string | null = null, round = 2) => ({ status, round, mergeNote });
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

describe('needsManager', () => {
  it('counts needs-human only', () => {
    const statuses: QaStatus[] = ['queued', 'testing', 'failed', 'fixing', 'needs-human', 'passed'];
    expect(statuses.filter((status) => needsManager({ status }))).toEqual(['needs-human']);
    expect(needsManager(undefined)).toBe(false);
  });
});
