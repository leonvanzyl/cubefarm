import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { browserProblem, playwrightMcp } from './browser.ts';
import { HOME_DIR } from './config.ts';
import { BOX_CDP, BoxPty, boxHooksReady, finishedTurn, lookAtBoxCli, readFrom, type BoxCliRecord } from './boxCli.ts';
import { BOX_BIN, BOX_CLI_BIN, BOX_HOME, boxSessionDir, signInCommand, tmuxKill } from './boxScripts.ts';
import { BOX_ENV } from './cloud.ts';
import { cliLabel, CLIS, CODEX_HOOK_SOURCE, codexThread, commandFor, hookReviewKey, interruptions, isCli, launchArgs, NOTIFY_SOURCE, OPENCODE_PLUGIN_SOURCE, signedOutScreen, STATUSLINE_SOURCE, trustKey } from './clis.ts';
import { adoptPty, discardPty, hooksReady as keeperHooksReady, keeperHookUrl, keeperPid, leaveKeeper, spawnPty, startKeeper, terminalsAvailable, type Pty } from './ptyClient.ts';
import type { BoxApi } from './box.ts';
import {
  clip,
  describeTool,
  newScreenshots,
  resultText,
  screenshotFile,
  summariseResult,
  tidyPaths,
  todoLines,
  type LogEntry,
  type SessionCallbacks,
  type SessionHandle,
  type SessionOptions,
  type SessionResult,
} from './agentRunner.ts';
import type { OfficeTools } from './ceo.ts';
import type { AgentTerminal } from './terminal.ts';
import type { AgentCli } from '../shared/types.ts';

// One agent session as the real CLI in a pseudo-terminal: the same contract as the Agent SDK runner (log lines, the
// current tool, the final text, finished), so the rest of the office doesn't care which runtime an agent uses.
//
// Claude Code reports through HTTP hooks passed with --settings: every tool call (PreToolUse also approves it, so the
// CLI never stops to ask), each finished turn (Stop, with the final text), failures (StopFailure) and, through its
// status line, cost and usage limits. Codex says when a turn ends (notify) and, once the manager trusts the office's
// hooks in its /hooks, reports its steps through them too. OpenCode's plugin only says when a turn ends.
//
// The CLIs run in the office's terminal keeper (ptyClient.ts) and call their hooks there, so an office restart doesn't
// stop them: the office picks them up again when it's back (reconnectClis). A cloud agent's CLI runs in their Upstash
// Box instead (boxCli.ts): its hooks are read from a file there, and it carries on while the office is closed.

export { terminalsAvailable };

const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
const BIN_DIR = path.join(HOME_DIR, 'bin');
/** After a turn ends the CLI may still pick up a queued message: only an idle prompt this long means it's done. */
const FINISH_GRACE_MS = 3000;
/** Starting up: how long before the office says the CLI seems to be waiting on something. */
const BOOT_MS = 60_000;
/** Claude's usage warning, the way the SDK's allowed_warning is used: pace new work from here. */
const USAGE_WARN_PCT = 90;
/** Prompts longer than this go in a file: Windows caps a command line at 32K characters. */
const INLINE_PROMPT_MAX = 8000;

// ---------- routing the CLIs' calls back to their sessions ----------

let officeUrl = '';

/** The office's own address, for the hook and MCP endpoints the CLIs call back on. Set once the server listens. */
export function setOfficeUrl(url: string) {
  officeUrl = url;
}

interface Route {
  hook(body: Record<string, unknown>): Record<string, unknown>;
  office?: OfficeTools;
}
const routes = new Map<string, Route>();

/** A hook, status line or notify call from a CLI (POST /api/hooks/:token). The answer is the hook's output. */
export function handleHook(token: string, body: unknown): Record<string, unknown> {
  const route = routes.get(token);
  if (!route || !body || typeof body !== 'object' || Array.isArray(body)) return {};
  try {
    return route.hook(body as Record<string, unknown>);
  } catch (err) {
    console.warn('hook failed', err);
    return {};
  }
}

/** The CEO's office tools over MCP (Streamable HTTP, stateless: a fresh server per request). */
export async function handleMcp(token: string, req: Request, res: Response) {
  const office = routes.get(token)?.office;
  if (!office) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This session has ended.' }, id: null });
    return;
  }
  const server = office.serve();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// ---------- helper scripts ----------

let helpersWritten = false;

/** The status line, notify and plugin scripts the CLIs run. Rewritten once per office start, so updates reach them. */
function writeHelpers() {
  if (helpersWritten) return;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(path.join(BIN_DIR, 'statusline.cjs'), STATUSLINE_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'notify.cjs'), NOTIFY_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'codex-hook.cjs'), CODEX_HOOK_SOURCE);
  fs.writeFileSync(path.join(BIN_DIR, 'opencode-plugin.mjs'), OPENCODE_PLUGIN_SOURCE);
  helpersWritten = true;
}

/** A command line for Claude Code's shell (Git Bash on Windows): forward slashes, quoted. */
const shellArg = (p: string) => `"${p.replaceAll('\\', '/')}"`;

// ---------- plumbing ----------

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'Notification'];

/** What a tool call returned, as text, and any images in it (Playwright screenshots). */
function toolOutput(response: unknown): { text: string; images: { data: string; mime: string }[] } {
  const images: { data: string; mime: string }[] = [];
  const blocks = Array.isArray(response) ? response : Array.isArray((response as { content?: unknown })?.content) ? (response as { content: unknown[] }).content : null;
  if (blocks) {
    for (const b of blocks as Record<string, unknown>[]) {
      const source = b?.source as { type?: string; data?: string; media_type?: string } | undefined;
      if (b?.type === 'image' && source?.type === 'base64' && source.data) images.push({ data: source.data, mime: source.media_type ?? 'image/png' });
      else if (b?.type === 'image' && typeof b.data === 'string') images.push({ data: b.data, mime: String(b.mimeType ?? 'image/png') });
    }
    return { text: resultText(blocks), images };
  }
  if (typeof response === 'string') return { text: response, images };
  const r = response as { stdout?: unknown; stderr?: unknown; file?: { content?: unknown }; filenames?: unknown } | null;
  if (r && typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') return { text: [r.stdout, r.stderr].filter((s) => typeof s === 'string' && s).join('\n'), images };
    if (typeof r.file?.content === 'string') return { text: r.file.content, images };
    if (Array.isArray(r.filenames)) return { text: r.filenames.join('\n'), images };
  }
  return { text: '', images };
}

/** A pseudo-terminal whose CLI just died throws on writes and resizes before it reports the exit: ignore that. */
function quietly(fn: () => void) {
  try {
    fn();
  } catch {
    // the CLI is gone; its exit is on the way
  }
}

// ---------- CLIs that outlive their session ----------

/**
 * A CLI running in an agent's terminal. It can outlive the office session that started it: when an agent has built or
 * fixed something their CLI waits at its prompt, so the manager can keep using it, and a follow-up picks it up again. It also
 * outlives an office restart, held by the terminal keeper.
 */
interface LiveCli {
  agentId: string;
  cli: AgentCli;
  term: AgentTerminal;
  proc: Pty | null;
  token: string;
  dir: string;
  resumeId: string | null; // the session a follow-up resumes
  statusLine: string;
  /** Browser screenshots already passed on (Codex and OpenCode: collected from the browser's output folder). */
  shots: Set<string>;
  /** The office session driving it; null while it waits at its prompt. */
  session: { hook(b: Record<string, unknown>): Record<string, unknown>; exited(code: number): void } | null;
  idleTimer?: NodeJS.Timeout;
  /** The cloud agent's Box it runs in (absent: this computer). */
  box?: { api: BoxApi; boxId: string };
}
const lives = new Map<AgentTerminal, LiveCli>();
/** How to trust Codex's hooks was said once this run (Codex asks at the start of every session until they are). */
let hooksHinted = false;
/** A CLI left at its prompt this long is closed; its session can still be resumed. */
const IDLE_MS = 30 * 60_000;
/** The same in a Box: closed sooner, so the Box can pause and stop costing. */
const BOX_IDLE_MS = 5 * 60_000;

/** PreToolUse's answer: nobody may be watching to answer a permission question, so every tool call is approved. */
const ALLOW = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Approved by cubefarm' } };

const toolInput = (b: Record<string, unknown>) => (b.tool_input && typeof b.tool_input === 'object' ? b.tool_input : {}) as Record<string, unknown>;

/** The CLI has exited, or has had a few seconds to. */
const exitOf = (p: Pty) =>
  new Promise<void>((resolve) => {
    p.onExit(() => resolve());
    setTimeout(resolve, 5000);
  });

/** Close a CLI for good; settles once it has exited. A Codex thread is archived once its CLI is gone (see codexThread). */
function endLive(live: LiveCli): Promise<void> {
  if (lives.get(live.term) !== live) return Promise.resolve();
  lives.delete(live.term);
  clearTimeout(live.idleTimer);
  routes.delete(live.token);
  live.term.releaseIdle = null;
  live.term.bind(null);
  const gone = live.proc ? exitOf(live.proc) : Promise.resolve();
  live.proc?.kill();
  live.proc = null;
  live.term.note(`── ${cliLabel(live.cli)} session ended ──`);
  if (live.box) return gone; // its session folder in the Box goes with its tmux; Codex's threads there aren't ours to archive
  fs.rm(live.dir, { recursive: true, force: true, maxRetries: 5 }, () => undefined);
  if (live.cli === 'codex' && live.resumeId) void codexThread('archive', live.resumeId, gone);
  return gone;
}

/** What the keeper holds with a CLI's terminal, so the office can pick it up again after a restart. */
interface CliMeta {
  agentId: string;
  cli: AgentCli;
  token: string;
  dir: string;
  resumeId: string | null;
  /** An office session was driving it (not waiting at its prompt). */
  busy: boolean;
}

const metaOf = (l: LiveCli): CliMeta => ({ agentId: l.agentId, cli: l.cli, token: l.token, dir: l.dir, resumeId: l.resumeId, busy: !!l.session });
const remember = (l: LiveCli) => l.proc?.setMeta(metaOf(l));

/** A CLI is running in its terminal: its output, its keys and its hooks are connected. */
function wire(l: LiveCli, office?: OfficeTools) {
  const p = l.proc!;
  lives.set(l.term, l);
  routes.set(l.token, { hook: (b) => (l.session ? l.session.hook(b) : idleHook(l, b)), office });
  l.term.bind({ write: (d) => quietly(() => p.write(d)), resize: (c, r) => quietly(() => p.resize(c, r)) });
  p.onData((data) => {
    if (lives.get(l.term) === l) l.term.write(data);
  });
  p.onExit((code) => {
    l.proc = null;
    if (lives.get(l.term) !== l) return; // already replaced or closed
    if (l.session) l.session.exited(code);
    else endLive(l); // quit while waiting at its prompt
  });
}

/** The task is done but the CLI stays at its prompt for the manager (or a follow-up), for a while. */
function waitAtPrompt(l: LiveCli) {
  clearTimeout(l.idleTimer);
  l.idleTimer = setTimeout(() => endLive(l), l.box ? BOX_IDLE_MS : IDLE_MS);
  l.term.releaseIdle = () => endLive(l);
  remember(l);
}

export interface ReconnectedCli {
  agentId: string;
  cli: AgentCli;
  resumeId: string | null;
  /** It was working on a task: the office should follow its session again. */
  busy: boolean;
}

/**
 * The office started: connect to the terminal keeper and take back the CLIs it kept running through the restart, each
 * into its agent's terminal. They wait at their prompt until the office follows their session again (busy ones) or
 * the manager uses them. Ones whose agent is gone, or that exited while the office was away, are stopped: the office
 * resumes those sessions itself. Call hooksReady() once the busy ones are followed again.
 */
export async function reconnectClis(terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]> {
  const held = await startKeeper(HOME_DIR, handleHook);
  const back: ReconnectedCli[] = [];
  for (const h of held) {
    const meta = (h.meta ?? {}) as Partial<CliMeta>;
    const term = meta.agentId ? terminalFor(meta.agentId) : null;
    if (h.exit !== null || !term || lives.has(term) || !isCli(meta.cli) || !meta.token || !meta.dir || !meta.agentId) {
      discardPty(h);
      if (meta.cli === 'codex' && meta.resumeId) void codexThread('archive', meta.resumeId, h.exit === null ? new Promise((r) => setTimeout(r, 5000)) : undefined);
      continue;
    }
    const l: LiveCli = { agentId: meta.agentId, cli: meta.cli, term, proc: adoptPty(h), token: meta.token, dir: meta.dir, resumeId: meta.resumeId ?? null, statusLine: '🏢 cubefarm', shots: new Set(), session: null };
    wire(l);
    waitAtPrompt(l);
    // Resizing makes the CLI draw its whole screen again, over whatever the saved copy of the terminal missed.
    setTimeout(() => quietly(() => (l.proc?.resize(term.cols - 1, term.rows), l.proc?.resize(term.cols, term.rows))), 500);
    back.push({ agentId: l.agentId, cli: l.cli, resumeId: l.resumeId, busy: !!meta.busy });
  }
  return back;
}

/** A cloud agent's CLI the office was following when it closed, to pick up again (reconnectBoxClis). */
export interface KeptBoxCli {
  agentId: string;
  rec: BoxCliRecord;
  api: BoxApi;
  /** Its record changed (null: the CLI is gone). */
  record(rec: BoxCliRecord | null): void;
  /** The office's connection to it dropped (false) or is back (true). */
  connection?(up: boolean): void;
}

/**
 * The office started: pick up cloud agents' CLIs in their Boxes, as reconnectClis does the keeper's. One still running
 * is attached again and its events since the office last looked are replayed once the office follows its session; one
 * that ended while the office was away comes back too when it finished a turn first (its events replayed, then its
 * exit), so its task finishes as it would have. A Box Upstash can't be reached about is attached optimistically: it
 * keeps trying, and a CLI that turns out to be gone ends then. Ones whose agent or terminal is gone are stopped.
 */
export async function reconnectBoxClis(kept: KeptBoxCli[], terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]> {
  const back: ReconnectedCli[] = [];
  await Promise.all(
    kept.map(async (k) => {
      const term = terminalFor(k.agentId);
      if (!term || lives.has(term)) {
        k.record(null);
        await k.api.run(k.rec.boxId, tmuxKill(k.rec.token)).catch(() => undefined);
        return;
      }
      const look = await Promise.race([lookAtBoxCli(k.api, k.rec), new Promise<null>((r) => setTimeout(() => r(null), 45_000))]).catch(() => null);
      if (look && !look.alive && !finishedTurn(look.events)) {
        k.record(null); // gone without finishing: the office resumes or requeues its task
        return;
      }
      const l: LiveCli = { agentId: k.agentId, cli: k.rec.cli, term, proc: null, token: k.rec.token, dir: k.rec.dir, resumeId: k.rec.resumeId, statusLine: '🏢 cubefarm', shots: new Set(), session: null, box: { api: k.api, boxId: k.rec.boxId } };
      const p = boxPty(l, { api: k.api, boxId: k.rec.boxId, record: (r) => k.record(r), connection: k.connection }, term.cols, term.rows, readFrom(k.rec));
      l.proc = p;
      wire(l);
      waitAtPrompt(l);
      if (look && !look.alive) p.replay(look.events, look);
      else await p.open('attach');
      back.push({ agentId: l.agentId, cli: l.cli, resumeId: l.resumeId, busy: k.rec.busy });
    }),
  );
  return back;
}

/** A Box CLI's terminal, saving its record as its events are handled. */
function boxPty(
  l: LiveCli,
  box: { api: BoxApi; boxId: string; record(rec: BoxCliRecord | null): void; connection?(up: boolean): void },
  cols: number,
  rows: number,
  offset: number,
  env?: Record<string, string>,
): BoxPty {
  const save = (off: number, turnAt: number, meta: unknown) => {
    const m = (meta ?? {}) as Partial<CliMeta>;
    box.record({ boxId: box.boxId, token: l.token, cli: l.cli, dir: l.dir, offset: off, turnAt, resumeId: m.resumeId ?? l.resumeId, busy: m.busy ?? !!l.session });
  };
  return new BoxPty(
    { api: box.api, boxId: box.boxId, token: l.token, cols, rows, env, offset, event: (b) => handleHook(l.token, b), save, gone: () => box.record(null), connection: (up) => box.connection?.(up) },
    l.dir,
  );
}

/** A cloud agent's CLI signing in in their terminal (startBoxSignIn). */
export interface BoxSignIn {
  /** Close it (it's no longer needed, or the agent left). */
  stop(): void;
}

/**
 * Sign a cloud agent's CLI in with its own login, in their terminal (docs/cloud.md): Claude Code prints a link and
 * asks for the code the page gives back, Codex prints a link and a one-time code. The manager finishes Anthropic's or
 * OpenAI's flow there. The office only relays the terminal's keys and screen, as for any CLI: it never reads the link,
 * the code or the login, which stays in the Box user's home. It runs with no credentials, and no record is kept (an
 * office restart sweeps it away and starts a new one). `exited` hears its exit code; stop() doesn't call it.
 */
export function startBoxSignIn(o: { api: BoxApi; boxId: string; cli: 'claude' | 'codex'; term: AgentTerminal; agentId: string }, exited: (code: number) => void): BoxSignIn {
  const prev = lives.get(o.term);
  if (prev) void endLive(prev);
  const token = crypto.randomUUID();
  const dir = boxSessionDir(token);
  const l: LiveCli = { agentId: o.agentId, cli: o.cli, term: o.term, proc: null, token, dir, resumeId: null, statusLine: '', shots: new Set(), session: null, box: { api: o.api, boxId: o.boxId } };
  let over = false;
  const end = (code: number) => {
    if (over) return;
    over = true;
    void endLive(l);
    exited(code);
  };
  l.session = { hook: () => ({}), exited: end };
  o.term.note(`── Signing ${cliLabel(o.cli)} in · ☁ cloud machine ──`);
  void (async () => {
    try {
      await o.api.write(o.boxId, `${dir}/launch.json`, JSON.stringify({ ...signInCommand(o.cli), cwd: BOX_HOME, events: `${dir}/events.jsonl` }));
      if (over) return;
      const pty = boxPty(l, { api: o.api, boxId: o.boxId, record: () => undefined }, o.term.cols, o.term.rows, 0, {});
      l.proc = pty;
      wire(l);
      await pty.open('new');
    } catch (err) {
      o.term.note(`Couldn't start signing in: ${(err as Error).message}`);
      end(-1);
    }
  })();
  return {
    stop: () => {
      over = true;
      void endLive(l);
    },
  };
}

/** The office follows its sessions again after starting: hooks and Box events that waited for it come in. */
export function hooksReady() {
  keeperHooksReady();
  boxHooksReady();
}

/**
 * What a desk clean-up (releaseDesk) must leave alone: the keeper, every CLI in a terminal, and the office's session
 * files, which only the CLIs' own command lines carry (Codex's instructions name the worktree, for one).
 */
export function officeProcesses(): { pids: number[]; markers: string[] } {
  const pids = [keeperPid(), ...[...lives.values()].map((l) => l.proc?.pid ?? 0)].filter((p) => p > 0);
  return { pids, markers: [SESSIONS_DIR, BIN_DIR] };
}

/**
 * The office is stopping. On a restart its CLIs carry on in the terminal keeper, which holds their output and hooks
 * until it's back; when it quits for good they stop with it (once they're gone, their Codex threads are archived).
 */
export async function releaseClis(restart: boolean): Promise<void> {
  // Cloud agents' CLIs carry on in their Boxes either way: the office only lets go of them.
  for (const l of [...lives.values()].filter((x) => x.box)) {
    lives.delete(l.term);
    routes.delete(l.token);
    clearTimeout(l.idleTimer);
    (l.proc as BoxPty | null)?.detach();
  }
  if (!restart) await Promise.all([...lives.values()].map(endLive)); // their exits come through the keeper
  leaveKeeper();
}

/** Stop reading cloud agents' events (before the office writes its state for the last time), keeping their CLIs. */
export function detachBoxClis() {
  for (const l of lives.values()) if (l.box) (l.proc as BoxPty | null)?.detach();
}

/** A CLI waiting at its prompt: what the manager types there becomes a follow-up. */
function idleHook(live: LiveCli, b: Record<string, unknown>): Record<string, unknown> {
  switch (String(b.hook_event_name ?? '')) {
    case 'PreToolUse':
      return ALLOW;
    case 'UserPromptSubmit': {
      const text = String(b.prompt ?? '').trim();
      if (!text || live.term.onIdlePrompt?.(text)) return {};
      return { decision: 'block', reason: "The office couldn't take that on as a follow-up right now (see the agent's panel). Nothing was sent." };
    }
    case 'StatusLine':
      return { statusLine: live.statusLine };
  }
  return {};
}

// ---------- the session ----------

/**
 * The Claude Code session a hook reports, once its conversation is on disk: only then can --resume pick it up. Claude
 * writes the file during the first turn, after SessionStart and UserPromptSubmit, so a session the office keeps any
 * earlier could be one that never existed.
 */
export function resumableSession(b: Record<string, unknown>, exists: (file: string) => boolean): string | null {
  const id = typeof b.session_id === 'string' ? b.session_id : '';
  const file = typeof b.transcript_path === 'string' ? b.transcript_path : '';
  return id && file && exists(file) ? id : null;
}

/** Claude Code was told to resume a conversation that isn't on disk (it says so and exits 1). */
export const lostConversation = (screen: string) => /No conversation found with session ID/i.test(screen);

export function startCliSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  const term = opts.terminal!;
  // A follow-up to the session a CLI is still waiting in picks that CLI up again, and so does an office that restarted
  // while it worked (reattach); anything else replaces it.
  const prev = lives.get(term);
  const waiting = !!prev?.proc && !prev.session;
  // A CLI is only picked up where the session is to run: on this computer, or in that same Box.
  const sameHost = (prev?.box?.boxId ?? null) === (opts.box?.boxId ?? null);
  const adopt = waiting && (!!opts.reattach || (sameHost && prev!.cli === (opts.cli ?? 'claude') && !!opts.resumeSessionId && prev!.resumeId === opts.resumeSessionId));
  if (prev && !adopt) endLive(prev);
  let live: LiveCli | null = adopt ? prev! : null;
  const cli = live?.cli ?? opts.cli ?? 'claude';
  const label = cliLabel(cli);
  const box = adopt ? null : (opts.box ?? null);
  const inBox = !!(box ?? live?.box);

  const token = crypto.randomUUID();
  const sessionId = opts.resumeSessionId ?? crypto.randomUUID();
  const dir = box ? boxSessionDir(token) : path.join(SESSIONS_DIR, token);
  const started = Date.now();
  const statusLine = `🏢 cubefarm${opts.label ? ` · ${opts.label}` : ''}`;
  const toolNames = new Map<string, string>();
  const officePrompts: string[] = []; // prompts the office typed, so the ones the manager typed are told apart
  const launched: string[] = []; // every prompt the CLI was given, as given (Codex: finds its main thread)
  let mainThread: string | null = opts.resumeSessionId ?? null;
  let kept: string | null = opts.resumeSessionId ?? null; // the Claude session the agent has saved to resume
  const usageResets = new Map<string, number | null>();
  const warned = new Set<string>();
  let done = false;
  let costUsd = 0;
  let turns = 0;
  let lastText = '';
  let turnError: string | null = null; // the turn failed (OpenCode reports errors separately from going idle)
  let begun = false; // the CLI took its first prompt
  let finishTimer: NodeJS.Timeout | undefined;
  let bootTimer: NodeJS.Timeout | undefined;
  let screenTimer: NodeJS.Timeout | undefined;
  let shotTimer: NodeJS.Timeout | undefined;
  const nudged = new Set<string>();
  let trustKeys = 0; // keys pressed on a folder-trust question (a few at most)
  let trustedAt = 0;

  const cb: SessionCallbacks = { ...callbacks };
  const log = (entries: LogEntry[]) => entries.length && cb.log(entries);

  /** Codex and OpenCode don't report tool results: pass on the screenshots their browser saved instead. all: the last look. */
  const collectShots = (all = false) => {
    const l = live;
    if (!l || l.box || cli === 'claude' || !opts.browserTesting) return;
    for (const shot of newScreenshots(path.join(l.dir, 'browser'), l.shots, all ? Infinity : Date.now())) {
      l.shots.add(shot.name);
      try {
        cb.screenshot(fs.readFileSync(shot.file), shot.mime);
      } catch {
        // removed before we got to it
      }
    }
  };

  /** The same in a Box, read from its browser folder there, all at once: the session's last look, before it closes. */
  const collectBoxShots = async () => {
    const l = live;
    if (!l?.box || cli === 'claude' || !opts.browserTesting) return;
    const folder = `${l.dir}/browser`;
    for (const f of (await l.box.api.files(l.box.boxId, folder)).sort((a, b) => a.name.localeCompare(b.name))) {
      const mime = /\.png$/i.test(f.name) ? 'image/png' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : null;
      if (!mime || l.shots.has(f.name)) continue;
      const data = await l.box.api.read(l.box.boxId, `${folder}/${f.name}`, { base64: true }).catch(() => null);
      if (!data) continue;
      l.shots.add(f.name);
      cb.screenshot(Buffer.from(data, 'base64'), mime);
    }
  };

  /** The session is over. A CLI kept alive (keepAlive) that ended its turn normally stays at its prompt (keep); others close. */
  const finish = (result: Omit<SessionResult, 'costUsd' | 'turns'>, keep = false) => {
    if (done) return;
    done = true;
    let r = result;
    // A cloud agent's CLI that failed (or said nothing) because its login expired: the task waits for a new sign-in.
    const cut = r.interrupted || r.signedOut || r.errors[0] === 'Stopped by manager';
    if (inBox && !cut && (!r.ok || !r.text) && (signedOutScreen(term.screen()) || r.errors.some((e) => /authentication failed/i.test(e)))) {
      r = { ...r, ok: false, signedOut: true, errors: [`${label}'s sign-in in their cloud machine expired or was turned away.`] };
      keep = false;
    }
    for (const t of [finishTimer, bootTimer]) clearTimeout(t);
    clearInterval(screenTimer);
    clearInterval(shotTimer);
    collectShots(true);
    if (term.onInput === watchKeys) term.onInput = null;
    const l = live;
    const close = () => {
      if (l && lives.get(term) === l) {
        l.session = null;
        if (keep && opts.keepAlive && l.proc) waitAtPrompt(l);
        else endLive(l);
      }
      cb.tool(null);
      cb.finished({ ...r, costUsd, turns });
    };
    // A Box's screenshots are fetched before its CLI (and its session folder) can go.
    if (l?.box && cli !== 'claude' && opts.browserTesting) void collectBoxShots().catch(() => undefined).finally(close);
    else close();
  };

  /** A turn ended: finished, unless the CLI picks up another prompt within the grace period. */
  const turnEnded = (text: string) => {
    lastText = text;
    cb.tool(null);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => finish({ ok: !turnError, text: lastText, errors: turnError ? [turnError] : [] }, true), FINISH_GRACE_MS);
  };
  const busy = () => {
    begun = true;
    clearTimeout(finishTimer);
  };

  /** The turn was interrupted from the terminal: the office treats it like Stop, and the CLI waits for the manager. */
  const interrupted = () => finish({ ok: false, text: lastText, errors: ['Interrupted in the terminal'], interrupted: true }, true);

  /** Esc typed in the terminal while the agent works: if the CLI then says it interrupted the turn, it's over. */
  const watchKeys = (data: string) => {
    if (data !== '\x1b' || done || !begun) return;
    const before = interruptions(term.screen());
    let looks = 0;
    const look = () => {
      if (done) return;
      if (interruptions(term.screen()) > before) interrupted();
      else if (++looks < 4) setTimeout(look, 1000);
    };
    setTimeout(look, 800);
  };
  term.onInput = watchKeys;

  /** screenshotFile for a Box: the saved screenshot read from the agent's worktree there. */
  const boxScreenshotFile = async (text: string) => {
    const m = text.match(/\]\(([^)\s]+\.(png|jpe?g))\)/i);
    const b = live?.box;
    if (!m || !b) return;
    const file = m[1].startsWith('/') ? m[1] : path.posix.join(opts.cwd, m[1]);
    const data = await b.api.read(b.boxId, file, { base64: true }).catch(() => null);
    if (data) cb.screenshot(Buffer.from(data, 'base64'), /png$/i.test(m[2]) ? 'image/png' : 'image/jpeg');
  };

  const assistantLines = (text: string): LogEntry[] => {
    const lines = text.split('\n');
    const out: LogEntry[] = lines.slice(0, 30).map((l, i) => ({ kind: 'text', text: `${i === 0 ? '● ' : '  '}${l}` }));
    if (lines.length > 30) out.push({ kind: 'text', text: `  … (${lines.length - 30} more lines)` });
    return out;
  };

  const onStatus = (b: Record<string, unknown>) => {
    const cost = Number((b.cost as { total_cost_usd?: unknown } | undefined)?.total_cost_usd);
    if (Number.isFinite(cost)) costUsd = cost;
    const limits = (b.rate_limits ?? {}) as Record<string, { used_percentage?: unknown; resets_at?: unknown } | null>;
    for (const [type, l] of Object.entries(limits)) {
      const used = Number(l?.used_percentage);
      if (!Number.isFinite(used)) continue;
      const resetsAt = Number(l?.resets_at) > 0 ? Number(l?.resets_at) * 1000 : null;
      usageResets.set(type, used >= 100 ? resetsAt : null);
      if (used >= USAGE_WARN_PCT && used < 100 && !warned.has(type)) {
        warned.add(type);
        cb.usageWarning?.({ resetsAt, rateLimitType: type, utilization: used / 100 });
      }
    }
    return { statusLine };
  };

  const hook = (b: Record<string, unknown>): Record<string, unknown> => {
    const event = String(b.hook_event_name ?? '');
    const sub = typeof b.agent_id === 'string' && b.agent_id !== ''; // a subagent's call: kept off the log
    if (cli === 'claude' && !sub && b.session_id !== kept) {
      // In a Box, its hook script looked for the transcript there.
      const id = resumableSession(b, inBox ? () => b.transcript_exists === true : fs.existsSync);
      if (id) {
        kept = id;
        cb.sessionId(id);
      }
    }
    switch (event) {
      case 'PreToolUse': {
        const name = String(b.tool_name ?? '');
        const input = toolInput(b);
        if (!sub) {
          busy();
          turns += 1;
          toolNames.set(String(b.tool_use_id ?? ''), name);
          log([{ kind: 'tool', tool: name, text: `⏺ ${describeTool(opts.cwd, name, input)}` }, ...(name === 'TodoWrite' ? todoLines(input) : [])]);
          cb.tool(name);
          if (name === 'mcp__playwright__browser_navigate' && typeof input.url === 'string') cb.browserUrl(input.url);
        }
        return ALLOW;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (sub) return {};
        const name = toolNames.get(String(b.tool_use_id ?? '')) ?? String(b.tool_name ?? '');
        const out = toolOutput(b.tool_response);
        // Codex's unnamed screenshots are collected from the browser's folder (its hooks may not be trusted yet).
        if (cli === 'claude') for (const img of out.images) cb.screenshot(Buffer.from(img.data, 'base64'), img.mime);
        const shot = name === 'mcp__playwright__browser_take_screenshot' && !out.images.length;
        const saved = shot && !inBox ? screenshotFile(opts.cwd, out.text) : null;
        if (saved) cb.screenshot(saved.data, saved.mime);
        if (shot && inBox) void boxScreenshotFile(out.text);
        if (name.startsWith('mcp__playwright__')) {
          const url = out.text.match(/Page URL:\s*(\S+)/);
          if (url) cb.browserUrl(url[1]);
        }
        if (event === 'PostToolUseFailure') log([{ kind: 'error', text: `  ⎿ ${clip(tidyPaths(opts.cwd, String(b.error ?? out.text ?? 'Error')).split('\n')[0] || 'Error', 200)}` }]);
        else if (name !== 'TodoWrite') log(summariseResult(opts.cwd, name, out.text));
        cb.tool(null);
        return {};
      }
      case 'UserPromptSubmit': {
        if (sub) return {};
        busy();
        const prompt = String(b.prompt ?? '').trim();
        const i = officePrompts.findIndex((p) => p.slice(0, 60) === prompt.slice(0, 60));
        if (i >= 0) officePrompts.splice(i, 1);
        else if (prompt) log([{ kind: 'manager', text: `▶ Typed in the terminal: ${clip(prompt.split('\n')[0], 200)}` }]);
        return {};
      }
      case 'Stop': {
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'StopFailure': {
        const error = String(b.error ?? 'unknown');
        const details = String(b.error_details ?? '').trim();
        if (error === 'rate_limit') cb.limited?.([...usageResets.values()].find((t) => t !== null) ?? null);
        finish({ ok: false, text: lastText, errors: [`${label} stopped: ${error.replace(/_/g, ' ')}${details ? ` (${clip(details, 160)})` : ''}`] }, true);
        return {};
      }
      case 'Notification': {
        if (b.notification_type === 'permission_prompt') log([{ kind: 'error', text: `⚠ ${label} is waiting for a permission answer: open the terminal to answer it.` }]);
        return {};
      }
      case 'StatusLine':
        return onStatus(b);
      case 'Interrupt': // Codex: Esc in its terminal
        if (!sub) interrupted();
        return {};
      // Codex's notify program and the OpenCode plugin
      case 'TurnComplete': {
        const thread = typeof b.session_id === 'string' ? b.session_id : '';
        if (cli === 'codex' && thread !== mainThread) {
          // Codex also runs side threads (it titles each task in one): the main thread is the one given our prompt.
          const input = String(b.input ?? '').trim();
          if (mainThread || !launched.some((p) => input.startsWith(p.slice(0, 40)))) return {};
          mainThread = thread;
        }
        if (thread) {
          cb.sessionId(thread);
          if (live && live.resumeId !== thread) {
            live.resumeId = thread;
            remember(live);
          }
        }
        const text = String(b.last_assistant_message ?? '').trim();
        turns += 1;
        if (text) {
          log(assistantLines(text));
          cb.turn?.(text);
        }
        turnEnded(text);
        return {};
      }
      case 'TurnError':
        turnError = `${label}: ${clip(String(b.error ?? 'error'), 200)}`;
        log([{ kind: 'error', text: `✗ ${turnError}` }]);
        return {};
    }
    return {};
  };

  /** The CLI quit on its own: /exit typed in the terminal, a crash, or it couldn't start (not signed in, bad flag…). */
  const exited = (exitCode: number) => {
    if (cli === 'claude' && opts.resumeSessionId && !begun && lostConversation(term.screen())) {
      cb.sessionId(null);
      finish({ ok: false, text: '', errors: [`${label} couldn't find the conversation it was resuming, so the next session starts a new one.`] });
      return;
    }
    const ok = exitCode === 0 && (lastText !== '' || (cli !== 'claude' && Date.now() - started > 20_000));
    finish({ ok, text: lastText, errors: ok ? [] : [`${label} exited${exitCode ? ` with code ${exitCode}` : ''} before finishing.`] });
  };

  const handle: SessionHandle = {
    send(text) {
      const proc = live?.proc;
      if (done || !proc) return;
      busy();
      turnError = null;
      officePrompts.push(text.trim());
      // Pasted, so newlines stay in the message instead of sending it early; then Enter.
      const clean = text.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
      launched.push(clean.trim());
      quietly(() => proc.write(`\x1b[200~${clean}\x1b[201~`));
      setTimeout(() => quietly(() => live?.proc?.write('\r')), 150);
    },
    stop() {
      finish({ ok: false, text: '', errors: ['Stopped by manager'] });
    },
  };

  if (adopt && live) {
    // Back in the CLI that was waiting at its prompt: same conversation, same terminal.
    clearTimeout(live.idleTimer);
    term.releaseIdle = null;
    live.session = { hook, exited };
    Object.assign(live, { statusLine });
    remember(live);
    if (live.resumeId) cb.sessionId(live.resumeId);
    if (opts.typed || opts.reattach) busy(); // typed at the prompt, or still at it after a restart: already running
    else handle.send(opts.prompt);
    shotTimer = setInterval(collectShots, 2000);
    return handle;
  }
  if (opts.reattach) {
    // Its CLI didn't make it through the restart after all.
    setTimeout(() => finish({ ok: false, text: '', errors: [`${label} stopped while the office restarted.`] }), 0);
    return handle;
  }

  // ---------- a new CLI: files for this session, and the command line ----------

  // In a Box the CLI is the office's own pinned copy there, by its full path; here, the one found on this computer.
  const cmd = box ? { file: `${BOX_CLI_BIN}/${CLIS.find((c) => c.id === cli)!.command}`, args: [] as string[] } : commandFor(cli);
  if (box && cli === 'opencode') {
    setTimeout(() => finish({ ok: false, text: '', errors: [`${label} can't run in a cloud machine yet: give this agent Claude Code or Codex.`] }), 0);
    return handle;
  }
  if (!box && (!terminalsAvailable || !cmd)) {
    const why = !terminalsAvailable ? 'the terminal module could not be loaded on this machine' : `${label} isn't installed (no "${cli}" on PATH)`;
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${why}.`] }), 0);
    return handle;
  }

  // Through the keeper, a hook waits while the office restarts instead of failing: the CLIs allow it longer. A Box's
  // CLI can't reach the office at all: its hooks write to the session's events file, which the office reads.
  const keeper = box ? null : keeperHookUrl();
  const events = `${dir}/events.jsonl`;
  const hookUrl = box ? events : `${keeper ?? officeUrl}/api/hooks/${token}`;
  const p = box ? path.posix : path;
  // The browser for a session. Its snapshots and unnamed screenshots go to the session's folder, not the worktree. In a
  // Box, Playwright attaches to the Box's own Chromium.
  const browser = !opts.browserTesting ? null : box ? (box.browser ? { command: `${BOX_CLI_BIN}/playwright-mcp`, args: ['--cdp-endpoint', BOX_CDP, '--output-dir', `${dir}/browser`] } : null) : playwrightMcp(path.join(dir, 'browser'));
  const browserIssue = !opts.browserTesting ? null : box ? (box.browser ? null : "⚠ This cloud machine has no browser, so this session can't test in one.") : browserProblem(browser);
  if (browserIssue) log([{ kind: 'error', text: browserIssue }]);
  let prompt = opts.prompt;
  if (opts.outputSchema) {
    prompt += `\n\nWhen you are done, end your final message with your report as one JSON object in a \`\`\`json block, matching this JSON schema:\n${JSON.stringify(opts.outputSchema)}`;
  }
  let files: { settings: string; mcp: string | null; system: string };
  const boxFiles: [string, string][] = []; // written into the Box when the CLI starts
  const put = (file: string, text: string) => (box ? boxFiles.push([file, text]) : fs.writeFileSync(file, text));
  try {
    if (!box) {
      writeHelpers();
      fs.mkdirSync(dir, { recursive: true });
    }
    const boxHook = `node ${BOX_BIN}/hook.cjs ${events}`;
    const settings = {
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [box ? { type: 'command', command: boxHook, timeout: 30 } : { type: 'http', url: hookUrl, timeout: keeper ? 120 : 30 }] }]])),
      statusLine: box
        ? { type: 'command', command: `node ${BOX_BIN}/statusline.cjs ${events}`, padding: 0 }
        : { type: 'command', command: `${shellArg(process.execPath)} ${shellArg(path.join(BIN_DIR, 'statusline.cjs'))} ${shellArg(hookUrl)}`, padding: 0 },
      ...(box?.apiKeyHelper ? { apiKeyHelper: box.apiKeyHelper } : {}),
    };
    const servers: Record<string, unknown> = {};
    if (browser) servers.playwright = browser;
    if (opts.office && !box) servers.office = { type: 'http', url: `${officeUrl}/api/mcp/${token}` };
    files = { settings: p.join(dir, 'settings.json'), mcp: Object.keys(servers).length ? p.join(dir, 'mcp.json') : null, system: p.join(dir, 'instructions.md') };
    put(files.settings, JSON.stringify(settings, null, 2));
    if (files.mcp) put(files.mcp, JSON.stringify({ mcpServers: servers }, null, 2));
    put(files.system, opts.systemAppend);
    if (prompt.length > INLINE_PROMPT_MAX) {
      const file = p.join(dir, 'task.md');
      put(file, prompt);
      prompt = `Your task is in ${file}. Read all of it first, then do what it says.`;
    }
  } catch (err) {
    setTimeout(() => finish({ ok: false, text: '', errors: [`Could not prepare ${label}: ${(err as Error).message}`] }), 0);
    return handle;
  }
  officePrompts.push(prompt.trim()); // as given: a long one is a pointer to its file
  launched.push(prompt.trim());

  const launch = launchArgs(cli, {
    prompt,
    systemAppend: opts.systemAppend,
    model: opts.model,
    effort: opts.effort,
    resumeId: opts.resumeSessionId,
    sessionId,
    name: opts.label ?? 'cubefarm',
    role: opts.role,
    additionalDirectories: opts.additionalDirectories,
    files,
    notify: box ? { script: `${BOX_BIN}/notify.cjs`, url: events } : { script: path.join(BIN_DIR, 'notify.cjs'), url: hookUrl },
    codexHook: box ? `${BOX_BIN}/codex-hook.cjs` : path.join(BIN_DIR, 'codex-hook.cjs'),
    plugin: box ? '' : pathToFileURL(path.join(BIN_DIR, 'opencode-plugin.mjs')).href,
    browser,
    ...(box ? { node: 'node', posix: true } : {}),
  });

  // Each agent must be a clean instance on the account its CLI is logged into: no API keys (they would switch Claude
  // Code's billing to the API) and nothing inherited from a Claude Code session the office itself was started from.
  // In a Box nothing of the office's own environment goes along (a Windows PATH, the manager's other secrets): only
  // what a Box needs and the credentials this CLI signs in with.
  const env: Record<string, string> = {};
  if (box) Object.assign(env, BOX_ENV, box.env, launch.env, { CUBEFARM_STATUS: statusLine });
  else {
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
      if (/^(NO_COLOR|FORCE_COLOR|TERM_PROGRAM|TERM_PROGRAM_VERSION|CODEX_THREAD_ID|OPENCODE_CONFIG_CONTENT)$/i.test(k)) continue;
      env[k] = v;
    }
    Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, opts.env, launch.env);
  }

  if (cli === 'claude' && opts.resumeSessionId) cb.sessionId(sessionId);
  term.note(`── ${label}${opts.label ? ` · ${opts.label}` : ''}${box ? ' · ☁ cloud machine' : ''} ──`);
  const resumeId = cli === 'claude' ? sessionId : (opts.resumeSessionId ?? null);
  const l: LiveCli = { agentId: opts.agentId ?? '', cli, term, proc: null, token, dir, resumeId, statusLine, shots: new Set(), session: { hook, exited }, ...(box ? { box: { api: box.api, boxId: box.boxId } } : {}) };

  // Starting up: answer the folder-trust question for the office's own worktrees (the answer that trusts it), and say
  // so when a CLI is waiting on something only the manager can do (signing in).
  const watchBoot = (pty: Pty) => {
    screenTimer = setInterval(() => {
      if (done || Date.now() - started > BOOT_MS * 2) return clearInterval(screenTimer);
      const screen = term.screen();
      const review = hookReviewKey(screen);
      const key = trustKeys < 12 && Date.now() - trustedAt > 3000 ? (trustKey(screen) ?? review) : null;
      if (key === 'down') {
        trustKeys += 1;
        quietly(() => pty.write(term.appCursor ? '\x1bOB' : '\x1b[B'));
      } else if (key === 'enter') {
        trustKeys += 1;
        trustedAt = Date.now(); // the question takes a moment to go: don't answer it twice
        if (!review) log([{ kind: 'system', text: `✓ Trusted the worktree for ${label}.` }]);
        else if (!hooksHinted) {
          hooksHinted = true;
          log([{ kind: 'system', text: `ℹ To see ${label}'s steps here, trust the office's hooks once: in this terminal, type /hooks and press t. Until then the office shows its task.` }]);
        }
        quietly(() => pty.write('\r'));
      }
      if (!nudged.has('login') && /Not logged in|run \/login|Select login method|Sign in with ChatGPT|Please login|Invalid API key/i.test(screen)) {
        nudged.add('login');
        // A cloud agent's CLI is signed in through the office's own sign-in, which then starts the task again.
        if (box) return finish({ ok: false, text: '', errors: [`${label} isn't signed in in their cloud machine.`], signedOut: true });
        log([{ kind: 'error', text: `⚠ ${label} needs you to sign in: open the terminal and sign in there, or run "${cli}" in a terminal of your own.` }]);
      } else if (!nudged.has('setup') && !trustKey(screen) && Date.now() - trustedAt > 5000 && /Choose the text style|Press Enter to continue|Bypass Permissions mode|Settings Error/i.test(screen)) {
        // First-run screens only the manager should answer: the CLI waits for them in the terminal.
        nudged.add('setup');
        log([{ kind: 'error', text: `⚠ ${label} is waiting on a setup screen: open the terminal to answer it.` }]);
      }
    }, 1000);
    bootTimer = setTimeout(() => {
      if (!done && !begun && cli === 'claude') log([{ kind: 'error', text: `⚠ ${label} hasn't started on the task yet. Open the terminal to see what it's waiting for.` }]);
    }, BOOT_MS);
  };

  const begin = () => {
    if (done) return; // stopped while its thread was being unarchived
    let pty: Pty;
    try {
      pty = spawnPty(cmd!.file, [...cmd!.args, ...launch.args], { cols: term.cols, rows: term.rows, cwd: opts.cwd, env }, metaOf(l));
    } catch (err) {
      setTimeout(() => finish({ ok: false, text: '', errors: [`Could not start ${label}: ${(err as Error).message}`] }), 0);
      return;
    }
    l.proc = pty;
    live = l;
    wire(l, opts.office);
    shotTimer = setInterval(collectShots, 2000);
    watchBoot(pty);
  };

  /** The same in the agent's Box: the session's files go there first, then the CLI starts under tmux. */
  const beginInBox = async (b: NonNullable<typeof box>) => {
    try {
      boxFiles.push([`${dir}/launch.json`, JSON.stringify({ file: cmd!.file, args: [...cmd!.args, ...launch.args], cwd: opts.cwd, events })]);
      for (const [file, text] of boxFiles) await b.api.write(b.boxId, file, text);
      if (done) return;
      const pty = boxPty(l, b, term.cols, term.rows, 0, env);
      l.proc = pty;
      live = l;
      wire(l);
      await pty.open('new');
      remember(l);
      watchBoot(pty);
    } catch (err) {
      finish({ ok: false, text: '', errors: [`Could not start ${label} in the cloud machine: ${(err as Error).message}`] });
    }
  };

  if (box) void beginInBox(box);
  // Codex won't resume a thread the office archived (see codexThread): it's unarchived first.
  else if (cli === 'codex' && opts.resumeSessionId) void codexThread('unarchive', opts.resumeSessionId).then(begin);
  else begin();

  return handle;
}
