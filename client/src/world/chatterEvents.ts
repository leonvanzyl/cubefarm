// Who in the office has something to say, and what, worked out from how the office changed: a developer starting an
// issue or opening a PR, asking the tester to look at it, QA's verdict, a merge (and a teammate's "Nice one!"), a
// conflict, slow or red CI on someone's PR, an error; and from the new lines in someone's log, tests going green or
// red, a fix pushed, a merge conflict. Also what they'd say when you greet them. Pure, so every rule is tested;
// Chatter.tsx feeds it the store and speaks the lines.

import type { AgentView, LogLine, PullInfo, QaView, RepoView } from '../../../shared/types';
import type { Priority } from '../ui/babbleRules';
import { readLog, shortFile, workOf, type ChatterEvent, type WorkKind } from '../ui/chatterLines';

type Agent = Omit<AgentView, 'log'>;

/** A line someone should say, `delay` seconds from now. With `near`, the nearest other person on the floor says it. */
export interface Said {
  who: string;
  near?: boolean;
  event: ChatterEvent;
  delay: number;
  priority: Priority;
}

/** The parts of the store the news comes from. */
export interface OfficeSlice {
  agents: Record<string, Agent>;
  qa: Record<string, QaView>;
  repos: readonly RepoView[];
}

/** Seconds of pending checks before the PR's author grumbles about CI; the demo office runs on a much faster clock. */
export const CI_SLOW = 180;
export const DEMO_CI_SLOW = 20;
/** Log lines older than this (ms) are history, not news (a reconnect replays the whole log). */
export const LOG_FRESH_MS = 20_000;
/** A merge stays someone's news for a greeting this long (ms). */
export const SHIPPED_MS = 10 * 60_000;
/** The author speaks once the gong has rung, and a teammate after them (s). */
const MERGE_DELAY = 2.6;
const CONGRATS_DELAY = 4.4;
/** The tester answers the developer's request after this long (s). */
const REPLY_DELAY = 2.6;

const isBusy = (a: Agent | undefined) => a?.status === 'working' || a?.status === 'preparing';

/**
 * The developer who wrote a PR on a floor: by QA's record, else the one whose PR number or branch it is (not a
 * developer testing it, whose PR number is the one under test).
 */
export function authorOf(agents: Record<string, Agent>, repoId: string, pr: Pick<PullInfo, 'number' | 'headRefName'>, qa?: QaView): Agent | undefined {
  const byQa = qa?.devAgentId ? agents[qa.devAgentId] : undefined;
  if (byQa) return byQa;
  const devs = Object.values(agents).filter((a) => a.role === 'dev' && a.repoId === repoId && a.task !== 'qa');
  return devs.find((a) => a.prNumber === pr.number) ?? devs.find((a) => !!a.branch && a.branch === pr.headRefName);
}

const said = (who: string, event: ChatterEvent, delay = 0, priority: Priority = 'event', near?: boolean): Said => ({ who, event, delay, priority, ...(near ? { near } : {}) });

/** What changed between two states of the office, as lines to say. `lastFile` is the file someone last edited. */
export function storeNews(prev: OfficeSlice, next: OfficeSlice, lastFile: (id: string) => string | null = () => null): Said[] {
  const out: Said[] = [];
  for (const a of Object.values(next.agents)) {
    const p = prev.agents[a.id];
    if (!p) continue; // a new hire: their arrival is news of its own (the elevator, the welcome jingle)
    const started = !isBusy(p) && isBusy(a);
    if (started && a.role === 'dev' && a.task === 'issue' && a.issueNumber != null) out.push(said(a.id, { kind: 'start', issue: a.issueNumber }));
    if (started && a.role === 'dev' && a.task === 'fix' && a.prNumber != null) out.push(said(a.id, { kind: 'fixing', pr: a.prNumber }));
    // The office learns an issue's PR as the session ends (from its last words, or the branch): that's when it's up for QA.
    if (a.role === 'dev' && a.task === 'issue' && a.prNumber != null && p.prNumber !== a.prNumber) out.push(said(a.id, { kind: 'prOpened', pr: a.prNumber }));
    if (p.status !== 'error' && a.status === 'error') out.push(said(a.id, { kind: 'error' }));
  }

  for (const r of next.repos) {
    const before = prev.repos.find((x) => x.id === r.id);
    if (!before) continue;
    for (const q of r.pulls) {
      const old = before.pulls.find((x) => x.number === q.number);
      const author = authorOf(next.agents, r.id, q, next.qa[`${r.id}#${q.number}`]);
      if (!author || !old) continue;
      if (old.state === 'OPEN' && q.state === 'MERGED') {
        out.push(said(author.id, { kind: 'merged', pr: q.number }, MERGE_DELAY));
        out.push(said(author.id, { kind: 'congrats', to: author.name, pr: q.number }, CONGRATS_DELAY, 'event', true));
      }
      if (q.state !== 'OPEN') continue;
      if (old.mergeable !== 'CONFLICTING' && q.mergeable === 'CONFLICTING') out.push(said(author.id, { kind: 'conflict', pr: q.number, file: lastFile(author.id) }));
      if (old.checks !== 'failing' && q.checks === 'failing') out.push(said(author.id, { kind: 'ciRed', pr: q.number }));
    }
  }

  for (const [key, q] of Object.entries(next.qa)) {
    const was = prev.qa[key]?.status;
    const tester = q.qaAgentId ? next.agents[q.qaAgentId] : undefined;
    if (!tester) continue;
    const dev = q.devAgentId ? next.agents[q.devAgentId] : undefined;
    if (q.status === 'testing' && was !== 'testing') {
      if (dev && dev.repoId === q.repoId) {
        out.push(said(dev.id, { kind: 'askQa', pr: q.prNumber, tester: tester.name }));
        out.push(said(tester.id, { kind: 'qaStart', pr: q.prNumber }, REPLY_DELAY));
      } else out.push(said(tester.id, { kind: 'qaStart', pr: q.prNumber }));
    }
    if (was === 'testing' && q.status === 'passed') out.push(said(tester.id, { kind: 'qaPassed', pr: q.prNumber }));
    if (was === 'testing' && (q.status === 'failed' || q.status === 'needs-human')) out.push(said(tester.id, { kind: 'qaFailed', pr: q.prNumber }));
  }
  return out;
}

/**
 * Open PRs whose checks have been pending for `slow` seconds: their author grumbles, once per wait. `since` (when
 * each PR's checks started pending, epoch ms) and `done` (whose grumble is said) are kept between calls.
 */
export function slowChecks(repos: readonly RepoView[], agents: Record<string, Agent>, since: Map<string, number>, done: Set<string>, now: number, slow = CI_SLOW): Said[] {
  const out: Said[] = [];
  const seen = new Set<string>();
  for (const r of repos) {
    for (const q of r.pulls) {
      const key = `${r.id}#${q.number}`;
      if (q.state !== 'OPEN' || q.checks !== 'pending') continue;
      seen.add(key);
      if (!since.has(key)) since.set(key, now);
      if (now - since.get(key)! < slow * 1000 || done.has(key)) continue;
      done.add(key);
      const author = authorOf(agents, r.id, q);
      if (author) out.push(said(author.id, { kind: 'ciSlow', pr: q.number }));
    }
  }
  for (const key of [...since.keys()]) {
    if (seen.has(key)) continue;
    since.delete(key);
    done.delete(key);
  }
  return out;
}

/** The news in someone's newest log lines (epoch ms `now`): the last of tests passing or failing, a fix pushed, a conflict. */
export function logNews(a: Agent, lines: readonly LogLine[], now: number): Said[] {
  let news: ChatterEvent | null = null;
  for (const l of lines) {
    if (now - l.t > LOG_FRESH_MS) continue;
    const n = readLog(l);
    if (!n) continue;
    if (n.kind === 'testsGreen' || n.kind === 'testsRed') news = { kind: n.kind };
    else if (n.kind === 'pushed' && a.task === 'fix') news = { kind: 'fixPushed', pr: a.prNumber };
    else if (n.kind === 'conflict') news = { kind: 'conflict', pr: a.prNumber, file: n.file };
  }
  return news ? [said(a.id, news)] : [];
}

/** The file someone last edited or wrote, from their log (newest last). */
export function lastFile(lines: readonly LogLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.kind !== 'tool' || !l.tool) continue;
    const w = workOf(l.tool, l.text);
    if (w?.work === 'edit' && w.detail) return shortFile(w.detail);
  }
  return null;
}

/** What someone is doing right now, from their latest tool call (within `freshMs`), for small talk about their work. */
export function currentWork(lines: readonly LogLine[], now: number, freshMs = 45_000): { work: WorkKind; detail: string | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (now - l.t > freshMs) return null;
    if (l.kind === 'thinking') return { work: 'think', detail: null };
    if (l.kind === 'tool' && l.tool) {
      const w = workOf(l.tool, l.text);
      if (w) return w;
    }
  }
  return null;
}

/** What someone says when the player greets them: a quip about their work (a fresh merge, QA, a fix) or just hi. */
export function greeting(a: Agent, office: Pick<OfficeSlice, 'qa' | 'repos'>, manager: string, now: number): ChatterEvent {
  const base = { kind: 'greet' as const, manager, pr: a.prNumber, issue: a.issueNumber };
  if (a.role === 'ceo') return { ...base, mood: 'ceo' };
  const repo = office.repos.find((r) => r.id === a.repoId);
  const pull = a.prNumber != null ? repo?.pulls.find((p) => p.number === a.prNumber) : undefined;
  const qa = a.prNumber != null ? office.qa[`${a.repoId}#${a.prNumber}`] : undefined;
  // testers, and developers lending QA a hand (their PR number is the one under test)
  if (a.role === 'qa' || a.task === 'qa') return { ...base, mood: isBusy(a) && a.prNumber != null ? 'testing' : 'free' };
  if (pull?.state === 'MERGED' && pull.mergedAt && now - Date.parse(pull.mergedAt) < SHIPPED_MS) return { ...base, mood: 'shipped' };
  if (isBusy(a) && a.task === 'fix') return { ...base, mood: 'fixing' };
  if (pull?.state === 'OPEN' && (qa?.status === 'queued' || qa?.status === 'testing')) return { ...base, mood: 'inQa' };
  if (isBusy(a) && a.issueNumber != null) return { ...base, mood: 'working' };
  return { ...base, mood: 'free' };
}
