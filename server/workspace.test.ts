import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// syncMain against real throwaway repos: a bare "origin", a clone of it as the floor's main checkout, and an
// "upstream" clone that pushes new work. Everything lives in one temp folder whose path has spaces in it.

const npmRuns = vi.hoisted(() => [] as { cmd: string; cwd?: string }[]);

// npm install is stubbed: only what it was asked to do is recorded. git still runs for real.
vi.mock('./exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exec.ts')>();
  return {
    ...actual,
    run: (cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }) => {
      if (cmd === 'npm' || (cmd === 'cmd.exe' && args.join(' ').includes('npm install'))) {
        npmRuns.push({ cmd, cwd: opts?.cwd });
        return Promise.resolve('');
      }
      return actual.run(cmd, args, opts);
    },
  };
});

const savedEnv = { SWARM_HOME: process.env.SWARM_HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
const ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'office swarm sync '));
// Point the office at the temp folder before workspace.ts (and config.ts) load, so mainDir() resolves inside it.
process.env.SWARM_HOME = path.join(ROOT, 'swarm home');
// A known git setup, whoever runs the tests: an identity for test commits, and no user hooks or pull settings.
const gitConfig = path.join(ROOT, 'gitconfig');
await fs.writeFile(gitConfig, '[user]\n\tname = Sync Test\n\temail = sync-test@example.com\n[init]\n\tdefaultBranch = main\n');
process.env.GIT_CONFIG_GLOBAL = gitConfig;

const { git } = await import('./exec.ts');
const { HOME_DIR, WORKSPACE_ROOT } = await import('./config.ts');
const { deskDir, fileList, leftoversInDesk, mainDir, overwrittenPaths, parseWorktrees, planSweep, porcelainPaths, prepareDesk, removeDesk, setLocalPath, sweepDesks, syncMain: sync } =
  await import('./workspace.ts');
// Most tests only care about the status line.
const syncMain = async (...args: Parameters<typeof sync>) => (await sync(...args))?.status ?? null;

let seq = 0;
let edits = 0;

interface Repos {
  fullName: string;
  dir: string; // the floor's main checkout (mainDir)
  upstream: string; // someone else's clone, pushing to origin
}

async function commitFile(cwd: string, file: string, content: string, message = `change ${file}`) {
  await fs.mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
  await fs.writeFile(path.join(cwd, file), content);
  await git(['add', '--', file], { cwd });
  await git(['commit', '-q', '-m', message], { cwd });
}

/** Push `n` new commits to origin's main from the upstream clone. */
async function pushUpstream(r: Repos, n = 1, file = 'notes.txt') {
  for (let i = 0; i < n; i++) await commitFile(r.upstream, file, `upstream edit ${++edits}\n`);
  await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
}

/** `local`: the floor's checkout is a project folder of the manager's (setLocalPath), not a clone under the home. */
async function makeRepos(cloneArgs: string[] = [], local = false): Promise<Repos> {
  const n = ++seq;
  const fullName = `sync-test/repo-${n}`;
  if (local) setLocalPath(fullName, path.join(ROOT, 'projects', `repo ${n}`));
  const origin = path.join(ROOT, 'origins', `repo ${n}.git`);
  const upstream = path.join(ROOT, 'upstream', `repo ${n}`);
  await fs.mkdir(origin, { recursive: true });
  await git(['init', '-q', '--bare', '--initial-branch=main', origin]);
  await git(['clone', '-q', origin, upstream]);
  await commitFile(upstream, 'README.md', '# Test\n', 'initial');
  await commitFile(upstream, 'package.json', '{ "name": "sync-test" }\n', 'add package.json');
  await git(['push', '-q', '-u', 'origin', 'main'], { cwd: upstream });
  const dir = mainDir(fullName);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(['clone', '-q', ...cloneArgs, origin, dir]);
  return { fullName, dir, upstream };
}

const head = (cwd: string) => git(['rev-parse', 'HEAD'], { cwd });
const originMain = (cwd: string) => git(['rev-parse', 'origin/main'], { cwd });

beforeEach(() => {
  npmRuns.length = 0;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

describe('syncMain', { timeout: 60_000 }, () => {
  beforeAll(() => {
    // The whole point: the floor's folder is under the temp SWARM_HOME, never a real office's.
    expect(mainDir('sync-test/repo-x').startsWith(path.join(ROOT, 'swarm home'))).toBe(true);
  });

  it('is null when there is no checkout yet', async () => {
    expect(await syncMain('sync-test/nothing-here', 'main', { touch: true })).toBeNull();
  });

  it('reports a checkout that is up to date', async () => {
    const r = await makeRepos();
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('in sync');
  });

  it('fast-forwards a clean checkout that is behind', async () => {
    const r = await makeRepos();
    await pushUpstream(r, 2);
    const status = await syncMain(r.fullName, 'main', { touch: true });
    const short = await git(['rev-parse', '--short', 'HEAD'], { cwd: r.dir });
    expect(status).toBe(`updated to ${short}`);
    expect(await head(r.dir)).toBe(await head(r.upstream));
    expect(await fs.readFile(path.join(r.dir, 'notes.txt'), 'utf8')).toMatch(/^upstream/);
    expect(npmRuns).toEqual([]);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('in sync');
  });

  it('leaves local changes alone and reports them', async () => {
    const r = await makeRepos();
    await fs.writeFile(path.join(r.dir, 'README.md'), '# My work in progress\n');
    const before = await head(r.dir);
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('1 behind: local changes in README.md');
    expect(await head(r.dir)).toBe(before);
    expect(await fs.readFile(path.join(r.dir, 'README.md'), 'utf8')).toBe('# My work in progress\n');
    expect(await git(['stash', 'list'], { cwd: r.dir })).toBe('');
  });

  it('names the first three changed files, then how many more', async () => {
    const r = await makeRepos();
    for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) await commitFile(r.upstream, f, 'one\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    await syncMain(r.fullName, 'main', { touch: true });
    for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) await fs.writeFile(path.join(r.dir, f), 'mine\n');
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('1 behind: local changes in a.txt, b.txt, c.txt +2 more');
  });

  it('names the new path of a renamed file', async () => {
    const r = await makeRepos();
    await git(['mv', 'README.md', 'GUIDE.md'], { cwd: r.dir });
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('1 behind: local changes in GUIDE.md');
  });

  it('names a changed file in a subfolder with forward slashes', async () => {
    const r = await makeRepos();
    await commitFile(r.upstream, path.join('src', 'app', 'main.ts'), 'one\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    await syncMain(r.fullName, 'main', { touch: true });
    await fs.writeFile(path.join(r.dir, 'src', 'app', 'main.ts'), 'mine\n');
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('1 behind: local changes in src/app/main.ts');
  });

  it('names untracked files that are in the way', async () => {
    const r = await makeRepos();
    await fs.writeFile(path.join(r.dir, 'notes.txt'), 'my own notes\n');
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('1 behind: local files are in the way: notes.txt');
    expect(await fs.readFile(path.join(r.dir, 'notes.txt'), 'utf8')).toBe('my own notes\n');
  });

  it('leaves a checkout on another branch alone', async () => {
    const r = await makeRepos();
    await git(['checkout', '-q', '-b', 'my-feature'], { cwd: r.dir });
    const before = await head(r.dir);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('on branch my-feature');
    await pushUpstream(r, 3);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('on branch my-feature (main is 3 commits ahead)');
    expect(await head(r.dir)).toBe(before);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: r.dir })).toBe('my-feature');
  });

  it('leaves a detached HEAD alone', async () => {
    const r = await makeRepos();
    await git(['checkout', '-q', '--detach'], { cwd: r.dir });
    const before = await head(r.dir);
    await pushUpstream(r);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('on a detached HEAD (main is 1 commit ahead)');
    expect(await head(r.dir)).toBe(before);
  });

  it('leaves a diverged checkout alone', async () => {
    const r = await makeRepos();
    await commitFile(r.dir, 'mine.txt', 'local only\n');
    const before = await head(r.dir);
    await pushUpstream(r, 2);
    expect(await syncMain(r.fullName, 'main', { touch: true })).toBe('diverged: local commits, and 2 commits to pull');
    expect(await head(r.dir)).toBe(before);
    await expect(fs.access(path.join(r.dir, 'notes.txt'))).rejects.toThrow();
  });

  it('only reports an update with touch: false', async () => {
    const r = await makeRepos();
    const before = await head(r.dir);
    await pushUpstream(r, 1);
    expect(await syncMain(r.fullName, 'main', { touch: false })).toBe('update ready (1 commit)');
    await pushUpstream(r, 1);
    expect(await syncMain(r.fullName, 'main', { touch: false })).toBe('update ready (2 commits)');
    expect(await head(r.dir)).toBe(before);
    // It fetched, so the checkout knows about the update; it just didn't take it.
    expect(await originMain(r.dir)).toBe(await head(r.upstream));
  });

  it('returns how far behind it is, and whether a fast-forward would catch up', async () => {
    const r = await makeRepos();
    expect(await sync(r.fullName, 'main', { touch: false })).toEqual({ status: 'in sync', behind: 0, updatable: false });
    await pushUpstream(r, 2);
    expect(await sync(r.fullName, 'main', { touch: false })).toEqual({ status: 'update ready (2 commits)', behind: 2, updatable: true });
    await git(['checkout', '-q', '-b', 'my-feature'], { cwd: r.dir });
    expect(await sync(r.fullName, 'main', { touch: false })).toMatchObject({ behind: 2, updatable: false });
    await git(['checkout', '-q', 'main'], { cwd: r.dir });
    expect(await sync(r.fullName, 'main', { touch: true })).toMatchObject({ behind: 0, updatable: false });
  });

  it('installs dependencies when package.json changed', async () => {
    const r = await makeRepos();
    await commitFile(r.upstream, 'package.json', '{ "name": "sync-test", "version": "2.0.0" }\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    const status = await syncMain(r.fullName, 'main', { touch: true });
    const short = await git(['rev-parse', '--short', 'HEAD'], { cwd: r.dir });
    expect(status).toBe(`updated to ${short} · dependencies installed`);
    expect(npmRuns).toEqual([{ cmd: process.platform === 'win32' ? 'cmd.exe' : 'npm', cwd: r.dir }]);
  });

  it('installs dependencies when the lockfile changed', async () => {
    const r = await makeRepos();
    await commitFile(r.upstream, 'package-lock.json', '{}\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    expect(await syncMain(r.fullName, 'main', { touch: true })).toMatch(/^updated to \w+ · dependencies installed$/);
    expect(npmRuns).toHaveLength(1);
  });

  it("doesn't install for a package.json in a subfolder", async () => {
    const r = await makeRepos();
    await commitFile(r.upstream, 'packages/app/package.json', '{}\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    expect(await syncMain(r.fullName, 'main', { touch: true })).toMatch(/^updated to \w+$/);
    expect(npmRuns).toEqual([]);
  });

  it('fast-forwards a Windows-style checkout with CRLF line endings', async () => {
    // core.autocrlf=true: the working tree has CRLF while the repo has LF, which must not count as local changes.
    const r = await makeRepos(['-c', 'core.autocrlf=true']);
    expect(await fs.readFile(path.join(r.dir, 'README.md'), 'utf8')).toBe('# Test\r\n');
    await commitFile(r.upstream, 'lines.txt', 'one\ntwo\n');
    await git(['push', '-q', 'origin', 'main'], { cwd: r.upstream });
    expect(await syncMain(r.fullName, 'main', { touch: true })).toMatch(/^updated to \w+$/);
    expect(await head(r.dir)).toBe(await head(r.upstream));
    expect(await fs.readFile(path.join(r.dir, 'lines.txt'), 'utf8')).toBe('one\r\ntwo\r\n');
  });
});

describe('blocking files', () => {
  it('reads the paths from porcelain status, including a first line whose leading space was trimmed', () => {
    const porcelain = ['M package-lock.json', 'MM README.md', 'M  src/app.ts', 'R  old name.md -> docs/new name.md', 'R  "a -> b.md" -> c.md'].join('\n');
    expect(porcelainPaths(porcelain)).toEqual(['package-lock.json', 'README.md', 'src/app.ts', 'docs/new name.md', 'c.md']);
    expect(porcelainPaths('')).toEqual([]);
  });

  it('reads the files a failed merge says it would overwrite', () => {
    const stderr = [
      'error: The following untracked working tree files would be overwritten by merge:',
      '\tnotes.txt',
      '\tsrc/new.ts',
      'Please move or remove them before you merge.',
      'Aborting',
    ].join('\n');
    expect(overwrittenPaths(stderr)).toEqual(['notes.txt', 'src/new.ts']);
    expect(overwrittenPaths('fatal: Not possible to fast-forward, aborting.')).toEqual([]);
  });

  it('lists the first three, then how many more, in about 120 characters', () => {
    expect(fileList(['a'])).toBe('a');
    expect(fileList(['a', 'b', 'c'])).toBe('a, b, c');
    expect(fileList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2 more');
    const long = `${'x'.repeat(70)}.ts`;
    expect(fileList([long, long, long])).toBe(`${long} +2 more`);
    const huge = fileList([`${'deep/'.repeat(40)}file.ts`]);
    expect(huge.length).toBe(120);
    expect(huge.endsWith('/file.ts')).toBe(true);
  });
});

describe('leftoversInDesk', () => {
  const desk = '/Users/ada/.cubefarm/workspaces/me__app/desks/ada-01df';
  const keep = { pids: [300], markers: ['/Users/ada/.cubefarm/sessions', '/Users/ada/.cubefarm/bin'] };

  it("finds what an agent left running in its desk, but never an agent's own CLI or the office's processes", () => {
    const listing = [
      `  101 node ${desk}/node_modules/.bin/vite --port 5401`, // a dev server it left: a leftover
      `  102 /bin/zsh -c cd ${desk} && npm test`, // a command still running there
      `  103 node /opt/homebrew/bin/codex -c notify=["node","/Users/ada/.cubefarm/bin/notify.cjs"] -c developer_instructions="Your worktree: ${desk}"`,
      `  104 /opt/homebrew/lib/codex/codex -c notify=["node","/Users/ada/.cubefarm/bin/notify.cjs"] -c developer_instructions="Your worktree: ${desk}"`,
      `  300 node /Users/ada/project/${desk}`, // spared by pid
      '  105 node /somewhere/else/server.js',
    ].join('\n');
    expect(leftoversInDesk(listing, desk, keep)).toEqual([101, 102]);
  });

  it('recognises Windows paths as Codex escapes them in its command line', () => {
    const winDesk = String.raw`C:\Users\Ada\.cubefarm\workspaces\me__app\desks\ada-01df`;
    const winKeep = { pids: [], markers: [String.raw`C:\Users\Ada\.cubefarm\bin`] };
    const escaped = (s: string) => s.replaceAll('\\', '\\\\'); // how -c values carry a path (JSON strings)
    const listing = [
      `  7 codex.exe -c notify=["node","${escaped(String.raw`C:\Users\Ada\.cubefarm\bin\notify.cjs`)}"] -c developer_instructions="Your worktree: ${escaped(winDesk)}"`,
      `  8 node ${winDesk}\\server.js`,
    ].join('\n');
    expect(leftoversInDesk(listing, winDesk, winKeep)).toEqual([8]);
  });
});

describe('planSweep', () => {
  const top = path.parse(process.cwd()).root;
  const root = path.join(top, 'home', 'ada', '.cubefarm', 'workspaces');
  const desks = path.join(root, 'me__app', 'desks');
  const oldDesks = path.join(top, 'home', 'ada', '.office-swarm', 'workspaces', 'me__app', 'desks');
  const main = path.join(top, 'projects', 'app');
  const wt = (p: string, branch: string | null = null, locked = false) => ({ path: p, branch, locked });
  const keep = { desks: ['ada-1', 'preview'], branches: ['swarm/issue-9-ada', 'swarm/issue-4-open'] };

  it("removes desks nobody uses, here and under an older home, but never the manager's worktrees or branches", () => {
    const plan = planSweep(
      {
        fullName: 'me/app',
        root,
        worktrees: [
          wt(main, 'main'),
          wt(path.join(desks, 'ada-1'), 'swarm/issue-9-ada'),
          wt(path.join(desks, 'preview'), 'swarm-preview'),
          wt(path.join(desks, 'bob-2'), 'swarm/issue-5-bob'),
          wt(path.join(oldDesks, 'ada-1'), 'swarm/issue-2-ada'), // a current agent's slug, but in the old home
          wt(path.join(desks, 'held-3'), 'swarm/issue-6-held', true), // locked by someone: left alone
          wt(path.join(top, 'projects', 'app-feature'), 'swarm/issue-7-manual'), // the manager's own worktree
          wt(path.join(root, 'other__repo', 'desks', 'x'), 'swarm/issue-8-x'), // another floor's desk
          wt(path.join(top, 'tmp', 'workspaces', 'me__app', 'desks', 'y')), // not under an office home
        ],
        branches: [
          'main',
          'fix/my-work',
          'swarm/issue-1-old',
          'qa/pr-3-x',
          'swarm/issue-9-ada',
          'swarm/issue-4-open',
          'swarm/issue-5-bob',
          'swarm/issue-2-ada',
          'swarm/issue-6-held',
          'swarm/issue-7-manual',
          'swarm-preview',
        ],
        folders: ['ada-1', 'preview', 'bob-2', 'stray', 'eve-5'],
      },
      { ...keep, desks: [...keep.desks, 'eve-5'] },
    );
    expect(plan.worktrees.map((w) => w.path)).toEqual([path.join(desks, 'bob-2'), path.join(oldDesks, 'ada-1')]);
    expect(plan.folders).toEqual(['stray']);
    expect(plan.branches).toEqual(['swarm/issue-1-old', 'qa/pr-3-x', 'swarm/issue-5-bob', 'swarm/issue-2-ada']);
  });

  it('never removes the main worktree, even where a desk would be', () => {
    const plan = planSweep({ fullName: 'me/app', root, worktrees: [wt(path.join(desks, 'odd'), 'swarm/issue-1-a')], branches: ['swarm/issue-1-a'], folders: [] }, keep);
    expect(plan).toEqual({ worktrees: [], folders: [], branches: [] });
  });

  it.runIf(process.platform === 'win32')('matches Windows paths whatever their case', () => {
    const upper = desks.toUpperCase();
    const plan = planSweep({ fullName: 'Me/App', root, worktrees: [wt(main), wt(path.join(upper, 'ADA-1')), wt(path.join(upper, 'bob-2'))], branches: [], folders: [] }, keep);
    expect(plan.worktrees.map((w) => w.path)).toEqual([path.join(upper, 'bob-2')]);
  });

  it('reads git worktree list --porcelain', () => {
    const porcelain = ['worktree /projects/app', 'HEAD 1111', 'branch refs/heads/main', '', 'worktree /home/ada/desks/x', 'HEAD 2222', 'detached', '', 'worktree /home/ada/desks/y', 'HEAD 3333', 'branch refs/heads/qa/pr-3-y', 'locked', ''].join('\n');
    expect(parseWorktrees(porcelain)).toEqual([
      { path: path.resolve('/projects/app'), branch: 'main', locked: false },
      { path: path.resolve('/home/ada/desks/x'), branch: null, locked: false },
      { path: path.resolve('/home/ada/desks/y'), branch: 'qa/pr-3-y', locked: true },
    ]);
  });
});

describe('sweepDesks', { timeout: 120_000 }, () => {
  const branchesOf = async (cwd: string) => (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd })).split(/\r?\n/).sort();
  // Compared as real paths: git may spell a temp folder differently (8.3 names on Windows, symlinks on macOS).
  const reals = async (ps: string[]) => (await Promise.all(ps.map((p) => fs.realpath(p)))).sort();
  const worktreesOf = async (cwd: string) => reals(parseWorktrees(await git(['worktree', 'list', '--porcelain'], { cwd })).map((w) => w.path));
  const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
  const nothing = { desks: 0, folders: 0, branches: 0, patches: [], skipped: [] };

  beforeAll(() => {
    expect(WORKSPACE_ROOT.startsWith(path.join(ROOT, 'swarm home'))).toBe(true);
  });

  it('removes old desks, stray folders and finished branches, keeps what is in use, and saves unpushed work first', async () => {
    const r = await makeRepos([], true);
    const base = { defaultBranch: 'main' };
    const ada = await prepareDesk(r.fullName, base, 'ada-1234', 'swarm/issue-9-ada'); // a current agent
    const bob = await prepareDesk(r.fullName, base, 'bob-5678', 'swarm/issue-5-bob'); // left long ago
    await fs.writeFile(path.join(bob, 'scratch.txt'), 'untracked notes\n'); // untracked only: nothing to save
    const dan = await prepareDesk(r.fullName, base, 'dan-9999', 'swarm/issue-7-dan'); // left with work on no remote branch
    await commitFile(dan, path.join('src', 'feature.ts'), 'export const x = 1;\n\n');
    await fs.writeFile(path.join(dan, 'README.md'), '# Test\n\nUnfinished docs\n');
    // A desk from before the rename, under the old home.
    const oldDesk = path.join(ROOT, 'old home', '.office-swarm', 'workspaces', r.fullName.replace('/', '__'), 'desks', 'cara-0001');
    await git(['worktree', 'add', '-q', '-b', 'swarm/issue-6-cara', oldDesk, 'origin/main'], { cwd: r.dir });
    // The manager's own worktree and branches.
    const mine = path.join(ROOT, 'projects', `repo ${seq} feature`);
    await git(['worktree', 'add', '-q', '-b', 'feature/mine', mine, 'origin/main'], { cwd: r.dir });
    for (const b of ['swarm/issue-1-old', 'qa/pr-3-x', 'fix/my-work', 'swarm/issue-4-open']) await git(['branch', b, 'origin/main'], { cwd: r.dir });
    // A stray folder, and the folder of a current agent whose worktree isn't made yet.
    const desks = path.dirname(deskDir(r.fullName, 'x'));
    await fs.mkdir(path.join(desks, 'stray'), { recursive: true });
    await fs.writeFile(path.join(desks, 'stray', 'left.txt'), 'x\n');
    await fs.mkdir(path.join(desks, 'eve-0000'), { recursive: true });

    // swarm/issue-4-open is an open PR's head.
    const keep = { desks: ['ada-1234', 'eve-0000', 'preview'], branches: ['swarm/issue-9-ada', 'swarm/issue-4-open'] };
    const result = await sweepDesks(r.fullName, keep);

    expect(result).toMatchObject({ desks: 3, folders: 1, branches: 5, skipped: [] });
    expect(await worktreesOf(r.dir)).toEqual(await reals([r.dir, ada, mine]));
    for (const gone of [bob, dan, oldDesk, path.join(desks, 'stray')]) expect(await isDir(gone)).toBe(false);
    for (const kept of [ada, mine, path.join(desks, 'eve-0000')]) expect(await isDir(kept)).toBe(true);
    expect(await branchesOf(r.dir)).toEqual(['feature/mine', 'fix/my-work', 'main', 'swarm/issue-4-open', 'swarm/issue-9-ada']);

    // Dan's commit and uncommitted change are in one patch that applies cleanly where Dan started from.
    const d = new Date();
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    expect(result.patches).toEqual([path.join(HOME_DIR, 'leftovers', r.fullName.replace('/', '__'), `dan-9999-${day}.patch`)]);
    await git(['apply', '--check', result.patches[0]], { cwd: r.upstream });
    await git(['apply', result.patches[0]], { cwd: r.upstream });
    const text = async (...p: string[]) => (await fs.readFile(path.join(r.upstream, ...p), 'utf8')).replaceAll('\r\n', '\n'); // a system autocrlf may apply
    expect(await text('src', 'feature.ts')).toBe('export const x = 1;\n\n');
    expect(await text('README.md')).toBe('# Test\n\nUnfinished docs\n');

    // Nothing left to do the second time.
    expect(await sweepDesks(r.fullName, keep)).toEqual(nothing);
    expect(await branchesOf(r.dir)).toHaveLength(5);
  });

  it.runIf(process.platform === 'win32')('skips a desk some process still works in, and removes it on a later sweep', async () => {
    const r = await makeRepos([], true);
    const bob = await prepareDesk(r.fullName, { defaultBranch: 'main' }, 'bob-5678', 'swarm/issue-5-bob');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { cwd: bob, windowsHide: true, stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const first = await sweepDesks(r.fullName, { desks: [], branches: [] });
      expect(first).toMatchObject({ desks: 0, branches: 0, skipped: [await fs.realpath(bob)] });
      expect(await isDir(bob)).toBe(true);
      expect(await branchesOf(r.dir)).toContain('swarm/issue-5-bob');
    } finally {
      child.kill();
      await exited;
    }
    expect(await sweepDesks(r.fullName, { desks: [], branches: [] })).toMatchObject({ desks: 1, branches: 1, skipped: [] });
    expect(await isDir(bob)).toBe(false);
  });

  it('does nothing without a checkout', async () => {
    expect(await sweepDesks('sync-test/nothing-here', { desks: [], branches: [] })).toEqual(nothing);
  });

  it('lets a desk go from the project folder after the floor stopped pointing at it (a disconnect)', async () => {
    const r = await makeRepos([], true);
    const desk = await prepareDesk(r.fullName, { defaultBranch: 'main' }, 'ada-1234', 'swarm/issue-9-ada');
    const main = mainDir(r.fullName);
    setLocalPath(r.fullName, null); // disconnectRepo does this before the let-go's clean-up runs
    await removeDesk(r.fullName, 'ada-1234', main);
    expect(await worktreesOf(r.dir)).toEqual(await reals([r.dir]));
    expect(await isDir(desk)).toBe(false);
  });
});
