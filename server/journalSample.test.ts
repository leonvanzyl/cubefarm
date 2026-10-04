import { describe, expect, it } from 'vitest';
import { compress, isFrame, journalEvent, KEYFRAME_MS, marksOf, type JournalAgent, type JournalFrame, type JournalLine } from '../shared/journal.ts';
import { CEO_ID, type RepoView } from '../shared/types.ts';
import { SAMPLE_FROM_MIN, SAMPLE_TO_MIN, sampleDay, seeded } from './journalSample.ts';

const MIN = 60_000;

const person = (id: string, role: JournalAgent['role'], repoId: string, desk: number): JournalAgent => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  repoId,
  role,
  title: '',
  specialty: '',
  brief: '',
  hiredBy: 'manager',
  look: 'feminine',
  task: null,
  desk,
  color: '#123456',
  hair: '#000000',
  skin: '#ffddcc',
  style: null,
  career: null,
  model: '',
  effort: '',
  cli: '',
  terminal: true,
  status: 'idle',
  issueNumber: null,
  issueTitle: null,
  branch: null,
  prNumber: null,
  prUrl: null,
  currentTool: null,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  browserUrl: null,
  hasScreenshot: false,
  screenshotAt: null,
  lastError: null,
});

const floor = (id: string, n: number, issues: number): RepoView => ({
  id,
  fullName: id,
  description: '',
  url: `https://github.com/${id}`,
  defaultBranch: 'main',
  floor: n,
  color: '#ff0000',
  autoAssign: true,
  autoMerge: true,
  folderSync: null,
  browserTesting: true,
  links: [],
  mission: '',
  summary: '',
  qaBrief: '',
  localPath: null,
  checkoutPath: '',
  cloneStatus: 'ready',
  issues: Array.from({ length: issues }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}`, body: '', url: '', labels: [], createdAt: '' })),
  pulls: [],
  held: [],
  lastSync: null,
  previewConfig: { command: null, env: {} },
  preview: { status: 'stopped', port: 6301, url: null, ref: null, pr: null, commit: null, startedAt: null, error: null, logTail: [] },
});

const base: JournalFrame = {
  repos: [floor('demo-co/pixel-todo', 1, 6), floor('demo-co/weather-api', 2, 3)],
  agents: [
    person(CEO_ID, 'ceo', '', 0),
    ...['ada', 'grace', 'linus', 'alan', 'barbara'].map((id, i) => person(id, 'dev', 'demo-co/pixel-todo', i)),
    person('marple', 'qa', 'demo-co/pixel-todo', 0),
    ...['ken', 'dennis', 'margaret'].map((id, i) => person(id, 'dev', 'demo-co/weather-api', i)),
    person('poirot', 'qa', 'demo-co/weather-api', 0),
  ],
  qa: [],
  requests: [],
  ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
  messages: [],
  usage: { state: 'normal', until: null, warning: null },
};

const midnight = new Date(2026, 9, 3).getTime();

describe('sampleDay', () => {
  const lines = sampleDay(base, midnight, seeded(42));

  it('is a working day of journal lines in order, a keyframe every 10 minutes, the first a boot one', () => {
    expect(lines[0]).toMatchObject({ t: midnight + SAMPLE_FROM_MIN * MIN, boot: true });
    expect(lines.every((l, i) => i === 0 || l.t >= lines[i - 1].t)).toBe(true);
    expect(lines.at(-1)!.t).toBeLessThan(midnight + SAMPLE_TO_MIN * MIN);
    const frames = lines.filter(isFrame);
    expect(frames.length).toBe((SAMPLE_TO_MIN - SAMPLE_FROM_MIN) / (KEYFRAME_MS / MIN));
    expect(frames.every((f, i) => i === 0 || f.t - frames[i - 1].t === KEYFRAME_MS)).toBe(true);
  });

  it('has merges, a PR that needs the manager and new issues to see on the timeline', () => {
    const marks = marksOf(lines);
    expect(marks.filter((m) => m.kind === 'merge').length).toBeGreaterThanOrEqual(8);
    expect(marks.filter((m) => m.kind === 'needs-human').length).toBeGreaterThanOrEqual(1);
    expect(marks.filter((m) => m.kind === 'issue').length).toBeGreaterThanOrEqual(4);
  });

  it('only has events the journal itself would write, already slimmed and compressed', () => {
    for (const l of lines as JournalLine[]) if (!isFrame(l) && l.e.type !== 'agentPatch' && l.e.type !== 'repoPatch') expect(journalEvent(l.e)).toEqual(l.e);
    expect(compress(lines)).toEqual(lines);
    expect(lines.some((l) => !isFrame(l) && l.e.type === 'agentPatch')).toBe(true);
  });

  it('keeps the floors and people it was given', () => {
    const last = lines.filter(isFrame).at(-1)!.k;
    expect(last.repos.map((r) => r.id)).toEqual(base.repos.map((r) => r.id));
    expect(last.agents.map((a) => a.id)).toEqual(base.agents.map((a) => a.id));
  });

  it('is the same day for the same seed', () => {
    expect(JSON.stringify(sampleDay(base, midnight, seeded(42)))).toBe(JSON.stringify(lines));
  });
});
