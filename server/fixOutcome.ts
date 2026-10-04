// After a fix session that ended well: did it push anything? A QA fix or a conflict resolution that left the PR's head
// where it was fixed nothing, so it counts as a failed session: QA doesn't re-test the same commit, and the manager
// hears "nothing was pushed" rather than another identical QA report. A checks fix may rightly push nothing (it can
// re-run a flaky check), and so may a QA fix whose only finding was a red check: when the PR's checks have gone from
// failing (when QA reported) to passing or running, the developer re-ran a flake and QA simply re-tests. A conflict
// found before QA (preQa) goes back to the QA test it was queued for once resolved.

import type { PullInfo } from '../shared/types.ts';
import type { PreQa } from './qaOutcome.ts';

/** Failed fix sessions in a row (unpushed ones included) before the PR goes to the manager. */
export const MAX_FIX_FAILURES = 3;

/** The parts of a QA record a finished fix reads. */
export interface FixRecord {
  prNumber: number;
  round: number;
  retests: number;
  sessionFailures: number;
  testedSha: string | null;
  passedSha: string | null;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
  preQa: PreQa | null;
  qaChecks: PullInfo['checks'] | null; // GitHub's checks on the PR when QA reported (null: not recorded)
}

export type FixPatch = Partial<{
  status: 'queued' | 'passed' | 'failed' | 'needs-human';
  round: number;
  retests: number;
  sessionFailures: number;
  mergeNote: string | null;
  fixReason: FixRecord['fixReason'];
  preQa: PreQa | null;
}>;

export interface FixOutcome {
  set: FixPatch;
  log: { kind: 'done' | 'error'; text: string };
  pushed: boolean;
}

/**
 * What a fix session that ended well did to its PR. head: the PR's head commit now (null: GitHub couldn't be asked,
 * so the session is taken at its word). counts: false while Claude's usage limit is hit, which isn't the PR's fault.
 * checks: GitHub's checks on the PR now (null: not asked).
 */
export function fixOutcome(rec: FixRecord, head: string | null, minutes: number, counts = true, checks: PullInfo['checks'] | null = null): FixOutcome {
  const pr = rec.prNumber;
  // The commit the fix started from: the one QA failed, or the one QA passed (and auto-merge kept) for a conflict.
  const before = rec.preQa ? rec.preQa.sha : rec.fixReason === 'conflict' ? (rec.passedSha ?? rec.testedSha) : rec.testedSha;
  const unpushed = rec.fixReason !== 'checks' && head && before && head === before;
  if (unpushed && rec.fixReason !== 'conflict' && rec.qaChecks === 'failing' && (checks === 'passing' || checks === 'pending')) {
    // A re-run of a red check: QA re-tests the same commit, which costs neither a QA round nor a failed session.
    return {
      set: { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, sessionFailures: 0 },
      log: { kind: 'done', text: `✔ PR #${pr}'s failed checks were re-run in ${minutes}m. Back to QA.` },
      pushed: true,
    };
  }
  if (unpushed) {
    const sessionFailures = rec.sessionFailures + (counts ? 1 : 0);
    const needsHuman = sessionFailures >= MAX_FIX_FAILURES;
    return {
      set: needsHuman
        ? { status: 'needs-human', sessionFailures, mergeNote: rec.fixReason === 'conflict' ? 'the conflict was never resolved' : 'the fix was never pushed' }
        : { status: 'failed', sessionFailures },
      log: { kind: 'error', text: `✗ No new commits were pushed for PR #${pr}` },
      pushed: false,
    };
  }
  if (rec.preQa) {
    // QA hadn't tested it yet: it gets the test it was queued for, on the merged head. Not one of QA's rounds.
    return {
      set: { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, sessionFailures: 0, fixReason: rec.preQa.fixReason, preQa: null },
      log: { kind: 'done', text: `✔ PR #${pr} brought up to date in ${minutes}m. Back to QA.` },
      pushed: true,
    };
  }
  // A conflict fix for a PR QA failed on its last round (passedSha null) also fixed QA's findings: QA re-tests it.
  if (rec.fixReason === 'checks' || (rec.fixReason === 'conflict' && rec.passedSha)) {
    // Back in line to merge: new commits go through QA again first, a re-run of flaky checks doesn't.
    return { set: { status: 'passed', sessionFailures: 0, mergeNote: 'waiting for fresh checks' }, log: { kind: 'done', text: `✔ PR #${pr} fixed in ${minutes}m. Back in line to merge.` }, pushed: true };
  }
  return { set: { status: 'queued', round: rec.round + 1, sessionFailures: 0 }, log: { kind: 'done', text: `✔ Fix pushed for PR #${pr} in ${minutes}m. Back to QA.` }, pushed: true };
}
