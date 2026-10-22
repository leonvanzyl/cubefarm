import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { BOX_HELPERS } from './boxHelpers.ts';
import { EventLines } from './boxCli.ts';

// The helpers run in a Box with its node; here they run with this one, in a temp folder, the way the CLIs call them.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-boxhelpers-'));
for (const [name, source] of Object.entries(BOX_HELPERS)) fs.writeFileSync(path.join(dir, name), source);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const node = (script: string, args: string[], input = '', env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [path.join(dir, script), ...args], { input, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20_000 });

const events = (file: string) => new EventLines(0).push(fs.readFileSync(file, 'utf8'));

describe('hook.cjs', () => {
  it('writes each hook to the events file as one ASCII line, and approves tool calls', () => {
    const file = path.join(dir, 'hook-events.jsonl');
    const r = node('hook.cjs', [file], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo “héllo” 🚀' } }));
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toMatch(/^[\x00-\x7f]*$/);
    expect(raw.split('\n')).toHaveLength(2);
    expect(events(file)[0]).toMatchObject({ hook_event_name: 'PreToolUse', tool_input: { command: 'echo “héllo” 🚀' } });
  });

  it("cuts big tool output but keeps screenshots, and says whether the transcript is there", () => {
    const file = path.join(dir, 'hook-big.jsonl');
    const image = 'A'.repeat(20_000);
    const r = node(
      'hook.cjs',
      [file],
      JSON.stringify({ hook_event_name: 'PostToolUse', transcript_path: path.join(dir, 'nope.jsonl'), tool_response: [{ type: 'text', text: 'x'.repeat(20_000) }, { type: 'image', source: { type: 'base64', data: image } }] }),
    );
    expect(r.stdout).toBe('');
    const [ev] = events(file) as [{ transcript_exists: boolean; tool_response: { text?: string; source?: { data: string } }[] }];
    expect(ev.transcript_exists).toBe(false);
    expect(ev.tool_response[0].text!.length).toBeLessThan(6000);
    expect(ev.tool_response[1].source!.data).toBe(image);
  });
});

describe('statusline.cjs', () => {
  it("passes on cost and limits only when they change, and prints the office's line", () => {
    const file = path.join(dir, 'status.jsonl');
    const status = JSON.stringify({ session_id: 's', cost: { total_cost_usd: 0.5 }, rate_limits: {} });
    expect(node('statusline.cjs', [file], status, { CUBEFARM_STATUS: '🏢 cubefarm · Ada' }).stdout).toBe('🏢 cubefarm · Ada');
    node('statusline.cjs', [file], status);
    node('statusline.cjs', [file], JSON.stringify({ session_id: 's', cost: { total_cost_usd: 0.7 }, rate_limits: {} }));
    expect(events(file).map((e) => (e.cost as { total_cost_usd: number }).total_cost_usd)).toEqual([0.5, 0.7]);
  });
});

describe('notify.cjs and codex-hook.cjs', () => {
  it("turn Codex's finished turns and hooks into events", () => {
    const file = path.join(dir, 'codex.jsonl');
    node('notify.cjs', [file, JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 't1', 'last-assistant-message': 'PR opened', 'input-messages': ['Fix #3'] })]);
    node('notify.cjs', [file, JSON.stringify({ type: 'something-else' })]);
    node('codex-hook.cjs', [], JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'shell' }), { CUBEFARM_HOOK_URL: file });
    expect(events(file)).toEqual([
      { hook_event_name: 'TurnComplete', session_id: 't1', last_assistant_message: 'PR opened', input: 'Fix #3' },
      { hook_event_name: 'PreToolUse', tool_name: 'shell' },
    ]);
  });
});

describe('launch.cjs', () => {
  it("starts the command line from its file, with no shell, and notes the CLI's exit", () => {
    const file = path.join(dir, 'launch-events.jsonl');
    const spec = path.join(dir, 'launch.json');
    // A prompt full of shell syntax reaches the program as one argument, untouched.
    const prompt = `$(echo nope); "quoted" 'single' && exit 9`;
    fs.writeFileSync(spec, JSON.stringify({ file: process.execPath, args: ['-e', 'console.log(process.argv[1]); process.exit(3)', prompt], cwd: dir, events: file }));
    const r = node('launch.cjs', [spec]);
    expect(r.status).toBe(3);
    expect(r.stdout.trim()).toBe(prompt);
    expect(events(file)).toEqual([{ hook_event_name: 'CubefarmExit', code: 3 }]);
  });

  it("notes a CLI that couldn't start", () => {
    const file = path.join(dir, 'launch-missing.jsonl');
    const spec = path.join(dir, 'launch-missing.json');
    fs.writeFileSync(spec, JSON.stringify({ file: path.join(dir, 'no-such-cli'), args: [], cwd: dir, events: file }));
    expect(node('launch.cjs', [spec]).status).toBe(127);
    expect(events(file)).toEqual([{ hook_event_name: 'CubefarmExit', code: 127 }]);
  });
});

describe('seed-claude.cjs', () => {
  it("marks Claude Code's onboarding done and the worktree trusted, keeping what was there", () => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'));
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ theme: 'dark', projects: { '/a': { allowedTools: ['x'] } } }));
    node('seed-claude.cjs', ['/a', '/workspace/home/work/acme__web'], '', { HOME: home });
    const c = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    expect(c.theme).toBe('dark');
    expect(c.hasCompletedOnboarding).toBe(true);
    expect(c.projects['/a']).toEqual({ allowedTools: ['x'], hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect(c.projects['/workspace/home/work/acme__web'].hasTrustDialogAccepted).toBe(true);
  });
});
