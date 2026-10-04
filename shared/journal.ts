// The office journal (docs/how-it-works.md, "Time-lapse"): what the server records of the office's day so the client
// can replay it. Pure, so the server (recording, reading, pruning) and the client (replay) share one set of rules:
// which events are kept and how they're slimmed and scrubbed of secrets, keyframes and seeking, retention, and the
// marks on the replay's timeline. Terminal output, settings and anything secret are never kept.
import type { CareerView } from './careers.ts';
import { INSTALL_STEP, type AgentView, type CeoInfo, type HireRequestView, type IssueInfo, type OpsView, type PhoneMessage, type PreviewView, type PullInfo, type QaView, type RepoView, type ServerEvent, type TickerItem, type UsageView, type WorldSnapshot } from './types.ts';

/** A keyframe (a full picture of the office) starts every journal file; a new file starts this often. */
export const KEYFRAME_MS = 10 * 60_000;
/** Days kept, and the most the journal may take on disk; the oldest files go first. */
export const KEEP_DAYS = 7;
export const MAX_BYTES = 200 * 1024 * 1024;
/** The longest stretch one GET /api/journal/events returns. */
export const MAX_RANGE_MS = 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type JournalAgent = Omit<AgentView, 'log'>;

/** A keyframe: everything a replay draws, at one moment. */
export interface JournalFrame {
  repos: RepoView[];
  agents: JournalAgent[];
  qa: QaView[];
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  usage: UsageView;
  /** Mission control's screens (absent in the demo's sample day). */
  ops?: OpsView;
  /** The floors' latest ticker lines (absent in journals from before the ticker). */
  ticker?: TickerItem[];
}

/** The events the journal keeps: the ones that change how the office looks. */
export type JournalEvent = Extract<ServerEvent, { type: 'repo' | 'repoRemoved' | 'agent' | 'agentRemoved' | 'qa' | 'qaRemoved' | 'request' | 'ceo' | 'message' | 'usage' | 'ops' | 'ticker' }>;

/** An agent's update after their first: only the fields that changed (mostly just the tool in hand). */
export interface AgentPatch {
  type: 'agentPatch';
  id: string;
  set: Partial<JournalAgent>;
}

/**
 * A floor's update after its first: the top-level fields that changed, and the issues and PRs that changed when the
 * lists kept their order (a list that gained, lost or reordered entries is in `set` whole).
 */
export interface RepoPatch {
  type: 'repoPatch';
  id: string;
  set: Partial<RepoView>;
  issues?: IssueInfo[];
  pulls?: PullInfo[];
}

/** What an event line holds: an event as journalEvent slims it, or an agent's or a floor's changes. */
export type RecordedEvent = JournalEvent | AgentPatch | RepoPatch;

/** One line of a journal file: a keyframe (`boot` on the first one after the office started) or an event. */
export type JournalLine = { t: number; k: JournalFrame; boot?: true } | { t: number; e: RecordedEvent };

export const isFrame = (l: JournalLine): l is Extract<JournalLine, { k: JournalFrame }> => 'k' in l;

/** On the replay's timeline: a merge (🎉), a PR that needs the manager (🔴), a new issue. */
export type MarkKind = 'merge' | 'needs-human' | 'issue';

export interface JournalMark {
  t: number;
  kind: MarkKind;
  repoId: string;
  n: number;
  label: string;
}

/** GET /api/journal/days: one recorded day (local time on the office's machine). */
export interface JournalDayView {
  day: string; // YYYY-MM-DD
  from: number;
  to: number;
  bytes: number;
  marks: JournalMark[];
}

/**
 * GET /api/journal/events: the lines between two times. With seek they start at the nearest keyframe at or before
 * `from`; `next` is when the journal carries on after `to` (null when nothing was recorded after it yet).
 */
export interface JournalChunk {
  lines: JournalLine[];
  next: number | null;
}

// ---------- secrets ----------

const REDACTED = '[redacted]';

// Shapes of keys and tokens, and assignments to names that say they hold one. Long opaque tokens (mixed case and
// digits, 32+ characters) go too; commit hashes and branch names don't look like that.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bsk_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${REDACTED}`],
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/g, `$1$2${REDACTED}`],
  [/\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, `$1$2${REDACTED}`],
  [/\b(?=[\w-]*\d)(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{32,}/g, REDACTED],
];

/** `text` with known secret values and anything shaped like a key or token replaced by "[redacted]". */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6 && out.includes(s)) out = out.split(s).join(REDACTED);
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to);
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Scrubbed before it's cut, so a cut never leaves half a secret behind; only the start is scrubbed, to bound the work.
const text = (s: string | null | undefined, n: number, secrets: readonly string[]) => clip(redact((s ?? '').slice(0, n + 256), secrets), n);
const textOrNull = (s: string | null | undefined, n: number, secrets: readonly string[]) => (s ? text(s, n, secrets) : null);

// ---------- slimming ----------

/** Only the "Depends on #N" statements of an issue body: the whiteboard's ⏳ notes need nothing else. */
export function dependencyText(body: string): string {
  const out: string[] = [];
  for (const m of (body ?? '').matchAll(/\b(?:depends\s+on|blocked\s+by)\s*:?\s*((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    out.push(`Depends on ${[...m[1].matchAll(/#\d+/g)].map((x) => x[0]).join(', ')}`);
  }
  return out.join('\n');
}

const compactIssue = (i: IssueInfo, secrets: readonly string[]): IssueInfo => ({
  number: i.number,
  title: text(i.title, 140, secrets),
  body: dependencyText(i.body),
  url: i.url,
  labels: i.labels.slice(0, 8).map((l) => clip(l, 40)),
  createdAt: i.createdAt,
});

// Fields that change on every push, check run or sync without changing the office's look (the head sha, which checks
// are still pending, GitHub's UNKNOWN while it works out mergeability) are left out, so a sync with nothing new
// records nothing. Only a conflict shows on the board.
const compactPull = (p: PullInfo, secrets: readonly string[]): PullInfo => ({
  number: p.number,
  title: text(p.title, 140, secrets),
  url: p.url,
  headRefName: clip(p.headRefName, 100),
  state: p.state,
  isDraft: p.isDraft,
  mergeable: p.mergeable === 'CONFLICTING' ? 'CONFLICTING' : 'MERGEABLE',
  reviewDecision: null,
  closesIssues: p.closesIssues.slice(0, 10),
  createdAt: p.createdAt,
  mergedAt: p.mergedAt,
  additions: p.additions,
  deletions: p.deletions,
  checks: p.checks,
  headSha: '',
  mergeState: '',
  failedChecks: p.failedChecks.slice(0, 6).map((c) => ({ name: text(c.name, 60, secrets), url: null })),
  pendingChecks: [],
  ...(p.issueCreatedAt !== undefined && { issueCreatedAt: p.issueCreatedAt }),
});

const compactPreview = (p: PreviewView): PreviewView => ({
  status: p.status,
  port: p.port,
  url: p.url,
  ref: p.ref,
  pr: p.pr,
  commit: p.commit,
  startedAt: p.startedAt,
  error: null,
  logTail: [],
});

/** A floor as the journal keeps it: no preview env or logs, no briefs, no paths, issue bodies cut to their dependencies. */
export function compactRepo(r: RepoView, secrets: readonly string[] = []): RepoView {
  return {
    id: r.id,
    fullName: r.fullName,
    description: text(r.description, 140, secrets),
    url: r.url,
    defaultBranch: r.defaultBranch,
    floor: r.floor,
    color: r.color,
    autoAssign: r.autoAssign,
    autoMerge: r.autoMerge,
    folderSync: null,
    browserTesting: r.browserTesting,
    links: r.links,
    mission: '',
    summary: text(r.summary, 140, secrets),
    qaBrief: '',
    localPath: null,
    checkoutPath: '',
    cloneStatus: r.cloneStatus,
    issues: r.issues.slice(0, 300).map((i) => compactIssue(i, secrets)),
    pulls: r.pulls.slice(0, 100).map((p) => compactPull(p, secrets)),
    held: (r.held ?? []).slice(0, 100).map((h) => ({ issue: h.issue, pr: h.pr })),
    lastSync: null,
    previewConfig: { command: null, env: {} },
    preview: compactPreview(r.preview),
  };
}

/** Someone's record on the team (their desk tells it): the numbers, and their latest merges' titles scrubbed. */
const compactCareer = (c: CareerView, secrets: readonly string[]): CareerView => ({
  ...c,
  costUsd: Math.round(c.costUsd * 100) / 100,
  recent: c.recent.slice(0, 8).map((r) => ({ n: r.n, title: text(r.title, 100, secrets), at: r.at })),
});

/** An agent as the journal keeps it: what they're on and the tool in hand, never their errors, screens or brief. */
export function compactAgent(a: JournalAgent, secrets: readonly string[] = []): JournalAgent {
  return {
    id: a.id,
    name: text(a.name, 40, secrets),
    repoId: a.repoId,
    role: a.role,
    title: text(a.title, 80, secrets),
    specialty: text(a.specialty, 40, secrets),
    brief: '',
    hiredBy: a.hiredBy,
    look: a.look,
    task: a.task,
    desk: a.desk,
    color: a.color,
    hair: a.hair,
    skin: a.skin,
    style: a.style ? { ...a.style } : null,
    model: clip(a.model, 60),
    effort: a.effort,
    cli: a.cli,
    terminal: a.terminal,
    status: a.status,
    issueNumber: a.issueNumber,
    issueTitle: textOrNull(a.issueTitle, 140, secrets),
    branch: textOrNull(a.branch, 100, secrets),
    prNumber: a.prNumber,
    prUrl: a.prUrl,
    // A tool's name ("Bash", "Edit"), never what it ran.
    currentTool: a.currentTool === INSTALL_STEP ? a.currentTool : (a.currentTool?.match(/^[\w:.-]+/)?.[0].slice(0, 60) ?? null),
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    costUsd: Math.round(a.costUsd * 100) / 100,
    turns: a.turns,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
    career: a.career ? compactCareer(a.career, secrets) : null,
    // The sign over them: the kind of work, without its detail (a file, a command).
    ...(a.activity !== undefined && { activity: a.activity && { kind: a.activity.kind, detail: '' } }),
  };
}

/** A QA record's state: its verdict's text and check details stay out. */
export function compactQa(q: QaView, secrets: readonly string[] = []): QaView {
  return {
    repoId: q.repoId,
    prNumber: q.prNumber,
    status: q.status,
    round: q.round,
    devAgentId: q.devAgentId,
    qaAgentId: q.qaAgentId,
    summary: null,
    checks: q.checks.slice(0, 12).map((c) => ({ name: text(c.name, 60, secrets), result: c.result, details: '' })),
    commentUrl: q.commentUrl,
    mergeNote: textOrNull(q.mergeNote, 120, secrets),
    ceoLooking: q.ceoLooking,
    updatedAt: q.updatedAt,
  };
}

function compactRequest(r: HireRequestView, secrets: readonly string[]): HireRequestView {
  return {
    id: r.id,
    kind: r.kind,
    repoId: r.repoId,
    role: r.role,
    agentId: r.agentId,
    name: text(r.name, 40, secrets),
    title: text(r.title, 80, secrets),
    specialty: text(r.specialty, 40, secrets),
    brief: '',
    reason: text(r.reason, 240, secrets),
    model: clip(r.model, 60),
    effort: r.effort,
    look: r.look,
    color: r.color,
    hair: r.hair,
    skin: r.skin,
    status: r.status,
    note: text(r.note, 160, secrets),
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
  };
}

/** A phone message: its text only (no voice), scrubbed and cut short. */
export function compactMessage(m: PhoneMessage, secrets: readonly string[] = []): PhoneMessage {
  const out: PhoneMessage = { id: m.id, from: m.from, text: text(m.text, 600, secrets), at: m.at };
  if (m.requestId) out.requestId = m.requestId;
  return out;
}

const compactCeo = (c: CeoInfo, secrets: readonly string[]): CeoInfo => ({
  queue: c.queue.slice(0, 12).map((j) => ({ kind: j.kind, label: text(j.label, 80, secrets) })),
  job: c.job ? { kind: c.job.kind, label: text(c.job.label, 80, secrets) } : null,
  lastReviewAt: c.lastReviewAt,
  nextReviewAt: c.nextReviewAt,
});

const compactUsage = (u: UsageView): UsageView => ({
  state: u.state,
  until: u.until,
  warning: u.warning ? { limit: u.warning.limit && clip(u.warning.limit, 60), pct: u.warning.pct, resetsAt: u.warning.resetsAt, at: u.warning.at } : null,
});

/** Mission control's numbers; an alarm about someone's error says who, never the error. */
function compactOps(o: OpsView, secrets: readonly string[]): OpsView {
  return { ...o, alarms: o.alarms.slice(0, 50).map((a) => ({ ...a, text: a.kind === 'agent' ? clip(a.text.split(':')[0], 80) : text(a.text, 160, secrets) })) };
}

/** A floor ticker line, without QA's screenshots. */
const compactTicker = (t: TickerItem, secrets: readonly string[]): TickerItem => ({ id: t.id, repoId: t.repoId, at: t.at, text: text(t.text, 140, secrets), tone: t.tone });

/** The ticker lines a keyframe keeps. */
const FRAME_TICKER = 30;

/** The event as the journal keeps it, or null for one it never records (terminal output, screens, settings, keys, toasts…). */
export function journalEvent(ev: ServerEvent, secrets: readonly string[] = []): JournalEvent | null {
  switch (ev.type) {
    case 'repo':
      return { type: 'repo', repo: compactRepo(ev.repo, secrets) };
    case 'repoRemoved':
      return { type: 'repoRemoved', repoId: ev.repoId };
    case 'agent':
      return { type: 'agent', agent: compactAgent(ev.agent, secrets) };
    case 'agentRemoved':
      return { type: 'agentRemoved', agentId: ev.agentId };
    case 'qa':
      return { type: 'qa', qa: compactQa(ev.qa, secrets) };
    case 'qaRemoved':
      return { type: 'qaRemoved', repoId: ev.repoId, prNumber: ev.prNumber };
    case 'request':
      return { type: 'request', request: compactRequest(ev.request, secrets) };
    case 'ceo':
      return { type: 'ceo', ceo: compactCeo(ev.ceo, secrets) };
    case 'message':
      return { type: 'message', message: compactMessage(ev.message, secrets) };
    case 'usage':
      return { type: 'usage', usage: compactUsage(ev.usage) };
    case 'ops':
      return { type: 'ops', ops: compactOps(ev.ops, secrets) };
    case 'ticker':
      return { type: 'ticker', item: compactTicker(ev.item, secrets) };
    default:
      return null;
  }
}

/** The proposals a keyframe keeps: every pending one and the latest decided. */
const KEEP_REQUESTS = 20;
/** The phone messages a keyframe keeps. */
export const FRAME_MESSAGES = 20;

/** A keyframe from the office's snapshot, slimmed and scrubbed like the events. */
export function journalFrame(s: Pick<WorldSnapshot, 'repos' | 'agents' | 'qa' | 'requests' | 'ceo' | 'messages' | 'usage'> & { ops?: OpsView; ticker?: TickerItem[] }, secrets: readonly string[] = []): JournalFrame {
  const decided = s.requests.filter((r) => r.status !== 'pending').slice(-KEEP_REQUESTS);
  return {
    repos: s.repos.map((r) => compactRepo(r, secrets)),
    agents: s.agents.map(({ log: _log, ...a }) => compactAgent(a, secrets)),
    qa: s.qa.map((q) => compactQa(q, secrets)),
    requests: s.requests.filter((r) => r.status === 'pending' || decided.includes(r)).map((r) => compactRequest(r, secrets)),
    ceo: compactCeo(s.ceo, secrets),
    messages: s.messages.slice(-FRAME_MESSAGES).map((m) => compactMessage(m, secrets)),
    usage: compactUsage(s.usage),
    ...(s.ops && { ops: compactOps(s.ops, secrets) }),
    ...(s.ticker && { ticker: s.ticker.slice(-FRAME_TICKER).map((t) => compactTicker(t, secrets)) }),
  };
}

// ---------- recording only what changed ----------

/** What a journaled event is about, so an unchanged repeat (a sync with nothing new) is skipped; null: always record. */
export function dedupeKey(e: JournalEvent): string | null {
  switch (e.type) {
    case 'repo':
      return `repo:${e.repo.id}`;
    case 'repoRemoved':
      return `repo:${e.repoId}`;
    case 'agent':
      return `agent:${e.agent.id}`;
    case 'agentRemoved':
      return `agent:${e.agentId}`;
    case 'qa':
      return `qa:${e.qa.repoId}#${e.qa.prNumber}`;
    case 'qaRemoved':
      return `qa:${e.repoId}#${e.prNumber}`;
    case 'request':
      return `request:${e.request.id}`;
    case 'ceo':
      return 'ceo';
    case 'usage':
      return 'usage';
    case 'ops':
      return 'ops';
    case 'message':
    case 'ticker':
      return null;
  }
}

/** The dedupe keys and their recorded form for everything in a keyframe: what the events after it are compared with. */
export function frameKeys(f: JournalFrame): Map<string, string> {
  const out = new Map<string, string>();
  const put = (e: JournalEvent) => out.set(dedupeKey(e)!, JSON.stringify(e));
  for (const repo of f.repos) put({ type: 'repo', repo });
  for (const agent of f.agents) put({ type: 'agent', agent });
  for (const qa of f.qa) put({ type: 'qa', qa });
  for (const request of f.requests) put({ type: 'request', request });
  put({ type: 'ceo', ceo: f.ceo });
  put({ type: 'usage', usage: f.usage });
  if (f.ops) put({ type: 'ops', ops: f.ops });
  return out;
}

const REMOVALS = new Set<JournalEvent['type']>(['repoRemoved', 'agentRemoved', 'qaRemoved']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields of `now` that differ from `was`, skipping `except`. */
function changedFields<T extends object>(was: T, now: T, except: string[] = []): Partial<T> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(now)) if (!except.includes(k) && !same(v, (was as Record<string, unknown>)[k])) set[k] = v;
  return set as Partial<T>;
}

/** A list's change: the whole new list when its entries or their order changed, else just the entries that changed. */
function listChange<T extends { number: number }>(was: T[], now: T[]): { whole?: T[]; changed?: T[] } {
  if (was.length !== now.length || was.some((x, i) => x.number !== now[i].number)) return { whole: now };
  const changed = now.filter((x, i) => !same(x, was[i]));
  return changed.length ? { changed } : {};
}

/** A floor's update as a patch on how it was. */
export function repoPatch(was: RepoView, now: RepoView): RepoPatch {
  const out: RepoPatch = { type: 'repoPatch', id: now.id, set: changedFields(was, now, ['issues', 'pulls']) };
  const issues = listChange(was.issues, now.issues);
  const pulls = listChange(was.pulls, now.pulls);
  if (issues.whole) out.set.issues = issues.whole;
  if (issues.changed) out.issues = issues.changed;
  if (pulls.whole) out.set.pulls = pulls.whole;
  if (pulls.changed) out.pulls = pulls.changed;
  return out;
}

/** The floor after a patch. */
export function applyRepoPatch(prev: RepoView, p: RepoPatch): RepoView {
  const next = { ...prev, ...p.set };
  const swap = <T extends { number: number }>(list: T[], changed?: T[]) => (changed ? list.map((x) => changed.find((c) => c.number === x.number) ?? x) : list);
  return { ...next, issues: swap(next.issues, p.issues), pulls: swap(next.pulls, p.pulls) };
}

/**
 * What to write for `e`, given what was last recorded (`last`, updated in place): nothing for an update identical to
 * the last one or the removal of something the journal never had, a patch for a known agent or floor, else `e`.
 */
export function recorded(last: Map<string, string>, e: JournalEvent): RecordedEvent | null {
  const key = dedupeKey(e);
  if (!key) return e;
  if (REMOVALS.has(e.type)) return last.delete(key) ? e : null;
  const json = JSON.stringify(e);
  const prev = last.get(key);
  if (prev === json) return null;
  last.set(key, json);
  if (!prev) return e;
  if (e.type === 'agent') return { type: 'agentPatch', id: e.agent.id, set: changedFields((JSON.parse(prev) as { agent: JournalAgent }).agent, e.agent) };
  if (e.type === 'repo') return repoPatch((JSON.parse(prev) as { repo: RepoView }).repo, e.repo);
  return e;
}

/** A patch passed on as it is: what was last recorded follows it. */
function remember(last: Map<string, string>, e: AgentPatch | RepoPatch) {
  const key = `${e.type === 'agentPatch' ? 'agent' : 'repo'}:${e.id}`;
  const prev = last.get(key);
  if (!prev) return;
  if (e.type === 'agentPatch') last.set(key, JSON.stringify({ type: 'agent', agent: { ...(JSON.parse(prev) as { agent: JournalAgent }).agent, ...e.set } }));
  else last.set(key, JSON.stringify({ type: 'repo', repo: applyRepoPatch((JSON.parse(prev) as { repo: RepoView }).repo, e) }));
}

/** Lines as the journal writes them: unchanged repeats dropped, agents' and floors' updates cut to their changes. */
export function compress(lines: readonly JournalLine[]): JournalLine[] {
  let last = new Map<string, string>();
  const out: JournalLine[] = [];
  for (const l of lines) {
    if (isFrame(l)) {
      last = frameKeys(l.k);
      out.push(l);
      continue;
    }
    if (l.e.type === 'agentPatch' || l.e.type === 'repoPatch') {
      remember(last, l.e);
      out.push(l);
      continue;
    }
    const e = recorded(last, l.e);
    if (e) out.push({ t: l.t, e });
  }
  return out;
}

// ---------- reading ----------

/** The lines of a journal file; a line cut short by a crash (or anything else unreadable) is skipped. */
export function parseLines(raw: string): JournalLine[] {
  const out: JournalLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as JournalLine;
      if (l && typeof l.t === 'number' && ('k' in l || 'e' in l)) out.push(l);
    } catch {
      // torn or damaged: the rest of the file still reads
    }
  }
  return out;
}

/** Index of the last start at or before `t` in ascending `starts`; 0 when they all come after it, -1 when empty. */
export function keyframeIndex(starts: readonly number[], t: number): number {
  if (!starts.length) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  if (starts[0] > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The lines of consecutive files (each starting with its keyframe) for [from, to): with `seek`, from the keyframe of
 * the file `from` falls in; otherwise only lines at or after `from`. `next` is the first time at or after `to`.
 */
export function selectLines(files: readonly JournalLine[][], from: number, to: number, seek: boolean): JournalChunk {
  const starts = files.map((f) => f[0]?.t ?? Infinity);
  const first = keyframeIndex(starts, from);
  const lines: JournalLine[] = [];
  if (first < 0) return { lines, next: null };
  for (let i = first; i < files.length; i++) {
    for (const l of files[i]) {
      if (l.t >= to) return { lines, next: l.t };
      if (seek || l.t >= from) lines.push(l);
    }
  }
  return { lines, next: null };
}

// ---------- the timeline's marks ----------

/**
 * Merges, PRs newly needing the manager and new issues in one journal file (it starts with a keyframe, so it needs
 * nothing before it). A PR counts as merged when it goes from open to merged, as the client's gong does.
 */
export function marksOf(lines: readonly JournalLine[]): JournalMark[] {
  const repos = new Map<string, RepoView>();
  const qa = new Map<string, boolean>();
  const marks: JournalMark[] = [];
  const needsYou = (q: QaView) => q.status === 'needs-human' && !q.ceoLooking;
  const update = (t: number, next: RepoView) => {
    const before = repos.get(next.id);
    repos.set(next.id, next);
    if (!before) return; // a new floor: its backlog isn't news
    const was = new Map(before.pulls.map((p) => [p.number, p.state]));
    for (const p of next.pulls) if (p.state === 'MERGED' && was.get(p.number) === 'OPEN') marks.push({ t, kind: 'merge', repoId: next.id, n: p.number, label: `#${p.number} ${p.title}` });
    const known = new Set(before.issues.map((i) => i.number));
    for (const i of next.issues) if (!known.has(i.number)) marks.push({ t, kind: 'issue', repoId: next.id, n: i.number, label: `#${i.number} ${i.title}` });
  };
  for (const l of lines) {
    if (isFrame(l)) {
      repos.clear();
      qa.clear();
      for (const r of l.k.repos) repos.set(r.id, r);
      for (const q of l.k.qa) qa.set(`${q.repoId}#${q.prNumber}`, needsYou(q));
      continue;
    }
    const e = l.e;
    if (e.type === 'repo') update(l.t, e.repo);
    else if (e.type === 'repoPatch') {
      const prev = repos.get(e.id);
      if (prev) update(l.t, applyRepoPatch(prev, e));
    } else if (e.type === 'qa') {
      const key = `${e.qa.repoId}#${e.qa.prNumber}`;
      const now = needsYou(e.qa);
      if (now && !qa.get(key)) marks.push({ t: l.t, kind: 'needs-human', repoId: e.qa.repoId, n: e.qa.prNumber, label: `#${e.qa.prNumber} needs you` });
      qa.set(key, now);
    } else if (e.type === 'qaRemoved') qa.delete(`${e.repoId}#${e.prNumber}`);
    else if (e.type === 'repoRemoved') repos.delete(e.repoId);
  }
  return marks;
}

// ---------- days and retention ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of `ms` as YYYY-MM-DD: journal files are grouped by the office's own day. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of `day` (YYYY-MM-DD), or NaN for anything else. */
export function dayStart(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
}

/** A journal file on disk: the day it belongs to, when it starts (its keyframe) and its size. */
export interface SegmentFile {
  day: string;
  start: number;
  bytes: number;
}

/**
 * The journal files to delete: whole days older than `keepDays`, then the oldest files until the rest fit in
 * `maxBytes`. The file being written (`keep`, its start) always stays.
 */
export function toPrune<T extends SegmentFile>(files: readonly T[], now: number, { keepDays = KEEP_DAYS, maxBytes = MAX_BYTES, keep }: { keepDays?: number; maxBytes?: number; keep?: number } = {}): T[] {
  const oldest = dayKey(now - keepDays * DAY_MS);
  const out: T[] = [];
  const left: T[] = [];
  for (const f of [...files].sort((a, b) => a.start - b.start)) {
    if (f.start !== keep && f.day < oldest) out.push(f);
    else left.push(f);
  }
  let total = left.reduce((n, f) => n + f.bytes, 0);
  for (const f of left) {
    if (total <= maxBytes) break;
    if (f.start === keep) continue;
    out.push(f);
    total -= f.bytes;
  }
  return out;
}
