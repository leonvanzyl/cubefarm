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
const { fileList, leftoversInDesk, mainDir, overwrittenPaths, porcelainPaths, syncMain: sync } = await import('./workspace.ts');
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

async function makeRepos(cloneArgs: string[] = []): Promise<Repos> {
  const n = ++seq;
  const fullName = `sync-test/repo-${n}`;
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
