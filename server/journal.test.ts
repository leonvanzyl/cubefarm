import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFrame, journalFrame, KEYFRAME_MS, type JournalAgent } from '../shared/journal.ts';
import type { AgentView, PullInfo, RepoView, ServerEvent } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { envSecrets, Journal, parseRange } from './journal.ts';

const MIN = 60_000;

function agent(patch: Partial<JournalAgent> = {}): JournalAgent {
  return {
    id: 'ada',
    name: 'Ada',
    repoId: 'o/r',
    role: 'dev',
    title: '',
    specialty: '',
    brief: '',
    hiredBy: 'manager',
    look: 'feminine',
    task: 'issue',
    desk: 0,
    color: '#123456',
    hair: '#000000',
    skin: '#ffddcc',
    style: null,
    career: null,
    model: '',
    effort: '',
    cli: '',
    terminal: true,
    status: 'working',
    issueNumber: 1,
    issueTitle: 'First',
    branch: 'swarm/issue-1-ada',
    prNumber: null,
    prUrl: null,
    currentTool: 'Read',
    startedAt: 1,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
    ...patch,
  };
}

const pull = (n: number, state: PullInfo['state']): PullInfo => ({
  number: n,
  title: `PR ${n}`,
  url: '',
  headRefName: `swarm/issue-${n}-ada`,
  state,
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  closesIssues: [],
  createdAt: '',
  mergedAt: null,
  additions: 1,
  deletions: 1,
  checks: 'passing',
  headSha: '',
  mergeState: 'CLEAN',
  failedChecks: [],
  pendingChecks: [],
});

function repo(pulls: PullInfo[]): RepoView {
  return {
    id: 'o/r',
    fullName: 'o/r',
    description: '',
    url: '',
    defaultBranch: 'main',
    floor: 1,
    color: '#ff0000',
    autoAssign: true,
    autoMerge: true,
    folderSync: null,
    browserTesting: false,
    links: [],
    mission: '',
    summary: '',
    qaBrief: '',
    localPath: null,
    checkoutPath: '',
    cloneStatus: 'ready',
    issues: [],
    pulls,
    held: [],
    lastSync: null,
    previewConfig: { command: null, env: {} },
    preview: { status: 'stopped', port: 6301, url: null, ref: null, pr: null, commit: null, startedAt: null, error: null, logTail: [] },
  };
}

describe('envSecrets', () => {
  it('picks the values of secret-sounding variables', () => {
    expect(envSecrets({ GITHUB_TOKEN: 'ghp_0123456789', PATH: '/usr/bin:/bin', ELEVENLABS_API_KEY: 'abcdefgh1234', SHORT_KEY: 'abc', DB_PASSWORD: 'hunter2hunter2' }).sort()).toEqual(['abcdefgh1234', 'ghp_0123456789', 'hunter2hunter2']);
  });
});

describe('parseRange', () => {
  const now = 1_800_000_000_000;
  const bad = (q: Record<string, unknown>) => {
    try {
      parseRange(q, now);
    } catch (err) {
      return err instanceof HttpError ? err.status : -1;
    }
    return 0;
  };

  it('takes whole epoch milliseconds, from before to, at most a day apart', () => {
    expect(parseRange({ from: '1000', to: '2000', seek: '1' }, now)).toEqual({ from: 1000, to: 2000, seek: true });
    expect(parseRange({ from: '1000', to: '2000' }, now).seek).toBe(false);
  });

  it('answers 400 for bad ranges', () => {
    expect(bad({ from: 'x', to: '2000' })).toBe(400);
    expect(bad({ from: '1000' })).toBe(400);
    expect(bad({ from: '-5', to: '2000' })).toBe(400);
    expect(bad({ from: '1.5', to: '2000' })).toBe(400);
    expect(bad({ from: '2000', to: '2000' })).toBe(400);
    expect(bad({ from: '3000', to: '2000' })).toBe(400);
    expect(bad({ from: '0', to: String(25 * 60 * MIN) })).toBe(400);
    expect(bad({ from: String(now + 10 * MIN), to: String(now + 20 * MIN) })).toBe(400);
  });
});

describe('Journal', () => {
  let dir: string;
  let now: number;
  let agents: JournalAgent[];
  let pulls: PullInfo[];
  let journal: Journal;
  const SECRET = 'eleven-labs-key-0123456789';

  const frameNow = () =>
    journalFrame({
      repos: [repo(pulls)],
      agents: agents.map((a) => ({ ...a, log: [] }) as AgentView),
      qa: [],
      requests: [],
      ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
      messages: [],
      usage: { state: 'normal', until: null, warning: null },
    });
  // flushMs: the tests tick by hand
  const make = (opts: Partial<ConstructorParameters<typeof Journal>[0]> = {}) => new Journal({ dir, now: () => now, flushMs: 1e9, secrets: () => [SECRET], frame: frameNow, ...opts });

  const emit = (ev: ServerEvent) => journal.record(ev);
  const setAgent = (patch: Partial<JournalAgent>) => {
    agents = [{ ...agents[0], ...patch }];
    emit({ type: 'agent', agent: agents[0] });
  };
  const files = async () => {
    const out: string[] = [];
    for (const day of await fs.readdir(dir).catch(() => [])) for (const f of await fs.readdir(path.join(dir, day))) out.push(path.join(day, f));
    return out.sort();
  };
  const allText = async () => (await Promise.all((await files()).map((f) => fs.readFile(path.join(dir, f), 'utf8')))).join('\n');

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-journal-'));
    now = new Date(2026, 9, 4, 9, 0).getTime();
    agents = [agent()];
    pulls = [pull(2, 'OPEN')];
    journal = make();
    await journal.start();
  });

  afterEach(async () => {
    await journal.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('starts with a boot keyframe, and batches events until the timer writes them', async () => {
    expect(journal.stats.writes).toBe(0);
    for (const tool of ['Edit', 'Bash', 'Grep', 'Write']) {
      now += 1000;
      setAgent({ currentTool: tool });
    }
    expect(journal.stats.writes).toBe(0);
    journal.tick();
    await journal.close();
    expect(journal.stats.writes).toBe(1);
    const names = await files();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^2026-10-04[\\/]\d+\.ndjson$/);
    const { lines } = await journal.read(now - 10 * MIN, now + 1, true);
    expect(lines[0]).toMatchObject({ boot: true });
    expect(lines.slice(1).map((l) => (!isFrame(l) && l.e.type === 'agentPatch' ? l.e.set : null))).toEqual(['Edit', 'Bash', 'Grep', 'Write'].map((currentTool) => ({ currentTool })));
  });

  it('records a change once: repeats are skipped', () => {
    emit({ type: 'agent', agent: agents[0] }); // as in the keyframe
    emit({ type: 'repo', repo: repo(pulls) });
    expect(journal.stats.lines).toBe(1);
    expect(journal.stats.skipped).toBe(2);
  });

  it('starts a new file with a keyframe every 10 minutes, so a seek starts close by', async () => {
    for (let m = 1; m <= 25; m++) {
      now += MIN;
      setAgent({ currentTool: m % 2 ? 'Edit' : 'Bash' });
      journal.tick();
    }
    await journal.close();
    expect(await files()).toHaveLength(3);
    const start = new Date(2026, 9, 4, 9, 0).getTime();
    const { lines, next } = await journal.read(start + 15 * MIN, start + 17 * MIN, true);
    expect(isFrame(lines[0])).toBe(true);
    expect(lines[0].t).toBeLessThanOrEqual(start + 15 * MIN);
    expect(start + 15 * MIN - lines[0].t).toBeLessThan(KEYFRAME_MS);
    expect(lines.every((l) => l.t < start + 17 * MIN)).toBe(true);
    expect(next).toBe(start + 17 * MIN);
  });

  it('lists the day with its merges, and keeps it all through a restart', async () => {
    now += MIN;
    pulls = [pull(2, 'MERGED')];
    emit({ type: 'repo', repo: repo(pulls) });
    await journal.close();
    now += 30 * MIN;
    journal = make(); // the office restarts
    await journal.start();
    now += MIN;
    setAgent({ currentTool: 'Grep' });
    const days = await journal.days();
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe('2026-10-04');
    expect(days[0].marks.map((m) => [m.kind, m.n])).toEqual([['merge', 2]]);
    const { lines } = await journal.read(new Date(2026, 9, 4, 9, 0).getTime(), now + 1, true);
    expect(lines.filter((l) => isFrame(l) && l.boot)).toHaveLength(2); // one per start
    expect(lines.at(-1)).toMatchObject({ e: { type: 'agentPatch', set: { currentTool: 'Grep' } } });
  });

  it('answers 404 before anything was recorded', async () => {
    await expect(journal.read(now - 60 * MIN, now - 30 * MIN, true)).rejects.toMatchObject({ status: 404 });
  });

  it('never writes secrets or terminal output', async () => {
    emit({ type: 'logs', tails: { ada: [{ id: 1, t: now, kind: 'text', text: 'npm test output: 42 passing' }] } });
    emit({ type: 'message', message: { id: 1, from: 'manager', text: `here is the key ${SECRET}`, at: now } });
    setAgent({ lastError: 'stack trace here', issueTitle: `Use ${SECRET}` });
    emit({ type: 'toast', level: 'error', text: 'toast text' });
    journal.tick();
    await journal.close();
    const text = await allText();
    expect(text).toContain('here is the key [redacted]');
    for (const s of [SECRET, '42 passing', 'stack trace', 'toast text']) expect(text).not.toContain(s);
  });

  it('prunes days past the limit and the oldest files past the size cap', async () => {
    await journal.close();
    // a day from two weeks ago and three recent ones, written as whole days
    for (const daysAgo of [14, 3, 2, 1]) {
      const t = new Date(2026, 9, 4 - daysAgo, 9, 0).getTime();
      await journal.writeDay([{ t, k: frameNow(), boot: true }, { t: t + MIN, e: { type: 'agentRemoved', agentId: 'x' } }]);
    }
    expect((await journal.days()).map((d) => d.day)).toEqual(['2026-09-20', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(await journal.prune()).toBe(1);
    expect((await journal.days()).map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const bytes = (await journal.days()).reduce((n, d) => n + d.bytes, 0);
    expect(await make({ maxBytes: bytes - 1 }).prune()).toBe(1);
    expect((await journal.days()).map((d) => d.day)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('skips a line a crash cut short, and leaves no temp files', async () => {
    now += MIN;
    setAgent({ currentTool: 'Bash' });
    await journal.close();
    const [name] = await files();
    await fs.appendFile(path.join(dir, name), '{"t":123,"e":{"type":"ag');
    journal = make();
    await journal.start();
    const { lines } = await journal.read(now - MIN, now + 1, true);
    expect(lines.map((l) => (isFrame(l) ? 'k' : l.e.type))).toEqual(['k', 'agentPatch', 'k']);
    expect((await files()).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it("won't overwrite the day being recorded with a sample day", async () => {
    await expect(journal.writeDay([{ t: now - MIN, k: frameNow() }])).rejects.toMatchObject({ status: 409 });
  });
});
