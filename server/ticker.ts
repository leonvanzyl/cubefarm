// The floors' activity tickers: one short line per thing that happened on a floor ("Ken opened PR #212", "CI red on
// #198", "#204 merged 🎉"), worked out by comparing each agent, QA and repo update the office broadcasts with the one
// before it. Kept in memory, the last few per floor: a restart starts a fresh tape.

import { clipText, redact } from '../shared/activity.ts';
import type { AgentView, PullInfo, QaStatus, QaView, RepoView, ServerEvent, TickerItem } from '../shared/types.ts';

/** A ticker line before it's numbered and timed. `key` marks news told once (a PR opening, seen two ways). */
export interface Tick {
  repoId: string;
  text: string;
  tone: TickerItem['tone'];
  key?: string;
}

export type AgentFacts = Pick<AgentView, 'name' | 'repoId' | 'role' | 'status' | 'task' | 'issueNumber' | 'prNumber'>;

export interface RepoFacts {
  pulls: Map<number, Pick<PullInfo, 'state' | 'checks'>>;
  issues: Set<number>;
}

/** Lines kept per floor. */
export const TICKER_KEEP = 20;
const MERGED_NEWS_MS = 10 * 60_000; // a merge first seen this long after it happened is old news
const MAX_NEW_ISSUES = 3; // a batch of filed issues: this many lines, then "+n more"
const OPEN_PULLS_LISTED = 50; // github.ts's --limit for open PRs
const OPEN_ISSUES_LISTED = 100; // and for open issues

const busy = (s: AgentView['status']) => s === 'working' || s === 'preparing';
const opened = (repoId: string, pr: number) => `opened:${repoId}#${pr}`;

/** What changed about a developer that's worth a line. With no `prev` (first seen), only the work they're on. */
export function agentTicks(prev: AgentFacts | undefined, next: AgentFacts): Tick[] {
  if (next.role === 'ceo' || !next.repoId) return [];
  const out: Tick[] = [];
  const say = (text: string, tone: Tick['tone'] = 'info', key?: string) => out.push({ repoId: next.repoId, text, tone, key });
  const was = prev && busy(prev.status) ? prev : null;
  if (busy(next.status) && next.task === 'issue' && next.issueNumber != null && (was?.task !== 'issue' || was.issueNumber !== next.issueNumber)) {
    say(`${next.name} picked up #${next.issueNumber}`);
  }
  if (busy(next.status) && next.task === 'fix' && next.prNumber != null && (was?.task !== 'fix' || was.prNumber !== next.prNumber)) {
    say(`${next.name} is fixing PR #${next.prNumber}`);
  }
  if (prev && next.task === 'issue' && next.prNumber != null && prev.prNumber !== next.prNumber) {
    say(`${next.name} opened PR #${next.prNumber}`, 'good', opened(next.repoId, next.prNumber));
  }
  if (prev && next.status === 'error' && prev.status !== 'error') {
    say(`${next.name} hit a snag${next.task === 'issue' && next.issueNumber ? ` on #${next.issueNumber}` : next.prNumber ? ` on PR #${next.prNumber}` : ''}`, 'bad');
  }
  return out;
}

/** A QA record moving on: queued, being tested, passed, failed, or stuck and waiting for the manager. */
export function qaTicks(prev: QaStatus | undefined, next: QaView, nameOf: (agentId: string | null) => string | null): Tick[] {
  if (prev === next.status) return [];
  const pr = `PR #${next.prNumber}`;
  const who = nameOf(next.qaAgentId) ?? 'QA';
  const tick = (text: string, tone: Tick['tone'] = 'info'): Tick[] => [{ repoId: next.repoId, text, tone }];
  switch (next.status) {
    case 'queued':
      return tick(`${pr} is queued for QA${next.round > 1 ? ` (round ${next.round})` : ''}`);
    case 'testing':
      return tick(`${who} is testing ${pr}`);
    // A tester's verdict, or the office's own call after it (a conflict at merge sends a passed PR back).
    case 'passed':
      return tick(prev === 'testing' ? `${who} passed ${pr} ✅` : `${pr} passed QA ✅`, 'good');
    case 'failed':
      return tick(prev === 'testing' ? `${who} failed ${pr} · round ${next.round}` : `${pr} was sent back`, 'bad');
    case 'needs-human':
      return tick(`${pr} needs you 🙋`, 'bad');
    default:
      return []; // fixing: the developer's own line says so
  }
}

export function repoFacts(repo: RepoView): RepoFacts {
  return { pulls: new Map(repo.pulls.map((p) => [p.number, { state: p.state, checks: p.checks }])), issues: new Set(repo.issues.map((i) => i.number)) };
}

/** PRs opened, merged or closed, CI turning red or green, and issues filed or closed, since the floor's last sync. */
export function repoTicks(prev: RepoFacts, next: RepoView, authorOf: (pr: number) => string | null, now = Date.now()): Tick[] {
  const out: Tick[] = [];
  const say = (text: string, tone: Tick['tone'] = 'info', key?: string) => out.push({ repoId: next.id, text, tone, key });
  for (const p of next.pulls) {
    const before = prev.pulls.get(p.number);
    if (!before) {
      const author = authorOf(p.number);
      if (p.state === 'OPEN') say(author ? `${author} opened PR #${p.number}` : `PR #${p.number} opened`, 'good', opened(next.id, p.number));
      else if (p.state === 'MERGED' && p.mergedAt && now - Date.parse(p.mergedAt) < MERGED_NEWS_MS) say(`#${p.number} merged 🎉`, 'good');
      continue;
    }
    if (before.state === 'OPEN' && p.state === 'MERGED') say(`#${p.number} merged 🎉`, 'good');
    else if (before.state === 'OPEN' && p.state === 'CLOSED') say(`PR #${p.number} closed`);
    if (p.state !== 'OPEN' || before.checks === p.checks) continue;
    if (p.checks === 'failing') say(`CI red on #${p.number}`, 'bad');
    else if (p.checks === 'passing' && (before.checks === 'pending' || before.checks === 'failing')) say(`CI green on #${p.number}`, 'good');
  }
  // Closed PRs and issues drop off GitHub's lists (github.ts lists open ones, and the last few merged PRs). A full list
  // may have pushed something off it instead, so only a shorter one counts.
  const listed = new Set(next.pulls.map((p) => p.number));
  if (next.pulls.filter((p) => p.state === 'OPEN').length < OPEN_PULLS_LISTED) {
    for (const [n, p] of prev.pulls) if (p.state === 'OPEN' && !listed.has(n)) say(`PR #${n} closed`);
  }
  const open = new Set(next.issues.map((i) => i.number));
  const mergedFor = new Set(next.pulls.filter((p) => p.state === 'MERGED').flatMap((p) => p.closesIssues));
  if (next.issues.length < OPEN_ISSUES_LISTED) {
    for (const n of prev.issues) if (!open.has(n) && !mergedFor.has(n)) say(`Issue #${n} closed`); // a merge already said so
  }
  const filed = next.issues.filter((i) => !prev.issues.has(i.number));
  for (const i of filed.slice(0, MAX_NEW_ISSUES)) say(`New issue #${i.number}: ${clipText(redact(i.title), 40)}`);
  if (filed.length > MAX_NEW_ISSUES) say(`+${filed.length - MAX_NEW_ISSUES} more new issues`);
  return out;
}

export interface TickerLookups {
  /** An agent's name, for QA lines. */
  name(agentId: string): string | null;
  /** Who in the office opened a PR, if anyone did. */
  author(repoId: string, pr: number): string | null;
}

/** Watches what the office broadcasts and keeps each floor's recent lines. */
export class Ticker {
  private items: TickerItem[] = [];
  private seq = 1;
  private agents = new Map<string, AgentFacts>();
  private qa = new Map<string, QaStatus>();
  private repos = new Map<string, RepoFacts>();
  private told = new Set<string>();

  constructor(private lookups: TickerLookups) {}

  /** The new lines this event makes (already kept), for the caller to broadcast. */
  observe(ev: ServerEvent, now = Date.now()): TickerItem[] {
    let ticks: Tick[] = [];
    switch (ev.type) {
      case 'agent': {
        const { name, repoId, role, status, task, issueNumber, prNumber } = ev.agent;
        const next: AgentFacts = { name, repoId, role, status, task, issueNumber, prNumber };
        ticks = agentTicks(this.agents.get(ev.agent.id), next);
        this.agents.set(ev.agent.id, next);
        break;
      }
      case 'agentRemoved':
        this.agents.delete(ev.agentId);
        break;
      case 'qa': {
        const key = `${ev.qa.repoId}#${ev.qa.prNumber}`;
        ticks = qaTicks(this.qa.get(key), ev.qa, (id) => (id ? this.lookups.name(id) : null));
        this.qa.set(key, ev.qa.status);
        break;
      }
      case 'qaRemoved':
        this.qa.delete(`${ev.repoId}#${ev.prNumber}`);
        break;
      case 'repo': {
        if (ev.repo.lastSync == null) break; // not synced yet: nothing to compare with
        const prev = this.repos.get(ev.repo.id);
        if (prev) ticks = repoTicks(prev, ev.repo, (pr) => this.lookups.author(ev.repo.id, pr), now);
        this.repos.set(ev.repo.id, repoFacts(ev.repo));
        break;
      }
      case 'repoRemoved':
        this.repos.delete(ev.repoId);
        this.items = this.items.filter((i) => i.repoId !== ev.repoId);
        break;
    }
    const added: TickerItem[] = [];
    for (const t of ticks) {
      if (t.key) {
        if (this.told.has(t.key)) continue;
        this.told.add(t.key);
        if (this.told.size > 500) this.told.delete(this.told.values().next().value!);
      }
      const item: TickerItem = { id: this.seq++, repoId: t.repoId, at: now, text: t.text, tone: t.tone };
      added.push(item);
      this.items.push(item);
    }
    if (added.length) this.trim(added[0].repoId);
    return added;
  }

  /** Every floor's kept lines, oldest first (for the snapshot). */
  recent(): TickerItem[] {
    return this.items.slice();
  }

  private trim(repoId: string) {
    const mine = this.items.filter((i) => i.repoId === repoId);
    if (mine.length <= TICKER_KEEP) return;
    const drop = new Set(mine.slice(0, mine.length - TICKER_KEEP));
    this.items = this.items.filter((i) => !drop.has(i));
  }
}
