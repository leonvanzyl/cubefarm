import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from './config.ts';
import { gh, git, run } from './exec.ts';

// Layout on disk:
//   <your projects folder>/<repo>                    the floor's main checkout: your own folder, only ever fetched
//   <WORKSPACE_ROOT>/<owner>__<repo>/desks/<agent>   one git worktree per agent, reused from task to task
// Desks stay outside your project so its dev server, tsc and linters never see them.
// Floors connected before project folders existed keep their clone at <WORKSPACE_ROOT>/<owner>__<repo>/main.

const locks = new Map<string, Promise<unknown>>();
const localRoots = new Map<string, string>(); // lowercased owner/name -> the user's project folder

/** Serialise git operations per repo so concurrent worktree adds don't fight over index locks. */
function withRepoLock<T>(fullName: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(fullName) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(fullName, next);
  return next;
}

export const repoDir = (fullName: string) => path.join(WORKSPACE_ROOT, fullName.replace('/', '__'));
export const mainDir = (fullName: string) => localRoots.get(fullName.toLowerCase()) ?? path.join(repoDir(fullName), 'main');
export const deskDir = (fullName: string, agentSlug: string) => path.join(repoDir(fullName), 'desks', agentSlug);

/** Use the user's own folder as a floor's main checkout (null: back to a clone the office manages). */
export function setLocalPath(fullName: string, dir: string | null) {
  if (dir) localRoots.set(fullName.toLowerCase(), path.resolve(dir));
  else localRoots.delete(fullName.toLowerCase());
}

async function exists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

// Tool droppings that should never be committed from a desk (shared by all worktrees of the clone).
// .preview-tmp/ is the preview worktree's {tmp} scratch folder.
const LOCAL_EXCLUDES = ['.playwright-mcp/', '.preview-tmp/'];

async function addLocalExcludes(main: string) {
  const file = path.join(main, '.git', 'info', 'exclude');
  const current = await fs.readFile(file, 'utf8').catch(() => '');
  const missing = LOCAL_EXCLUDES.filter((l) => !current.split(/\r?\n/).includes(l));
  if (missing.length === 0) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# added by Office Swarm\n${missing.join('\n')}\n`);
}

/** Make sure the floor's worktrees keep LOCAL_EXCLUDES out of git status. */
export const ensureLocalExcludes = (fullName: string) => addLocalExcludes(mainDir(fullName));

export function ensureClone(fullName: string): Promise<void> {
  return withRepoLock(fullName, async () => {
    const dir = mainDir(fullName);
    if (await exists(path.join(dir, '.git'))) {
      // Only remote-tracking refs change: your checkout, branch and uncommitted work are left alone.
      await git(['fetch', 'origin', '--prune'], { cwd: dir, timeoutMs: 180_000 });
    } else {
      await fs.mkdir(path.dirname(dir), { recursive: true });
      await gh(['repo', 'clone', fullName, dir], { timeoutMs: 600_000 });
    }
    await addLocalExcludes(dir);
  });
}

// ---------- your projects folder ----------

export interface LocalFolder {
  name: string;
  path: string;
  git: boolean;
  github: string | null; // owner/name of its GitHub origin
  modified: number;
}

/** owner/name from a git config's origin URL, if it points at GitHub. */
function githubFromConfig(config: string): string | null {
  const url = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1];
  const m = url?.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** What a folder is: a git repo? with a GitHub origin? Reads .git/config directly, so scanning is quick. */
export async function inspectFolder(dir: string): Promise<LocalFolder> {
  const full = path.resolve(dir);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`${full} is not a folder`);
  const dotGit = path.join(full, '.git');
  const gitStat = await fs.stat(dotGit).catch(() => null);
  let config = '';
  if (gitStat?.isDirectory()) config = await fs.readFile(path.join(dotGit, 'config'), 'utf8').catch(() => '');
  else if (gitStat) {
    // a worktree or submodule: .git is a file pointing at the real git dir
    const ref = (await fs.readFile(dotGit, 'utf8').catch(() => '')).match(/gitdir:\s*(.+)/)?.[1]?.trim();
    if (ref) {
      const gitDir = path.resolve(full, ref);
      config = await fs.readFile(path.join(gitDir, 'config'), 'utf8').catch(() => fs.readFile(path.join(gitDir, '..', '..', 'config'), 'utf8').catch(() => ''));
    }
  }
  return { name: path.basename(full), path: full, git: !!gitStat, github: githubFromConfig(config), modified: stat.mtimeMs };
}

/** The folders directly inside the projects folder, most recently changed first. */
export async function scanProjects(root: string): Promise<LocalFolder[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => {
    throw new Error(`Can't read the projects folder ${root}`);
  });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
  const folders = await Promise.all(dirs.map((e) => inspectFolder(path.join(root, e.name)).catch(() => null)));
  return folders.filter((f): f is LocalFolder => !!f).sort((a, b) => b.modified - a.modified);
}

async function commitReadme(dir: string, title: string, description: string) {
  const readme = path.join(dir, 'README.md');
  if (!(await exists(readme))) await fs.writeFile(readme, `# ${title}\n\n${description.trim()}\n`);
  await git(['add', 'README.md'], { cwd: dir });
  try {
    await git(['commit', '-m', 'Initial commit'], { cwd: dir });
  } catch (err) {
    if (!/tell me who you are|user\.(name|email)/i.test((err as Error).message)) throw err;
    // No git identity on this machine: commit as the GitHub account gh is signed in to.
    const login = await gh(['api', 'user', '--jq', '.login']);
    await git(['-c', `user.name=${login}`, '-c', `user.email=${login}@users.noreply.github.com`, 'commit', '-m', 'Initial commit'], { cwd: dir });
  }
}

/**
 * Put a folder on GitHub (gh repo create --source --push). Only what's already committed is pushed. A folder with
 * no commits yet gets a README commit, but only when it's empty: the office never decides which of your files go public.
 */
export async function publishFolder(dir: string, opts: { name: string; visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<string> {
  const full = path.resolve(dir);
  const info = await inspectFolder(full);
  if (info.github) return info.github;
  if (!info.git) await git(['init', '-b', 'main'], { cwd: full });
  const hasCommit = await git(['rev-parse', '--verify', 'HEAD'], { cwd: full }).then(
    () => true,
    () => false,
  );
  if (!hasCommit) {
    const files = (await fs.readdir(full)).filter((f) => f !== '.git' && f !== 'README.md');
    if (files.length) {
      throw new Error(`${info.name} has files but no commits yet. Commit what you want on GitHub first (git add, git commit), then publish it.`);
    }
    await commitReadme(full, opts.name, opts.description ?? '');
  }
  const origin = await git(['remote', 'get-url', 'origin'], { cwd: full }).catch(() => '');
  if (origin) throw new Error(`${info.name}'s origin (${origin}) isn't on GitHub. Office Swarm needs GitHub for issues and pull requests.`);
  const target = opts.owner ? `${opts.owner}/${opts.name}` : opts.name;
  const args = ['repo', 'create', target, `--${opts.visibility}`, '--source', full, '--remote', 'origin', '--push'];
  if (opts.description) args.push('--description', opts.description);
  const out = await gh(args, { cwd: full, timeoutMs: 120_000 });
  return out.match(/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\s|$)/)?.[1] ?? (await inspectFolder(full)).github ?? target;
}

/** A brand-new project: <root>/<name> with a README, pushed to a new GitHub repo. */
export async function createProject(root: string, name: string, opts: { visibility: 'private' | 'public'; owner?: string; description?: string }) {
  const dir = path.join(root, name);
  if (await exists(dir)) {
    const inside = await fs.readdir(dir).catch(() => ['?']);
    if (inside.length) throw new Error(`${dir} already exists. Pick another name, or connect that folder instead.`);
  }
  await fs.mkdir(dir, { recursive: true });
  await git(['init', '-b', 'main'], { cwd: dir });
  await commitReadme(dir, name, opts.description ?? '');
  const fullName = await publishFolder(dir, { name, ...opts });
  return { fullName, path: dir };
}

export interface DeskBase {
  defaultBranch: string;
  /** Start from a pull request's head instead of the default branch (QA testing, fixes after QA). */
  pr?: number;
}

/** Remove a directory, retrying while Windows still has handles open in it. */
async function removeDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

export function prepareDesk(fullName: string, base: DeskBase, agentSlug: string, branch: string): Promise<string> {
  return withRepoLock(fullName, async () => {
    const main = mainDir(fullName);
    await git(['fetch', 'origin', '--prune'], { cwd: main, timeoutMs: 180_000 });
    let ref = `origin/${base.defaultBranch}`;
    if (base.pr) {
      // refs/pull/N/head works for branches in this repo and for forks alike
      ref = `origin/pr/${base.pr}`;
      await git(['fetch', 'origin', `+refs/pull/${base.pr}/head:refs/remotes/${ref}`], { cwd: main, timeoutMs: 180_000 });
    }
    try {
      await git(['rev-parse', '--verify', ref], { cwd: main });
    } catch {
      throw new Error(
        base.pr
          ? `Could not fetch pull request #${base.pr} of ${fullName}.`
          : `${fullName} has no ${base.defaultBranch} branch yet. Push an initial commit (or create the repo with a README) before assigning work.`,
      );
    }

    const wt = deskDir(fullName, agentSlug);

    // Reuse the desk's worktree in place. Deleting it fails on Windows while any process (a dev server
    // the agent left running, a browser) still has its working directory inside, and reuse keeps
    // node_modules warm between tasks.
    if (await exists(path.join(wt, '.git'))) {
      try {
        await git(['checkout', '--force', '-B', branch, ref], { cwd: wt });
        await git(['reset', '--hard', ref], { cwd: wt });
        // Untracked leftovers from the last task go; ignored files (node_modules, build caches) stay.
        await git(['clean', '-fd'], { cwd: wt }).catch(() => undefined);
        return wt;
      } catch {
        // fall through and rebuild the worktree from scratch
      }
    }

    if (await exists(wt)) {
      await git(['worktree', 'remove', '--force', wt], { cwd: main }).catch(() => undefined);
      try {
        await removeDir(wt);
      } catch (err) {
        throw new Error(
          `Could not clear the desk folder ${wt}: ${(err as Error).message}. A program started by the previous task is probably still running there. Close it and try again.`,
        );
      }
    }
    await git(['worktree', 'prune'], { cwd: main });
    await fs.mkdir(path.dirname(wt), { recursive: true });
    await git(['worktree', 'add', '-B', branch, wt, ref], { cwd: main });
    return wt;
  });
}

export function removeDesk(fullName: string, agentSlug: string): Promise<void> {
  return withRepoLock(fullName, async () => {
    const main = mainDir(fullName);
    const wt = deskDir(fullName, agentSlug);
    if (!(await exists(wt))) return;
    await git(['worktree', 'remove', '--force', wt], { cwd: main }).catch(() => undefined);
    await removeDir(wt).catch(() => undefined);
    await git(['worktree', 'prune'], { cwd: main }).catch(() => undefined);
  });
}

// ---------- leftover processes ----------

// Only these kinds of processes are stopped when walking up from a leftover to its (orphaned) launcher.
const LAUNCHERS = ['node.exe', 'cmd.exe', 'bash.exe', 'sh.exe', 'conhost.exe', 'python.exe', 'npm.exe', 'npx.exe', 'bun.exe', 'deno.exe'];

/**
 * Stop what an agent left running: anything listening on its reserved port or whose command line
 * points into its desk, plus the shell/node chain that launched it. Called when the agent is not working.
 */
export async function releaseDesk(fullName: string, agentSlug: string, port: number): Promise<void> {
  const desk = deskDir(fullName, agentSlug);
  if (process.platform === 'win32') {
    const variants = [desk, desk.replaceAll('\\', '/')].map((d) => `'${d.toLowerCase().replaceAll("'", "''")}'`).join(', ');
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$seed = @()
Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { $seed += [int]$_.OwningProcess }
$desks = @(${variants})
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($p in $all) {
  if (-not $p.CommandLine) { continue }
  $cmd = $p.CommandLine.ToLower()
  foreach ($d in $desks) { if ($cmd.Contains($d)) { $seed += [int]$p.ProcessId } }
}
$launchers = @(${LAUNCHERS.map((n) => `'${n}'`).join(', ')})
$kill = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($id in $seed) {
  $cur = $byId[$id]
  $first = $true
  while ($cur -and [int]$cur.ProcessId -ne ${process.pid} -and ($first -or $launchers -contains $cur.Name.ToLower())) {
    [void]$kill.Add([int]$cur.ProcessId)
    $first = $false
    $cur = $byId[[int]$cur.ParentProcessId]
  }
}
foreach ($id in $kill) { taskkill /PID $id /T /F 2>&1 | Out-Null }
Write-Output $kill.Count`;
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30_000 }).catch(() => undefined);
    return;
  }
  const pids = await run('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null; pgrep -f ${JSON.stringify(desk)} 2>/dev/null`]).catch(() => '');
  for (const pid of pids.split(/\s+/).map(Number).filter((p) => p && p !== process.pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
