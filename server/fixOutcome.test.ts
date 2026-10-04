import { describe, expect, it } from 'vitest';
import { fixOutcome, MAX_FIX_FAILURES, type FixRecord } from './fixOutcome.ts';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

const record = (r: Partial<FixRecord> = {}): FixRecord => ({ prNumber: 45, round: 2, retests: 0, sessionFailures: 0, testedSha: OLD, passedSha: null, fixReason: 'qa', preQa: null, qaChecks: null, ...r });

describe('fixOutcome', () => {
  for (const fixReason of ['qa', null] as const) {
    describe(`a QA fix (fixReason ${fixReason})`, () => {
      it('with a new commit goes back to QA for the next round', () => {
        expect(fixOutcome(record({ fixReason, sessionFailures: 1 }), NEW, 3)).toEqual({
          set: { status: 'queued', round: 3, sessionFailures: 0 },
          log: { kind: 'done', text: '✔ Fix pushed for PR #45 in 3m. Back to QA.' },
          pushed: true,
        });
      });

      it('without one is a failed session: no QA round, back in line for a fix', () => {
        expect(fixOutcome(record({ fixReason }), OLD, 3)).toEqual({
          set: { status: 'failed', sessionFailures: 1 },
          log: { kind: 'error', text: '✗ No new commits were pushed for PR #45' },
          pushed: false,
        });
      });
    });
  }

  it('has three failed fixes in a row before the manager hears about it', () => {
    expect(MAX_FIX_FAILURES).toBe(3);
    expect(fixOutcome(record({ sessionFailures: 1 }), OLD, 3).set).toEqual({ status: 'failed', sessionFailures: 2 });
  });

  it('sends the last failed fix in a row to the manager, saying nothing was pushed', () => {
    const step = fixOutcome(record({ sessionFailures: MAX_FIX_FAILURES - 1 }), OLD, 3);
    expect(step.set).toEqual({ status: 'needs-human', sessionFailures: MAX_FIX_FAILURES, mergeNote: 'the fix was never pushed' });
    expect(step.set.round).toBeUndefined();
    expect(step.log.text).toBe('✗ No new commits were pushed for PR #45');
  });

  it("doesn't count an unpushed fix while the usage limit is hit", () => {
    expect(fixOutcome(record({ sessionFailures: MAX_FIX_FAILURES - 1 }), OLD, 3, false).set).toEqual({ status: 'failed', sessionFailures: MAX_FIX_FAILURES - 1 });
  });

  describe('a conflict fix', () => {
    const conflict = record({ fixReason: 'conflict', testedSha: 'c'.repeat(40), passedSha: OLD });

    it('with a new commit goes back in line to merge', () => {
      expect(fixOutcome(conflict, NEW, 3)).toEqual({
        set: { status: 'passed', sessionFailures: 0, mergeNote: 'waiting for fresh checks' },
        log: { kind: 'done', text: '✔ PR #45 fixed in 3m. Back in line to merge.' },
        pushed: true,
      });
    });

    it('compares with the commit QA passed, which auto-merge may have moved on from the one QA tested', () => {
      expect(fixOutcome(conflict, OLD, 3).pushed).toBe(false);
      expect(fixOutcome(conflict, conflict.testedSha, 3).pushed).toBe(true);
    });

    it('without a new commit is a failed session, then the manager\'s', () => {
      expect(fixOutcome(conflict, OLD, 3).set).toEqual({ status: 'failed', sessionFailures: 1 });
      expect(fixOutcome({ ...conflict, sessionFailures: MAX_FIX_FAILURES - 1 }, OLD, 3).set).toEqual({ status: 'needs-human', sessionFailures: MAX_FIX_FAILURES, mergeNote: 'the conflict was never resolved' });
    });
  });

  describe('a conflict fix after QA failed the last round', () => {
    const failedLast = record({ fixReason: 'conflict', round: 3, testedSha: OLD, passedSha: null });

    it('with a new commit goes back to QA for one more round, never straight to merge', () => {
      expect(fixOutcome(failedLast, NEW, 3)).toEqual({
        set: { status: 'queued', round: 4, sessionFailures: 0 },
        log: { kind: 'done', text: '✔ Fix pushed for PR #45 in 3m. Back to QA.' },
        pushed: true,
      });
      expect(fixOutcome(failedLast, null, 3).set.status).toBe('queued');
    });

    it('without a new commit is a failed session, then the manager\'s', () => {
      expect(fixOutcome(failedLast, OLD, 3).set).toEqual({ status: 'failed', sessionFailures: 1 });
      expect(fixOutcome({ ...failedLast, sessionFailures: MAX_FIX_FAILURES - 1 }, OLD, 3).set).toEqual({ status: 'needs-human', sessionFailures: MAX_FIX_FAILURES, mergeNote: 'the conflict was never resolved' });
    });
  });

  describe('a conflict found before QA tested the PR', () => {
    const MERGE_HEAD = 'd'.repeat(40);
    // QA failed OLD, the developer pushed MERGE_HEAD for round 3, and that conflicted before QA got to it.
    const preQa = record({ fixReason: 'conflict', round: 3, retests: 1, testedSha: OLD, passedSha: 'e'.repeat(40), preQa: { sha: MERGE_HEAD, fixReason: 'qa' } });

    it('with a new commit goes back to the QA test it was queued for, as a re-test', () => {
      expect(fixOutcome(preQa, NEW, 3)).toEqual({
        set: { status: 'queued', round: 4, retests: 2, sessionFailures: 0, fixReason: 'qa', preQa: null },
        log: { kind: 'done', text: '✔ PR #45 brought up to date in 3m. Back to QA.' },
        pushed: true,
      });
    });

    it('compares with the head the conflict was found on, not an older tested or passed commit', () => {
      expect(fixOutcome(preQa, MERGE_HEAD, 3)).toMatchObject({ pushed: false, set: { status: 'failed', sessionFailures: 1 } });
      expect(fixOutcome(preQa, OLD, 3).pushed).toBe(true);
    });
  });

  it('lets a checks fix push nothing: it may have re-run a flaky check', () => {
    for (const head of [OLD, NEW, null]) {
      const step = fixOutcome(record({ fixReason: 'checks', passedSha: OLD }), head, 3);
      expect(step.pushed).toBe(true);
      expect(step.set).toEqual({ status: 'passed', sessionFailures: 0, mergeNote: 'waiting for fresh checks' });
    }
  });

  describe('a QA fix that re-ran a red check instead of pushing', () => {
    const red = record({ qaChecks: 'failing', retests: 1 });

    for (const now of ['passing', 'pending'] as const) {
      it(`goes back to QA as a re-test when the checks went from failing to ${now}`, () => {
        expect(fixOutcome(red, OLD, 3, true, now)).toEqual({
          set: { status: 'queued', round: 3, retests: 2, sessionFailures: 0 },
          log: { kind: 'done', text: "✔ PR #45's failed checks were re-run in 3m. Back to QA." },
          pushed: true,
        });
        expect(fixOutcome({ ...red, fixReason: null, sessionFailures: 1 }, OLD, 3, true, now).set).toMatchObject({ status: 'queued', sessionFailures: 0 });
      });
    }

    it('counts as an unpushed fix as today while the checks still fail', () => {
      expect(fixOutcome(red, OLD, 3, true, 'failing').set).toEqual({ status: 'failed', sessionFailures: 1 });
      expect(fixOutcome({ ...red, sessionFailures: MAX_FIX_FAILURES - 1 }, OLD, 3, true, 'failing').set).toEqual({ status: 'needs-human', sessionFailures: MAX_FIX_FAILURES, mergeNote: 'the fix was never pushed' });
      expect(fixOutcome(red, OLD, 3, true, null).pushed).toBe(false);
    });

    it("counts as an unpushed fix when QA's checks weren't failing", () => {
      for (const qaChecks of ['passing', 'pending', 'none', null] as const) {
        expect(fixOutcome(record({ qaChecks }), OLD, 3, true, 'passing').pushed).toBe(false);
      }
    });

    it('leaves conflict fixes as they were', () => {
      const conflict = record({ fixReason: 'conflict', passedSha: OLD, qaChecks: 'failing' });
      expect(fixOutcome(conflict, OLD, 3, true, 'passing').set).toEqual({ status: 'failed', sessionFailures: 1 });
      expect(fixOutcome(conflict, NEW, 3, true, 'passing').set).toEqual({ status: 'passed', sessionFailures: 0, mergeNote: 'waiting for fresh checks' });
    });

    it('is an ordinary QA fix when a commit was pushed too', () => {
      expect(fixOutcome(red, NEW, 3, true, 'passing').set).toEqual({ status: 'queued', round: 3, sessionFailures: 0 });
    });
  });

  it("takes the session at its word when the head couldn't be read or nothing was recorded to compare", () => {
    expect(fixOutcome(record(), null, 3).set).toEqual({ status: 'queued', round: 3, sessionFailures: 0 });
    expect(fixOutcome(record({ testedSha: null }), OLD, 3).set.status).toBe('queued');
    expect(fixOutcome(record({ fixReason: 'conflict', passedSha: OLD }), null, 3).set.status).toBe('passed');
  });
});
