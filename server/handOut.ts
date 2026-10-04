// Handing out a PR's fix or QA run (#199): who may take a failed PR's fix, and what happens when a desk can't even be
// set up for it. A desk that fails to prepare ran nothing, so its developer is free again at once; the PR is what
// keeps failing, so it is the PR that sits out, and its fix/QA budget that pays.

import type { AgentStatus } from '../shared/types.ts';

/** The parts of the PR's author that decide who gets its fix. */
export interface FixAuthor {
  status: AgentStatus;
  branch: string | null;
  prNumber: number | null;
}

/**
 * Who takes a failed PR's fix: its author when they're free; nobody yet while the author is still in a session on that
 * PR or its branch (they get it when the session ends); anyone free when the author is gone, errored or on other work.
 */
export function fixGoesTo(author: FixAuthor | null, authorFree: boolean, prNumber: number, headRef: string | null): 'author' | 'wait' | 'anyone' {
  if (!author) return 'anyone';
  if (authorFree) return 'author';
  const live = author.status === 'preparing' || author.status === 'working';
  return live && (author.prNumber === prNumber || (!!headRef && author.branch === headRef)) ? 'wait' : 'anyone';
}

/** Desk preparations in a row that may fail for the same PR and task before it sits out. */
export const PREP_FAILURES_BEFORE_HOLD = 2;
/** How long it sits out. */
export const PREP_HOLD_MS = 10 * 60_000;

/** Failed desk preparations for one PR and task (fix or QA). */
export interface PrepStrikes {
  failures: number; // in a row, since the last hold
  holdUntil: number; // not handed out before this
}

export interface PrepFailure {
  strikes: PrepStrikes;
  /** 'retry': hand it out again now; 'hold': it sits out until strikes.holdUntil; 'needs-human': its budget is spent. */
  next: 'retry' | 'hold' | 'needs-human';
  /** The PR's failed sessions after this: a run of failed preparations counts as one, so it can't loop forever. */
  sessionFailures: number;
}

/** After a desk couldn't be prepared for a PR's fix or QA run. budget: failed sessions before it goes to the manager. */
export function prepFailure(prev: PrepStrikes | undefined, sessionFailures: number, budget: number, now: number): PrepFailure {
  const failures = (prev?.failures ?? 0) + 1;
  if (failures < PREP_FAILURES_BEFORE_HOLD) return { strikes: { failures, holdUntil: 0 }, next: 'retry', sessionFailures };
  const spent = sessionFailures + 1;
  return { strikes: { failures: 0, holdUntil: now + PREP_HOLD_MS }, next: spent >= budget ? 'needs-human' : 'hold', sessionFailures: spent };
}

/** Is the PR sitting out after failed preparations? */
export const prepHeld = (strikes: PrepStrikes | undefined, now: number) => !!strikes && now < strikes.holdUntil;
