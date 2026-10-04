import { describe, expect, it } from 'vitest';
import { MAX_MERGE_FIXES, mergeStep } from './mergeGate.ts';
import { conflictFixInstructions, lastQaRound, MAX_QA_ROUNDS, qaOutcome, type QaPull, type QaRoundRecord } from './qaOutcome.ts';

const CONFLICTING: QaPull = { mergeable: 'CONFLICTING', mergeState: 'DIRTY' };
const MERGEABLE: QaPull = { mergeable: 'MERGEABLE', mergeState: 'CLEAN' };
const record = (r: Partial<QaRoundRecord> = {}): QaRoundRecord => ({ round: 1, retests: 0, mergeFixes: 0, ...r });
const last = (r: Partial<QaRoundRecord> = {}) => record({ round: MAX_QA_ROUNDS, ...r });

describe('qaOutcome', () => {
  it('sends a fail on the last QA round while the PR conflicts back as a conflict fix', () => {
    expect(qaOutcome(false, last(), CONFLICTING)).toBe('conflict');
    expect(qaOutcome(false, last(), { mergeable: 'UNKNOWN', mergeState: 'DIRTY' })).toBe('conflict');
    expect(qaOutcome(false, last({ mergeFixes: MAX_MERGE_FIXES - 1 }), CONFLICTING)).toBe('conflict');
  });

  it('sends a fail on the last QA round while the PR is mergeable to the manager, as before', () => {
    expect(qaOutcome(false, last(), MERGEABLE)).toBe('needs-human');
    expect(qaOutcome(false, last(), { mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' })).toBe('needs-human');
    expect(qaOutcome(false, last(), null)).toBe('needs-human'); // GitHub couldn't be asked
  });

  it('sends a fail while conflicting to the manager once the merge-fix budget is used up', () => {
    expect(qaOutcome(false, last({ mergeFixes: MAX_MERGE_FIXES }), CONFLICTING)).toBe('needs-human');
  });

  it('sends an earlier fail back to the developer, conflicting or not', () => {
    expect(qaOutcome(false, record(), CONFLICTING)).toBe('failed');
    expect(qaOutcome(false, record({ round: MAX_QA_ROUNDS + 1, retests: 2 }), MERGEABLE)).toBe('failed');
  });

  it("counts only QA's own rounds, not the office's re-tests", () => {
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS, retests: 1 }))).toBe(false);
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS + 1, retests: 1 }))).toBe(true);
    expect(lastQaRound(record({ round: MAX_QA_ROUNDS + 2, retests: 0 }))).toBe(true); // the extra round after a conflict send-back
  });

  it("passes a PR while it conflicts, leaving the conflict to the merge gate's existing path", () => {
    expect(qaOutcome(true, last(), CONFLICTING)).toBe('passed');
    expect(qaOutcome(true, last({ mergeFixes: MAX_MERGE_FIXES }), CONFLICTING)).toBe('passed');
    const rec = { passedSha: 'a'.repeat(40), mergeFixes: 0, pendingSince: null, mergeRetryAt: null, alerted: false, rerunSha: null, rerunAt: null };
    const pr = { ...CONFLICTING, isDraft: false, headSha: rec.passedSha, checks: 'passing' as const, failedChecks: [], pendingChecks: [] };
    expect(mergeStep(pr, rec, 0, { base: 'main' })).toMatchObject({ do: 'send-back', reason: 'conflict', needsHuman: false });
  });
});

describe('conflictFixInstructions', () => {
  it("keeps QA's findings and adds the merge", () => {
    expect(conflictFixInstructions('Make the toolbar wrap.\n', 'main')).toBe(
      'Make the toolbar wrap.\n\nIt also conflicts with main: bring it up to date (git fetch origin && git merge origin/main) and resolve the conflicts so both this change and the newly merged work keep working.',
    );
    expect(conflictFixInstructions('', 'trunk')).toMatch(/^It also conflicts with trunk: .*git merge origin\/trunk/);
  });
});
