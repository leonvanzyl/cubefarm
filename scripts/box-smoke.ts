// A real check of cloud agents against your Upstash account (docs/cloud.md), outside the office: it creates one Box,
// sets it up as the office does, clones a small public repo, runs a stand-in CLI under tmux (its events, and its work
// carrying on while nobody's attached), then Claude Code on a few short prompts (a reply, a reply after the office's
// connection is dropped and picked up again, a look through the Box's browser), then deletes the Box. It costs a few
// cents of Box time and a little Claude usage.
//
//   node --env-file=.env --import tsx scripts/box-smoke.ts [--keep] [--no-browser]
//
// .env (or the environment) holds UPSTASH_BOX_API_KEY, and CUBEFARM_CLAUDE_TOKEN or ANTHROPIC_API_KEY for the Claude
// Code checks (without either, they're skipped). GitHub comes from GH_TOKEN or your gh login.

import crypto from 'node:crypto';
import { upstashBoxes } from '../server/box.ts';
import { BoxPty, finishedTurn, lookAtBoxCli } from '../server/boxCli.ts';
import { BoxMachines } from '../server/boxMachines.ts';
import { BOX_BIN, BOX_CLI_BIN, boxSessionDir } from '../server/boxScripts.ts';
import { hooksReady, reconnectBoxClis, releaseClis, startCliSession } from '../server/cliRunner.ts';
import { boxLabels, boxName, resolveCredentials } from '../server/cloud.ts';
import { run } from '../server/exec.ts';
import { boxVersions } from '../server/clis.ts';
import { AgentTerminal } from '../server/terminal.ts';
import type { BoxCliRecord, BoxTarget } from '../server/boxCli.ts';
import type { SessionOptions, SessionResult } from '../server/agentRunner.ts';

const keep = process.argv.includes('--keep');
const withBrowser = !process.argv.includes('--no-browser');
const key = process.env.UPSTASH_BOX_API_KEY ?? '';
const claudeToken = process.env.CUBEFARM_CLAUDE_TOKEN ?? '';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
if (!key) {
  console.error('Set UPSTASH_BOX_API_KEY first (in .env, or the environment).');
  process.exit(2);
}
const withClaude = !!(claudeToken || anthropicApiKey);
const ghToken = process.env.GH_TOKEN || (await run('gh', ['auth', 'token']).catch(() => '')).trim();

const started = Date.now();
const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
const say = (line: string) => console.log(`[${secs()}] ${line}`);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail]);
  say(`${ok ? '✓' : '✗'} ${name}${detail ? `: ${detail}` : ''}`);
};

const versions = boxVersions();
const office = `smk${Math.random().toString(36).slice(2, 5)}`.padEnd(6, '0');
const machine = 'boxsmoke';
const repo = 'octocat/Hello-World';
const api = upstashBoxes(key);
const secrets = [key, claudeToken, anthropicApiKey, ghToken].filter(Boolean);
const machines = new BoxMachines({
  api: () => api,
  office: () => office,
  size: () => 'small',
  versions,
  git: async () => ({ name: 'cubefarm smoke test', email: 'smoke@example.com' }),
  githubEnv: async (): Promise<Record<string, string>> => (ghToken ? { GH_TOKEN: ghToken } : {}),
  state: (_m) => undefined,
  secrets: () => secrets,
  log: (line) => say(line),
});

// The office lets its CLIs' events through once it follows their sessions again; here there's nothing to wait for.
hooksReady();

const creds = resolveCredentials('claude', { claudeToken, secrets: { anthropicApiKey: anthropicApiKey || undefined }, ghToken });
let record: BoxCliRecord | null = null;

/** One session in the Box; resolves with its result and the tools it used. */
function session(o: Partial<SessionOptions> & { terminal: AgentTerminal; prompt: string; box?: BoxTarget }, onTool?: (name: string) => void): Promise<{ result: SessionResult; tools: string[] }> {
  return new Promise((resolve) => {
    const tools: string[] = [];
    const timer = setTimeout(() => {
      handle.stop();
    }, 5 * 60_000);
    const handle = startCliSession(
      {
        cwd: `/workspace/home/work/${repo.replace('/', '__')}`,
        systemAppend: 'You are a short smoke test of a cloud machine. Do exactly what the prompt says.',
        model: 'haiku',
        effort: 'low',
        browserTesting: false,
        additionalDirectories: [],
        role: 'agent',
        cli: 'claude',
        keepAlive: false,
        agentId: 'smoke',
        ...o,
      },
      {
        log: (entries) => entries.forEach((e) => e.kind === 'error' && say(`  log: ${e.text}`)),
        tool: (name) => {
          if (!name) return;
          tools.push(name);
          onTool?.(name);
        },
        sessionId: () => undefined,
        browserUrl: () => undefined,
        screenshot: () => undefined,
        finished: (result) => {
          clearTimeout(timer);
          resolve({ result, tools });
        },
      },
    );
  });
}

let boxId: string | null = null;
try {
  say(`Creating and setting up a Box (${boxName(office, machine)}): the first time takes a few minutes…`);
  boxId = await machines.ensure(machine, (t) => say(`  ${t}`));
  check('Box created and set up', true, boxId);
  const desk = await machines.prepareDesk(machine, repo, { defaultBranch: 'master' }, 'swarm/issue-0-smoke', (t) => say(`  ${t}`));
  check('desk cloned and checked out', desk.endsWith('octocat__Hello-World'), desk);
  const deps = await machines.installDeps(machine, repo, { log: (l) => l.forEach((x) => say(`  ${x}`)), installing: () => undefined });
  check('dependencies looked at', deps === 'none', deps);
  const named = (await api.list()).find((b) => b.id === boxId);
  check("the Box's name says it's cubefarm's", !!named?.name.startsWith('cubefarm-'), named?.name);
  const bin = BOX_CLI_BIN;
  const tools = await api.run(boxId, `${bin}/claude --version; ${bin}/codex --version; ${bin}/playwright-mcp --version 2>/dev/null | head -1; tmux -V; gh --version | head -1; git config --global --get-regexp "credential.*"`);
  say(`  tools:\n${tools.output.trim().replace(/^/gm, '    ')}`);
  check('pinned Claude Code installed', tools.output.includes(versions.claude), versions.claude);
  check('pinned Codex installed', tools.output.includes(versions.codex), versions.codex);

  // 0. tmux, the launcher and the events file, with a stand-in for a CLI: no coding agent needed.
  const fake = async (seconds: number, detachAfterMs?: number) => {
    const token = crypto.randomUUID();
    const dir = boxSessionDir(token);
    const events = `${dir}/events.jsonl`;
    const stop = JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'FAKE OK' });
    const script = `printf 'hello from the Box\\n'; sleep ${seconds}; echo '${stop}' | node ${BOX_BIN}/hook.cjs ${events}`;
    await api.write(boxId!, `${dir}/launch.json`, JSON.stringify({ file: 'bash', args: ['-c', script], cwd: desk, events }));
    const seen: Record<string, unknown>[] = [];
    let screen = '';
    let saved = { offset: 0, turnAt: 0 };
    const p = new BoxPty({ api, boxId: boxId!, token, cols: 100, rows: 30, env: {}, offset: 0, event: (e) => seen.push(e), save: (offset, turnAt) => (saved = { offset, turnAt }), gone: () => undefined }, dir);
    const exited = new Promise<number>((r) => p.onExit(r));
    p.onData((d) => (screen += d));
    await p.open('new');
    if (detachAfterMs !== undefined) {
      await new Promise((r) => setTimeout(r, detachAfterMs));
      p.detach();
      return { token, dir, seen, screen, saved, code: null };
    }
    const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 90_000))]);
    return { token, dir, seen, screen, saved, code };
  };
  const f1 = await fake(2);
  check('a CLI runs under tmux in the Box, its screen reaches the office', f1.screen.includes('hello from the Box'), `${f1.screen.length} characters`);
  check('its hooks reach the office through the events file', f1.seen.some((e) => e.hook_event_name === 'Stop' && e.last_assistant_message === 'FAKE OK'), `${f1.seen.length} events`);
  check('its exit is reported', f1.code === 0, `code ${f1.code}`);
  const f2 = await fake(20, 4000);
  say('  dropped the connection to a stand-in CLI that works for 20 more seconds; waiting…');
  await new Promise((r) => setTimeout(r, 30_000));
  const look = await lookAtBoxCli(api, { boxId, token: f2.token, cli: 'claude', dir: f2.dir, offset: f2.saved.offset, turnAt: f2.saved.turnAt, resumeId: null, busy: true });
  check('it carries on with nobody attached, and finishes', !look.alive && finishedTurn(look.events), `${look.events.map((e) => e.hook_event_name).join(', ') || 'no events'}`);

  const target: BoxTarget = { api, boxId, env: creds.env, apiKeyHelper: creds.apiKeyHelper, browser: false, record: (r) => (record = r) };
  if (!withClaude) say('No CUBEFARM_CLAUDE_TOKEN or ANTHROPIC_API_KEY: skipping the Claude Code checks.');

  // 1. A reply, through tmux and the events file.
  if (withClaude) {
    const t1 = new AgentTerminal();
    const one = await session({ terminal: t1, prompt: 'Reply with exactly the words BOX OK and nothing else. Do not use any tools.', box: target });
    check('Claude Code signed in and replied', one.result.ok && /BOX OK/.test(one.result.text), one.result.text.slice(0, 80) || one.result.errors.join('; '));
    if (!one.result.ok) say(`  its screen:\n${t1.screen().split('\n').slice(-15).join('\n')}`);

    // 2. The office lets go mid-task (a restart) and picks the CLI up again; the turn it finished meanwhile still counts.
    const t2 = new AgentTerminal();
    let detached = false;
    const two = session({ terminal: t2, prompt: 'Use the Bash tool to run exactly: sleep 20 && echo slept. Then reply with exactly the word SLEPT.', box: target, keepAlive: true }, (name) => {
      if (name !== 'Bash' || detached) return;
      detached = true;
      say('  dropping the connection while it runs Bash…');
      void releaseClis(true);
    });
    await Promise.race([two, new Promise((r) => setTimeout(r, 90_000))]);
    check('tool calls reported from the Box', detached);
    const saved = record as BoxCliRecord | null;
    check('its record kept for a restart', !!saved, saved ? `offset ${saved.offset}` : 'none');
    if (saved) {
      await new Promise((r) => setTimeout(r, 30_000)); // it finishes while nobody's attached
      const t3 = new AgentTerminal();
      const back = await reconnectBoxClis([{ agentId: 'smoke', rec: saved, api, record: (r) => (record = r) }], () => t3);
      check('CLI picked up again', back.length === 1 && back[0].busy, JSON.stringify(back));
      const after = await session({ terminal: t3, prompt: '', reattach: true, keepAlive: true });
      check('turn finished while away still counts', after.result.ok && /SLEPT/.test(after.result.text), after.result.text.slice(0, 80) || after.result.errors.join('; '));
    }
  }

  // 3. The Box's own browser, through Playwright MCP over CDP.
  if (withBrowser) {
    const has = await api.browser(boxId);
    check("the Box's Chromium started", has);
    const cdp = await api.run(boxId, 'curl -s -m 10 http://127.0.0.1:9222/json/version | head -c 200');
    check('Playwright can reach it over CDP', /Browser/.test(cdp.output), cdp.output.trim().slice(0, 80));
    if (has && withClaude) {
      const t4 = new AgentTerminal();
      const look = await session({ terminal: t4, prompt: 'Use the Playwright browser tools to open https://example.com, then reply with only the page title.', box: { ...target, browser: true }, browserTesting: true });
      check('browser testing works in the Box', /Example Domain/i.test(look.result.text), look.result.text.slice(0, 80) || look.result.errors.join('; '));
    }
  }
  // 4. An idle cloud agent's Box pauses, and wakes for their next task, as the office does it.
  await machines.pause(machine);
  check('the Box pauses', (await api.get(boxId))?.status === 'paused', (await api.get(boxId))?.status);
  const woken = await machines.ensure(machine, (t) => say(`  ${t}`));
  const awake = (await api.get(woken))?.status;
  check('it wakes for the next task, its desk still there', woken === boxId && awake !== 'paused' && (await api.run(boxId, `test -e ${desk}/.git && echo DESK`)).output.includes('DESK'), awake);
} catch (err) {
  check('smoke test ran to the end', false, (err as Error).message);
} finally {
  if (boxId && !keep) {
    // As when a cloud agent leaves: unpushed work saved to leftovers, then the Box deleted.
    const gone = await machines.remove(machine).catch((err) => ({ removed: false, patches: [] as string[], error: (err as Error).message }));
    const left = gone.removed ? await api.get(boxId).catch(() => 'unknown') : 'kept';
    check('the Box is deleted when its agent leaves', gone.removed && left === null, gone.removed ? '' : `delete ${boxName(office, machine)} in the Upstash console`);
  } else if (boxId) say(`Kept the Box ${boxName(office, machine)} (labels ${boxLabels(office, machine).join(', ')}).`);
  const failed = results.filter(([, ok]) => !ok);
  say(`${results.length - failed.length}/${results.length} checks passed.`);
  // Not process.exit: on Windows it can abort while the terminal module's handles close.
  process.exitCode = failed.length ? 1 : 0;
}
