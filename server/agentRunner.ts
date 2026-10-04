import fs from 'node:fs';
import path from 'node:path';
import { query, type CanUseTool, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentCli, AgentRole, EffortLevel, LogKind } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import type { UsageWarning } from './pacing.ts';
import type { AgentTerminal } from './terminal.ts';
import { browserProblem, playwrightMcp } from './browser.ts';
import { CROSS_TURN_TOOLS } from './clis.ts';
import { VERSION } from './config.ts';

// One Claude Code instance (via the Claude Agent SDK) working one issue in its own git worktree.
// The CEO runs through here too, with the office tools instead of a shell.

export interface SessionOptions {
  cwd: string;
  prompt: string;
  systemAppend: string;
  model: string; // e.g. 'claude-opus-5-5'
  effort: EffortLevel;
  browserTesting: boolean;
  additionalDirectories: string[]; // read-only reference clones of linked repos
  role: AgentRole;
  /** JSON schema for a structured final answer (QA reports). */
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  /** The CEO's in-process MCP server (mcp__office__*). */
  office?: OfficeTools;
  /** The terminal runtime: the agent's terminal and the CLI to run in it. Without one: an Agent SDK session. */
  terminal?: AgentTerminal;
  cli?: AgentCli;
  /** Who and on what, for the CLI's session name and status line, e.g. "Ada · #12 Add dark mode". */
  label?: string;
  /** Leave the CLI waiting at its prompt when the task is done, for the manager and for follow-ups. */
  keepAlive?: boolean;
  /** The prompt was typed at the CLI's prompt by the manager: it's already running, so it isn't sent again. */
  typed?: boolean;
  /** Whose terminal it is (the terminal keeper holds this, for the office that picks the CLI up after a restart). */
  agentId?: string;
  /** Follow the session of the CLI still running in the terminal after the office restarted; start nothing. */
  reattach?: boolean;
}

export interface LogEntry {
  kind: LogKind;
  text: string;
  tool?: string;
}

export interface SessionResult {
  ok: boolean;
  text: string;
  costUsd: number;
  turns: number;
  errors: string[];
  structured?: unknown;
  /** The manager interrupted the turn in the agent's terminal (Esc). */
  interrupted?: boolean;
}

export interface SessionCallbacks {
  log(entries: LogEntry[]): void;
  tool(name: string | null): void;
  /** The session to resume next time; null: there's none to resume (the next session starts a new one). */
  sessionId(id: string | null): void;
  browserUrl(url: string): void;
  screenshot(data: Buffer, mime: string): void;
  /** The final text of each turn: the reply to the prompt and to every message sent while it ran. */
  turn?(text: string): void;
  /** Claude turned the session away for the subscription's usage limit (epoch ms when it resets, if known). */
  limited?(resetsAt: number | null): void;
  /** Claude warned that the subscription's usage is getting high (not while on overage). */
  usageWarning?(info: UsageWarning): void;
  finished(result: SessionResult): void;
}

export interface SessionHandle {
  send(text: string): void;
  stop(): void;
}

/** Async queue used as the streaming-input prompt so the manager can message a running agent. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(text: string) {
    if (this.closed) return;
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: msg, done: false });
    else this.items.push(msg);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// ---------- permissions and screenshots ----------

// Agents work like the manager's own CLI, but nobody may be watching to answer a permission question: every tool call
// is approved. The office's rules (branches, pull requests, QA leaving GitHub alone) are in their instructions only.
const allowAll: CanUseTool = async (_toolName, input) => ({ behavior: 'allow', updatedInput: input });

/**
 * A Playwright screenshot saved to a file (browser_take_screenshot with a filename) comes back as a link, not an
 * image: the file, read from the agent's worktree, so it still counts as QA evidence.
 */
export function screenshotFile(cwd: string, text: string): { data: Buffer; mime: string } | null {
  const file = text.match(/\]\(([^)\s]+\.(png|jpe?g))\)/i);
  if (!file) return null;
  try {
    return { data: fs.readFileSync(path.resolve(cwd, file[1])), mime: /png$/i.test(file[2]) ? 'image/png' : 'image/jpeg' };
  } catch {
    return null;
  }
}

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * Screenshots in a browser's output folder that aren't in `seen` yet, oldest first (Playwright names them
 * page-<timestamp>). Files changed in the last second may still be being written, so they wait for the next look.
 */
export function newScreenshots(dir: string, seen: Set<string>, now = Date.now()): { name: string; file: string; mime: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: { name: string; file: string; mime: string }[] = [];
  for (const name of names.sort()) {
    const mime = IMAGE_MIME[path.extname(name).toLowerCase()];
    const file = path.join(dir, name);
    if (!mime || seen.has(name)) continue;
    try {
      if (now - fs.statSync(file).mtimeMs < 1000) continue;
    } catch {
      continue;
    }
    found.push({ name, file, mime });
  }
  return found;
}

// ---------- formatting the stream into terminal lines ----------

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rel(cwd: string, p: unknown) {
  const s = String(p ?? '');
  if (!s) return '';
  const r = path.relative(cwd, path.resolve(cwd, s)); // a relative path (Codex's patches) is the agent's, not ours
  return r && !r.startsWith('..') ? r.replaceAll('\\', '/') : s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Agents often prefix commands with `cd "<worktree>" &&` and print absolute paths; show them relative instead. */
export function tidyPaths(cwd: string, text: string): string {
  let out = text;
  for (const v of new Set([cwd, cwd.replaceAll('\\', '/')])) {
    out = out.replace(new RegExp(`^cd\\s+"?${escapeRe(v)}"?\\s*(&&|;)\\s*`, 'i'), '');
    out = out.replace(new RegExp(`${escapeRe(v)}[\\\\/]?`, 'gi'), './');
  }
  return out;
}

export function describeTool(cwd: string, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `$ ${clip(tidyPaths(cwd, String(input.command ?? '')).split('\n')[0], 220)}`;
    case 'Read':
      return `Read ${rel(cwd, input.file_path)}`;
    case 'Write':
      return `Write ${rel(cwd, input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${rel(cwd, input.file_path)}`;
    case 'Glob':
      return `Glob ${input.pattern}`;
    case 'Grep':
      return `Grep "${clip(String(input.pattern ?? ''), 80)}"`;
    case 'WebFetch':
      return `Fetch ${input.url}`;
    case 'WebSearch':
      return `Search "${input.query}"`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${input.description ?? ''}`;
    case 'TodoWrite':
      return 'Update todo list';
    case 'ToolSearch':
      return `Load tools ${String(input.query ?? '').replace(/^select:/, '')}`;
    case 'apply_patch': {
      // Codex's file edits: "*** Add File: a.ts", "*** Update File: b.ts", "*** Delete File: c.ts"
      const files = [...String(input.command ?? '').matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map((m) => `${m[1] === 'Update' ? '' : `${m[1].toLowerCase()} `}${rel(cwd, m[2].trim())}`);
      return `Edit ${clip(files.join(', ') || 'files', 200)}`;
    }
  }
  if (name.startsWith('mcp__playwright__')) {
    const action = name.replace('mcp__playwright__browser_', '').replace('mcp__playwright__', '');
    const detail = input.url ?? input.element ?? input.text ?? '';
    return `🌐 ${action}${detail ? ` ${clip(String(detail), 120)}` : ''}`;
  }
  if (name.startsWith('mcp__office__')) return describeOfficeTool(name.slice('mcp__office__'.length), input);
  return `${name}(${clip(JSON.stringify(input), 140)})`;
}

export function describeOfficeTool(action: string, input: Record<string, unknown>): string {
  const floor = input.floor != null ? ` → floor ${input.floor}` : '';
  switch (action) {
    case 'company_status':
      return '🏢 company_status';
    case 'agent_detail':
      return `🔎 agent_detail ${String(input.agent_id ?? '')}`;
    case 'set_floor_profile':
      return `🗂️ set_floor_profile${floor}${input.summary ? `: ${clip(String(input.summary), 90)}` : ''}`;
    case 'update_job':
      return `🪪 update_job ${input.title ? `"${clip(String(input.title), 60)}"` : String(input.agent_id ?? '')}`;
    case 'propose_hire':
      return `🤝 propose_hire ${input.role === 'qa' ? 'QA ' : ''}"${clip(String(input.title ?? ''), 60)}"${floor}`;
    case 'propose_let_go':
      return `👋 propose_let_go ${String(input.agent_id ?? '')}`;
    case 'file_issue':
      return `📝 file_issue "${clip(String(input.title ?? ''), 70)}"${floor}${input.specialty ? ` · ${input.specialty}` : ''}`;
    case 'close_issue':
      return `🗂️ close_issue #${String(input.number ?? '?')}${floor}`;
    case 'retry_qa':
      return `🔁 retry_qa PR #${String(input.pr ?? '?')}${floor}`;
    case 'send_back':
      return `↩️ send_back PR #${String(input.pr ?? '?')}${floor}`;
    case 'rerun_checks':
      return `🔄 rerun_checks PR #${String(input.pr ?? '?')}${floor}`;
    case 'close_pull':
      return `🗂️ close_pull PR #${String(input.pr ?? '?')}${floor}`;
    case 'escalate':
      return `📣 escalate PR #${String(input.pr ?? '?')}${floor}${input.reason ? `: ${clip(String(input.reason), 90)}` : ''}`;
    case 'route_issue':
      return `🔀 route_issue #${String(input.number ?? '?')}${floor}${input.specialty !== undefined ? ` · ${input.specialty || 'no specialty'}` : ''}${Array.isArray(input.depends_on) ? ` · depends on ${input.depends_on.map((n) => `#${n}`).join(', ') || 'nothing'}` : ''}`;
  }
  return `🏢 ${action}(${clip(JSON.stringify(input), 120)})`;
}

export function todoLines(input: Record<string, unknown>): LogEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
  return todos.slice(0, 12).map((t) => ({
    kind: 'result' as const,
    text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${clip(t.content ?? '', 150)}`,
  }));
}

export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => b?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

const lineCount = (text: string) => text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '').length;

export function summariseResult(cwd: string, tool: string, text: string): LogEntry[] {
  // Claude Code-style one-liners for the chatty file tools
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return [{ kind: 'result', text: '  ⎿ Updated' }];
  if (tool === 'apply_patch' && /Success\. Updated the following files/.test(text)) return [{ kind: 'result', text: '  ⎿ Updated' }];
  if (tool === 'Write') return [{ kind: 'result', text: '  ⎿ Saved' }];
  if (tool === 'Read') return [{ kind: 'result', text: `  ⎿ Read ${lineCount(text)} lines` }];
  if (tool === 'Glob') return [{ kind: 'result', text: `  ⎿ Found ${lineCount(text)} files` }];
  const lines = tidyPaths(cwd, text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [{ kind: 'result', text: '  ⎿ (no output)' }];
  const shown = lines.slice(0, 3).map((l, i) => ({ kind: 'result' as const, text: `${i === 0 ? '  ⎿ ' : '    '}${clip(l, 170)}` }));
  if (lines.length > 3) shown.push({ kind: 'result', text: `    … +${lines.length - 3} lines` });
  return shown;
}

// ---------- the session ----------

export function startSession(opts: SessionOptions, callbacks: SessionCallbacks): SessionHandle {
  let done = false;
  const cb: SessionCallbacks = {
    ...callbacks,
    finished: (r) => {
      if (done) return;
      done = true;
      callbacks.finished(r);
    },
  };
  const input = new InputQueue();
  const abort = new AbortController();
  let pendingTurns = 1;
  let stopped = false;
  let lastCost = 0;
  let lastTurns = 0;
  const toolNames = new Map<string, string>();

  input.push(opts.prompt);

  // Each agent must be a clean Claude Code instance on the subscription Claude Code is logged into.
  // Drop API keys (they would switch billing to the API) and any CLAUDE_* / ANTHROPIC_* variables
  // inherited from a parent Claude Code session (base URL proxies, session sockets, effort overrides…).
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && k !== 'CLAUDE_CONFIG_DIR') continue;
    env[k] = v;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = `cubefarm/${VERSION}`;

  const mcpServers: Options['mcpServers'] = {};
  if (opts.browserTesting) {
    const browser = playwrightMcp();
    if (browser) mcpServers.playwright = browser;
    const problem = browserProblem(browser);
    if (problem) cb.log([{ kind: 'error', text: problem }]);
  }
  if (opts.office) mcpServers.office = opts.office.server;
  // The CEO reads repositories and acts through the office tools; it never runs commands.
  const disallowedTools = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', ...CROSS_TURN_TOOLS];
  if (opts.role === 'ceo') disallowedTools.push('Bash', 'PowerShell', 'NotebookEdit');

  const options: Options = {
    cwd: opts.cwd,
    additionalDirectories: opts.additionalDirectories,
    abortController: abort,
    env,
    model: opts.model || undefined,
    effort: opts.effort,
    // The manager's own setup (settings, skills, plugins, MCP servers, connectors), plus the office's servers below.
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemAppend },
    mcpServers,
    disallowedTools,
    resume: opts.resumeSessionId,
    stderr: (data) => {
      const line = data.trim();
      if (line && /error|fail/i.test(line)) cb.log([{ kind: 'error', text: clip(line, 200) }]);
    },
    permissionMode: 'acceptEdits',
    canUseTool: allowAll,
    ...(opts.outputSchema ? { outputFormat: { type: 'json_schema' as const, schema: opts.outputSchema } } : {}),
  };

  // The office's prompts are answered one result each. See the 'result' case for results that answer none of them.
  let emptyTurn: NodeJS.Timeout | undefined;
  const answered = (msg: Extract<SDKMessage, { type: 'result' }>) => {
    pendingTurns -= 1;
    if (pendingTurns > 0) return;
    input.close();
    const ok = msg.subtype === 'success' && !msg.is_error;
    cb.finished({
      ok,
      text: msg.subtype === 'success' ? msg.result : '',
      costUsd: lastCost,
      turns: lastTurns,
      errors: msg.subtype === 'success' ? [] : msg.errors,
      structured: msg.subtype === 'success' ? msg.structured_output : undefined,
    });
  };

  const handle = (msg: SDKMessage) => {
    clearTimeout(emptyTurn);
    if (done && msg.type === 'assistant' && !stopped) {
      // The office already treated this session as finished and no longer follows it.
      stopped = true;
      cb.log([{ kind: 'system', text: '■ This session kept working after it had finished, so it was stopped.' }]);
      abort.abort();
      return;
    }
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          cb.sessionId(msg.session_id);
          const mcp = msg.mcp_servers.map((s) => `${s.name}:${s.status}`).join(', ');
          cb.log([
            { kind: 'system', text: `✻ Claude Code ${msg.claude_code_version} · ${msg.model} · ${msg.effort ?? opts.effort} effort` },
            { kind: 'system', text: `  cwd ${msg.cwd}${mcp ? ` · mcp ${mcp}` : ''}` },
          ]);
        } else if (msg.subtype === 'api_retry') {
          cb.log([{ kind: 'system', text: `… API retry ${msg.attempt}/${msg.max_retries} in ${Math.round(msg.retry_delay_ms / 1000)}s` }]);
        } else if (msg.subtype === 'compact_boundary') {
          cb.log([{ kind: 'system', text: '✻ Conversation compacted' }]);
        }
        break;
      }
      case 'rate_limit_event': {
        const info = msg.rate_limit_info;
        if (info.status !== 'allowed') {
          const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'later';
          cb.log([{ kind: 'error', text: `⚠ Subscription usage ${info.status === 'rejected' ? 'limit reached' : 'warning'} (${info.rateLimitType ?? 'limit'}) · resets ${when}` }]);
          const overage = info.isUsingOverage || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning';
          if (info.status === 'rejected' && !overage) cb.limited?.(info.resetsAt ? info.resetsAt * 1000 : null);
          if (info.status === 'allowed_warning' && !overage) {
            cb.usageWarning?.({ resetsAt: info.resetsAt ? info.resetsAt * 1000 : null, rateLimitType: info.rateLimitType ?? null, utilization: info.utilization ?? null });
          }
        }
        break;
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) break; // subagent chatter stays off the main screen
        const out: LogEntry[] = [];
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            const lines = block.text.trim().split('\n');
            lines.slice(0, 30).forEach((l, i) => out.push({ kind: 'text', text: `${i === 0 ? '● ' : '  '}${l}` }));
            if (lines.length > 30) out.push({ kind: 'text', text: `  … (${lines.length - 30} more lines)` });
          } else if (block.type === 'thinking') {
            out.push({ kind: 'thinking', text: '✻ Thinking…' });
          } else if (block.type === 'tool_use') {
            const toolInput = (block.input ?? {}) as Record<string, unknown>;
            toolNames.set(block.id, block.name);
            out.push({ kind: 'tool', tool: block.name, text: `⏺ ${describeTool(opts.cwd, block.name, toolInput)}` });
            if (block.name === 'TodoWrite') out.push(...todoLines(toolInput));
            cb.tool(block.name);
            if (block.name === 'mcp__playwright__browser_navigate' && typeof toolInput.url === 'string') cb.browserUrl(toolInput.url);
          }
        }
        if (out.length) cb.log(out);
        break;
      }
      case 'user': {
        if (msg.parent_tool_use_id) break;
        const content = msg.message.content;
        if (!Array.isArray(content)) break;
        const out: LogEntry[] = [];
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const name = toolNames.get(block.tool_use_id) ?? '';
          const text = resultText(block.content);
          let images = 0;
          if (Array.isArray(block.content)) {
            for (const part of block.content) {
              if (part.type === 'image' && part.source.type === 'base64') {
                images += 1;
                cb.screenshot(Buffer.from(part.source.data, 'base64'), part.source.media_type);
              }
            }
          }
          const saved = name === 'mcp__playwright__browser_take_screenshot' && !images ? screenshotFile(opts.cwd, text) : null;
          if (saved) cb.screenshot(saved.data, saved.mime);
          if (name.startsWith('mcp__playwright__')) {
            const url = text.match(/Page URL:\s*(\S+)/);
            if (url) cb.browserUrl(url[1]);
          }
          if (name === 'TodoWrite') continue;
          if (block.is_error) out.push({ kind: 'error', text: `  ⎿ ${clip(tidyPaths(opts.cwd, text).split('\n')[0] || 'Error', 200)}` });
          else out.push(...summariseResult(opts.cwd, name, text));
        }
        cb.tool(null);
        if (out.length) cb.log(out);
        break;
      }
      case 'result': {
        lastCost = msg.total_cost_usd;
        lastTurns = msg.num_turns;
        if (msg.subtype === 'success' && !msg.is_error && msg.num_turns === 0) {
          // A resumed session can first replay a turn left over from before an office restart: an empty "success"
          // that answers none of our prompts, with the real turn right behind it. Counting it ended the session
          // while the real turn ran on without its permission channel. If nothing follows, it was the answer.
          emptyTurn = setTimeout(() => answered(msg), 30_000);
          break;
        }
        if (msg.subtype === 'success' && !msg.is_error && msg.result.trim()) cb.turn?.(msg.result.trim());
        answered(msg);
        break;
      }
    }
  };

  (async () => {
    try {
      for await (const msg of query({ prompt: input, options })) handle(msg);
      if (pendingTurns > 0) {
        cb.finished({ ok: false, text: '', costUsd: lastCost, turns: lastTurns, errors: [stopped ? 'Stopped by manager' : 'Session ended unexpectedly'] });
      }
    } catch (err) {
      input.close();
      const message = stopped ? 'Stopped by manager' : err instanceof Error ? err.message : String(err);
      cb.finished({ ok: false, text: '', costUsd: lastCost, turns: lastTurns, errors: [message] });
    }
  })();

  return {
    send(text) {
      pendingTurns += 1;
      input.push(text);
    },
    stop() {
      stopped = true;
      clearTimeout(emptyTurn);
      input.close();
      abort.abort();
    },
  };
}
