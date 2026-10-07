import { describe, expect, it } from 'vitest';
import {
  applyRepoPatch,
  compactAgent,
  compress,
  dayKey,
  dayStart,
  dependencyText,
  frameKeys,
  isFrame,
  journalEvent,
  journalFrame,
  keyframeIndex,
  legacyAgent,
  legacyRequest,
  marksOf,
  parseLines,
  recorded,
  redact,
  selectLines,
  toPrune,
  type JournalAgent,
  type JournalFrame,
  type JournalLine,
  type RepoPatch,
} from './journal.ts';
import { INSTALL_STEP, type AgentView, type HireRequestView, type OpsView, type PullInfo, type QaView, type RepoView, type ServerEvent, type WorldSnapshot } from './types.ts';

const MIN = 60_000;

function pull(n: number, state: PullInfo['state'] = 'OPEN', patch: Partial<PullInfo> = {}): PullInfo {
  return {
    number: n,
    title: `PR ${n}`,
    url: `https://github.com/o/r/pull/${n}`,
    headRefName: `swarm/issue-${n}-ada`,
    state,
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    closesIssues: [],
    createdAt: '2026-10-01T10:00:00Z',
    mergedAt: state === 'MERGED' ? '2026-10-01T11:00:00Z' : null,
    additions: 10,
    deletions: 2,
    checks: 'passing',
    headSha: 'abc123',
    mergeState: 'CLEAN',
    failedChecks: [],
    pendingChecks: [],
    ...patch,
  };
}

function repo(patch: Partial<RepoView> = {}): RepoView {
  return {
    id: 'o/r',
    fullName: 'o/r',
    description: 'A repo',
    url: 'https://github.com/o/r',
    defaultBranch: 'main',
    floor: 1,
    color: '#ff0000',
    autoAssign: true,
    autoMerge: true,
    folderSync: 'in sync',
    browserTesting: true,
    links: [],
    mission: 'Build the thing',
    summary: 'A web app',
    qaBrief: 'Test it well',
    localPath: 'C:\\Projects\\r',
    checkoutPath: 'C:\\Projects\\r',
    cloneStatus: 'ready',
    issues: [{ number: 1, title: 'First', body: 'Long body text.\nDepends on #7', url: 'https://github.com/o/r/issues/1', labels: ['swarm:ui'], createdAt: '2026-10-01T09:00:00Z' }],
    pulls: [],
    held: [],
    lastSync: 123,
    previewConfig: { command: 'npm run dev', env: { API_KEY: 'preview-env-secret-123' } },
    preview: { status: 'running', port: 6301, url: 'http://localhost:6301', ref: 'main', pr: null, commit: 'abc1234', startedAt: 1, error: null, logTail: ['listening on 6301'] },
    ...patch,
  };
}

function agent(patch: Partial<JournalAgent> = {}): JournalAgent {
  return {
    id: 'ada',
    name: 'Ada',
    repoId: 'o/r',
    role: 'agent',
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
    currentTool: 'Bash',
    startedAt: 1000,
    endedAt: null,
    costUsd: 1.23456,
    turns: 3,
    browserUrl: 'http://localhost:5200',
    hasScreenshot: true,
    screenshotAt: 5,
    lastError: null,
    ...patch,
  };
}

function qa(patch: Partial<QaView> = {}): QaView {
  return { repoId: 'o/r', prNumber: 2, status: 'queued', round: 1, devAgentId: 'ada', qaAgentId: null, summary: null, checks: [], commentUrl: null, mergeNote: null, ceoLooking: false, updatedAt: 1, ...patch };
}

/** A keyframe as the journal writes it: slimmed by journalFrame. */
function frame(patch: Partial<JournalFrame> = {}): JournalFrame {
  const f = { repos: [repo()], agents: [agent()], qa: [], requests: [], ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null }, messages: [], usage: { state: 'normal' as const, until: null, warning: null }, ...patch };
  return journalFrame({ ...f, agents: f.agents.map((a) => ({ ...a, log: [] })) });
}

const SECRETS = {
  anthropic: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  github: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  eleven: 'sk_0123456789abcdef0123456789abcdef0123456789abcdef',
  env: 'super-secret-env-value-42',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
};

describe('redact', () => {
  it('scrubs known secret values wherever they appear', () => {
    expect(redact(`the key is ${SECRETS.env}!`, [SECRETS.env])).toBe('the key is [redacted]!');
  });

  it('scrubs things shaped like keys and tokens', () => {
    for (const s of [SECRETS.anthropic, SECRETS.github, SECRETS.eleven, SECRETS.jwt, 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdefghij']) expect(redact(`x ${s} y`)).not.toContain(s);
    expect(redact('Authorization: Bearer abcdef0123456789abcdef')).toBe('Authorization: Bearer [redacted]');
  });

  it('scrubs assignments to secret-sounding names, keeping the name', () => {
    expect(redact('OPENAI_API_KEY=abc123 npm test')).toBe('OPENAI_API_KEY=[redacted] npm test');
    expect(redact('password: hunter2')).toBe('password: [redacted]');
    expect(redact('{"apiKey": "zzz"}')).toBe('{"apiKey": [redacted]}');
  });

  it('leaves ordinary text, branch names and commit hashes alone', () => {
    const plain = 'Fix #12: swarm/issue-12-implement-the-login-page-quickly at 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
    expect(redact(plain)).toBe(plain);
    expect(redact('The key insight: tokens are cheap')).toBe('The key insight: tokens are cheap');
  });
});

describe('journalEvent: what is kept', () => {
  it('never keeps terminal output, screens, settings, keys, toasts or snapshots', () => {
    const dropped: ServerEvent[] = [
      { type: 'logs', tails: { ada: [{ id: 1, t: 1, kind: 'text', text: `export TOKEN=${SECRETS.env}` }] } },
      { type: 'latest', lines: { ada: { id: 1, t: 1, kind: 'text', text: `export TOKEN=${SECRETS.env}` } } },
      { type: 'screen', agentId: 'ada', url: 'http://localhost', at: 1 },
      { type: 'toast', level: 'error', text: `failed: ${SECRETS.env}` },
      { type: 'voiceKey', voiceKeySet: true, voiceKeyHint: 'cdef' },
      { type: 'phoneRead', at: 1 },
      { type: 'clis', clis: [] },
      { type: 'voiceCache', voiceCache: { clips: 0, bytes: 0, saved: [] } },
      { type: 'snapshot', data: {} as WorldSnapshot },
    ];
    for (const ev of dropped) expect(journalEvent(ev)).toBeNull();
  });

  it('keeps what changes the office look: agents, floors, QA, messages, usage, removals', () => {
    for (const ev of [
      { type: 'agent', agent: agent() },
      { type: 'repo', repo: repo() },
      { type: 'qa', qa: qa() },
      { type: 'qaRemoved', repoId: 'o/r', prNumber: 2 },
      { type: 'agentRemoved', agentId: 'ada' },
      { type: 'repoRemoved', repoId: 'o/r' },
      { type: 'message', message: { id: 1, from: 'ceo', text: 'hi', at: 1 } },
      { type: 'usage', usage: { state: 'pacing', until: 5 } },
      { type: 'ceo', ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null } },
    ] as ServerEvent[])
      expect(journalEvent(ev)?.type).toBe(ev.type);
  });

  it('keeps no secret, env value, error or screen anywhere in what it records', () => {
    const secrets = [SECRETS.env, SECRETS.eleven];
    const events: ServerEvent[] = [
      { type: 'agent', agent: agent({ lastError: `crashed with ${SECRETS.anthropic}`, branch: `swarm/${SECRETS.env}`, issueTitle: `Rotate ${SECRETS.github}`, currentTool: `Bash(${SECRETS.env})` }) },
      { type: 'repo', repo: repo({ mission: SECRETS.env, issues: [{ number: 3, title: `Leak ${SECRETS.jwt}`, body: `token=${SECRETS.env}\nDepends on #1`, url: 'u', labels: [], createdAt: '' }] }) },
      { type: 'message', message: { id: 2, from: 'manager', text: `my ElevenLabs key is ${SECRETS.eleven} and env ${SECRETS.env}`, at: 1 } },
      { type: 'qa', qa: qa({ summary: `ran with GITHUB_TOKEN=${SECRETS.github}`, checks: [{ name: 'tests', result: 'fail', details: `stderr: ${SECRETS.env}` }] }) },
      { type: 'request', request: { id: 'r1', kind: 'hire', repoId: 'o/r', agentId: null, name: 'Bo', reason: `needs ${SECRETS.anthropic}`, cli: '', model: '', effort: '', look: 'masculine', color: '', hair: '', skin: '', status: 'pending', note: `not now: ${SECRETS.env}`, createdAt: 1, decidedAt: null, decidedBy: null } },
      {
        type: 'ops',
        ops: {
          floors: [],
          total: {} as OpsView['total'],
          ceoCostToday: 0,
          alarms: [
            { id: 'agent:ada', kind: 'agent', repoId: 'o/r', floor: 1, prNumber: null, agentId: 'ada', text: `Ada is stuck on an error: crashed with ${SECRETS.env}`, since: 1 },
            { id: 'pr:o/r#2', kind: 'pr', repoId: 'o/r', floor: 1, prNumber: 2, agentId: null, text: `PR #2 needs you: GITHUB_TOKEN=${SECRETS.github}`, since: 1 },
          ],
        },
      },
    ];
    const recorded = JSON.stringify(events.map((e) => journalEvent(e, secrets)));
    for (const s of Object.values(SECRETS)) expect(recorded).not.toContain(s);
    expect(recorded).not.toContain('preview-env-secret-123');
    expect(recorded).not.toContain('listening on 6301');
    expect(recorded).not.toContain('crashed with');
    expect(recorded).not.toContain('stderr');
    expect(recorded).toContain('"Ada is stuck on an error"');
    // the floor's look survives
    expect(recorded).toContain('Depends on #1');
    expect(recorded).toContain('my ElevenLabs key is [redacted]');
  });

  it('keeps a tool name, never its arguments', () => {
    expect(compactAgent(agent({ currentTool: 'Bash' })).currentTool).toBe('Bash');
    expect(compactAgent(agent({ currentTool: 'mcp__playwright__browser_click' })).currentTool).toBe('mcp__playwright__browser_click');
    expect(compactAgent(agent({ currentTool: 'Bash(cat ~/.ssh/id_rsa)' })).currentTool).toBe('Bash');
    expect(compactAgent(agent({ status: 'preparing', currentTool: INSTALL_STEP })).currentTool).toBe(INSTALL_STEP);
  });

  it('keeps only the dependencies of an issue body', () => {
    expect(dependencyText('Some text.\nDepends on #3 and #4\nBlocked by: #9')).toBe('Depends on #3, #4\nDepends on #9');
    expect(dependencyText('Nothing here')).toBe('');
  });
});

describe('journalFrame', () => {
  it('slims a snapshot like the events: no logs, the latest messages only', () => {
    const snap = {
      repos: [repo()],
      agents: [{ ...agent(), log: [{ id: 1, t: 1, kind: 'text', text: 'terminal output' }] } as AgentView],
      qa: [qa()],
      requests: [],
      ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
      messages: Array.from({ length: 50 }, (_, i) => ({ id: i, from: 'ceo' as const, text: `m${i}`, at: i })),
      usage: { state: 'normal' as const, until: null, warning: null },
    };
    const f = journalFrame(snap);
    expect(JSON.stringify(f)).not.toContain('terminal output');
    expect(f.messages).toHaveLength(20);
    expect(f.messages[19].text).toBe('m49');
    expect(f.repos[0].previewConfig.env).toEqual({});
  });
});

describe('recorded: writing only what changed', () => {
  it('skips an update identical to the last one, and removals of unknown things', () => {
    const last = frameKeys(frame());
    expect(recorded(last, journalEvent({ type: 'agent', agent: agent() })!)).toBeNull();
    const moved = journalEvent({ type: 'agent', agent: agent({ currentTool: 'Edit' }) })!;
    expect(recorded(last, moved)).not.toBeNull();
    expect(recorded(last, moved)).toBeNull();
    expect(recorded(last, { type: 'agentRemoved', agentId: 'ada' })).toEqual({ type: 'agentRemoved', agentId: 'ada' });
    expect(recorded(last, { type: 'agentRemoved', agentId: 'ada' })).toBeNull();
    const msg = { type: 'message' as const, message: { id: 1, from: 'ceo' as const, text: 'x', at: 1 } };
    expect(recorded(last, msg)).toBe(msg);
  });

  it("writes a known agent's update as just the fields that changed, nulls included", () => {
    const last = frameKeys(frame());
    expect(recorded(last, journalEvent({ type: 'agent', agent: agent({ currentTool: 'Edit' }) })!)).toEqual({ type: 'agentPatch', id: 'ada', set: { currentTool: 'Edit' } });
    expect(recorded(last, journalEvent({ type: 'agent', agent: agent({ currentTool: null, status: 'done', endedAt: 9 }) })!)).toEqual({ type: 'agentPatch', id: 'ada', set: { currentTool: null, status: 'done', endedAt: 9 } });
    const hire = journalEvent({ type: 'agent', agent: agent({ id: 'bo', name: 'Bo' }) })!;
    expect(recorded(last, hire)).toBe(hire); // someone new: whole
  });

  it("ignores what changes on every sync without changing the office's look", () => {
    const last = frameKeys(frame({ repos: [repo({ pulls: [pull(2)] })] }));
    const synced = journalEvent({ type: 'repo', repo: repo({ lastSync: 999, pulls: [pull(2, 'OPEN', { headSha: 'def456', pendingChecks: ['CI'] })] }) })!;
    expect(recorded(last, synced)).toBeNull();
  });

  it('compresses whole events into what the journal writes, starting over at each keyframe', () => {
    const tool = (t: number, currentTool: string): JournalLine => ({ t, e: journalEvent({ type: 'agent', agent: agent({ currentTool }) })! });
    const out = compress([{ t: 0, k: frame() }, tool(1, 'Bash'), tool(2, 'Edit'), tool(3, 'Edit'), { t: 4, k: frame() }, tool(5, 'Bash')]);
    expect(out.map((l) => (isFrame(l) ? 'k' : l.e.type === 'agentPatch' ? l.e.set.currentTool : l.e.type))).toEqual(['k', 'Edit', 'k']);
  });

  it("writes a known floor's update as a patch: the changed fields, and only the PRs that changed", () => {
    const last = frameKeys(frame({ repos: [repo({ pulls: [pull(2), pull(3)] })] }));
    const checks = recorded(last, journalEvent({ type: 'repo', repo: repo({ pulls: [pull(2, 'OPEN', { checks: 'failing' }), pull(3)] }) })!) as RepoPatch;
    expect(checks).toMatchObject({ type: 'repoPatch', id: 'o/r', set: {} });
    expect(checks.pulls?.map((p) => [p.number, p.checks])).toEqual([[2, 'failing']]);
    expect(checks.issues).toBeUndefined();
    // a new PR changes the list itself: it goes whole
    const opened = recorded(last, journalEvent({ type: 'repo', repo: repo({ autoMerge: false, pulls: [pull(2, 'OPEN', { checks: 'failing' }), pull(3), pull(4)] }) })!) as RepoPatch;
    expect(opened.set.pulls?.map((p) => p.number)).toEqual([2, 3, 4]);
    expect(opened.set.autoMerge).toBe(false);
    expect(opened.pulls).toBeUndefined();
  });

  it('gives back every update exactly when its patches are applied in order', () => {
    const states = [
      repo({ pulls: [pull(2)] }),
      repo({ pulls: [pull(2, 'OPEN', { checks: 'pending' })] }),
      repo({ pulls: [pull(2, 'OPEN', { checks: 'pending' }), pull(5)], issues: [] }),
      repo({ pulls: [pull(2, 'MERGED'), pull(5, 'OPEN', { mergeable: 'CONFLICTING' })], summary: 'Now a game' }),
    ].map((r) => journalEvent({ type: 'repo', repo: r })!);
    const f = frame({ repos: [(states[0] as { repo: RepoView }).repo] });
    const out = compress([{ t: 0, k: f }, ...states.slice(1).map((e, i) => ({ t: i + 1, e }))]);
    let shown = f.repos[0];
    for (const l of out.slice(1)) if (!isFrame(l) && l.e.type === 'repoPatch') shown = applyRepoPatch(shown, l.e);
    expect(JSON.stringify(shown)).toBe(JSON.stringify((states.at(-1) as { repo: RepoView }).repo));
    expect(compress(out)).toEqual(out);
  });
});

describe('seeking', () => {
  const files: JournalLine[][] = [
    [{ t: 0, k: frame(), boot: true }, { t: 5, e: { type: 'usage', usage: { state: 'normal', until: null, warning: null } } }],
    [{ t: 10, k: frame() }, { t: 12, e: { type: 'agentRemoved', agentId: 'a' } }, { t: 18, e: { type: 'agentRemoved', agentId: 'b' } }],
    [{ t: 20, k: frame() }, { t: 25, e: { type: 'agentRemoved', agentId: 'c' } }],
  ];

  it('finds the nearest keyframe at or before a time', () => {
    expect(keyframeIndex([0, 10, 20], 15)).toBe(1);
    expect(keyframeIndex([0, 10, 20], 10)).toBe(1);
    expect(keyframeIndex([0, 10, 20], 99)).toBe(2);
    expect(keyframeIndex([5, 10], 1)).toBe(0);
    expect(keyframeIndex([], 1)).toBe(-1);
  });

  it('starts a seek at the keyframe before `from` and stops before `to`', () => {
    const { lines, next } = selectLines(files, 15, 22, true);
    expect(lines.map((l) => l.t)).toEqual([10, 12, 18, 20]);
    expect(next).toBe(25);
  });

  it('carries on without a keyframe when not seeking', () => {
    const { lines, next } = selectLines(files, 12, 30, false);
    expect(lines.map((l) => l.t)).toEqual([12, 18, 20, 25]);
    expect(next).toBeNull();
  });

  it('starts at the first keyframe when `from` comes before the journal', () => {
    expect(selectLines(files.slice(1), 3, 13, true).lines.map((l) => l.t)).toEqual([10, 12]);
  });

  it('skips a line a crash cut short', () => {
    const raw = `${JSON.stringify(files[0][0])}\n${JSON.stringify(files[0][1])}\n{"t":7,"e":{"ty`;
    expect(parseLines(raw).map((l) => l.t)).toEqual([0, 5]);
  });
});

describe('marksOf', () => {
  it('marks merges, PRs newly needing the manager and new issues, in order', () => {
    const base = frame({ repos: [repo({ pulls: [pull(2)] })], qa: [qa()] });
    const lines: JournalLine[] = [
      { t: 0, k: base, boot: true },
      { t: 5, e: { type: 'qa', qa: qa({ status: 'needs-human', ceoLooking: true }) } }, // the CEO looks first: not yet
      { t: 6, e: { type: 'qa', qa: qa({ status: 'needs-human' }) } },
      { t: 7, e: { type: 'qa', qa: qa({ status: 'needs-human', round: 2 }) } }, // still needs you: no second mark
      { t: 8, e: { type: 'repo', repo: repo({ pulls: [pull(2, 'MERGED')], issues: [...repo().issues, { number: 9, title: 'New one', body: '', url: '', labels: [], createdAt: '' }] }) } },
      { t: 9, e: { type: 'repo', repo: repo({ pulls: [pull(2, 'MERGED')] }) } }, // still merged: no second gong
    ];
    expect(marksOf(lines).map((m) => [m.t, m.kind, m.n])).toEqual([
      [6, 'needs-human', 2],
      [8, 'merge', 2],
      [8, 'issue', 9],
    ]);
  });

  it('does not count a closed PR, or what a keyframe already had, as merged', () => {
    const lines: JournalLine[] = [
      { t: 0, k: frame({ repos: [repo({ pulls: [pull(2), pull(3, 'MERGED')] })] }) },
      { t: 1, e: { type: 'repo', repo: repo({ pulls: [pull(2, 'CLOSED'), pull(3, 'MERGED')] }) } },
    ];
    expect(marksOf(lines)).toEqual([]);
  });

  it('finds the same marks in what the journal writes (patches)', () => {
    const base = frame({ repos: [repo({ pulls: [pull(2), pull(3)] })] });
    const update = (t: number, r: RepoView): JournalLine => ({ t, e: journalEvent({ type: 'repo', repo: r })! });
    const lines: JournalLine[] = [
      { t: 0, k: base },
      update(1, repo({ pulls: [pull(2, 'OPEN', { checks: 'failing' }), pull(3)] })),
      update(2, repo({ pulls: [pull(2, 'MERGED'), pull(3)] })),
      update(3, repo({ pulls: [pull(2, 'MERGED'), pull(3, 'MERGED')], issues: [...repo().issues, { number: 8, title: 'More', body: '', url: '', labels: [], createdAt: '' }] })),
    ];
    const written = compress(lines);
    expect(written.slice(1).every((l) => !isFrame(l) && l.e.type === 'repoPatch')).toBe(true);
    expect(marksOf(written)).toEqual(marksOf(lines));
    expect(marksOf(written).map((m) => [m.t, m.kind, m.n])).toEqual([
      [2, 'merge', 2],
      [3, 'merge', 3],
      [3, 'issue', 8],
    ]);
  });
});

describe('days and retention', () => {
  it('groups by the local calendar day', () => {
    const t = new Date(2026, 9, 4, 23, 59).getTime();
    expect(dayKey(t)).toBe('2026-10-04');
    expect(dayKey(t + 2 * MIN)).toBe('2026-10-05');
    expect(dayStart('2026-10-04')).toBe(new Date(2026, 9, 4).getTime());
    expect(dayStart('nope')).toBeNaN();
  });

  const now = new Date(2026, 9, 10, 12).getTime();
  const file = (daysAgo: number, bytes = 1000, hour = 9) => {
    const start = new Date(2026, 9, 10 - daysAgo, hour).getTime();
    return { day: dayKey(start), start, bytes };
  };

  it('drops days older than the limit', () => {
    const files = [file(9), file(8), file(7), file(1), file(0)];
    expect(toPrune(files, now).map((f) => f.day)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('then drops the oldest files until the rest fit the size cap, never the one being written', () => {
    const files = [file(3, 400), file(2, 400), file(1, 400), file(0, 400, 11)];
    expect(toPrune(files, now, { maxBytes: 900 }).map((f) => f.day)).toEqual(['2026-10-07', '2026-10-08']);
    const current = file(0, 5000, 11);
    expect(toPrune([file(1, 400), current], now, { maxBytes: 1000, keep: current.start })).toEqual([file(1, 400)]);
  });

  it('keeps everything within the limits', () => {
    expect(toPrune([file(6), file(0)], now, { maxBytes: 10_000 })).toEqual([]);
    expect(toPrune([], now)).toEqual([]);
  });
});

describe('records from before agents were interchangeable', () => {
  const { role: _role, ...rest } = agent();
  const old = (patch: Record<string, unknown>) => ({ ...rest, title: 'Audio engineer', specialty: 'audio', brief: 'Sounds', hiredBy: 'ceo', ...patch });

  it('makes developers agents at the same desk, without their title, specialty, brief or hiredBy', () => {
    const a = legacyAgent(old({ role: 'dev', desk: 7 }));
    expect(a).toEqual(agent({ desk: 7 }));
    for (const k of ['title', 'specialty', 'brief', 'hiredBy']) expect(a).not.toHaveProperty(k);
  });

  it("seats QA testers at the east wall's desks, where their lab stations were", () => {
    expect(legacyAgent(old({ role: 'qa', desk: 0, task: 'qa' }))).toMatchObject({ role: 'agent', desk: 12, task: 'qa' });
    expect(legacyAgent(old({ role: 'qa', desk: 2 })).desk).toBe(14);
  });

  it("leaves the CEO and records already in the new shape alone, and drops old careers' specialties", () => {
    expect(legacyAgent(old({ id: 'ceo', role: 'ceo', desk: 0 }))).toMatchObject({ role: 'ceo', desk: 0 });
    expect(legacyAgent(agent({ desk: 13 }))).toEqual(agent({ desk: 13 }));
    const career = { since: 1, opened: 2, merged: 1, firstPass: 1, qaPass: 1, qaFail: 0, fixRounds: 0, run: 1, best: 1, reviews: 0, costUsd: 0, turns: 0, recent: [], week: [] };
    expect(legacyAgent(old({ role: 'dev', career: { ...career, bySpecialty: { audio: 1 } } })).career).toEqual(career);
  });

  it('turns an old hire proposal into a team change: no role, title, specialty or brief, the default coding agent', () => {
    const now: HireRequestView = { id: 'r1', kind: 'hire', repoId: 'o/r', agentId: null, name: 'Bo', reason: 'more hands', cli: '', model: '', effort: '', look: 'masculine', color: '', hair: '', skin: '', status: 'pending', note: '', createdAt: 1, decidedAt: null, decidedBy: null };
    const { cli: _cli, ...before } = now;
    expect(legacyRequest({ ...before, role: 'qa', title: 'QA tester', specialty: 'testing', brief: 'Test it' })).toEqual(now);
    expect(legacyRequest({ ...now, cli: 'codex' })).toEqual({ ...now, cli: 'codex' });
  });
});
