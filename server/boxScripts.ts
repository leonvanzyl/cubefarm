// The shell scripts the office runs in a cloud agent's Upstash Box (docs/cloud.md), built here as pure functions so
// their quoting is tested. A Box is Debian (ARM64) with user boxuser, passwordless sudo and /workspace/home as home.
// Nothing here carries a credential: GitHub's token reaches git through a credential helper that reads $GH_TOKEN
// from the command's own environment.

import type { DeskBase } from './workspace.ts';

export const BOX_HOME = '/workspace/home';
export const BOX_CF = `${BOX_HOME}/.cubefarm`;
export const BOX_BIN = `${BOX_CF}/bin`;
export const BOX_SESSIONS = `${BOX_CF}/sessions`;
export const BOX_TMUX_CONF = `${BOX_CF}/tmux.conf`;
export const BOX_LEFTOVERS = `${BOX_CF}/leftovers.patch`;
/** The office's own copies of the CLIs, at its pinned versions: launched by full path, so the image's never stand in. */
export const BOX_CLI_BIN = `${BOX_CF}/cli/bin`;

const folder = (fullName: string) => fullName.replace('/', '__');
export const boxRepoDir = (fullName: string) => `${BOX_HOME}/repos/${folder(fullName)}`;
export const boxDeskDir = (fullName: string) => `${BOX_HOME}/work/${folder(fullName)}`;
export const boxLinkedDir = (fullName: string) => `${BOX_HOME}/linked/${folder(fullName)}`;
export const boxSessionDir = (token: string) => `${BOX_SESSIONS}/${token}`;
/** A session's tmux server: one per CLI, started with that CLI's environment. */
export const tmuxSocket = (token: string) => `cf-${token.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;

/** One shell word, safe whatever it holds. */
export const sq = (s: string) => `'${String(s).replaceAll("'", `'"'"'`)}'`;

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;
const BRANCH = /^[\w./-]+$/;

function checkRepo(fullName: string) {
  if (!OWNER_REPO.test(fullName)) throw new Error(`Not a GitHub repository name: ${fullName}`);
}

/** The CLI versions a Box runs: the office's own pins, so the hooks it relies on are there. */
export interface BoxVersions {
  claude: string;
  playwrightMcp: string;
  codex: string;
}

/** The setup marker: a new one (new versions, a new setup) runs the setup again. */
export const setupMarker = (v: BoxVersions, rev: number) => `${BOX_CF}/setup-${rev}-${v.claude}-${v.playwrightMcp}-${v.codex}`.replace(/[^\w./-]/g, '_');

/** The tmux the office runs CLIs in: no status line or prefix key, keys passed straight through, no alternate screen. */
export const TMUX_CONF = [
  'set -g status off',
  'set -g prefix None',
  'unbind C-b',
  'set -g escape-time 0',
  'set -g history-limit 5000',
  'set -g window-size latest',
  'set -g default-terminal "xterm-256color"',
  "set -ga terminal-overrides ',*:smcup@:rmcup@'",
  'set -g remain-on-exit off',
  'set -g exit-empty on',
  '',
].join('\n');

/** The one-time setup of a Box: tools, the pinned CLIs, git, and the office's folders. Prints CUBEFARM_SETUP_OK. */
export function setupScript(o: { versions: BoxVersions; rev: number; gitName: string; gitEmail: string }): string {
  const marker = setupMarker(o.versions, o.rev);
  const pkgs = [`@anthropic-ai/claude-code@${o.versions.claude}`, `@playwright/mcp@${o.versions.playwrightMcp}`, `@openai/codex@${o.versions.codex}`];
  // git asks the helper with "get" (and later "store" / "erase", which it ignores): the token comes from the
  // environment of whichever command runs git, so it's never on the Box's disk.
  const helper = `!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$GH_TOKEN"; }; f`;
  return [
    'set -e',
    `mkdir -p ${sq(BOX_BIN)} ${sq(BOX_SESSIONS)}`,
    `if [ -f ${sq(marker)} ]; then echo CUBEFARM_SETUP_OK; exit 0; fi`,
    'missing=""',
    'for t in tmux lsof gh; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done',
    'if [ -n "$missing" ]; then',
    '  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true',
    '  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing >/dev/null 2>&1 || true',
    'fi',
    'command -v tmux >/dev/null 2>&1 || { echo "tmux could not be installed in the Box" >&2; exit 3; }',
    // Into the office's own folder, not the image's global one: the Box image ships its own CLIs first on the PATH.
    `npm install -g --prefix ${sq(`${BOX_CF}/cli`)} --no-fund --no-audit --loglevel=error ${pkgs.map(sq).join(' ')} > /tmp/cubefarm-cli.log 2>&1 || { tail -n 5 /tmp/cubefarm-cli.log >&2; exit 4; }`,
    `for c in claude codex playwright-mcp; do test -x ${sq(BOX_CLI_BIN)}/$c || { echo "$c was not installed" >&2; exit 4; }; done`,
    'git config --global --unset-all credential.helper >/dev/null 2>&1 || true',
    `git config --global credential.https://github.com.helper ${sq(helper)}`,
    `git config --global user.name ${sq(o.gitName || 'cubefarm')}`,
    `git config --global user.email ${sq(o.gitEmail || 'cubefarm@users.noreply.github.com')}`,
    'git config --global init.defaultBranch main',
    'git config --global advice.detachedHead false',
    `rm -f ${sq(BOX_CF)}/setup-*`,
    `touch ${sq(marker)}`,
    'echo CUBEFARM_SETUP_OK',
  ].join('\n');
}

/**
 * Put the agent's worktree on `branch` at the default branch or a PR's head, as setUpWorktree does on a local machine:
 * the Box's own clone is made the first time; the worktree is reused in place (node_modules stays warm) or rebuilt.
 * A Box has one worktree per clone, so no other checkout ever holds the branch. Prints the worktree on success.
 */
export function prepareDeskScript(fullName: string, base: DeskBase, branch: string): string {
  checkRepo(fullName);
  if (!BRANCH.test(branch) || !BRANCH.test(base.defaultBranch)) throw new Error(`Not a branch name: ${branch}`);
  const repo = boxRepoDir(fullName);
  const desk = boxDeskDir(fullName);
  const ref = base.pr ? `origin/pr/${base.pr}` : `origin/${base.defaultBranch}`;
  return [
    'set -e',
    `R=${sq(repo)}`,
    `W=${sq(desk)}`,
    `REF=${sq(ref)}`,
    `B=${sq(branch)}`,
    'if [ ! -d "$R/.git" ]; then',
    '  rm -rf "$R"; mkdir -p "$(dirname "$R")"',
    `  git clone -q --no-checkout ${sq(`https://github.com/${fullName}.git`)} "$R"`,
    `  printf '%s\\n' '# added by cubefarm' '.playwright-mcp/' '.preview-tmp/' >> "$R/.git/info/exclude"`,
    'fi',
    'cd "$R"',
    'git fetch -q origin --prune',
    ...(base.pr
      ? [`git fetch -q origin ${sq(`+refs/pull/${base.pr}/head:refs/remotes/origin/pr/${base.pr}`)} || { echo ${sq(`Could not fetch pull request #${base.pr} of ${fullName}.`)} >&2; exit 2; }`]
      : []),
    `git rev-parse --verify -q "$REF" >/dev/null || { echo ${sq(
      base.pr ? `Could not fetch pull request #${base.pr} of ${fullName}.` : `${fullName} has no ${base.defaultBranch} branch yet. Push an initial commit (or create the repo with a README) before assigning work.`,
    )} >&2; exit 2; }`,
    'git worktree prune',
    'if [ -e "$W/.git" ]; then',
    '  cd "$W"',
    '  L="$(git rev-parse --git-dir 2>/dev/null)/index.lock"',
    '  if [ -f "$L" ] && [ -n "$(find "$L" -mmin +10 2>/dev/null)" ]; then rm -f "$L"; echo "Removed a stale git lock left in the desk." >&2; fi',
    '  if git checkout -q --force -B "$B" "$REF" && git reset -q --hard "$REF"; then git clean -fdq || true; echo "$W"; exit 0; fi',
    `  echo "Couldn't reuse the desk in place, so it's rebuilt." >&2`,
    '  cd "$R"; git worktree remove --force "$W" >/dev/null 2>&1 || true; rm -rf "$W"; git worktree prune',
    'fi',
    'rm -rf "$W"; mkdir -p "$(dirname "$W")"',
    'git worktree add -q -B "$B" "$W" "$REF"',
    'echo "$W"',
  ].join('\n');
}

/** Read-only, shallow copies of a floor's linked repos, fetched again for each task. Never fails the task. */
export function linkedReposScript(fullNames: string[]): string {
  const lines = ['set +e'];
  for (const fullName of fullNames) {
    checkRepo(fullName);
    const d = sq(boxLinkedDir(fullName));
    const url = sq(`https://github.com/${fullName}.git`);
    lines.push(
      `if [ -d ${d}/.git ]; then git -C ${d} fetch -q --depth 1 origin HEAD && git -C ${d} reset -q --hard FETCH_HEAD; else mkdir -p "$(dirname ${d})" && git clone -q --depth 1 ${url} ${d}; fi || echo ${sq(`⚠ Couldn't fetch ${fullName} for reference.`)}`,
    );
  }
  return lines.join('\n');
}

/**
 * The desk's dependencies, as deskDepsPlan decides on a local machine: nothing without a package.json, left to the
 * agent without a package-lock.json, skipped when node_modules matches, otherwise npm ci (`install`: false only looks,
 * and says DEPS_STALE where it would install). The last DEPS_ line is the outcome.
 */
export function depsScript(fullName: string, install = true): string {
  checkRepo(fullName);
  return [
    `cd ${sq(boxDeskDir(fullName))} || exit 1`,
    '[ -f package.json ] || { echo DEPS_NONE; exit 0; }',
    '[ -f package-lock.json ] || { echo DEPS_AGENT; exit 0; }',
    'H=$( (cat package.json; printf "\\0"; cat package-lock.json) | sha256sum | cut -c1-64)',
    'M=node_modules/.cubefarm-preview-install',
    'if [ -d node_modules ] && [ "$(cat "$M" 2>/dev/null)" = "$H" ]; then echo DEPS_SKIPPED; exit 0; fi',
    install
      ? 'if NO_COLOR=1 npm ci --no-audit --no-fund > /tmp/cubefarm-npm.log 2>&1; then echo "$H" > "$M"; echo DEPS_INSTALLED; else tail -n 3 /tmp/cubefarm-npm.log; echo DEPS_FAILED; fi'
      : 'echo DEPS_STALE',
  ].join('\n');
}

export type BoxDeps = 'none' | 'agent' | 'skipped' | 'stale' | 'installed' | 'failed';

/** What depsScript printed last. */
export function depsOutcome(output: string, code: number): BoxDeps {
  if (code !== 0) return 'failed';
  const last = output.split('\n').map((l) => l.trim()).filter((l) => /^DEPS_[A-Z]+$/.test(l)).pop() ?? '';
  const outcomes: Record<string, BoxDeps> = { DEPS_NONE: 'none', DEPS_AGENT: 'agent', DEPS_SKIPPED: 'skipped', DEPS_STALE: 'stale', DEPS_INSTALLED: 'installed' };
  return outcomes[last] ?? 'failed';
}

/** Stop what the agent left running: on its port, or started in its worktree, never its CLI (release.cjs). */
export const releaseScript = (port: number, fullName: string) => `node ${sq(`${BOX_BIN}/release.cjs`)} ${Math.trunc(port)} ${sq(boxDeskDir(fullName))} || true`;

/** Delete finished swarm/qa branches in the Box's clone that nothing in `keep` names and the worktree doesn't have out. */
export function sweepScript(fullName: string, keep: string[]): string {
  checkRepo(fullName);
  const kept = keep.filter((b) => BRANCH.test(b));
  return [
    `cd ${sq(boxRepoDir(fullName))} 2>/dev/null || exit 0`,
    'git worktree prune',
    `KEEP=" ${kept.join(' ')} $(git worktree list --porcelain | sed -n 's#^branch refs/heads/##p' | tr '\\n' ' ') "`,
    "git for-each-ref --format='%(refname:short)' refs/heads/swarm refs/heads/qa | while read -r b; do",
    '  case "$KEEP" in *" $b "*) ;; *) git branch -D "$b" >/dev/null 2>&1 && echo "SWEPT $b" ;; esac',
    'done',
  ].join('\n');
}

/** Save the worktree's modified files and unpushed commits to BOX_LEFTOVERS. Prints SAVED or NONE. */
export function leftoversScript(fullName: string): string {
  checkRepo(fullName);
  return [
    `cd ${sq(boxDeskDir(fullName))} 2>/dev/null || { echo NONE; exit 0; }`,
    'git rev-parse --verify -q HEAD >/dev/null || { echo NONE; exit 0; }',
    'D=$(git status --porcelain --untracked-files=no)',
    'C=$(git rev-list --count HEAD --not --remotes)',
    'if [ -z "$D" ] && [ "$C" = 0 ]; then echo NONE; exit 0; fi',
    'T=$(mktemp -d)',
    'if [ "$C" != 0 ]; then git format-patch -q -o "$T" HEAD --not --remotes; fi',
    'if [ -n "$D" ]; then git diff HEAD --binary --output="$T/zz-uncommitted.patch"; fi',
    `cat $(ls "$T"/* | sort) > ${sq(BOX_LEFTOVERS)}`,
    'rm -rf "$T"',
    'echo SAVED',
  ].join('\n');
}

/** The repos the Box has worktrees for (owner/repo). */
export const worktreesScript = () => `ls -1 ${sq(`${BOX_HOME}/work`)} 2>/dev/null | sed 's#__#/#' || true`;

/** Start a session's CLI in its own tmux server and attach to it (the launcher reads the command line from a file). */
export function tmuxStart(token: string, cols: number, rows: number): string {
  const launch = `node ${BOX_BIN}/launch.cjs ${boxSessionDir(token)}/launch.json`;
  return `exec tmux -L ${tmuxSocket(token)} -f ${sq(BOX_TMUX_CONF)} new-session -A -s main -x ${Math.max(20, Math.trunc(cols))} -y ${Math.max(5, Math.trunc(rows))} ${sq(launch)}`;
}

export const tmuxAttach = (token: string) => `exec tmux -L ${tmuxSocket(token)} attach -t main`;
export const tmuxAlive = (token: string) => `tmux -L ${tmuxSocket(token)} has-session -t main 2>/dev/null && echo ALIVE || echo GONE`;
export const tmuxKill = (token: string) => `tmux -L ${tmuxSocket(token)} kill-server >/dev/null 2>&1; rm -rf ${sq(boxSessionDir(token))}; true`;
/** The office's tmux servers still running in the Box, by socket name. */
export const tmuxList = () => `for s in /tmp/tmux-$(id -u)/cf-*; do [ -S "$s" ] && tmux -L "$(basename "$s")" has-session 2>/dev/null && basename "$s"; done; true`;

// ---------- signing a CLI in (its own login, kept in the Box user's home) ----------

/**
 * Is the Box's own copy of the CLI signed in? Only the exit code is looked at: the status itself (an email address,
 * an account) never leaves the Box. Prints CUBEFARM_SIGNED_IN or CUBEFARM_SIGNED_OUT.
 */
export function signInCheckScript(cli: 'claude' | 'codex'): string {
  const status = cli === 'claude' ? `${sq(`${BOX_CLI_BIN}/claude`)} auth status --json` : `${sq(`${BOX_CLI_BIN}/codex`)} login status`;
  return `if ${status} >/dev/null 2>&1; then echo CUBEFARM_SIGNED_IN; else echo CUBEFARM_SIGNED_OUT; fi`;
}

/** What signInCheckScript said: true, false, or null when it didn't run. */
export function signInOutcome(output: string): boolean | null {
  const last = output.split('\n').map((l) => l.trim()).filter((l) => /^CUBEFARM_SIGNED_(IN|OUT)$/.test(l)).pop();
  return last ? last === 'CUBEFARM_SIGNED_IN' : null;
}

/** Forget a login the CLI's servers turned away, so the next check says signed out until the manager signs in again. */
export const signOutScript = (cli: 'claude' | 'codex') => `${sq(`${BOX_CLI_BIN}/${cli}`)} ${cli === 'claude' ? 'auth logout' : 'logout'} >/dev/null 2>&1; true`;

/**
 * The CLI's own sign-in, in a terminal with no browser: Claude Code shows a link and asks for the code the page gives
 * back; Codex shows a link and a one-time code for the page (its usual login waits for a browser on the Box itself).
 */
export const signInCommand = (cli: 'claude' | 'codex') => ({ file: `${BOX_CLI_BIN}/${cli}`, args: cli === 'claude' ? ['auth', 'login'] : ['login', '--device-auth'] });

/** What the launcher runs: the CLI's command line, where, and the session's events file (for its exit). */
export interface LaunchSpec {
  file: string;
  args: string[];
  cwd: string;
  events: string;
}
