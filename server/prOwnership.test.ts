import { describe, expect, it } from 'vitest';
import { MAX_FIX_FAILURES } from './fixOutcome.ts';
import { MAX_MERGE_FIXES } from './mergeGate.ts';
import { catchUp, failedRunId, logTail, noChangeReason, QA_STOPPED, unpushedFix, type CatchUpRecord, type UnpushedRecord } from './prOwnership.ts';
import { MAX_QA_ROUNDS } from './qaOutcome.ts';

const HEAD = 'a'.repeat(40);

describe('noChangeReason', () => {
  it('reads the line starting NO CHANGE NEEDED:', () => {
    expect(noChangeReason('I re-ran the e2e job; it passed.\nNO CHANGE NEEDED: the failure was a flaky e2e test.')).toBe('the failure was a flaky e2e test.');
    expect(noChangeReason('**NO CHANGE NEEDED:** main already fixed it in #140')).toBe('main already fixed it in #140');
    expect(noChangeReason('- No change needed: the check was re-run and is green')).toBe('the check was re-run and is green');
    expect(noChangeReason('NO CHANGE NEEDED:')).toBe('no reason given');
  });

  it('ignores anything else', () => {
    expect(noChangeReason('')).toBeNull();
    expect(noChangeReason('Pushed the fix.')).toBeNull();
    expect(noChangeReason('No change needed here, but I tidied the test')).toBeNull(); // no colon: not the answer
    expect(noChangeReason('I said NO CHANGE NEEDED: earlier')).toBeNull(); // not at the start of a line
  });
});

describe('unpushedFix: the nudge before a strike', () => {
  const rec = (r: Partial<UnpushedRecord> = {}): UnpushedRecord => ({ round: 3, retests: 1, noChangeSha: null, preQa: null, ...r });
  const first = { nudged: false, noChange: null, counts: true };

  it('resumes the same session once after the first empty ending', () => {
    expect(unpushedFix(rec(), HEAD, first)).toEqual({ do: 'nudge' });
  });

  it('sends a NO CHANGE NEEDED answer back to QA as a re-test, with no strike', () => {
    expect(unpushedFix(rec(), HEAD, { ...first, nudged: true, noChange: 'a flaky check, re-run green' })).toEqual({
      do: 'retest',
      set: { status: 'queued', round: 4, retests: 2, noChangeSha: HEAD },
    });
    expect(unpushedFix(rec(), HEAD, { ...first, noChange: 'main already fixed it' })).toMatchObject({ do: 'retest' }); // said so straight away
  });

  it('counts a second empty ending as a strike', () => {
    expect(unpushedFix(rec(), HEAD, { ...first, nudged: true })).toEqual({ do: 'strike' });
  });

  it('gives each commit one free re-test: a second NO CHANGE NEEDED for it is a strike', () => {
    expect(unpushedFix(rec({ noChangeSha: HEAD }), HEAD, { ...first, noChange: 'still nothing to change' })).toEqual({ do: 'strike' });
    expect(unpushedFix(rec({ noChangeSha: 'b'.repeat(40) }), HEAD, { ...first, noChange: 'flaky again' })).toMatchObject({ do: 'retest' });
  });

  it("doesn't nudge while the usage limit is hit (the resume would fail)", () => {
    expect(unpushedFix(rec(), HEAD, { ...first, counts: false })).toEqual({ do: 'strike' });
  });

  it('a conflict found before QA goes back to the test QA was queued for', () => {
    const set = unpushedFix(rec({ preQa: { sha: HEAD, fixReason: 'qa' } }), HEAD, { ...first, noChange: 'GitHub merges it cleanly now' });
    expect(set).toEqual({ do: 'retest', set: { status: 'queued', round: 4, retests: 2, noChangeSha: HEAD, fixReason: 'qa', preQa: null } });
  });
});

describe('catchUp: PRs the manager got under the old budgets', () => {
  const rec = (r: Partial<CatchUpRecord> = {}): CatchUpRecord => ({
    status: 'needs-human',
    summary: 'The toolbar overflows on phones.',
    round: 3,
    retests: 0,
    mergeFixes: 0,
    sessionFailures: 0,
    passedSha: null,
    fixReason: 'qa',
    ...r,
  });

  it('sends a PR that ran out of the old three QA rounds back to its developer', () => {
    expect(catchUp(rec())).toBe('failed');
    expect(catchUp(rec({ round: 5, retests: 2 }))).toBe('failed');
    expect(catchUp(rec({ round: MAX_QA_ROUNDS }))).toBeNull();
  });

  it('sends a PR that ran out of the old two fix sessions back to its developer', () => {
    expect(catchUp(rec({ sessionFailures: 2 }))).toBe('failed');
    expect(catchUp(rec({ sessionFailures: 2, fixReason: 'conflict', passedSha: HEAD }))).toBe('failed');
    expect(catchUp(rec({ sessionFailures: MAX_FIX_FAILURES }))).toBeNull();
  });

  it('puts a QA-passed PR that ran out of the old three merge fixes back through the merge gate', () => {
    expect(catchUp(rec({ passedSha: HEAD, fixReason: null, mergeFixes: 3 }))).toBe('passed');
    expect(catchUp(rec({ passedSha: HEAD, fixReason: 'checks', mergeFixes: 4 }))).toBe('passed');
    expect(catchUp(rec({ passedSha: HEAD, mergeFixes: MAX_MERGE_FIXES }))).toBeNull();
  });

  it("leaves the manager's own calls and everything else alone", () => {
    expect(catchUp(rec({ summary: QA_STOPPED, sessionFailures: 1 }))).toBeNull();
    expect(catchUp(rec({ fixReason: null }))).toBeNull(); // QA never failed it
    expect(catchUp(rec({ status: 'failed' }))).toBeNull();
    expect(catchUp(rec({ status: 'passed', passedSha: HEAD }))).toBeNull();
  });
});

describe('checks fixes: the failed run', () => {
  it('finds the run behind the first failed check', () => {
    expect(failedRunId('- e2e: https://github.com/o/r/actions/runs/123456/job/789\n- build: https://github.com/o/r/actions/runs/999/job/1')).toBe('123456');
    expect(failedRunId('- Vercel: https://vercel.com/o/r/abc')).toBeNull();
    expect(failedRunId(null)).toBeNull();
  });

  it('keeps the last lines of the log, clipped', () => {
    const log = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\r\n');
    const tail = logTail(log).split('\n');
    expect(tail).toHaveLength(60);
    expect(tail[0]).toBe('line 41');
    expect(tail[59]).toBe('line 100');
    expect(logTail(`${'x'.repeat(400)}\n\n`, 60, 10)).toBe(`${'x'.repeat(10)}…`);
  });
});
