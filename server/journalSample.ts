// The demo's sample day (docs/how-it-works.md, "Time-lapse"): a made-up working day on the demo's own floors and
// people, 08:30 to 18:00, journaled like a real one so a fresh demo office has a day to replay: issues picked up, PRs
// opened, QA rounds (some failed and fixed, one needing the manager), merges, the CEO filing issues and a spell of
// pacing. Seeded, so the same office gives the same day.
import { compress, FRAME_MESSAGES, KEYFRAME_MS, type JournalAgent, type JournalEvent, type JournalFrame, type JournalLine } from '../shared/journal.ts';
import { CEO_ID, INSTALL_STEP, type ActivityKind, type AgentActivity, type CeoInfo, type IssueInfo, type PhoneMessage, type PullInfo, type QaView, type RepoView, type TickerItem, type UsageView } from '../shared/types.ts';

/** A small seeded random number generator (mulberry32), in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
export const SAMPLE_FROM_MIN = 8.5 * 60; // minutes after midnight
export const SAMPLE_TO_MIN = 18 * 60;

const DEV_TOOLS = ['Read', 'Grep', 'Edit', 'Bash', 'Edit', 'Write', 'TodoWrite', 'Glob', 'Bash'];
const QA_TOOLS = ['Bash', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_click', 'mcp__playwright__browser_take_screenshot', 'Read'];
const MORE_ISSUES = [
  'Add a settings page',
  'Improve the loading states',
  'Write tests for the API client',
  'Speed up the first load',
  'Accessible focus styles',
  'Export to CSV',
  'Add a search box',
  'Fix the flaky date test',
  'Mobile layout tweaks',
  'Friendlier error messages',
  'Remember the last filter',
  'Add a help page',
  'Undo for deletes',
  'Show a toast on save',
  'Paginate long lists',
  'Tidy up the README',
];

interface Job {
  kind: 'issue' | 'qa' | 'fix' | 'ceo';
  repoId: string;
  n: number; // issue (issue job) or PR number
  until: number;
  nextTool: number;
  verdict?: 'pass' | 'fail' | 'stuck';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const iso = (t: number) => new Date(t).toISOString();

function idle(a: JournalAgent): JournalAgent {
  return { ...a, status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, currentTool: null, startedAt: null, endedAt: null, activity: null };
}

const KINDS: Record<string, ActivityKind> = { Read: 'read', Grep: 'read', Glob: 'read', TodoWrite: 'read', Edit: 'edit', Write: 'edit', Bash: 'test' };

/** The sign over someone at work, as the journal keeps it: the kind of work their tool is. */
function activityOf(a: JournalAgent): AgentActivity | null {
  if (a.status === 'preparing') return { kind: 'build', detail: '' };
  if (a.status !== 'working') return null;
  const tool = a.currentTool ?? '';
  return { kind: tool.startsWith('mcp__playwright') ? 'browse' : tool.startsWith('mcp__office') ? 'talk' : (KINDS[tool] ?? 'run'), detail: '' };
}

/**
 * The day starting at local midnight `midnight`, on `base`'s floors and people: a list of journal lines (keyframes
 * every 10 minutes, the first a boot one) as the journal writes them, ready for Journal.writeDay.
 */
export function sampleDay(base: JournalFrame, midnight: number, rand = seeded(7)): JournalLine[] {
  const lines: JournalLine[] = [];
  const clone = <T>(x: T): T => structuredClone(x);
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  let pool = 0;
  const repos: RepoView[] = base.repos.map((r) => {
    const issues = clone(r.issues);
    let n = Math.max(0, ...issues.map((i) => i.number), ...r.pulls.map((p) => p.number));
    for (let k = 0; k < 3; k++) issues.push(newIssue(r, ++n, MORE_ISSUES[pool++ % MORE_ISSUES.length], midnight));
    return { ...clone(r), issues, pulls: [] };
  });
  const nextNumber = new Map(repos.map((r) => [r.id, Math.max(0, ...r.issues.map((i) => i.number)) + 1]));
  const agents = base.agents.map((a) => idle(clone(a)));
  const qa = new Map<string, QaView>();
  const messages: PhoneMessage[] = [];
  const ceo: CeoInfo = { queue: [], job: null, lastReviewAt: null, nextReviewAt: null };
  let usage: UsageView = { state: 'normal', until: null, warning: null };
  const jobs = new Map<string, Job>();
  const restUntil = new Map<string, number>();
  const checksAt = new Map<string, number>(); // `${repoId}#${pr}` -> when its checks pass
  const merges: { repoId: string; n: number; at: number }[] = [];
  let merged = 0;
  let stuck = 0;
  let msgId = 900_000;
  let t = midnight + SAMPLE_FROM_MIN * MIN;
  const end = midnight + SAMPLE_TO_MIN * MIN;

  const ev = (e: JournalEvent) => lines.push({ t, e: clone(e) });
  const repoById = (id: string) => repos.find((r) => r.id === id)!;
  const emitAgent = (a: JournalAgent) => {
    a.activity = activityOf(a);
    ev({ type: 'agent', agent: a });
  };
  const ticker: TickerItem[] = [];
  const tick = (repoId: string, text: string, tone: TickerItem['tone'] = 'info') => {
    const item: TickerItem = { id: ticker.length + 1, repoId, at: t, text, tone };
    ticker.push(item);
    ev({ type: 'ticker', item });
  };
  const emitQa = (q: QaView) => {
    q.updatedAt = t;
    ev({ type: 'qa', qa: q });
  };
  const say = (from: PhoneMessage['from'], text: string) => {
    const m: PhoneMessage = { id: msgId++, from, text, at: t };
    messages.push(m);
    ev({ type: 'message', message: m });
  };
  const frame = (): JournalFrame => clone({ repos, agents, qa: [...qa.values()], requests: [], ceo, messages: messages.slice(-FRAME_MESSAGES), usage, ticker: ticker.slice(-30) });
  const qaKey = (repoId: string, n: number) => `${repoId}#${n}`;

  function newIssue(r: Pick<RepoView, 'url'>, n: number, title: string, at: number): IssueInfo {
    return { number: n, title, body: '', url: `${r.url}/issues/${n}`, labels: [], createdAt: iso(at) };
  }

  const claimed = (repo: RepoView) => {
    const out = new Set<number>(repo.pulls.filter((p) => p.state === 'OPEN').flatMap((p) => p.closesIssues));
    for (const j of jobs.values()) if (j.kind === 'issue' && j.repoId === repo.id) out.add(j.n);
    return out;
  };

  function start(a: JournalAgent, job: Job, patch: Partial<JournalAgent>) {
    jobs.set(a.id, job);
    Object.assign(a, patch, { startedAt: t, endedAt: null });
    emitAgent(a);
  }

  function rest(a: JournalAgent, patch: Partial<JournalAgent>) {
    jobs.delete(a.id);
    Object.assign(a, { currentTool: null, endedAt: t }, patch);
    restUntil.set(a.id, t + between(1, 4) * MIN);
    emitAgent(a);
  }

  function openPr(a: JournalAgent, job: Job) {
    const repo = repoById(job.repoId);
    const issue = repo.issues.find((i) => i.number === job.n);
    const n = nextNumber.get(repo.id)!;
    nextNumber.set(repo.id, n + 1);
    const pr: PullInfo = {
      number: n,
      title: issue?.title ?? `Fix #${job.n}`,
      url: `${repo.url}/pull/${n}`,
      headRefName: `swarm/issue-${job.n}-${slug(a.name)}`,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      reviewDecision: null,
      closesIssues: [job.n],
      createdAt: iso(t),
      mergedAt: null,
      additions: between(12, 420),
      deletions: between(0, 120),
      checks: 'pending',
      headSha: '',
      mergeState: '',
      failedChecks: [],
      pendingChecks: [],
    };
    repo.pulls.push(pr);
    checksAt.set(qaKey(repo.id, n), t + between(4, 9) * MIN);
    ev({ type: 'repo', repo });
    tick(repo.id, `${a.name} opened PR #${n}`, 'good');
    rest(a, { status: 'done', prNumber: n, prUrl: pr.url });
    const q: QaView = { repoId: repo.id, prNumber: n, status: 'queued', round: 1, devAgentId: a.id, qaAgentId: null, summary: null, checks: [], commentUrl: null, mergeNote: null, ceoLooking: false, updatedAt: t };
    qa.set(qaKey(repo.id, n), q);
    emitQa(q);
  }

  function finishQa(a: JournalAgent, job: Job) {
    const q = qa.get(qaKey(job.repoId, job.n));
    rest(a, { status: 'done' });
    if (!q) return;
    if (job.verdict === 'pass') {
      Object.assign(q, { status: 'passed', mergeNote: null });
      tick(job.repoId, `${a.name} passed PR #${job.n} ✅`, 'good');
      merges.push({ repoId: job.repoId, n: job.n, at: t + between(2, 6) * MIN });
    } else if (job.verdict === 'stuck') {
      stuck++;
      Object.assign(q, { status: 'needs-human', mergeNote: null });
      say('office', `⚠️ PR #${job.n} on ${repoById(job.repoId).fullName} failed QA ${q.round} times. It needs you.`);
      tick(job.repoId, `PR #${job.n} needs you 🙋`, 'bad');
    } else {
      Object.assign(q, { status: 'failed' });
      tick(job.repoId, `${a.name} failed PR #${job.n} · round ${q.round}`, 'bad');
    }
    emitQa(q);
  }

  function merge(repoId: string, n: number) {
    const repo = repoById(repoId);
    const pr = repo.pulls.find((p) => p.number === n);
    if (!pr || pr.state !== 'OPEN') return;
    const q = qa.get(qaKey(repoId, n));
    qa.delete(qaKey(repoId, n));
    ev({ type: 'qaRemoved', repoId, prNumber: n });
    Object.assign(pr, { state: 'MERGED', mergedAt: iso(t), checks: 'passing' });
    repo.issues = repo.issues.filter((i) => !pr.closesIssues.includes(i.number));
    // GitHub's list (github.ts) has the open PRs and the last 8 merged.
    const old = repo.pulls.filter((p) => p.state === 'MERGED').slice(0, -8);
    repo.pulls = repo.pulls.filter((p) => !old.includes(p));
    ev({ type: 'repo', repo });
    tick(repoId, `#${n} merged 🎉`, 'good');
    merged++;
    const dev = agents.find((x) => x.id === q?.devAgentId);
    if (dev && !jobs.has(dev.id) && dev.prNumber === n) {
      Object.assign(dev, idle(dev));
      emitAgent(dev);
    }
  }

  function ceoFiles(count: number) {
    const repo = repos[Math.floor(rand() * repos.length)];
    const ceoAgent = agents.find((a) => a.id === CEO_ID);
    const filed: number[] = [];
    for (let k = 0; k < count; k++) {
      const n = nextNumber.get(repo.id)!;
      nextNumber.set(repo.id, n + 1);
      repo.issues.push(newIssue(repo, n, MORE_ISSUES[pool++ % MORE_ISSUES.length], t));
      filed.push(n);
    }
    ev({ type: 'repo', repo });
    say('ceo', `📝 Filed ${filed.map((n) => `#${n}`).join(' and ')} on ${repo.fullName}, so nobody runs out of work this afternoon.`);
    if (ceoAgent) rest(ceoAgent, { status: 'done' });
    ceo.job = null;
    ev({ type: 'ceo', ceo });
  }

  for (; t < end; t += MIN) {
    if ((t - (midnight + SAMPLE_FROM_MIN * MIN)) % KEYFRAME_MS === 0) lines.push(lines.length ? { t, k: frame() } : { t, k: frame(), boot: true });
    const minute = Math.round((t - midnight) / MIN);

    // the day's set pieces
    if (minute === SAMPLE_FROM_MIN + 5) say('ceo', `☀️ Good morning! ${repos.reduce((n, r) => n + r.issues.length, 0)} issues on the board today. I'll keep the backlog topped up.`);
    if ([600, 690, 780, 870, 960].includes(minute)) {
      const ceoAgent = agents.find((a) => a.id === CEO_ID);
      ceo.job = { kind: 'plan', label: 'Planning the next issues' };
      ev({ type: 'ceo', ceo });
      if (ceoAgent) start(ceoAgent, { kind: 'ceo', repoId: '', n: 0, until: t + between(4, 8) * MIN, nextTool: t + MIN }, { status: 'working', currentTool: 'mcp__office__company_status' });
    }
    if (minute === 840) {
      usage = { state: 'pacing', until: t + 40 * MIN, warning: { limit: '5-hour limit', pct: 85, resetsAt: t + 40 * MIN, at: t } };
      ev({ type: 'usage', usage });
      say('office', '🐢 Claude warned that usage is getting high, so the office is pacing new work for a while.');
    }
    if (usage.state === 'pacing' && usage.until !== null && t >= usage.until) {
      usage = { state: 'normal', until: null, warning: usage.warning };
      ev({ type: 'usage', usage });
      say('office', '🏃 Usage is back to normal: new work starts as usual again.');
    }
    if (minute === SAMPLE_TO_MIN - 10) say('ceo', `🌙 That's a wrap: ${merged} PRs merged today${stuck ? `, ${stuck} waiting for you` : ''}. See you tomorrow!`);

    // checks go green, passed PRs merge
    for (const r of repos) {
      let touched = false;
      for (const p of r.pulls) {
        const at = checksAt.get(qaKey(r.id, p.number));
        if (p.state === 'OPEN' && p.checks === 'pending' && at !== undefined && t >= at) {
          p.checks = 'passing';
          touched = true;
        }
      }
      if (touched) ev({ type: 'repo', repo: r });
    }
    for (const m of merges.filter((x) => x.at <= t)) {
      const pr = repoById(m.repoId).pulls.find((p) => p.number === m.n);
      if (pr?.checks === 'pending') m.at = t + MIN;
      else {
        merges.splice(merges.indexOf(m), 1);
        merge(m.repoId, m.n);
      }
    }

    // people at work: a new tool now and then, and the end of each job
    for (const a of agents) {
      const job = jobs.get(a.id);
      if (!job) continue;
      if (t >= job.until) {
        if (job.kind === 'issue') openPr(a, job);
        else if (job.kind === 'qa') finishQa(a, job);
        else if (job.kind === 'fix') {
          const q = qa.get(qaKey(job.repoId, job.n));
          rest(a, { status: 'done' });
          if (q) {
            Object.assign(q, { status: 'queued', round: q.round + 1, qaAgentId: null });
            emitQa(q);
          }
        } else ceoFiles(between(2, 3));
      } else if (t >= job.nextTool) {
        job.nextTool = t + between(1, 3) * MIN;
        const tools = job.kind === 'qa' ? QA_TOOLS : job.kind === 'ceo' ? ['mcp__office__file_issue'] : DEV_TOOLS;
        Object.assign(a, { status: 'working', currentTool: pick(tools) });
        emitAgent(a);
      }
    }

    // free people pick up work: their own PR's fixes first, then testing someone else's PR (their own only when they're
    // the floor's one agent), then new issues (not all at once, and slower while pacing)
    for (const a of agents) {
      if (a.role === 'ceo' || jobs.has(a.id) || (restUntil.get(a.id) ?? 0) > t) continue;
      const repo = repos.find((r) => r.id === a.repoId);
      if (!repo) continue;
      const fix = [...qa.values()].find((x) => x.repoId === repo.id && x.status === 'failed' && x.devAgentId === a.id);
      if (fix) {
        Object.assign(fix, { status: 'fixing' });
        emitQa(fix);
        const pr = repo.pulls.find((p) => p.number === fix.prNumber)!;
        start(a, { kind: 'fix', repoId: repo.id, n: fix.prNumber, until: t + between(6, 15) * MIN, nextTool: t + MIN }, { status: 'working', task: 'fix', prNumber: fix.prNumber, prUrl: pr.url, issueNumber: pr.closesIssues[0] ?? null, issueTitle: pr.title, currentTool: 'Read' });
        continue;
      }
      const alone = agents.filter((x) => x.repoId === repo.id && x.role !== 'ceo').length === 1;
      const q = [...qa.values()].filter((x) => x.repoId === repo.id && x.status === 'queued' && (x.devAgentId !== a.id || alone)).sort((x, y) => x.updatedAt - y.updatedAt)[0];
      if (q) {
        const pr = repo.pulls.find((p) => p.number === q.prNumber)!;
        const verdict = !stuck && q.round >= 2 && minute > 870 ? 'stuck' : q.round >= 3 ? 'pass' : rand() < 0.28 ? 'fail' : 'pass';
        Object.assign(q, { status: 'testing', qaAgentId: a.id });
        emitQa(q);
        start(a, { kind: 'qa', repoId: repo.id, n: q.prNumber, until: t + between(7, 18) * MIN, nextTool: t + MIN, verdict }, { status: 'working', task: 'qa', prNumber: q.prNumber, prUrl: pr.url, issueTitle: pr.title, issueNumber: pr.closesIssues[0] ?? null, branch: null, currentTool: QA_TOOLS[0] });
        continue;
      }
      if (rand() > (usage.state === 'pacing' ? 0.06 : 0.3)) continue;
      const taken = claimed(repo);
      const issue = repo.issues.find((i) => !taken.has(i.number));
      if (!issue) continue;
      start(a, { kind: 'issue', repoId: repo.id, n: issue.number, until: t + between(22, 65) * MIN, nextTool: t + MIN }, {
        status: 'preparing',
        task: 'issue',
        issueNumber: issue.number,
        issueTitle: issue.title,
        branch: `swarm/issue-${issue.number}-${slug(a.name)}`,
        prNumber: null,
        prUrl: null,
        currentTool: INSTALL_STEP,
      });
    }
  }
  return compress(lines);
}
