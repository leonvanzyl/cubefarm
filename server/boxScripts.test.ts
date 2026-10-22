import { describe, expect, it } from 'vitest';
import {
  boxDeskDir,
  boxLinkedDir,
  boxRepoDir,
  depsOutcome,
  depsScript,
  leftoversScript,
  linkedReposScript,
  prepareDeskScript,
  releaseScript,
  setupMarker,
  setupScript,
  signInCheckScript,
  signInCommand,
  signInOutcome,
  signOutScript,
  sq,
  sweepScript,
  tmuxAttach,
  tmuxSocket,
  tmuxStart,
} from './boxScripts.ts';

const versions = { claude: '2.1.283', playwrightMcp: '0.0.83', codex: '0.163.0' };

describe('sq', () => {
  it('makes one shell word of anything, quotes included', () => {
    expect(sq('plain')).toBe("'plain'");
    expect(sq("it's")).toBe(`'it'"'"'s'`);
    expect(sq('$(rm -rf /) `x` "y"')).toBe(`'$(rm -rf /) \`x\` "y"'`);
  });
});

describe('Box folders', () => {
  it("keeps each repo's clone, worktree and linked copy under the Box's home", () => {
    expect(boxRepoDir('acme/web')).toBe('/workspace/home/repos/acme__web');
    expect(boxDeskDir('acme/web')).toBe('/workspace/home/work/acme__web');
    expect(boxLinkedDir('acme/api')).toBe('/workspace/home/linked/acme__api');
  });

  it('gives each session a tmux server of its own, named from its token', () => {
    expect(tmuxSocket('3f2a9c1e-77b0-4c2d-9e5f-0a1b2c3d4e5f')).toBe('cf-3f2a9c1e77b0');
    expect(tmuxStart('3f2a9c1e-77b0-4c2d-9e5f-0a1b2c3d4e5f', 120, 40)).toContain('tmux -L cf-3f2a9c1e77b0');
    expect(tmuxStart('t', 120, 40)).toContain('new-session -A -s main -x 120 -y 40');
    expect(tmuxAttach('t')).toBe('exec tmux -L cf-t attach -t main');
  });
});

describe('setupScript', () => {
  const script = setupScript({ versions, rev: 1, gitName: "Ada O'Neil", gitEmail: 'ada@example.com' });

  it('installs the pinned CLIs and tmux, once per set of versions', () => {
    expect(script).toContain(`npm install -g --prefix '/workspace/home/.cubefarm/cli'`);
    expect(script).toContain(`'@anthropic-ai/claude-code@2.1.283' '@playwright/mcp@0.0.83' '@openai/codex@0.163.0'`);
    expect(script).not.toContain('sudo npm');
    expect(script).toContain('for t in tmux lsof gh');
    expect(script).toContain(`if [ -f '${setupMarker(versions, 1)}' ]`);
    expect(setupMarker(versions, 1)).not.toBe(setupMarker({ ...versions, claude: '2.1.300' }, 1));
    expect(script.trim().endsWith('echo CUBEFARM_SETUP_OK')).toBe(true);
  });

  it("gives git a helper that reads GitHub's token from the environment, never from disk", () => {
    expect(script).toContain('git config --global --unset-all credential.helper');
    expect(script).toContain('password=$GH_TOKEN');
    expect(script).not.toMatch(/ghp_|github_pat_/);
  });

  it("signs commits with the manager's identity, quoted", () => {
    expect(script).toContain(`git config --global user.name 'Ada O'"'"'Neil'`);
    expect(script).toContain(`git config --global user.email 'ada@example.com'`);
  });
});

describe('prepareDeskScript', () => {
  it("clones the repo the first time and puts the worktree on a new branch from the default branch's tip", () => {
    const s = prepareDeskScript('acme/web', { defaultBranch: 'main' }, 'swarm/issue-12-ada');
    expect(s).toContain(`git clone -q --no-checkout 'https://github.com/acme/web.git' "$R"`);
    expect(s).toContain(`REF='origin/main'`);
    expect(s).toContain(`B='swarm/issue-12-ada'`);
    expect(s).toContain('git worktree add -q -B "$B" "$W" "$REF"');
    expect(s).not.toContain('refs/pull');
  });

  it("fetches a PR's head for QA and fixes", () => {
    const s = prepareDeskScript('acme/web', { defaultBranch: 'main', pr: 7 }, 'qa/pr-7-ada');
    expect(s).toContain(`'+refs/pull/7/head:refs/remotes/origin/pr/7'`);
    expect(s).toContain(`REF='origin/pr/7'`);
    expect(s).toContain('Could not fetch pull request #7 of acme/web.');
  });

  it('refuses names that could break out of the script', () => {
    expect(() => prepareDeskScript('acme/web; rm -rf ~', { defaultBranch: 'main' }, 'b')).toThrow(/repository/);
    expect(() => prepareDeskScript('acme/web', { defaultBranch: 'main' }, "x'; rm -rf ~")).toThrow(/branch/);
  });
});

describe('the other desk scripts', () => {
  it('fetches linked repos shallowly and never fails the task over them', () => {
    const s = linkedReposScript(['acme/api']);
    expect(s.startsWith('set +e')).toBe(true);
    expect(s).toContain(`git clone -q --depth 1 'https://github.com/acme/api.git' '/workspace/home/linked/acme__api'`);
  });

  it('installs dependencies only from a lockfile that changed', () => {
    expect(depsScript('acme/web')).toContain('npm ci --no-audit --no-fund');
    expect(depsScript('acme/web', false)).toContain('echo DEPS_STALE');
    expect(depsScript('acme/web', false)).not.toContain('npm ci');
  });

  it('reads what the deps script said', () => {
    expect(depsOutcome('DEPS_NONE\n', 0)).toBe('none');
    expect(depsOutcome('DEPS_AGENT', 0)).toBe('agent');
    expect(depsOutcome('DEPS_SKIPPED', 0)).toBe('skipped');
    expect(depsOutcome('DEPS_STALE', 0)).toBe('stale');
    expect(depsOutcome('added 300 packages\nDEPS_INSTALLED\n', 0)).toBe('installed');
    expect(depsOutcome('npm ERR! 404\nDEPS_FAILED', 0)).toBe('failed');
    expect(depsOutcome('DEPS_INSTALLED', 1)).toBe('failed');
    expect(depsOutcome('', 0)).toBe('failed');
  });

  it('keeps the branches it is told to and the one checked out', () => {
    const s = sweepScript('acme/web', ['swarm/issue-3-ada', 'bad branch name']);
    expect(s).toContain('swarm/issue-3-ada');
    expect(s).not.toContain('bad branch name');
    expect(s).toContain('git branch -D "$b"');
  });

  it("saves unpushed work as a patch before a Box goes, and stops only the agent's leftovers", () => {
    expect(leftoversScript('acme/web')).toContain('git format-patch -q -o "$T" HEAD --not --remotes');
    expect(releaseScript(4105.7, 'acme/web')).toBe(`node '/workspace/home/.cubefarm/bin/release.cjs' 4105 '/workspace/home/work/acme__web' || true`);
  });
});

describe('signing a CLI in', () => {
  it("asks the Box's own CLI whether it's signed in, by its exit code only", () => {
    expect(signInCheckScript('claude')).toBe(`if '/workspace/home/.cubefarm/cli/bin/claude' auth status --json >/dev/null 2>&1; then echo CUBEFARM_SIGNED_IN; else echo CUBEFARM_SIGNED_OUT; fi`);
    expect(signInCheckScript('codex')).toContain(`'/workspace/home/.cubefarm/cli/bin/codex' login status >/dev/null 2>&1`);
  });

  it('reads what the check said, and nothing when it never ran', () => {
    expect(signInOutcome('CUBEFARM_SIGNED_IN\n')).toBe(true);
    expect(signInOutcome('some noise\nCUBEFARM_SIGNED_OUT')).toBe(false);
    expect(signInOutcome('bash: line 1: claude: not found')).toBeNull();
    expect(signInOutcome('')).toBeNull();
  });

  it("runs each CLI's own login, the one that works without a browser on the Box", () => {
    expect(signInCommand('claude')).toEqual({ file: '/workspace/home/.cubefarm/cli/bin/claude', args: ['auth', 'login'] });
    expect(signInCommand('codex')).toEqual({ file: '/workspace/home/.cubefarm/cli/bin/codex', args: ['login', '--device-auth'] });
    expect(signOutScript('claude')).toContain(`claude' auth logout`);
    expect(signOutScript('codex')).toContain(`codex' logout`);
  });
});
