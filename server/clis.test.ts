import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxVersions, CODEX_HOOK_EVENTS, codexHookCommand, CROSS_TURN_TOOLS, hookReviewKey, interruptions, launchArgs, localUrl, nextSession, oneAtATime, openCodePromptReady, OPENCODE_PLUGIN_SOURCE, signedOutScreen, trustKey, unwrapCmdShim, writeOpenCodeVariantState, type LaunchContext } from './clis.ts';
import { LOCAL_PROVIDERS } from '../shared/models.ts';
import { describeOfficeTool, describeTool, newScreenshots, screenshotFile, summariseResult } from './agentRunner.ts';

const dir = path.join(os.tmpdir(), 'npm-global');

describe('nextSession', () => {
  const terminal = { runtime: 'terminal', defaultCli: 'claude' } as const;
  const sdk = { runtime: 'sdk', defaultCli: 'claude' } as const;
  const agent = { role: 'agent', cli: '', sessionCli: null } as const;

  it("runs the CLI the agent picked, not the one their last session belongs to", () => {
    // The manager moved this agent to OpenCode after a Claude Code session existed: the next session is OpenCode's, and
    // the Claude session is left alone rather than resumed behind their back.
    expect(nextSession({ ...agent, cli: 'opencode', sessionCli: 'claude' }, terminal, true, 'claude-1')).toEqual({ cli: 'opencode', resume: undefined });
    expect(nextSession({ role: 'ceo', cli: 'codex', sessionCli: 'claude' }, terminal, true, 'claude-1')).toEqual({ cli: 'codex', resume: undefined });
  });

  it('follows up in the same session while the CLI is unchanged', () => {
    expect(nextSession({ ...agent, cli: 'opencode', sessionCli: 'opencode' }, terminal, true, 'oc-1')).toEqual({ cli: 'opencode', resume: 'oc-1' });
    expect(nextSession({ ...agent, cli: '', sessionCli: 'claude' }, terminal, true, 'claude-1')).toEqual({ cli: 'claude', resume: 'claude-1' });
  });

  it('gives the CEO a concrete coding agent, always', () => {
    expect(nextSession({ role: 'ceo', cli: '', sessionCli: null }, terminal, true).cli).toBe('claude');
    expect(nextSession({ role: 'ceo', cli: 'opencode', sessionCli: null }, terminal, true).cli).toBe('opencode');
  });

  it('runs an agent with no pick of their own on the office default', () => {
    expect(nextSession(agent, { runtime: 'terminal', defaultCli: 'codex' }, true).cli).toBe('codex');
  });

  it('keeps a Claude session in the Agent SDK, which only ever runs Claude Code', () => {
    expect(nextSession({ ...agent, cli: 'opencode', sessionCli: 'claude' }, sdk, false, 'claude-1')).toEqual({ cli: 'opencode', resume: 'claude-1' });
    expect(nextSession({ ...agent, cli: '', sessionCli: 'codex' }, sdk, false, 'codex-1').resume).toBe(undefined);
  });

  it('follows a session already running in its CLI, whatever the agent picked since', () => {
    // The manager typed at the Claude Code prompt, or Claude Code kept working through a restart: switching to the new
    // pick here would kill the CLI doing the work and mislabel its session as OpenCode's.
    expect(nextSession({ ...agent, cli: 'opencode', sessionCli: 'claude' }, terminal, true, 'claude-1', true)).toEqual({ cli: 'claude', resume: 'claude-1' });
    // Nothing running to follow: the pick wins as usual.
    expect(nextSession({ ...agent, cli: 'opencode', sessionCli: 'claude' }, terminal, true, undefined, true)).toEqual({ cli: 'opencode', resume: undefined });
  });
});

describe('unwrapCmdShim', () => {
  it('runs node on the script a node shim points at, keeping its node flags', () => {
    const shim = [
      '@ECHO off',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" --no-warnings=DEP0040 "%dp0%\\node_modules\\@acme\\cli\\bin\\cli.js" %*',
    ].join('\r\n');
    expect(unwrapCmdShim(path.join(dir, 'cli.cmd'), shim)).toEqual({ file: process.execPath, args: ['--no-warnings=DEP0040', path.join(dir, 'node_modules\\@acme\\cli\\bin\\cli.js')] });
  });

  it('runs the executable an exe shim points at', () => {
    const shim = '@ECHO off\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n';
    expect(unwrapCmdShim(path.join(dir, 'opencode.cmd'), shim)).toEqual({ file: path.join(dir, 'node_modules\\opencode-ai\\bin\\opencode.exe'), args: [] });
  });

  it('gives up on shims it does not recognise', () => {
    expect(unwrapCmdShim(path.join(dir, 'x.cmd'), '@echo off\r\necho hi\r\n')).toBeNull();
  });
});

describe('trustKey', () => {
  it("moves Claude Code's trust question off its default \"No, exit\", then confirms \"Yes\"", () => {
    const question = (selected: 'no' | 'yes') =>
      [
        'Accessing workspace:',
        'C:\\Users\\me\\.cubefarm\\workspaces\\me__app\\desks\\ada-01df',
        'Quick safety check: Is this a project you created or one you trust?',
        "Claude Code'll be able to read, edit, and execute files here.",
        selected === 'no' ? '❯ No, exit' : '  No, exit',
        selected === 'yes' ? '❯ Yes, I trust this folder' : '  Yes, I trust this folder',
        'Enter to confirm · Esc to cancel',
      ].join('\n');
    expect(trustKey(question('no'))).toBe('down');
    expect(trustKey(question('yes'))).toBe('enter');
  });

  it("confirms Codex's trust question, whose first option is yes", () => {
    const screen = ['> You are in C:\\desk', '  Do you trust the contents of this directory?', '› 1. Yes, continue', '  2. No, quit'].join('\n');
    expect(trustKey(screen)).toBe('enter');
  });

  it('leaves every other screen alone', () => {
    expect(trustKey('❯ Try "refactor <filepath>"')).toBeNull();
  });
});

describe('hookReviewKey', () => {
  const review = (selected: 1 | 3) =>
    ['  Hooks need review', '  5 hooks are new or changed.', `${selected === 1 ? '›' : ' '} 1. Review hooks`, '  2. Trust all and continue', `${selected === 3 ? '›' : ' '} 3. Continue without trusting (hooks won't run)`].join('\n');

  it("goes on without the office's hooks, leaving trust to the manager", () => {
    expect(hookReviewKey(review(1))).toBe('down');
    expect(hookReviewKey(review(3))).toBe('enter');
    expect(hookReviewKey('› Ask Codex to do anything')).toBeNull();
  });
});

describe('interruptions', () => {
  it('counts the lines where a CLI says it interrupted a turn', () => {
    expect(interruptions(['● Bash(sleep 4)', '  ⎿  Interrupted · What should Claude do instead?', '❯ '].join('\n'))).toBe(1);
    expect(interruptions('■ Conversation interrupted - tell the model what to do differently.\n› ')).toBe(1);
    expect(interruptions('● done\n❯ ')).toBe(0);
  });
});

describe('signedOutScreen', () => {
  it("spots a CLI saying its login is gone, in each CLI's own words", () => {
    expect(signedOutScreen('⎿  API Error: 401 · Login expired · Please run /login')).toBe(true);
    expect(signedOutScreen('Not logged in · Please run /login')).toBe(true);
    expect(signedOutScreen('OAuth token revoked · Please run /login')).toBe(true);
    expect(signedOutScreen('Failed to authenticate: OAuth session expired and could not be refreshed')).toBe(true);
    expect(signedOutScreen('■ Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.')).toBe(true);
    expect(signedOutScreen("Not signed in. Please run 'codex login' to sign in with ChatGPT")).toBe(true);
  });

  it('leaves ordinary failures alone', () => {
    expect(signedOutScreen('● The tests fail: expected 401 from /api/login, got 200\n❯ ')).toBe(false);
    expect(signedOutScreen('Claude Code exited with code 1 before finishing.')).toBe(false);
  });
});

describe('launchArgs', () => {
  const ctx = (patch: Partial<LaunchContext> = {}): LaunchContext => ({
    prompt: '--looks like a flag',
    systemAppend: 'You are Ada.',
    model: '',
    effort: 'medium',
    sessionId: '11111111-1111-1111-1111-111111111111',
    name: 'Ada · #1',
    role: 'agent',
    additionalDirectories: [],
    files: { settings: 'settings.json', mcp: null, system: 'instructions.md' },
    notify: { script: 'notify.cjs', url: 'http://127.0.0.1:1/api/hooks/t' },
    codexHook: 'codex-hook.cjs',
    plugin: 'file:///plugin.mjs',
    browser: null,
    office: null,
    ...patch,
  });
  it('starts Claude Code on a chosen session id, with the prompt after --', () => {
    const { args } = launchArgs('claude', ctx());
    expect(args.slice(0, 2)).toEqual(['--session-id', '11111111-1111-1111-1111-111111111111']);
    expect(args.slice(-2)).toEqual(['--', '--looks like a flag']);
    // the manager's own setup loads: no limiting its setting sources or MCP servers
    expect(args).not.toContain('--setting-sources');
    expect(args).not.toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');
  });

  it("resumes Claude Code sessions and keeps the CEO's hands off the shell", () => {
    const { args } = launchArgs('claude', ctx({ resumeId: 'abc', role: 'ceo', files: { settings: 's', mcp: 'mcp.json', system: 'i' } }));
    expect(args.slice(0, 2)).toEqual(['--resume', 'abc']);
    expect(args).toContain('--mcp-config');
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--'))).toEqual(['--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS, 'Bash', 'PowerShell', 'NotebookEdit']);
  });

  it('keeps the CEO off the shell in Codex and OpenCode', () => {
    const codex = launchArgs('codex', ctx({ role: 'ceo' })).args;
    expect(codex).toContain('features.shell_tool=false');
    expect(codex).toContain('features.multi_agent=false');
    expect(codex).toContain('--sandbox');
    expect(codex[codex.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(codex).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    const opencode = JSON.parse(launchArgs('opencode', ctx({ role: 'ceo' })).env.OPENCODE_CONFIG_CONTENT);
    expect(opencode.permission.bash).toBe('deny');
    expect(opencode.permission.edit).toBe('deny');
    expect(opencode.permission.task).toBe('deny');
  });

  it('keeps tools that wait across turns away from Claude Code, but not background shells', () => {
    const { args } = launchArgs('claude', ctx());
    expect(CROSS_TURN_TOOLS).toEqual(['Monitor', 'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger']);
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--'))).toEqual(['--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS]);
    for (const cli of ['codex', 'opencode'] as const) expect(launchArgs(cli, ctx()).args.some((a) => a.includes('Monitor') || a.includes('ScheduleWakeup'))).toBe(false);
  });

  it("runs Codex without its sandbox or approvals, and resumes Codex's thread", () => {
    const fresh = launchArgs('codex', ctx()).args;
    expect(fresh).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(fresh).not.toContain('--sandbox');
    expect(fresh.slice(-2)).toEqual(['--', '--looks like a flag']);
    const resumed = launchArgs('codex', ctx({ resumeId: 'thread-1' })).args;
    expect(resumed[0]).toBe('resume');
    expect(resumed.slice(-2)).toEqual(['thread-1', '--looks like a flag']);
    expect(resumed).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it("gives Codex the office's hooks, with the office's address in its environment", () => {
    const { args, env } = launchArgs('codex', ctx());
    const hooks = args.filter((a) => a.startsWith('hooks.'));
    expect(hooks.map((h) => h.slice(6, h.indexOf('=')))).toEqual(CODEX_HOOK_EVENTS);
    expect(hooks[0]).toContain('type="command"');
    expect(env.CUBEFARM_HOOK_URL).toBe('http://127.0.0.1:1/api/hooks/t');
  });

  it('runs the hook program with a command that never starts with a quote on Windows', () => {
    expect(codexHookCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\A B\\.cubefarm\\bin\\codex-hook.cjs', true)).toBe('node "C:\\Users\\A B\\.cubefarm\\bin\\codex-hook.cjs"');
    expect(codexHookCommand('/usr/bin/node', "/home/o'neil/.cubefarm/bin/codex-hook.cjs", false)).toBe(`'/usr/bin/node' '/home/o'"'"'neil/.cubefarm/bin/codex-hook.cjs'`);
  });

  it("lets OpenCode run without stopping to ask, and without updating itself", () => {
    const config = (patch: Partial<LaunchContext>) => JSON.parse(launchArgs('opencode', ctx(patch)).env.OPENCODE_CONFIG_CONTENT);
    for (const role of ['agent'] as const) expect(config({ role }).permission).toEqual({ edit: 'allow', bash: 'allow', webfetch: 'allow' });
    expect(config({}).autoupdate).toBe(false);
  });

  it('keeps the manager-selected OpenCode agent when setting effort', () => {
    const launch = launchArgs('opencode', ctx({ model: 'opencode/space-bunny-free', effort: 'high' }));
    expect(launch.args).not.toContain('--agent');
    expect(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT).agent).toBeUndefined();
  });

  it('resumes OpenCode without --prompt so the terminal can submit it after loading', () => {
    const args = launchArgs('opencode', ctx({ resumeId: 'old-session', prompt: 'New question' })).args;
    expect(args).toContain('--session');
    expect(args).toContain('old-session');
    expect(args).not.toContain('--prompt');
    expect(args).not.toContain('New question');
    expect(launchArgs('opencode', ctx({ prompt: 'First question' })).args).toContain('--prompt');
  });

  it('recognizes the OpenCode prompt only after its terminal is ready', () => {
    expect(openCodePromptReady('Sisyphus · GLM-5.3-Flash Free OpenCode · max\nctrl+p commands')).toBe(true);
    expect(openCodePromptReady('Loading session…')).toBe(false);
  });

  it('passes the selected OpenCode effort to its prompt hook', async () => {
    const { env } = launchArgs('opencode', ctx({ model: 'opencode/space-bunny-free', effort: 'high' }));
    expect(env.CUBEFARM_OPENCODE_VARIANT).toBe('high');
    const before = process.env.CUBEFARM_OPENCODE_VARIANT;
    const beforeUrl = process.env.CUBEFARM_NOTIFY_URL;
    const beforeFetch = globalThis.fetch;
    const posted: unknown[] = [];
    globalThis.fetch = async (_url, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    };
    process.env.CUBEFARM_OPENCODE_VARIANT = env.CUBEFARM_OPENCODE_VARIANT;
    process.env.CUBEFARM_NOTIFY_URL = env.CUBEFARM_NOTIFY_URL;
    try {
      const { default: plugin } = await import(`data:text/javascript,${encodeURIComponent(OPENCODE_PLUGIN_SOURCE)}`);
      const hooks = await plugin({ client: {} });
      const output = { message: { model: { providerID: 'opencode', modelID: 'space-bunny-free', variant: 'max' } }, parts: [] };
      await hooks['chat.message']({ sessionID: 'session-high' }, output);
      expect(output.message.model.variant).toBe('high');
      expect(posted).toEqual([{ hook_event_name: 'PromptAccepted', session_id: 'session-high' }]);
    } finally {
      globalThis.fetch = beforeFetch;
      if (before === undefined) delete process.env.CUBEFARM_OPENCODE_VARIANT;
      else process.env.CUBEFARM_OPENCODE_VARIANT = before;
      if (beforeUrl === undefined) delete process.env.CUBEFARM_NOTIFY_URL;
      else process.env.CUBEFARM_NOTIFY_URL = beforeUrl;
    }
  });

  it('seeds OpenCode TUI state for the selected model without sharing variants between sessions', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-opencode-'));
    try {
      writeOpenCodeVariantState(home, 'opencode/space-bunny-free', 'high');
      const saved = JSON.parse(fs.readFileSync(path.join(home, 'opencode', 'model.json'), 'utf8'));
      expect(saved.variant).toEqual({ 'opencode/space-bunny-free': 'high' });
      writeOpenCodeVariantState(home, 'glm-5.3-flash-free', 'medium');
      const bare = JSON.parse(fs.readFileSync(path.join(home, 'opencode', 'model.json'), 'utf8'));
      expect(bare.variant).toEqual({ 'opencode/glm-5.3-flash-free': 'medium' });
      writeOpenCodeVariantState(home, 'llama.cpp/qwen/coder', 'low');
      const local = JSON.parse(fs.readFileSync(path.join(home, 'opencode', 'model.json'), 'utf8'));
      expect(local.variant).toEqual({ 'llamacpp/qwen/coder': 'low' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("gives the CEO's office tools to whichever CLI runs them", () => {
    const office = { url: 'http://127.0.0.1:4317/api/mcp/tok' };
    const browser = { command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
    // Claude Code reads them from the MCP config file cliRunner wrote, so it takes no -c of its own.
    expect(launchArgs('claude', ctx({ office })).args.some((a) => a.startsWith('mcp_servers.office'))).toBe(false);
    const codex = launchArgs('codex', ctx({ office })).args;
    expect(codex).toContain('mcp_servers.office={url="http://127.0.0.1:4317/api/mcp/tok",default_tools_approval_mode="approve"}');
    expect(launchArgs('codex', ctx()).args.some((a) => a.startsWith('mcp_servers.office'))).toBe(false);
    const config = (patch: Partial<LaunchContext>) => JSON.parse(launchArgs('opencode', ctx(patch)).env.OPENCODE_CONFIG_CONTENT);
    expect(config({ office }).mcp.office).toEqual({ type: 'remote', url: office.url, enabled: true });
    expect(config({}).mcp).toBeUndefined();
    expect(config({ browser, office }).mcp).toEqual({
      playwright: { type: 'local', command: ['npx', '-y', '@playwright/mcp@latest'], enabled: true },
      office: { type: 'remote', url: office.url, enabled: true },
    });
  });

  it('runs Codex on a local model through its own --oss, or a provider of the office\'s', () => {
    const args = (model: string) => launchArgs('codex', ctx({ model })).args;
    expect(args('gpt-5.5').join(' ')).toContain('-m gpt-5.5');
    expect(args('gpt-5.5')).not.toContain('--oss');
    expect(args('ollama/gpt-oss:20b').join(' ')).toContain('--oss --local-provider ollama -m gpt-oss:20b');
    const llama = args('llamacpp/default');
    expect(llama).not.toContain('--oss');
    expect(llama).toContain('model_providers.cubefarm-llamacpp={name="llama.cpp",base_url="http://127.0.0.1:8080/v1",wire_api="responses"}');
    expect(llama).toContain('model_provider="cubefarm-llamacpp"');
    expect(llama.slice(llama.indexOf('-m'), llama.indexOf('-m') + 2)).toEqual(['-m', 'default']);
  });

  it('gives OpenCode the local server a model runs on', () => {
    const launch = launchArgs('opencode', ctx({ model: 'llama.cpp/qwen/coder' }));
    expect(launch.args.slice(launch.args.indexOf('--model'), launch.args.indexOf('--model') + 2)).toEqual(['--model', 'llamacpp/qwen/coder']);
    expect(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT).provider).toEqual({
      llamacpp: { npm: '@ai-sdk/openai-compatible', name: 'llama.cpp', options: { baseURL: 'http://127.0.0.1:8080/v1' }, models: { 'qwen/coder': { name: 'qwen/coder' } } },
    });
    expect(JSON.parse(launchArgs('opencode', ctx({ model: 'anthropic/claude-opus-5-5' })).env.OPENCODE_CONFIG_CONTENT).provider).toBeUndefined();
  });
});

describe('localUrl', () => {
  it('takes a local server\'s address from the environment when set', () => {
    const ollama = LOCAL_PROVIDERS[0];
    expect(localUrl(ollama, {})).toBe('http://127.0.0.1:11434/v1');
    expect(localUrl(ollama, { CUBEFARM_OLLAMA_URL: ' http://gpu-box:11434/v1 ' })).toBe('http://gpu-box:11434/v1');
  });
});

describe('oneAtATime', () => {
  it("runs a thread's archive and unarchive in order, other threads alongside, past a step that fails", async () => {
    const steps = oneAtATime();
    const done: string[] = [];
    let release!: () => void;
    const exited = new Promise<void>((r) => (release = r));
    const archive = steps('a', async () => {
      await exited;
      done.push('archive a');
      throw new Error('already archived');
    });
    const unarchive = steps('a', async () => void done.push('unarchive a'));
    await steps('b', async () => void done.push('archive b'));
    expect(done).toEqual(['archive b']);
    release();
    await expect(archive).resolves.toBeUndefined();
    await unarchive;
    expect(done).toEqual(['archive b', 'archive a', 'unarchive a']);
  });
});

describe('screenshotFile', () => {
  it("reads a Playwright screenshot that was saved to a file instead of returned inline", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-shot-'));
    fs.mkdirSync(path.join(cwd, '.playwright-mcp'));
    fs.writeFileSync(path.join(cwd, '.playwright-mcp', 'pr16-375.png'), 'png-bytes');
    const shot = screenshotFile(cwd, '### Result\n- [Screenshot of viewport](.playwright-mcp/pr16-375.png)');
    expect(shot?.mime).toBe('image/png');
    expect(shot?.data.toString()).toBe('png-bytes');
    expect(screenshotFile(cwd, '### Result\n- no link here')).toBeNull();
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe("Codex's file edits in the log", () => {
  it('names the files an apply_patch touches, and says when it worked', () => {
    const patch = '*** Begin Patch\n*** Add File: notes.txt\n+hi\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch';
    expect(describeTool(dir, 'apply_patch', { command: patch })).toBe('Edit add notes.txt, src/app.ts');
    expect(summariseResult(dir, 'apply_patch', 'Exit code: 0\nOutput:\nSuccess. Updated the following files:\nA notes.txt')).toEqual([{ kind: 'result', text: '  ⎿ Updated' }]);
    expect(summariseResult(dir, 'apply_patch', 'error: patch did not apply')[0].text).toContain('patch did not apply');
  });
});

describe("the CEO's office tools in the log", () => {
  it('says what each one asks for', () => {
    expect(describeOfficeTool('scale_team', { floor: 2, size: 5, reason: 'Six issues ready, two agents free' })).toBe('📈 scale_team floor 2 → 5: Six issues ready, two agents free');
    expect(describeOfficeTool('configure_agent', { agent_id: 'ada', cli: 'codex', model: '' })).toBe('⚙️ configure_agent ada: codex');
    expect(describeOfficeTool('set_dependencies', { floor: 1, number: 7, depends_on: [3, 4] })).toBe('🔗 set_dependencies #7 → floor 1 · depends on #3, #4');
    expect(describeOfficeTool('set_dependencies', { floor: 1, number: 7, depends_on: [] })).toBe('🔗 set_dependencies #7 → floor 1 · depends on nothing');
    expect(describeOfficeTool('file_issue', { floor: 1, title: 'Dark mode', body: 'x' })).toBe('📝 file_issue "Dark mode" → floor 1');
  });
});

describe('newScreenshots', () => {
  it("picks up the images a browser saved, oldest first, once they're written and only once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-'));
    const later = Date.now() + 5000;
    for (const f of ['page-2026-09-29T10-00-02-000Z.jpeg', 'page-2026-09-29T10-00-01-000Z.png', 'page-2026-09-29T10-00-00-000Z.yml']) fs.writeFileSync(path.join(dir, f), 'x');
    const seen = new Set<string>();
    expect(newScreenshots(dir, seen)).toEqual([]); // just written: may still be in progress
    const found = newScreenshots(dir, seen, later);
    expect(found.map((s) => [s.name, s.mime])).toEqual([
      ['page-2026-09-29T10-00-01-000Z.png', 'image/png'],
      ['page-2026-09-29T10-00-02-000Z.jpeg', 'image/jpeg'],
    ]);
    seen.add(found[0].name);
    expect(newScreenshots(dir, seen, later).map((s) => s.name)).toEqual(['page-2026-09-29T10-00-02-000Z.jpeg']);
    expect(newScreenshots(path.join(dir, 'missing'), seen, later)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('boxVersions', () => {
  it("pins cloud agents' Claude Code and Playwright MCP to the office's own versions", () => {
    const v = boxVersions();
    expect(v.claude).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.playwrightMcp).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.codex).toMatch(/^\d+\.\d+\.\d+/);
  });
});
