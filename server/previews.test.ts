import { beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from './backend.ts';
import { PR_PREVIEW_IDLE_MS, PREVIEW_PORT } from './config.ts';
import type { PreviewCallbacks, PreviewJob } from './previewRunner.ts';
import { Previews, type PreviewFloor } from './previews.ts';
import type { PrPreviewView, PullInfo } from '../shared/types.ts';

// The PR theatre's previews against a fake backend: which worktree, branch and port each one gets, what makes room
// for a new one, and that every way a PR preview ends stops its app and clears its worktree away.

interface Started {
  job: PreviewJob;
  cb: PreviewCallbacks;
  stopped: boolean;
}

let started: Started[];
let calls: string[];
let views: Map<string, PrPreviewView>;
let notes: string[];
let pulls: Record<string, PullInfo[]>;

const backend = {
  mainDir: (fullName: string) => `/work/${fullName}/main`,
  prDetails: async () => ({ state: 'OPEN' }),
  releaseDesk: async (fullName: string, slug: string) => void calls.push(`release ${fullName} ${slug}`),
  removeDesk: async (fullName: string, slug: string) => void calls.push(`remove ${fullName} ${slug}`),
  previews: {
    hasDefault: async () => true,
    start(job: PreviewJob, cb: PreviewCallbacks) {
      const s: Started = { job, cb, stopped: false };
      started.push(s);
      return {
        stop: async () => {
          s.stopped = true;
        },
      };
    },
  },
} as unknown as Backend;

const floor = (n: number, name = `app${n}`): PreviewFloor => ({ id: `acme/${name}`, fullName: `acme/${name}`, defaultBranch: 'main', floor: n, preview: { command: 'npm run serve', env: { API: 'http://localhost:{port}' } } });
const open = (...ns: number[]) => ns.map((number) => ({ number, state: 'OPEN' }) as PullInfo);
const settle = () => new Promise((r) => setTimeout(r, 20));

let previews: Previews;
beforeEach(() => {
  started = [];
  calls = [];
  views = new Map();
  notes = [];
  pulls = { 'acme/app1': open(1, 2, 3, 4), 'acme/app2': open(7) };
  previews = new Previews(backend, {
    emit: () => undefined,
    pulls: (id) => pulls[id] ?? [],
    emitPr: (v) => void views.set(`${v.repoId}#${v.pr}`, v),
    prRemoved: (repoId, pr) => void views.delete(`${repoId}#${pr}`),
    note: (text) => void notes.push(text),
  });
});

describe('starting a PR preview', () => {
  it("runs the PR's head with the floor's command from a slot worktree, on a port above the floor previews", async () => {
    const v = await previews.startPr(floor(1), 2, 'app1 app');
    expect(started).toHaveLength(1);
    const { job } = started[0];
    expect(job).toMatchObject({ fullName: 'acme/app1', pr: 2, slug: 'preview-pr-1', branch: 'swarm-preview-pr-1', command: 'npm run serve', env: { API: 'http://localhost:{port}' }, title: 'app1 app · PR #2' });
    expect(job.port).toBeGreaterThanOrEqual(PREVIEW_PORT + 100);
    expect(job.port).toBeLessThan(PREVIEW_PORT + 200);
    expect(v).toMatchObject({ repoId: 'acme/app1', pr: 2, status: 'preparing', port: job.port, url: null });

    started[0].cb.status('running');
    expect(views.get('acme/app1#2')).toMatchObject({ status: 'running', url: `http://localhost:${job.port}/` });
    // Asked again while it's up: kept as it is.
    await previews.startPr(floor(1), 2, 'app1 app');
    expect(started).toHaveLength(1);
  });

  it('refuses PRs that are not open', async () => {
    pulls['acme/app1'] = [{ number: 5, state: 'MERGED' } as PullInfo];
    await expect(previews.startPr(floor(1), 5, 'x')).rejects.toThrow(/merged, not open/);
    await expect(previews.startPr(floor(1), 0, 'x')).rejects.toThrow(/Invalid/);
  });

  it('shows why a failed start failed, with the log', async () => {
    await previews.startPr(floor(1), 1, 'x');
    started[0].cb.log(['$ npm run serve', 'Error: boom']);
    started[0].cb.failed('The app exited (code 1) before it listened on port 6401.');
    expect(views.get('acme/app1#1')).toMatchObject({ status: 'error', error: expect.stringMatching(/exited/) });
    expect(previews.prViews()[0].logTail).toEqual(['$ npm run serve', 'Error: boom']);
    expect(calls).toContain('release acme/app1 preview-pr-1');
  });
});

describe('at most two PR previews', () => {
  it('a third stops the one unwatched the longest, and takes over its worktree on the same floor', async () => {
    await previews.startPr(floor(1), 1, 'x');
    await settle();
    await previews.startPr(floor(1), 2, 'x');
    previews.watch('viewer-1234', 'acme/app1', 1); // PR 1 on screen: it stays
    await previews.startPr(floor(1), 3, 'x');
    await settle();
    expect(previews.prViews().map((v) => v.pr).sort()).toEqual([1, 3]);
    expect(started[1].stopped).toBe(true); // PR 2's app
    expect(started[2].job.slug).toBe(started[1].job.slug);
    expect(calls.filter((c) => c.startsWith('remove'))).toEqual([]); // same floor: the worktree is reused
    expect(notes.join(' ')).toMatch(/PR #2's preview stopped to make room/);
  });

  it("clears another floor's worktree away when it takes over that slot", async () => {
    await previews.startPr(floor(2), 7, 'x');
    await previews.startPr(floor(1), 1, 'x');
    previews.watch('viewer-1234', 'acme/app1', 1);
    await previews.startPr(floor(1), 2, 'x');
    await settle();
    expect(started[0].stopped).toBe(true);
    expect(calls).toContain('remove acme/app2 preview-pr-1');
    expect(started[2].job).toMatchObject({ fullName: 'acme/app1', slug: 'preview-pr-1' });
  });

  it('refuses a third while both are on screen', async () => {
    await previews.startPr(floor(1), 1, 'x');
    await previews.startPr(floor(1), 2, 'x');
    previews.watch('viewer-aaaa', 'acme/app1', 1);
    previews.watch('viewer-bbbb', 'acme/app1', 2);
    await expect(previews.startPr(floor(1), 3, 'x')).rejects.toThrow(/on screen already/);
    expect(views.get('acme/app1#1')?.watched).toBe(true);
  });
});

describe('a PR preview stops', () => {
  it('when asked, clearing its worktree', async () => {
    await previews.startPr(floor(1), 1, 'x');
    await previews.stopPr(floor(1), 1);
    expect(started[0].stopped).toBe(true);
    expect(calls).toEqual(expect.arrayContaining(['release acme/app1 preview-pr-1', 'remove acme/app1 preview-pr-1']));
    expect(views.has('acme/app1#1')).toBe(false);
  });

  it('when its PR merges or closes', async () => {
    await previews.startPr(floor(1), 1, 'x');
    await previews.startPr(floor(1), 2, 'x');
    previews.pullsChanged(floor(1), [{ number: 1, state: 'MERGED' } as PullInfo, ...open(2)]);
    await settle();
    expect(previews.prViews().map((v) => v.pr)).toEqual([2]);
    expect(notes.join(' ')).toMatch(/PR #1's preview stopped: the PR was merged/);
  });

  it('after the idle time with nobody watching', async () => {
    await previews.startPr(floor(1), 1, 'x');
    previews.sweepPrs(Date.now() + PR_PREVIEW_IDLE_MS / 2);
    expect(previews.prViews()).toHaveLength(1);
    previews.sweepPrs(Date.now() + PR_PREVIEW_IDLE_MS + 1000);
    await settle();
    expect(previews.prViews()).toHaveLength(0);
    expect(calls).toContain('remove acme/app1 preview-pr-1');
  });

  it('when the office stops, worktrees and all; the next start clears what a hard stop left', async () => {
    await previews.startPr(floor(1), 1, 'x');
    await previews.startPr(floor(2), 7, 'x');
    await previews.stopAll([floor(1), floor(2)]);
    expect(started.every((s) => s.stopped)).toBe(true);
    expect(calls).toEqual(expect.arrayContaining(['remove acme/app1 preview-pr-1', 'remove acme/app2 preview-pr-2']));

    calls = [];
    await previews.clearOrphans([floor(1)]);
    await settle();
    expect(calls).toEqual(expect.arrayContaining(['release acme/app1 preview', 'release acme/app1 preview-pr-1', 'release acme/app1 preview-pr-2', 'remove acme/app1 preview-pr-1', 'remove acme/app1 preview-pr-2']));
  });
});
