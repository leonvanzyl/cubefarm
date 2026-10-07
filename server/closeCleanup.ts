// Closing an issue or PR cleans up after itself (#201). The office learns that an issue or PR closed from its GitHub
// sync, from closing it itself (the manager's Close, the CEO's tools) or from a merge, and the work on it ends at once:
// sessions on a closed issue or an unmerged closed PR stop, desks are cleared, and the PR leaves QA, so nothing hands
// its QA or fix out again; its issue waits for the manager rather than going back to auto-assign. A merge is the
// normal end of the work, so it cuts nobody's session short. The sync lists only
// open issues (100) and open (50) and recently merged (8) PRs, so what the office still holds that the lists don't show
// is asked about directly, and what it learns is newer than a list fetched before it.

import { issuesResolvedBy } from './issueClaims.ts';

export type PullState = 'OPEN' | 'CLOSED' | 'MERGED';

/** A PR, as far as closing goes. */
export interface KnownPull {
  number: number;
  state: PullState;
  headRefName: string;
  closesIssues: number[];
}

/** A PR the office learned is closed or merged, and when. */
export type LearnedPull = KnownPull & { at: number };

/** What the office knows about one floor's issues and PRs right now. */
export interface FloorState {
  fetchedAt: number; // when the last sync's fetch started
  openIssues: readonly number[]; // the last sync's open issues
  pulls: readonly KnownPull[]; // the last sync's open and recently merged PRs
  closedIssues: ReadonlyMap<number, number>; // issue -> when the office learned it is closed
  closedPulls: ReadonlyMap<number, LearnedPull>;
}

/** Learned after the last list was fetched, so it wins over what the list says. */
const newer = (at: number, f: FloorState) => at >= f.fetchedAt;

/** Is the issue open? null: the office can't tell (the sync lists at most 100 open issues). */
export function issueOpen(n: number, f: FloorState): boolean | null {
  const learned = f.closedIssues.get(n);
  const listed = f.openIssues.includes(n);
  if (learned !== undefined && (!listed || newer(learned, f))) return false;
  return listed ? true : null;
}

/** The PR as the office last saw it; null when the sync doesn't list it and nobody asked. */
export function pullNow(n: number, f: FloorState): KnownPull | null {
  const listed = f.pulls.find((p) => p.number === n) ?? null;
  const learned = f.closedPulls.get(n);
  return learned && (!listed || newer(learned.at, f)) ? learned : listed;
}

/**
 * May an issue, QA or fix task start? live: GitHub's answer just now (null: it couldn't be asked). Without one, the
 * office's latest view decides, and what it can't tell counts as open: a task is never refused on a guess.
 */
export function stillOpen(t: { kind: 'issue' | 'pr'; number: number }, f: FloorState, live?: PullState | null): boolean {
  if (live) return live === 'OPEN';
  if (t.kind === 'issue') return issueOpen(t.number, f) !== false;
  const p = pullNow(t.number, f);
  return !p || p.state === 'OPEN';
}

/** Learned closures the office can forget: listed open by a newer sync (reopened), or a day old. */
export function forgettable(f: FloorState, now: number): { issues: number[]; pulls: number[] } {
  const stale = (at: number) => now - at > 24 * 60 * 60_000;
  return {
    issues: [...f.closedIssues].filter(([n, at]) => stale(at) || (!newer(at, f) && f.openIssues.includes(n))).map(([n]) => n),
    pulls: [...f.closedPulls.values()].filter((p) => stale(p.at) || (!newer(p.at, f) && f.pulls.some((x) => x.number === p.number && x.state === 'OPEN'))).map((p) => p.number),
  };
}

// ---------- who holds what ----------

export interface Holder {
  id: string;
  role: string;
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  issueNumber: number | null;
  prNumber: number | null;
  branch: string | null;
}

export interface HeldRecord {
  prNumber: number;
  status: string;
  qaAgentId: string | null;
  devAgentId: string | null;
}

/** An agent still holding a task: in a session on it, or done, stopped or failed with it on their card. */
const holding = (a: Holder) => a.role !== 'ceo' && a.task !== null && a.status !== 'idle';

/** Issues and PRs asked about per sync, at most; the rest wait for the next one. */
export const MAX_ASKS = 6;
/** One GitHub said is open (past the sync's limits) isn't asked about again for this long. */
export const ASK_AGAIN_MS = 10 * 60_000;

/**
 * Issues and PRs that agents, QA records or holds (toHold) hold but the last sync can't vouch for: GitHub is asked
 * about each. openAt: when GitHub last said one was open, by `issue#<n>` / `pr#<n>`.
 */
export function toAsk(agents: readonly Holder[], records: readonly HeldRecord[], held: readonly number[], f: FloorState, openAt: ReadonlyMap<string, number>, now: number) {
  const fresh = (key: string) => now - (openAt.get(key) ?? -Infinity) < ASK_AGAIN_MS;
  const issues = new Set<number>();
  const pulls = new Set<number>();
  const issue = (n: number | null) => {
    if (n != null && issueOpen(n, f) === null && !fresh(`issue#${n}`)) issues.add(n);
  };
  const pull = (n: number | null) => {
    if (n != null && !pullNow(n, f) && !fresh(`pr#${n}`)) pulls.add(n);
  };
  for (const a of agents.filter(holding)) {
    if (a.task === 'issue') issue(a.issueNumber);
    pull(a.prNumber);
  }
  for (const r of records) pull(r.prNumber);
  for (const n of held) issue(n);
  return { issues: [...issues].slice(0, MAX_ASKS), pulls: [...pulls].slice(0, MAX_ASKS) };
}

// ---------- closures ----------

/** An issue or PR that is no longer open. mergedBy: the merged PRs the office knows of that resolve the issue. */
export type Closure =
  | { kind: 'issue'; number: number; mergedBy: { number: number; headRefName: string }[] }
  | { kind: 'pr'; number: number; merged: boolean; headRefName: string };

/** The merged PRs the office knows of that resolve issue n. */
function mergedResolving(n: number, f: FloorState) {
  const numbers = new Set([...f.pulls.map((p) => p.number), ...f.closedPulls.keys()]);
  return [...numbers]
    .map((x) => pullNow(x, f)!)
    .filter((p) => p.state === 'MERGED' && issuesResolvedBy(p).includes(n))
    .map((p) => ({ number: p.number, headRefName: p.headRefName }));
}

/** The closed or merged PRs, then issues, that agents or QA records still hold. */
export function closuresHeld(agents: readonly Holder[], records: readonly HeldRecord[], f: FloorState): Closure[] {
  const prs = new Map<number, Closure>();
  const issues = new Map<number, Closure>();
  const pull = (n: number | null) => {
    const p = n == null || prs.has(n) ? null : pullNow(n, f);
    if (p && p.state !== 'OPEN') prs.set(p.number, { kind: 'pr', number: p.number, merged: p.state === 'MERGED', headRefName: p.headRefName });
  };
  for (const a of agents.filter(holding)) {
    pull(a.prNumber);
    const n = a.task === 'issue' ? a.issueNumber : null;
    if (n != null && !issues.has(n) && issueOpen(n, f) === false) issues.set(n, { kind: 'issue', number: n, mergedBy: mergedResolving(n, f) });
  }
  for (const r of records) pull(r.prNumber);
  return [...prs.values(), ...issues.values()];
}

export interface CloseActions {
  /** Agents in a session on it: the session stops, then their desk is cleared. */
  stop: string[];
  /** Agents with it on their card but no session: their desk is cleared. */
  clear: string[];
  /** The PR's record leaves QA: whatever QA or fix work it had queued is never handed out. */
  dropQa: boolean;
}

/** Is this agent's task on the closed issue or PR? A session can open its PR before the office knows the number. */
function onIt(a: Holder, c: Closure) {
  if (c.kind === 'issue') return a.task === 'issue' && a.issueNumber === c.number;
  return a.prNumber === c.number || (!!c.headRefName && a.task !== 'qa' && a.branch === c.headRefName);
}

/** A merge is the normal end: of the PR for everyone on it, of an issue for the author of the PR that merged. */
function mergedEnd(a: Holder, c: Closure) {
  if (c.kind === 'pr') return c.merged;
  return c.mergedBy.some((p) => p.number === a.prNumber || (!!a.branch && p.headRefName === a.branch));
}

/**
 * What happens to the floor's agents and QA records when an issue or PR closes. Whoever works on a closed issue or an
 * unmerged closed PR stops; a merge stops nobody. Agents who only have it on their card are cleared, except one who
 * tested it, after a merge: their last run stays on their monitor until their next one. A PR's record leaves QA, unless it merged
 * while a QA run or fix is still going (that one leaves once it ends).
 */
export function afterClose(c: Closure, agents: readonly Holder[], records: readonly HeldRecord[], busy: readonly string[]): CloseActions {
  const live = (a: Holder) => busy.includes(a.status);
  const stop: string[] = [];
  const clear: string[] = [];
  for (const a of agents.filter((x) => holding(x) && onIt(x, c))) {
    if (live(a)) {
      if (!mergedEnd(a, c)) stop.push(a.id);
    } else if (!(c.kind === 'pr' && c.merged && a.task === 'qa')) clear.push(a.id);
  }
  const rec = c.kind === 'pr' ? records.find((r) => r.prNumber === c.number) : undefined;
  const running =
    !!rec &&
    agents.some(
      (a) =>
        live(a) &&
        a.prNumber === rec.prNumber &&
        ((rec.status === 'testing' && a.id === rec.qaAgentId && a.task === 'qa') || (rec.status === 'fixing' && a.id === rec.devAgentId && a.task === 'fix')),
    );
  return { stop, clear, dropQa: !!rec && c.kind === 'pr' && (!c.merged || !running) };
}

/**
 * Closing a PR never puts its issue back in line by itself: the open issues it resolved wait for the manager to assign
 * them again, or close them. (A merge closes them instead.)
 */
export function toHold(pr: KnownPull, f: FloorState): number[] {
  return pr.state === 'CLOSED' ? issuesResolvedBy(pr).filter((n) => issueOpen(n, f) !== false) : [];
}

// ---------- what the manager reads ----------

/** "Ada", "Ada and Linus", "Ada, Linus and Grace". */
export function nameList(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}

/** What happened to it, e.g. "issue #192 was closed", "PR #198 on acme/app was merged". */
export function closedWhy(c: Closure, repo?: string): string {
  const what = `${c.kind === 'issue' ? 'issue' : 'PR'} #${c.number}${repo ? ` on ${repo}` : ''}`;
  if (c.kind === 'pr') return `${what} was ${c.merged ? 'merged' : 'closed'}`;
  return `${what} was closed${c.mergedBy.length ? ` by PR #${c.mergedBy[0].number}` : ''}`;
}

/** The one phone message naming who a closure stopped, e.g. "🛑 Stopped Barbara: issue #192 on acme/app was closed." */
export function stoppedMessage(names: readonly string[], c: Closure, repo: string): string {
  return `🛑 Stopped ${nameList(names)}: ${closedWhy(c, repo)}.`;
}
