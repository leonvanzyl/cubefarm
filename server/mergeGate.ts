import type { PullInfo } from '../shared/types.ts';

// Auto-merge: fixes for failing checks or conflicts before a PR needs the manager, how long checks may run before
// the manager hears about it, and how long to wait before retrying a merge GitHub refused. Failing checks are first
// re-run once per head commit (a flake or an outage shouldn't cost a fix), and a re-run's old result is ignored for
// a while, since GitHub's rollup can still show it just after the re-run starts.
export const MAX_MERGE_FIXES = 3;
export const CHECKS_ALERT_MS = 30 * 60_000;
export const MERGE_RETRY_MS = 10 * 60_000;
export const RERUN_GRACE_MS = 2 * 60_000;

/** The parts of a QA record the merge gate reads. */
export interface MergeRecord {
  passedSha: string | null;
  mergeFixes: number;
  pendingSince: number | null;
  mergeRetryAt: number | null;
  alerted: boolean;
  rerunSha: string | null; // the head commit whose failed checks the office re-ran
  rerunAt: number | null; // when it did
}

/** Bookkeeping the caller writes onto the record as it is (it doesn't count as a change to the record). */
export type MergeBookkeeping = Partial<Pick<MergeRecord, 'passedSha' | 'pendingSince' | 'alerted'>>;

export type MergePull = Pick<PullInfo, 'isDraft' | 'mergeable' | 'mergeState' | 'headSha' | 'checks' | 'failedChecks' | 'pendingChecks'>;

/** What auto-merge does next with a QA-passed PR. */
export type MergeStep = { set: MergeBookkeeping } & (
  | { do: 'wait'; note?: string; alert?: boolean } // no note: leave the card as it is; alert: tell the manager checks are slow
  | { do: 'details' } // GitHub hasn't worked out mergeability: ask about the PR itself, then decide again with `detailed`
  | { do: 'requeue' } // commits arrived after QA's sign-off: QA tests them too
  | { do: 'rerun'; runIds: number[]; reason: 'checks'; instructions: string; needsHuman: boolean } // re-run these Actions runs' failed jobs; the rest is the send-back if that can't be done
  | { do: 'send-back'; reason: 'checks' | 'conflict'; instructions: string; needsHuman: boolean } // needsHuman: the fix budget ran out
  | { do: 'update-branch' } // the repo only merges up-to-date branches
  | { do: 'merge' }
);

/**
 * Decide the next step toward merging a PR QA has passed. Pure: advanceMerge (swarm.ts) does the talking to GitHub
 * and the office. `detailed` means the PR's mergeability has already been asked for, so UNKNOWN is waited out.
 */
export function mergeStep(pr: MergePull, rec: MergeRecord, now: number, opts: { base: string; detailed?: boolean }): MergeStep {
  if (pr.isDraft) return { do: 'wait', note: 'a draft: waiting', set: {} };
  if (!opts.detailed && (pr.mergeable === 'UNKNOWN' || pr.mergeState === 'UNKNOWN')) return { do: 'details', set: {} };
  const set: MergeBookkeeping = {};
  if (rec.passedSha == null) set.passedSha = pr.headSha; // signed off before the office tracked commits
  if (pr.headSha !== (set.passedSha ?? rec.passedSha)) return { do: 'requeue', set };
  const needsHuman = rec.mergeFixes >= MAX_MERGE_FIXES;
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') {
    return { do: 'send-back', reason: 'conflict', instructions: `It conflicts with ${opts.base}.`, needsHuman, set };
  }
  const rerun = rec.rerunSha === pr.headSha;
  if (pr.checks === 'failing') {
    const instructions = pr.failedChecks.map((c) => `- ${c.name}${c.url ? `: ${c.url}` : ''}`).join('\n');
    const runIds = failedRunIds(pr.failedChecks);
    if (!rerun && runIds.length) return { do: 'rerun', runIds, reason: 'checks', instructions, needsHuman, set };
    if (rerun && rec.rerunAt != null && now - rec.rerunAt < RERUN_GRACE_MS) return { do: 'wait', note: 're-running a failed check', set };
    return { do: 'send-back', reason: 'checks', instructions, needsHuman, set };
  }
  if (pr.checks === 'pending') {
    const since = rec.pendingSince ?? now;
    if (rec.pendingSince == null) set.pendingSince = since;
    const alert = now - since > CHECKS_ALERT_MS && !rec.alerted;
    if (alert) set.alerted = true;
    const running = pr.pendingChecks.join(', ') || 'running';
    return { do: 'wait', note: rerun ? `re-running a failed check: ${running}` : `waiting for checks: ${running}`, alert, set };
  }
  set.pendingSince = null;
  if (pr.mergeable === 'UNKNOWN') return { do: 'wait', note: 'GitHub is checking it can merge', set };
  if (pr.mergeState === 'BEHIND') return { do: 'update-branch', set };
  if (rec.mergeRetryAt && now < rec.mergeRetryAt) return { do: 'wait', set };
  return { do: 'merge', set };
}

/** The GitHub Actions runs behind failed checks (from their log URLs), once each. Other checks can't be re-run from here. */
export function failedRunIds(failed: MergePull['failedChecks']): number[] {
  const ids = failed.map((c) => c.url?.match(/\/actions\/runs\/(\d+)/)?.[1]).filter((id): id is string => !!id);
  return [...new Set(ids)].map(Number);
}
