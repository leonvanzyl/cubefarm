// The office's watchdog (#262): every minute it looks for work that's stuck, and heals what it safely can. A quiet
// session is nudged once, then its work goes back in line; a desk that takes too long to set up is released and its
// work requeued; a failed or stopped agent still holding finished work is cleared; a PR left "testing" or "fixing" with
// nobody on it goes back in its queue. At most one remedy per item per hour: anything that's still stuck after that,
// or has no safe remedy, becomes a finding for the office doctor, with the console's own buttons to fix it.

import type { DoctorFinding, DoctorFix } from '../shared/types.ts';
import type { WorkState } from './reconcile.ts';

/** A session with no output and no tool activity for this long is quiet. */
export const QUIET_MS = 20 * 60_000;
/** After a nudge, how long a quiet session gets to answer before its work goes back in line. */
export const NUDGE_WAIT_MS = 10 * 60_000;
/** Setting up a desk taking longer than this is stuck. */
export const PREPARING_MS = 10 * 60_000;
/** A PR "testing" or "fixing" with nobody on it gets this long first: a finished session's report may still be posting. */
export const ORPHAN_GRACE_MS = 3 * 60_000;
/** An open issue whose resolving PR merged this long ago is left open by mistake. */
export const UNCLOSED_GRACE_MS = 10 * 60_000;
/** At most one automatic remedy per item in this window. */
export const REMEDY_EVERY_MS = 60 * 60_000;

export interface WatchAgent {
  id: string;
  name: string;
  repoId: string;
  role: string;
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  issueNumber: number | null;
  prNumber: number | null;
  startedAt: number | null;
  /** The latest output or tool activity of their session. */
  activeAt: number;
  /** Their task's state as the office knows it. */
  work: WorkState;
}

export interface WatchQa {
  repoId: string;
  prNumber: number;
  status: string;
  qaAgentId: string | null;
  devAgentId: string | null;
  updatedAt: number;
}

/** An open issue a merged PR resolves (see unclosedIssues). */
export interface Unclosed {
  repoId: string;
  issue: number;
  pr: number;
  mergedAt: number;
}

export type ProblemKind = DoctorFinding['kind'];

export interface Problem {
  kind: ProblemKind;
  /** The item: what the per-hour limit and the doctor's ids are kept by. */
  key: string;
  repoId: string;
  agentId: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  since: number;
}

const BUSY = ['preparing', 'working'];
const workKey = (a: WatchAgent) => `${a.repoId}#${a.task === 'issue' && !a.prNumber ? `i${a.issueNumber}` : `p${a.prNumber}`}`;

/** Everything stuck right now. */
export function diagnose(agents: readonly WatchAgent[], qa: readonly WatchQa[], unclosed: readonly Unclosed[], now: number): Problem[] {
  const out: Problem[] = [];
  const of = (a: WatchAgent, kind: ProblemKind, since: number): Problem => ({
    kind,
    key: `${kind}:${a.id}:${workKey(a)}`,
    repoId: a.repoId,
    agentId: a.id,
    prNumber: a.prNumber,
    issueNumber: a.issueNumber,
    since,
  });
  for (const a of agents) {
    if (a.role === 'ceo' || !a.task) continue;
    if (a.status === 'working' && now - a.activeAt >= QUIET_MS) out.push(of(a, 'quiet', a.activeAt));
    else if (a.status === 'preparing' && a.startedAt != null && now - a.startedAt >= PREPARING_MS) out.push(of(a, 'preparing', a.startedAt));
    else if ((a.status === 'error' || a.status === 'stopped') && (a.work === 'closed' || a.work === 'merged')) out.push(of(a, 'stale', a.startedAt ?? now));
  }
  const on = (id: string | null, q: WatchQa, task: 'qa' | 'fix') =>
    agents.some((a) => a.id === id && BUSY.includes(a.status) && a.task === task && a.repoId === q.repoId && a.prNumber === q.prNumber);
  for (const q of qa) {
    if (now - q.updatedAt < ORPHAN_GRACE_MS) continue;
    const base = { repoId: q.repoId, prNumber: q.prNumber, issueNumber: null, since: q.updatedAt };
    if (q.status === 'testing' && !on(q.qaAgentId, q, 'qa')) out.push({ ...base, kind: 'qa-orphan', key: `qa-orphan:${q.repoId}#p${q.prNumber}`, agentId: q.qaAgentId });
    if (q.status === 'fixing' && !on(q.devAgentId, q, 'fix')) out.push({ ...base, kind: 'fix-orphan', key: `fix-orphan:${q.repoId}#p${q.prNumber}`, agentId: q.devAgentId });
  }
  for (const u of unclosed) {
    if (now - u.mergedAt < UNCLOSED_GRACE_MS) continue;
    out.push({ kind: 'unclosed', key: `unclosed:${u.repoId}#i${u.issue}`, repoId: u.repoId, agentId: null, prNumber: u.pr, issueNumber: u.issue, since: u.mergedAt });
  }
  return out;
}

/**
 * The open issues a merged PR on the floor resolves (GitHub closes them itself after a merge to the default branch,
 * so one still open well after is a slip). pulls: the floor's open and recent merged PRs.
 */
export function unclosedIssues(
  repoId: string,
  openIssues: readonly number[],
  pulls: readonly { number: number; state: string; mergedAt: string | null; closesIssues: number[] }[],
): Unclosed[] {
  const open = new Set(openIssues);
  const out: Unclosed[] = [];
  for (const p of pulls) {
    const at = p.state === 'MERGED' && p.mergedAt ? Date.parse(p.mergedAt) : NaN;
    if (!Number.isFinite(at)) continue;
    for (const n of p.closesIssues) if (open.has(n) && !out.some((u) => u.issue === n)) out.push({ repoId, issue: n, pr: p.number, mergedAt: at });
  }
  return out;
}

/** What the watchdog remembers between ticks: when it last remedied each item, and which quiet sessions it nudged. */
export interface WatchMemory {
  remedied: Map<string, number>;
  nudged: Map<string, number>;
}

/** nudge: say something to the quiet session · requeue: stop it and put the work back · clear: clear the desk · retry-qa / refix: back in the PR's queue. */
export type Remedy = 'nudge' | 'requeue' | 'clear' | 'retry-qa' | 'refix';

const REMEDY: Record<ProblemKind, Remedy | null> = {
  quiet: 'requeue',
  preparing: 'requeue',
  stale: 'clear',
  'qa-orphan': 'retry-qa',
  'fix-orphan': 'refix',
  unclosed: null, // closing an issue is the manager's call
};

/**
 * What the watchdog does about each problem now: an automatic remedy, nothing yet (a nudged session gets time to
 * answer), or a doctor finding (no safe remedy, or this item was already remedied within the hour).
 */
export function triage(problems: readonly Problem[], memory: WatchMemory, now: number): { auto: { problem: Problem; remedy: Remedy }[]; doctor: Problem[] } {
  const auto: { problem: Problem; remedy: Remedy }[] = [];
  const doctor: Problem[] = [];
  for (const p of problems) {
    const remedy = REMEDY[p.kind];
    const last = memory.remedied.get(p.key);
    if (!remedy || (last !== undefined && now - last < REMEDY_EVERY_MS)) {
      doctor.push(p);
      continue;
    }
    if (p.kind === 'quiet') {
      const nudgedAt = memory.nudged.get(p.key);
      if (nudgedAt === undefined) auto.push({ problem: p, remedy: 'nudge' });
      else if (now - nudgedAt >= NUDGE_WAIT_MS) auto.push({ problem: p, remedy });
      continue;
    }
    auto.push({ problem: p, remedy });
  }
  return { auto, doctor };
}

/**
 * Forget nudges and remedies older than the window. A nudge is kept that long even if the session spoke up: one that
 * goes quiet again on the same work within the hour has had its nudge.
 */
export function forget(memory: WatchMemory, now: number) {
  for (const map of [memory.nudged, memory.remedied]) for (const [key, at] of map) if (now - at >= REMEDY_EVERY_MS) map.delete(key);
}

const ago = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 90 ? `${min} minute${min === 1 ? '' : 's'}` : `${Math.round(min / 60)} hours`;
};

/** The doctor's words and buttons for a problem. name: an agent's name by id. */
export function finding(p: Problem, name: (id: string | null) => string | null, work: WorkState | null, now: number): DoctorFinding {
  const who = name(p.agentId) ?? 'Someone';
  const what = p.prNumber != null ? `PR #${p.prNumber}` : `#${p.issueNumber}`;
  const [text, fixes]: [string, DoctorFix[]] =
    p.kind === 'quiet'
      ? [`${who} has been quiet for ${ago(now - p.since)} on ${what}, even after a nudge. Stop them, or put the work back in line?`, ['stop', 'requeue']]
      : p.kind === 'preparing'
        ? [`${who} has been setting up a desk for ${what} for ${ago(now - p.since)}. Put the work back in line?`, ['requeue', 'stop']]
        : p.kind === 'stale'
          ? [`${who}'s last task ${what} is already ${work === 'merged' ? 'merged' : 'closed'}. Clear the desk?`, ['clear']]
          : p.kind === 'qa-orphan'
            ? [`PR #${p.prNumber} is marked as in QA, but nobody is testing it. Test it again?`, ['retry-qa', 'send-back']]
            : p.kind === 'fix-orphan'
              ? [`PR #${p.prNumber} is waiting for a fix, but ${p.agentId ? `${who} is on something else` : 'nobody is on it'}. Hand it to a developer?`, ['send-back', 'retry-qa']]
              : [`Issue #${p.issueNumber} is still open, but PR #${p.prNumber}, which closes it, was merged ${ago(now - p.since)} ago. Close it?`, ['close-issue']];
  return { id: p.key, kind: p.kind, repoId: p.repoId, agentId: p.agentId, prNumber: p.prNumber, issueNumber: p.issueNumber, text, fixes, since: p.since };
}

/** The nudge a quiet session gets, typed into it like the manager's messages. */
export function nudgeText(quietMs: number): string {
  return `The office hasn't seen any output from you for ${ago(quietMs)}. If you're stuck, say what's blocking you; otherwise carry on and finish your task.`;
}
