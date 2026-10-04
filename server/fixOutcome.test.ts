import { describe, expect, it } from 'vitest';
import { fixOutcome, type FixRecord } from './fixOutcome.ts';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

const record = (r: Partial<FixRecord> = {}): FixRecord => ({ prNumber: 45, round: 2, sessionFailures: 0, testedSha: OLD, passedSha: null, fixReason: 'qa', ...r });

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

  it('sends the second failed fix in a row to the manager, saying nothing was pushed', () => {
    const step = fixOutcome(record({ sessionFailures: 1 }), OLD, 3);
    expect(step.set).toEqual({ status: 'needs-human', sessionFailures: 2, mergeNote: 'the fix was never pushed' });
    expect(step.set.round).toBeUndefined();
    expect(step.log.text).toBe('✗ No new commits were pushed for PR #45');
  });

  it("doesn't count an unpushed fix while the usage limit is hit", () => {
    expect(fixOutcome(record({ sessionFailures: 1 }), OLD, 3, false).set).toEqual({ status: 'failed', sessionFailures: 1 });
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
      expect(fixOutcome({ ...conflict, sessionFailures: 1 }, OLD, 3).set).toEqual({ status: 'needs-human', sessionFailures: 2, mergeNote: 'the conflict was never resolved' });
    });
  });

  it('lets a checks fix push nothing: it may have re-run a flaky check', () => {
    for (const head of [OLD, NEW, null]) {
      const step = fixOutcome(record({ fixReason: 'checks', passedSha: OLD }), head, 3);
      expect(step.pushed).toBe(true);
      expect(step.set).toEqual({ status: 'passed', sessionFailures: 0, mergeNote: 'waiting for fresh checks' });
    }
  });

  it("takes the session at its word when the head couldn't be read or nothing was recorded to compare", () => {
    expect(fixOutcome(record(), null, 3).set).toEqual({ status: 'queued', round: 3, sessionFailures: 0 });
    expect(fixOutcome(record({ testedSha: null }), OLD, 3).set.status).toBe('queued');
    expect(fixOutcome(record({ fixReason: 'conflict', passedSha: OLD }), null, 3).set.status).toBe('passed');
  });
});
