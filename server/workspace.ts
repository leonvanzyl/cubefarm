import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_ROOT } from './config.ts';
import { type CommandError, gh, git, run } from './exec.ts';

// Layout on disk:
//   <your projects folder>/<repo>                    the floor's main checkout: your own folder, only fetched and fast-forwarded (syncMain)
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
  await fs.appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# added by cubefarm\n${missing.join('\n')}\n`);
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

const installs = new Map<string, Promise<unknown>>();

/** npm install in a folder, one at a time per folder. */
function npmInstall(dir: string) {
  const prev = installs.get(dir) ?? Promise.resolve();
  const opts = { cwd: dir, timeoutMs: 600_000 };
  const next = prev
    .catch(() => undefined)
    .then(() => (process.platform === 'win32' ? run('cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund'], opts) : run('npm', ['install', '--no-audit', '--no-fund'], opts)));
  installs.set(dir, next);
  return next;
}

/**
 * The paths in `git status --porcelain` output, as git prints them (repo-relative, forward slashes); for a rename
 * or copy (`old -> new`) the new path. Tolerates a first line whose leading space was trimmed (exec trims stdout).
 */
export function porcelainPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((line) => /^([ MTADRCU?!]{1,2}) (.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, xy, file]) => (/[RC]/.test(xy) ? (/^(?:"(?:[^"\\]|\\.)*"|.*?) -> (.+)$/.exec(file)?.[1] ?? file) : file));
}

/** The paths git lists (tab-indented) under "... would be overwritten by merge:" in a failed merge's stderr. */
export function overwrittenPaths(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const start = lines.findIndex((l) => /would be overwritten by/.test(l));
  if (start < 0) return [];
  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break;
    files.push(line.trim());
  }
  return files.filter(Boolean);
}

/** The first few paths, then "+K more": "a, b, c +2 more", kept to about `maxChars` so a status stays short. */
export function fileList(files: string[], max = 3, maxChars = 120): string {
  const shown: string[] = [];
  let length = 0;
  for (const file of files.slice(0, max)) {
    const name = file.length > maxChars ? `…${file.slice(-(maxChars - 1))}` : file;
    const add = name.length + (shown.length ? 2 : 0);
    if (shown.length && length + add > maxChars) break;
    shown.push(name);
    length += add;
  }
  const more = files.length - shown.length;
  return `${shown.join(', ')}${more ? ` +${more} more` : ''}`;
}

/** How a floor's main checkout stands after syncMain. */
export interface MainSync {
  status: string; // e.g. "in sync", "updated to abc1234", "update ready (3 commits)" or "2 behind: local changes in README.md"
  behind: number; // commits it is still behind GitHub's default branch
  updatable: boolean; // on the default branch without local commits, so a fast-forward would bring it up to date
}

/**
 * Bring a floor's main checkout up to date with GitHub. It only ever fast-forwards, and only when the checkout is on
 * the default branch with no local changes: nothing is stashed, reset or discarded, and anything else leaves the
 * folder as it is. Installs dependencies when package.json or the lockfile changed. With `touch: false` it only
 * reports (the office's own folder). Returns how the checkout stands; null when there is no checkout yet.
 */
export async function syncMain(fullName: string, defaultBranch: string, opts: { touch: boolean }): Promise<MainSync | null> {
  const dir = mainDir(fullName);
  const result = await withRepoLock(fullName, async (): Promise<(MainSync & { install?: boolean }) | null> => {
    if (!(await exists(path.join(dir, '.git')))) return null;
    const g = (args: string[], timeoutMs?: number) => git(args, { cwd: dir, timeoutMs });
    let behind = 0;
    try {
      await g(['fetch', 'origin', '--prune'], 180_000);
      const target = `origin/${defaultBranch}`;
      behind = Number(await g(['rev-list', '--count', `HEAD..${target}`]));
      const commits = `${behind} commit${behind === 1 ? '' : 's'}`;
      const branch = await g(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '');
      const stays = (status: string) => ({ status, behind, updatable: false });
      if (branch !== defaultBranch) return stays(`on ${branch ? `branch ${branch}` : 'a detached HEAD'}${behind ? ` (${defaultBranch} is ${commits} ahead)` : ''}`);
      if (behind === 0) return stays('in sync');
      if (Number(await g(['rev-list', '--count', `${target}..HEAD`])) > 0) return stays(`diverged: local commits, and ${commits} to pull`);
      if (!opts.touch) return { status: `update ready (${commits})`, behind, updatable: true };
      const dirty = await g(['status', '--porcelain', '--untracked-files=no']);
      if (dirty) {
        const files = porcelainPaths(dirty);
        return { status: `${behind} behind: local changes${files.length ? ` in ${fileList(files)}` : ''}`, behind, updatable: true };
      }
      const before = await g(['rev-parse', 'HEAD']);
      try {
        await g(['merge', '--ff-only', target], 120_000);
      } catch (err) {
        const files = overwrittenPaths((err as CommandError).stderr ?? '');
        return { status: `${behind} behind: local files are in the way${files.length ? `: ${fileList(files)}` : ''}`, behind, updatable: true };
      }
      const changed = (await g(['diff', '--name-only', before, 'HEAD'])).split(/\r?\n/);
      const install = changed.some((f) => f === 'package.json' || f === 'package-lock.json') && (await exists(path.join(dir, 'package.json')));
      return { status: `updated to ${await g(['rev-parse', '--short', 'HEAD'])}`, behind: 0, updatable: false, install };
    } catch (err) {
      return { status: `sync failed: ${(err as Error).message.split(/\r?\n/)[0].slice(0, 160)}`, behind, updatable: false };
    }
  });
  if (!result?.install) return result;
  const { install: _install, ...sync } = result;
  // Outside the repo lock: agents' worktrees don't wait for npm.
  try {
    await npmInstall(dir);
    return { ...sync, status: `${sync.status} · dependencies installed` };
  } catch (err) {
    console.warn(`npm install in ${dir} failed:`, (err as Error).message);
    return { ...sync, status: `${sync.status} · npm install failed` };
  }
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
  if (origin) throw new Error(`${info.name}'s origin (${origin}) isn't on GitHub. cubefarm needs GitHub for issues and pull requests.`);
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

/** What a desk clean-up leaves alone: the office's own processes, and command lines that carry these paths. */
export interface OfficeProcesses {
  /** The office, its terminal keeper and every CLI running in an agent's terminal. */
  pids: number[];
  /** Paths only the CLIs' own command lines carry (the office's session files): those are agents, not leftovers. */
  markers: string[];
}

/** A path as it can appear in a command line: as is, with forward slashes, and JSON-escaped (Codex's -c values). */
export const pathForms = (p: string) => [...new Set([p, p.replaceAll('\\', '/'), p.replaceAll('\\', '\\\\')])];

/** The processes of a `ps -A -ww -o pid=,args=` listing whose command line points into a desk, except the office's. */
export function leftoversInDesk(listing: string, desk: string, keep: OfficeProcesses): number[] {
  const out: number[] = [];
  for (const line of listing.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const [pid, args] = [Number(m[1]), m[2]];
    if (keep.pids.includes(pid) || keep.markers.some((mark) => pathForms(mark).some((f) => args.includes(f)))) continue;
    if (pathForms(desk).some((f) => args.includes(f))) out.push(pid);
  }
  return out;
}

/**
 * Stop what an agent left running: anything listening on its reserved port or whose command line points into its
 * desk, plus the shell/node chain that launched it. Never the office's own processes (the keeper, the CLIs in agents'
 * terminals): the walk up from a leftover stops at them.
 */
export async function releaseDesk(fullName: string, agentSlug: string, port: number, keep: OfficeProcesses = { pids: [], markers: [] }): Promise<void> {
  const desk = deskDir(fullName, agentSlug);
  const spare = [process.pid, ...keep.pids];
  if (process.platform === 'win32') {
    const psList = (paths: string[]) => paths.flatMap(pathForms).map((d) => `'${d.toLowerCase().replaceAll("'", "''")}'`).join(', ');
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$spare = @(${spare.join(', ')})
$seed = @()
Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { $seed += [int]$_.OwningProcess }
$desks = @(${psList([desk])})
$marks = @(${psList(keep.markers)})
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
foreach ($p in $all) {
  if (-not $p.CommandLine) { continue }
  $cmd = $p.CommandLine.ToLower()
  $ours = $false
  foreach ($m in $marks) { if ($cmd.Contains($m)) { $ours = $true } }
  if ($ours) { continue }
  foreach ($d in $desks) { if ($cmd.Contains($d)) { $seed += [int]$p.ProcessId } }
}
$launchers = @(${LAUNCHERS.map((n) => `'${n}'`).join(', ')})
$kill = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($id in $seed) {
  $cur = $byId[$id]
  $first = $true
  while ($cur -and -not ($spare -contains [int]$cur.ProcessId) -and ($first -or $launchers -contains $cur.Name.ToLower())) {
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
  const listening = await run('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`]).catch(() => '');
  const listing = await run('ps', ['-A', '-ww', '-o', 'pid=,args=']).catch(() => '');
  const pids = new Set([...listening.split(/\s+/).map(Number), ...leftoversInDesk(listing, desk, keep)]);
  for (const pid of pids) {
    if (!pid || spare.includes(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
