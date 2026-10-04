import type { PullInfo } from '../shared/types.ts';
import { MAX_MERGE_FIXES } from './mergeGate.ts';

// What a finished QA round does to its PR. A conflict with the default branch is the merge gate's job, not QA's: a
// fail on the last QA round while the PR conflicts goes back for a merge fix (and one more QA round) rather than to
// the manager, as long as the merge-fix budget lasts.

/** QA rounds that fail before a PR goes to the manager. */
export const MAX_QA_ROUNDS = 3;

/** The parts of a QA record a finished QA round reads. */
export interface QaRoundRecord {
  round: number;
  retests: number; // rounds the office added (re-tests after merge fixes), not counted against QA's budget
  mergeFixes: number;
}

export type QaPull = Pick<PullInfo, 'mergeable' | 'mergeState'>;

/**
 * passed: on to the merge gate (which handles a conflict as it always has). failed: back to the developer.
 * conflict: back to the developer to merge the default branch and fix QA's findings. needs-human: the manager decides.
 */
export type QaNext = 'passed' | 'failed' | 'conflict' | 'needs-human';

/** True when a fail now would use up QA's rounds: only then is the PR's mergeability worth asking about. */
export function lastQaRound(rec: QaRoundRecord): boolean {
  return rec.round - rec.retests >= MAX_QA_ROUNDS;
}

/** Decide where a PR goes after QA. pr: its mergeability right now, or null when it wasn't (or couldn't be) asked. */
export function qaOutcome(pass: boolean, rec: QaRoundRecord, pr: QaPull | null): QaNext {
  if (pass) return 'passed';
  if (!lastQaRound(rec)) return 'failed';
  const conflicting = pr != null && (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY');
  return conflicting && rec.mergeFixes < MAX_MERGE_FIXES ? 'conflict' : 'needs-human';
}

/** What the developer is told on a conflict send-back: QA's findings first, then the merge. */
export function conflictFixInstructions(qaInstructions: string, base: string): string {
  const merge = `It also conflicts with ${base}: bring it up to date (git fetch origin && git merge origin/${base}) and resolve the conflicts so both this change and the newly merged work keep working.`;
  return qaInstructions.trim() ? `${qaInstructions.trim()}\n\n${merge}` : merge;
}
