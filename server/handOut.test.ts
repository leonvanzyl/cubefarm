import { describe, expect, it } from 'vitest';
import { fixGoesTo, PREP_HOLD_MS, prepFailure, prepHeld, type FixAuthor } from './handOut.ts';

const author = (o: Partial<FixAuthor> = {}): FixAuthor => ({ status: 'done', branch: 'swarm/issue-192-barbara', prNumber: 198, ...o });
const HEAD = 'swarm/issue-192-barbara';

describe('fixGoesTo', () => {
  it('waits for an author still working on the issue whose PR QA failed (#198)', () => {
    // Barbara opened PR #198 mid-session: still on task 'issue', no PR number recorded yet, desk on the branch.
    expect(fixGoesTo(author({ status: 'working', prNumber: null }), false, 198, HEAD)).toBe('wait');
    expect(fixGoesTo(author({ status: 'preparing', prNumber: null }), false, 198, HEAD)).toBe('wait');
    expect(fixGoesTo(author({ status: 'working', branch: 'elsewhere' }), false, 198, null)).toBe('wait');
  });

  it('goes to the author when they are free', () => {
    expect(fixGoesTo(author(), true, 198, HEAD)).toBe('author');
    expect(fixGoesTo(author({ status: 'error' }), true, 198, HEAD)).toBe('author'); // their cooldown is over
  });

  it('goes to anyone free when the author is gone, errored or busy with other work', () => {
    expect(fixGoesTo(null, false, 198, HEAD)).toBe('anyone');
    expect(fixGoesTo(author({ status: 'error' }), false, 198, HEAD)).toBe('anyone');
    expect(fixGoesTo(author({ status: 'stopped' }), false, 198, HEAD)).toBe('anyone');
    expect(fixGoesTo(author({ status: 'working', branch: 'swarm/issue-200-barbara', prNumber: null }), false, 198, HEAD)).toBe('anyone');
    expect(fixGoesTo(author({ status: 'working', branch: 'qa/pr-201-barbara', prNumber: 201 }), false, 198, HEAD)).toBe('anyone');
  });
});

describe('prepFailure', () => {
  const now = 1_000_000;

  it('hands the PR out again after one failed desk, and the budget is untouched', () => {
    const step = prepFailure(undefined, 0, 2, now);
    expect(step).toEqual({ strikes: { failures: 1, holdUntil: 0 }, next: 'retry', sessionFailures: 0 });
    expect(prepHeld(step.strikes, now)).toBe(false);
  });

  it('holds the PR after a second failure in a row, which costs one failed session', () => {
    const first = prepFailure(undefined, 0, 2, now);
    const second = prepFailure(first.strikes, 0, 2, now + 5_000);
    expect(second).toEqual({ strikes: { failures: 0, holdUntil: now + 5_000 + PREP_HOLD_MS }, next: 'hold', sessionFailures: 1 });
    expect(prepHeld(second.strikes, now + 6_000)).toBe(true);
    expect(prepHeld(second.strikes, now + 5_000 + PREP_HOLD_MS)).toBe(false);
  });

  it('sends it to the manager once the budget is spent, so it never loops', () => {
    let strikes = prepFailure(undefined, 1, 2, now).strikes;
    const step = prepFailure(strikes, 1, 2, now);
    expect(step.next).toBe('needs-human');
    expect(step.sessionFailures).toBe(2);
    // From a fresh PR: two holds at most, four failed desks in all.
    let failures = 0;
    const outcomes: string[] = [];
    strikes = { failures: 0, holdUntil: 0 };
    for (let i = 0; i < 4; i++) {
      const s = prepFailure(strikes, failures, 2, now);
      strikes = s.strikes;
      failures = s.sessionFailures;
      outcomes.push(s.next);
    }
    expect(outcomes).toEqual(['retry', 'hold', 'retry', 'needs-human']);
  });

  it('is not held without strikes', () => {
    expect(prepHeld(undefined, now)).toBe(false);
  });
});
