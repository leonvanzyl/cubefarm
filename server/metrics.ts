import { prStage } from '../shared/ops.ts';
import type { AgentRole, AgentStatus, OpsAlarm, OpsFloor, OpsNumbers, OpsView, PullInfo, QaView } from '../shared/types.ts';

// Mission control's numbers (#216): pure functions over the office's state now, plus a compact rolling history of
// merges, QA verdicts, GitHub check runs and session costs. The history lives in the state file for a week; the
// swarm records into it as things happen and broadcasts the view whenever the numbers change.

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;
/** How long the history keeps anything. */
export const KEEP_MS = 7 * DAY_MS;
/** An agent in error longer than this raises an alarm. */
export const ALARM_ERROR_MS = 10 * 60_000;
const MAX_ENTRIES = 4000; // per list, however busy the week was

/** A merged PR: when, its floor's repo, its number (0: the demo's made-up past) and issue → merge time (null: unknown). */
export type MergeEntry = [at: number, repo: string, pr: number, leadMs: number | null];
/** A QA verdict: when, the repo, whether it passed, and how long the PR waited for an agent to test it (null: unknown). */
export type QaEntry = [at: number, repo: string, pass: boolean, waitMs: number | null];
/** GitHub's check runs on a commit, all finished: when, the repo, the commit (8 characters), passed, how long they took. */
export type CheckEntry = [at: number, repo: string, sha: string, pass: boolean, ms: number];
/** A finished session's reported cost: when, the repo ('' for the CEO), dollars. */
export type CostEntry = [at: number, repo: string, usd: number];

export interface OpsHistory {
  merges: MergeEntry[];
  qa: QaEntry[];
  checks: CheckEntry[];
  cost: CostEntry[];
}

export const emptyHistory = (): OpsHistory => ({ merges: [], qa: [], checks: [], cost: [] });

const fresh = <T extends [number, ...unknown[]]>(list: T[], now: number) =>
  list
    .filter((e) => now - e[0] <= KEEP_MS)
    .sort((a, b) => a[0] - b[0])
    .slice(-MAX_ENTRIES);

/** Drops what's older than a week (and anything over the cap), keeping each list oldest first. */
export function prune(h: OpsHistory, now: number) {
  h.merges = fresh(h.merges, now);
  h.qa = fresh(h.qa, now);
  h.checks = fresh(h.checks, now);
  h.cost = fresh(h.cost, now);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: unknown) => v === null || isNum(v);

/** The history from the state file: entries of the wrong shape are dropped, old ones pruned. */
export function loadHistory(raw: unknown, now: number): OpsHistory {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((e): e is unknown[] => Array.isArray(e) && isNum(e[0]) && typeof e[1] === 'string') : []);
  const h: OpsHistory = {
    merges: list(r.merges).filter((e) => isNum(e[2]) && orNull(e[3])) as MergeEntry[],
    qa: list(r.qa).filter((e) => typeof e[2] === 'boolean' && orNull(e[3])) as QaEntry[],
    checks: list(r.checks).filter((e) => typeof e[2] === 'string' && typeof e[3] === 'boolean' && isNum(e[4])) as CheckEntry[],
    cost: list(r.cost).filter((e) => isNum(e[2])) as CostEntry[],
  };
  prune(h, now);
  return h;
}

// ---------- recording ----------

/**
 * Merged PRs from a sync that the history doesn't have yet. Lead time runs from when the issue it closes was filed
 * (issueCreatedAt, as far as the office knows), else from the PR's opening. Returns how many were added.
 */
export function recordMerges(h: OpsHistory, repo: string, pulls: Pick<PullInfo, 'number' | 'state' | 'mergedAt' | 'createdAt' | 'issueCreatedAt'>[], now: number): number {
  let added = 0;
  for (const p of pulls) {
    const at = p.state === 'MERGED' && p.mergedAt ? Date.parse(p.mergedAt) : NaN;
    if (!Number.isFinite(at) || now - at > KEEP_MS) continue;
    if (h.merges.some((m) => m[1] === repo && m[2] === p.number)) continue;
    const filed = p.issueCreatedAt ? Date.parse(p.issueCreatedAt) : NaN;
    const start = Number.isFinite(filed) ? filed : Date.parse(p.createdAt);
    h.merges.push([at, repo, p.number, Number.isFinite(start) && start <= at ? at - start : null]);
    added++;
  }
  if (added) prune(h, now);
  return added;
}

/** Check runs that finished on a PR's head commit since the history last saw it (a re-run that flips the result counts again). */
export function recordChecks(h: OpsHistory, repo: string, pulls: Pick<PullInfo, 'checks' | 'headSha' | 'checkRun'>[], now: number): number {
  let added = 0;
  for (const p of pulls) {
    const run = p.checkRun;
    if (!run || !p.headSha || (p.checks !== 'passing' && p.checks !== 'failing') || now - run.doneAt > KEEP_MS) continue;
    const sha = p.headSha.slice(0, 8);
    const pass = p.checks === 'passing';
    if (h.checks.some((c) => c[1] === repo && c[2] === sha && c[3] === pass)) continue;
    h.checks.push([run.doneAt, repo, sha, pass, Math.max(0, run.ms)]);
    added++;
  }
  if (added) prune(h, now);
  return added;
}

export function recordQa(h: OpsHistory, repo: string, pass: boolean, waitMs: number | null, now: number) {
  h.qa.push([now, repo, pass, waitMs === null ? null : Math.max(0, waitMs)]);
  prune(h, now);
}

/** A session's reported cost (zero costs, from CLIs that don't report one, are left out). */
export function recordCost(h: OpsHistory, repo: string, usd: number, now: number) {
  if (!(usd > 0)) return;
  h.cost.push([now, repo, Math.round(usd * 10_000) / 10_000]);
  prune(h, now);
}

// ---------- the numbers ----------

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Local midnight before `now`. */
export function startOfDay(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** How many of `times` fell in each clock hour of the last `hours`, oldest first; the current hour is last. */
export function hourlyCounts(times: number[], now: number, hours = 24): number[] {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  const h0 = d.getTime();
  const out = new Array<number>(hours).fill(0);
  for (const t of times) {
    if (t > now) continue;
    const back = t >= h0 ? 0 : Math.floor((h0 - 1 - t) / HOUR_MS) + 1;
    if (back < hours) out[hours - 1 - back]++;
  }
  return out;
}

const share = (hits: number, n: number) => (n ? hits / n : null);

type Flow = Omit<OpsNumbers, 'ready' | 'building' | 'inQa' | 'fixing' | 'toMerge' | 'needsYou' | 'triage' | 'busy' | 'idle' | 'errors'>;

/** Throughput, flow, CI and cost for the repos `mine` accepts. */
function flow(h: OpsHistory, mine: (repo: string) => boolean, now: number): Flow {
  const today = startOfDay(now);
  const day = (e: [number, ...unknown[]]) => now - e[0] <= DAY_MS;
  const merges = h.merges.filter((m) => mine(m[1]));
  const qa = h.qa.filter((q) => mine(q[1]));
  const checks = h.checks.filter((c) => mine(c[1]));
  return {
    mergedToday: merges.filter((m) => m[0] >= today).length,
    mergedHour: merges.filter((m) => now - m[0] <= HOUR_MS).length,
    spark: hourlyCounts(merges.map((m) => m[0]), now),
    leadMs: median(merges.filter(day).flatMap((m) => (m[3] === null ? [] : [m[3]]))),
    qaWaitMs: median(qa.filter(day).flatMap((q) => (q[3] === null ? [] : [q[3]]))),
    qaPass: share(qa.filter((q) => q[2]).length, qa.length),
    ciPass: share(checks.filter((c) => c[3]).length, checks.length),
    ciRuns: checks.length,
    ciMs: median(checks.map((c) => c[4])),
    costToday: Math.round(h.cost.filter((c) => mine(c[1]) && c[0] >= today).reduce((s, c) => s + c[2], 0) * 100) / 100,
  };
}

/** A floor as mission control sees it: what can start, who's on it, and its open PRs with their QA records. */
export interface OpsFloorState {
  repoId: string;
  floor: number;
  ready: number; // backlog issues that can start now
  agents: { id: string; name: string; role: AgentRole; task: string | null; status: AgentStatus; endedAt: number | null; lastError: string | null }[];
  prs: { number: number; qa: Pick<QaView, 'status' | 'ceoLooking' | 'updatedAt'> | null; why: string | null }[]; // open PRs
}

const BUSY: AgentStatus[] = ['preparing', 'working'];

/** The pipeline and the team as they are now. */
function rightNow(f: OpsFloorState) {
  const stages = f.prs.map((p) => prStage(p.qa));
  const count = (s: string) => stages.filter((x) => x === s).length;
  const people = f.agents.filter((a) => a.role !== 'ceo');
  return {
    ready: f.ready,
    building: people.filter((a) => a.task === 'issue' && BUSY.includes(a.status)).length,
    inQa: count('inQa'),
    fixing: count('fixing'),
    toMerge: count('toMerge'),
    needsYou: count('needsYou'),
    triage: count('triage'),
    busy: people.filter((a) => BUSY.includes(a.status)).length,
    errors: people.filter((a) => a.status === 'error').length,
    idle: people.filter((a) => !BUSY.includes(a.status) && a.status !== 'error').length,
  };
}

const firstLine = (s: string, max = 120) => {
  const line = s.split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** What on this floor needs the manager: PRs that need you, and agents in error for over ALARM_ERROR_MS. */
export function floorAlarms(f: OpsFloorState, now: number): OpsAlarm[] {
  const base = { repoId: f.repoId, floor: f.floor };
  const prs: OpsAlarm[] = f.prs
    .filter((p) => prStage(p.qa) === 'needsYou')
    .map((p) => ({ ...base, id: `pr:${f.repoId}#${p.number}`, kind: 'pr', prNumber: p.number, agentId: null, text: `PR #${p.number} needs you${p.why ? `: ${firstLine(p.why)}` : ''}`, since: p.qa!.updatedAt }));
  const agents: OpsAlarm[] = f.agents
    .filter((a) => a.role !== 'ceo' && a.status === 'error' && a.endedAt !== null && now - a.endedAt >= ALARM_ERROR_MS)
    .map((a) => ({ ...base, id: `agent:${a.id}`, kind: 'agent', prNumber: null, agentId: a.id, text: `${a.name} is stuck on an error${a.lastError ? `: ${firstLine(a.lastError)}` : ''}`, since: a.endedAt! }));
  return [...prs, ...agents];
}

/** Mission control: every floor's numbers, the total (connected floors and the CEO) and the alarms, oldest first. */
export function opsView(floors: OpsFloorState[], h: OpsHistory, now: number): OpsView {
  const sorted = [...floors].sort((a, b) => a.floor - b.floor);
  const rows: OpsFloor[] = sorted.map((f) => ({ repoId: f.repoId, floor: f.floor, ...rightNow(f), ...flow(h, (r) => r === f.repoId, now), alarms: floorAlarms(f, now).length }));
  const connected = new Set(sorted.map((f) => f.repoId));
  const sum = (k: keyof ReturnType<typeof rightNow>) => rows.reduce((s, r) => s + r[k], 0);
  const total: OpsNumbers = {
    ready: sum('ready'),
    building: sum('building'),
    inQa: sum('inQa'),
    fixing: sum('fixing'),
    toMerge: sum('toMerge'),
    needsYou: sum('needsYou'),
    triage: sum('triage'),
    busy: sum('busy'),
    idle: sum('idle'),
    errors: sum('errors'),
    ...flow(h, (r) => connected.has(r) || r === '', now),
  };
  return {
    floors: rows,
    total,
    ceoCostToday: flow(h, (r) => r === '', now).costToday,
    alarms: sorted.flatMap((f) => floorAlarms(f, now)).sort((a, b) => a.since - b.since),
  };
}
