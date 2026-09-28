import path from 'node:path';
import { query, type CanUseTool, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole, EffortLevel, LogKind } from '../shared/types.ts';
import type { OfficeTools } from './ceo.ts';
import type { UsageWarning } from './pacing.ts';
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
  permissionMode: 'guarded' | 'bypass';
  additionalDirectories: string[]; // read-only reference clones of linked repos
  role: AgentRole;
  /** JSON schema for a structured final answer (QA reports). */
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  /** The CEO's in-process MCP server (mcp__office__*). */
  office?: OfficeTools;
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
}

export interface SessionCallbacks {
  log(entries: LogEntry[]): void;
  tool(name: string | null): void;
  sessionId(id: string): void;
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

// ---------- guard rails for the default "guarded" permission mode ----------

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const BLOCKED_COMMANDS: { re: RegExp; why: string }[] = [
  { re: /\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, why: 'force-pushing is not allowed' },
  { re: /\bgh\s+pr\s+merge\b/, why: 'the office merges pull requests once QA and the checks pass, not agents' },
  { re: /\bgh\s+(repo\s+(delete|edit|rename|archive)|secret|auth|release\s+delete|api\s+-X\s*DELETE)\b/, why: 'repository administration is off-limits' },
  { re: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(\/|~|[A-Za-z]:[\\/]?)(\s|$)/, why: 'deleting a filesystem root is not allowed' },
  { re: /\b(shutdown|format\s+[a-z]:|mkfs|Remove-Item\s+[^\n]*-Recurse[^\n]*[A-Za-z]:\\\s*$)/i, why: 'destructive system command' },
  { re: /\bgit\s+worktree\b/, why: 'worktrees are managed by the swarm' },
];

function isInside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// QA testers verify; they never change what's on GitHub. The office posts their report for them.
const QA_BLOCKED: { re: RegExp; why: string }[] = [
  { re: /\bgit\s+push\b/, why: 'QA testers do not push code' },
  { re: /\bgh\s+(pr|issue)\s+(merge|close|reopen|review|comment|edit|ready|create)\b/, why: 'QA testers report back to the office instead of changing PRs or issues' },
];

function guardedCanUseTool(cwd: string, defaultBranchPush: RegExp, role: AgentRole): CanUseTool {
  return async (toolName, input, { blockedPath }) => {
    if (toolName.startsWith('mcp__') && !toolName.startsWith('mcp__playwright__') && !(role === 'ceo' && toolName.startsWith('mcp__office__'))) {
      return { behavior: 'deny', message: 'Only the Playwright browser tools are available to swarm agents.' };
    }
    if (WRITE_TOOLS.has(toolName)) {
      const target = String(input.file_path ?? input.notebook_path ?? '');
      if (target && !isInside(path.resolve(cwd, target), cwd)) {
        return { behavior: 'deny', message: `You may only edit files inside your worktree (${cwd}).` };
      }
    }
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmd = String(input.command ?? '');
      for (const rule of role === 'qa' ? [...BLOCKED_COMMANDS, ...QA_BLOCKED] : BLOCKED_COMMANDS) {
        if (rule.re.test(cmd)) return { behavior: 'deny', message: `Blocked by cubefarm: ${rule.why}.` };
      }
      if (defaultBranchPush.test(cmd)) {
        return { behavior: 'deny', message: 'Push your own branch and open a PR; pushing to the default branch is not allowed.' };
      }
      if (blockedPath && /\b(rm|del|rmdir|mv|move|Remove-Item)\b/i.test(cmd) && !isInside(path.resolve(blockedPath), cwd)) {
        return { behavior: 'deny', message: `That command touches ${blockedPath}, which is outside your worktree.` };
      }
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

// ---------- formatting the stream into terminal lines ----------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rel(cwd: string, p: unknown) {
  const s = String(p ?? '');
  if (!s) return '';
  const r = path.relative(cwd, s);
  return r && !r.startsWith('..') ? r.replaceAll('\\', '/') : s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Agents often prefix commands with `cd "<worktree>" &&` and print absolute paths; show them relative instead. */
function tidyPaths(cwd: string, text: string): string {
  let out = text;
  for (const v of new Set([cwd, cwd.replaceAll('\\', '/')])) {
    out = out.replace(new RegExp(`^cd\\s+"?${escapeRe(v)}"?\\s*(&&|;)\\s*`, 'i'), '');
    out = out.replace(new RegExp(`${escapeRe(v)}[\\\\/]?`, 'gi'), './');
  }
  return out;
}

function describeTool(cwd: string, name: string, input: Record<string, unknown>): string {
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
    case 'route_issue':
      return `🔀 route_issue #${String(input.number ?? '?')}${floor}${input.specialty !== undefined ? ` · ${input.specialty || 'no specialty'}` : ''}${Array.isArray(input.depends_on) ? ` · depends on ${input.depends_on.map((n) => `#${n}`).join(', ') || 'nothing'}` : ''}`;
  }
  return `🏢 ${action}(${clip(JSON.stringify(input), 120)})`;
}

function todoLines(input: Record<string, unknown>): LogEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
  return todos.slice(0, 12).map((t) => ({
    kind: 'result' as const,
    text: `  ${t.status === 'completed' ? '☒' : t.status === 'in_progress' ? '◐' : '☐'} ${clip(t.content ?? '', 150)}`,
  }));
}

function resultText(content: unknown): string {
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

function summariseResult(cwd: string, tool: string, text: string): LogEntry[] {
  // Claude Code-style one-liners for the chatty file tools
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return [{ kind: 'result', text: '  ⎿ Updated' }];
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

export function startSession(opts: SessionOptions, callbacks: SessionCallbacks, defaultBranch: string): SessionHandle {
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
    // browser-init.js keeps pages from taking the real mouse with pointer lock (headless Chrome does on Windows).
    const args = ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--init-script', path.join(import.meta.dirname, 'browser-init.js')];
    mcpServers.playwright = process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args };
  }
  if (opts.office) mcpServers.office = opts.office.server;
  // The CEO reads repositories and acts through the office tools; it never runs commands.
  const disallowedTools = ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'];
  if (opts.role === 'ceo') disallowedTools.push('Bash', 'PowerShell', 'NotebookEdit');

  const escaped = defaultBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defaultBranchPush = new RegExp(`\\bgit\\s+push\\b[^\\n]*\\s(HEAD:)?(refs/heads/)?${escaped}(\\s|$)`);

  const options: Options = {
    cwd: opts.cwd,
    additionalDirectories: opts.additionalDirectories,
    abortController: abort,
    env,
    model: opts.model || undefined,
    effort: opts.effort,
    settingSources: ['project', 'local'],
    // Agents get exactly the MCP servers passed below: no claude.ai connectors (Gmail, Drive…),
    // no user-level servers or plugins from the host machine.
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true },
    systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemAppend },
    mcpServers,
    disallowedTools,
    resume: opts.resumeSessionId,
    stderr: (data) => {
      const line = data.trim();
      if (line && /error|fail/i.test(line)) cb.log([{ kind: 'error', text: clip(line, 200) }]);
    },
    ...(opts.permissionMode === 'bypass'
      ? { permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true }
      : { permissionMode: 'acceptEdits' as const, canUseTool: guardedCanUseTool(opts.cwd, defaultBranchPush, opts.role) }),
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
      // The office already treated this session as finished, so it can't approve anything the session does.
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
            { kind: 'system', text: `✻ Claude Code ${msg.claude_code_version} · ${msg.model} · ${msg.effort ?? opts.effort} effort · ${opts.permissionMode}` },
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
          if (Array.isArray(block.content)) {
            for (const part of block.content) {
              if (part.type === 'image' && part.source.type === 'base64') {
                cb.screenshot(Buffer.from(part.source.data, 'base64'), part.source.media_type);
              }
            }
          }
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
