import type { QaStatus } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

// Stuck PRs go to the CEO before the manager. When a QA record becomes needs-human the CEO gets a triage job and can
// retry QA, send it back, re-run its checks, close it or escalate. Each PR gets at most MAX_TRIAGES of them, so a PR
// that keeps getting stuck still reaches the manager; so does one the CEO looked at without doing anything.

/** Triage jobs one PR can get; the next time it gets stuck it goes straight to the manager. */
export const MAX_TRIAGES = 2;

export type TriageEvent =
  | { kind: 'stuck'; triages: number } // the record just became needs-human; triages: how many it already had
  | { kind: 'escalate'; reason: string } // the CEO called escalate
  | { kind: 'ended'; acted: boolean }; // a triage job finished; acted: the PR is no longer waiting on a decision

export type TriageStep = { do: 'triage' } | { do: 'escalate'; note: string | null } | { do: 'nothing' };

/** Triage or escalate. note: what the manager's alert adds to the reason the PR got stuck. */
export function triageStep(e: TriageEvent): TriageStep {
  switch (e.kind) {
    case 'stuck':
      return e.triages < MAX_TRIAGES ? { do: 'triage' } : { do: 'escalate', note: `The CEO already looked at it ${e.triages === 1 ? 'once' : `${e.triages} times`}.` };
    case 'escalate':
      return { do: 'escalate', note: e.reason.trim() || null };
    case 'ended':
      return e.acted ? { do: 'nothing' } : { do: 'escalate', note: 'The CEO looked at it but took no action.' };
  }
}

/**
 * Whether a triage tool may act on PR #pr of `floor`: only in a triage job, only on that job's floor, and only on an
 * open PR that is waiting on a decision. Throws HttpError 404 (another floor's or an unknown PR) or 409 (no triage
 * job, a closed PR, or one that isn't stuck).
 */
export function checkTriageTarget(r: {
  jobFloor: number | null; // the floor of the CEO's current triage job; null when it isn't on one
  floor: number;
  pr: number;
  pull: { state: string } | undefined; // the PR as the floor last synced it
  status: QaStatus | undefined; // its QA record
}) {
  if (r.jobFloor == null) throw new HttpError(409, 'Triage tools only work in a triage job.');
  if (r.floor !== r.jobFloor) throw new HttpError(404, `This triage is for floor ${r.jobFloor}: PR #${r.pr} on floor ${r.floor} isn't yours to change.`);
  if (!r.pull) throw new HttpError(404, `There is no PR #${r.pr} on floor ${r.floor}.`);
  if (r.pull.state !== 'OPEN') throw new HttpError(409, `PR #${r.pr} is ${r.pull.state.toLowerCase()}, so there is nothing to decide.`);
  if (r.status !== 'needs-human') throw new HttpError(409, `PR #${r.pr} isn't stuck: it is ${r.status ?? 'not in QA'}.`);
}

/** The PR facts a triage job's prompt carries. */
export interface TriagePr {
  number: number;
  title: string;
  url: string;
  round: number;
  why: string | null; // why it got stuck
  summary: string | null;
  fixInstructions: string | null;
  mergeNote: string | null;
  checks: string; // GitHub's checks rollup: passing / failing / pending / none
  failedChecks: string[];
  pendingChecks: string[];
  mergeable: string;
  mergeState: string;
  triage: number; // this is triage n of MAX_TRIAGES
}
