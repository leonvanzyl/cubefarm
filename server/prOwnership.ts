// Developers own their PR until it merges. A fix session that pushed nothing is asked once more before it counts as
// a strike, and may answer that nothing needs to change (QA then re-tests). PRs the manager got under the old, smaller
// budgets go back to their developer once. Pure, so the decisions are tested.

import { MAX_FIX_FAILURES } from './fixOutcome.ts';
import { MAX_MERGE_FIXES } from './mergeGate.ts';
import { MAX_QA_ROUNDS, type PreQa } from './qaOutcome.ts';

/** The summary of a QA record the manager stopped: the manager's call, never caught up. */
export const QA_STOPPED = 'QA was stopped by the manager.';

/** Bumped when the budgets grow, so PRs the manager got under the old ones are caught up once (catchUp). */
export const PR_LIMITS_VERSION = 2;

/** The reason a fix session gave for pushing nothing: its line starting "NO CHANGE NEEDED:", else null. */
export function noChangeReason(text: string): string | null {
  const m = text.match(/^[ \t*_>`#-]*NO CHANGE NEEDED[*_`]*[ \t]*:[*_`]*[ \t]*(.*)$/im);
  return m ? m[1].replace(/[*_`]+$/, '').trim() || 'no reason given' : null;
}

/** The parts of a QA record an unpushed fix reads. */
export interface UnpushedRecord {
  round: number;
  retests: number;
  /** The head a developer last said needed no change: a second claim for the same commit is a strike. */
  noChangeSha: string | null;
  preQa: PreQa | null;
}

export type UnpushedStep =
  | { do: 'nudge' } // resume the same session once with the nudge
  | { do: 'retest'; set: { status: 'queued'; round: number; retests: number; noChangeSha: string; fixReason?: PreQa['fixReason']; preQa?: null } }
  | { do: 'strike' }; // a failed fix session (fixOutcome's unpushed outcome)

/**
 * A fix session ended without pushing (head: the PR's unchanged head). nudged: it was already asked once. noChange:
 * its NO CHANGE NEEDED reason, if any. counts: false while Claude's usage limit is hit (a resume would fail anyway).
 */
export function unpushedFix(rec: UnpushedRecord, head: string, i: { nudged: boolean; noChange: string | null; counts: boolean }): UnpushedStep {
  if (i.noChange != null && rec.noChangeSha !== head) {
    // Back to QA as a re-test, not one of QA's rounds. A conflict found before QA goes to the test it was queued for.
    const back = rec.preQa ? { fixReason: rec.preQa.fixReason, preQa: null } : {};
    return { do: 'retest', set: { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, noChangeSha: head, ...back } };
  }
  if (i.noChange == null && !i.nudged && i.counts) return { do: 'nudge' };
  return { do: 'strike' };
}

/** The parts of a QA record the catch-up reads. */
export interface CatchUpRecord {
  status: string;
  summary: string | null;
  round: number;
  retests: number;
  mergeFixes: number;
  sessionFailures: number;
  passedSha: string | null;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
}

/**
 * One-off, on the first start with bigger budgets: where a PR the manager got under the old ones goes, or null to
 * leave it with the manager. failed: back to its developer with its last fixInstructions (fix sessions or QA rounds
 * ran out). passed: the merge gate decides afresh (merge fixes ran out after QA passed it), sending it back to a
 * developer with fresh instructions if it still conflicts or fails its checks.
 */
export function catchUp(rec: CatchUpRecord): 'failed' | 'passed' | null {
  if (rec.status !== 'needs-human' || rec.summary === QA_STOPPED) return null;
  if (rec.sessionFailures > 0) return rec.fixReason && rec.sessionFailures < MAX_FIX_FAILURES ? 'failed' : null;
  if (rec.passedSha) return rec.mergeFixes < MAX_MERGE_FIXES ? 'passed' : null;
  return rec.fixReason === 'qa' && rec.round - rec.retests < MAX_QA_ROUNDS ? 'failed' : null;
}

/** The GitHub Actions run behind the first failed check in a checks fix's instructions ("- name: url" lines). */
export function failedRunId(instructions: string | null): string | null {
  return instructions?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
}

/** The last `lines` lines of a log, each clipped, for a prompt. */
export function logTail(log: string, lines = 60, width = 300): string {
  return log
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-lines)
    .map((l) => (l.length > width ? `${l.slice(0, width)}…` : l))
    .join('\n');
}
