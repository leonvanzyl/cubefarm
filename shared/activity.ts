// What an agent is doing, in a form safe to float over their head: tool calls and status mapped to a kind of work
// (an icon) and a short detail ("store.ts", "npm test"), never a whole command, a path outside their desk, a secret
// or an env value. The server works each agent's activity out from their log lines (swarm.ts); the client's hover
// card summarises the log tail with the same functions.

import { INSTALL_STEP, type ActivityKind, type AgentActivity, type AgentStatus, type AgentTask, type LogLine } from './types.ts';

export const ACTIVITY_ICONS: Record<ActivityKind, string> = {
  read: '📖',
  edit: '✏️',
  test: '🧪',
  build: '🏗️',
  browse: '🌐',
  git: '🐙',
  ci: '⏳',
  qa: '🔍',
  fix: '🔧',
  talk: '💬',
  run: '⚙️',
};

/** What each kind is called on the hover card ("editing · store.ts"). */
export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  read: 'reading',
  edit: 'editing',
  test: 'testing',
  build: 'building',
  browse: 'browsing',
  git: 'on git',
  ci: 'waiting on CI',
  qa: 'QA testing',
  fix: 'fixing a PR',
  talk: 'talking to you',
  run: 'running',
};

/** The longest detail shown over a head. */
export const DETAIL_MAX = 24;

// ---------- redaction ----------

const MASK = '•••';

// Well-known token and key shapes, wherever they turn up.
const TOKENS: RegExp[] = [
  /\b(?:gh[opusr])_[A-Za-z0-9]{16,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{12,}/g, // Anthropic, OpenAI…
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/**
 * Masks anything that could be a secret: known token shapes, env assignments (`API_KEY=…`, `$env:X = …`),
 * credentials in URLs, secret-looking query parameters and flags, auth headers and long random strings.
 */
export function redact(text: string): string {
  let s = text;
  for (const re of TOKENS) s = s.replace(re, MASK);
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${MASK}@`); // https://user:pass@host
  s = s.replace(/([?&;](?:[\w-]*(?:token|key|secret|password|passwd|pwd|auth|sig|signature|credential)[\w-]*)=)[^&\s#'"]+/gi, `$1${MASK}`);
  s = s.replace(/(\$env:[A-Za-z_][\w]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`);
  s = s.replace(/(\b[A-Za-z_][A-Za-z0-9_]*=)("[^"]*"|'[^']*'|[^\s"';&|]+)/g, (m, name: string) => (/^[A-Z_][A-Z0-9_]*=$/.test(name) || /(?:token|key|secret|pass|pwd|auth)/i.test(name) ? `${name}${MASK}` : m));
  s = s.replace(/(^|\s)(--?[\w-]*(?:token|password|passwd|secret|api-?key|auth|credential)[\w-]*(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, `$1$2${MASK}`);
  s = s.replace(/\b(Bearer|Basic|token)\s+(?=[\w.~+/=-]*\d)[\w.~+/=-]{8,}/g, `$1 ${MASK}`);
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, MASK); // hashes, hex keys
  s = s.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (m) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) ? MASK : m)); // base64-ish blobs
  return s;
}

/** Collapses whitespace and cuts to `max` characters with an ellipsis. */
export function clipText(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…` : s;
}

// ---------- paths ----------

/** A path that isn't inside the agent's desk: absolute (the log shows desk paths relative), home-relative or above it. */
export const outsideDesk = (p: string) => /^(?:[A-Za-z]:[\\/]|[\\/]|~|\.\.(?:[\\/]|$)|\$|%)/.test(p.trim());

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/** A file as shown over a head: its name, and only its name when it lives outside the desk. */
export function fileLabel(p: string): string {
  const s = p.trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  return outsideDesk(s) ? `…/${basename(s)}` : basename(s) || s;
}

// ---------- shell commands ----------

/** A command line split into its commands (at unquoted &&, ||, ;, | and &) and each into words, quotes removed. */
export function splitCommand(cmd: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  let open = false;
  let quote: string | null = null;
  const endWord = () => {
    if (open) words.push(word);
    word = '';
    open = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      open = true;
    } else if ((c === '&' || c === '|') && (cmd[i - 1] === '>' || cmd[i + 1] === '>')) {
      word += c; // 2>&1, &>
      open = true;
    } else if (c === '&' || c === '|' || c === ';' || c === '\n') {
      endCommand();
      if (cmd[i + 1] === c) i++;
    } else if (/\s/.test(c)) endWord();
    else {
      word += c;
      open = true;
    }
  }
  endCommand();
  return out;
}

const program = (w: string) => basename(w).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'npx', 'pnpx', 'bunx', 'call', 'start-process', '&']);
const IGNORED = new Set(['cd', 'pushd', 'popd', 'set', 'export', 'setx', 'set-location', 'sl', 'true', 'sleep', 'start-sleep', 'clear', 'cls']);
const TESTS = new Set(['vitest', 'jest', 'mocha', 'ava', 'tap', 'pytest', 'tsc', 'vue-tsc', 'eslint', 'biome', 'prettier', 'stylelint', 'ruff', 'mypy', 'phpunit', 'rspec', 'tox', 'pyright', 'oxlint']);
const PACKAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno']);
const BUILDERS = new Set(['make', 'cmake', 'webpack', 'esbuild', 'rollup', 'tsup', 'turbo', 'nx', 'pip', 'pip3', 'poetry', 'uv', 'bundle', 'composer']);
const LANGS = new Set(['cargo', 'go', 'dotnet', 'mvn', 'gradle', 'gradlew', 'swift', 'zig', 'mix']);
const READERS = new Set(['cat', 'type', 'ls', 'dir', 'find', 'fd', 'grep', 'rg', 'ag', 'head', 'tail', 'less', 'more', 'wc', 'tree', 'stat', 'file', 'pwd', 'which', 'where', 'awk', 'jq', 'diff', 'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'get-item', 'test-path', 'bat', 'du', 'nl']);
const EDITORS = new Set(['mv', 'cp', 'rm', 'rmdir', 'mkdir', 'touch', 'ln', 'chmod', 'tee', 'patch', 'move', 'copy', 'del', 'ren', 'set-content', 'add-content', 'out-file', 'new-item', 'remove-item', 'copy-item', 'move-item', 'rename-item']);
const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'http', 'xh']);

/** What one command (its words, wrappers stripped) is: the kind of work, or null for ones not worth a sign (cd …). */
function commandKind(words: string[]): ActivityKind | null {
  const p = program(words[0]);
  const a = words.slice(1).map((w) => w.toLowerCase());
  if (IGNORED.has(p) || /^\$env:/i.test(words[0])) return null;
  if (p === 'gh') return (a[0] === 'pr' && a[1] === 'checks') || (a[0] === 'run' && ['watch', 'view', 'list'].includes(a[1])) ? 'ci' : 'git';
  if (p === 'git') return 'git';
  if (TESTS.has(p)) return p === 'tsc' && (a.includes('-b') || a.includes('--build')) ? 'build' : 'test';
  if (p === 'playwright' || p === 'cypress') return a[0] === 'test' || a[0] === 'run' ? 'test' : 'run';
  if (PACKAGERS.has(p)) {
    const script = a[0] === 'run' || a[0] === 'run-script' ? a[1] : a[0];
    if (!script) return 'build'; // a bare `npm` / `yarn` installs
    if (/^(t|tst|test)$/.test(script) || /test|lint|typecheck|type-check|tsc|check|e2e|spec|vitest|jest/.test(script)) return 'test';
    if (/^(ci|i|install|add|remove|uninstall|update|up|upgrade|rebuild)$/.test(script) || /build|compile|bundle|pack|dist/.test(script)) return 'build';
    return 'run';
  }
  if (LANGS.has(p)) return a[0] === 'test' || a[0] === 'check' || a[0] === 'vet' || a[0] === 'clippy' ? 'test' : a[0] === 'build' || a[0] === 'install' || a[0] === 'publish' ? 'build' : 'run';
  if (p === 'vite' || p === 'next' || p === 'astro' || p === 'nuxt' || p === 'docker') return a[0] === 'build' ? 'build' : 'run';
  if (BUILDERS.has(p)) return 'build';
  if ((p === 'python' || p === 'python3' || p === 'py') && a[0] === '-m') return ['pytest', 'unittest', 'mypy', 'ruff'].includes(a[1]) ? 'test' : 'run';
  if (p === 'node' && a.includes('--test')) return 'test';
  if (p === 'sed' || p === 'perl') return a.some((x) => /^-[a-z]*i/.test(x)) ? 'edit' : 'read';
  if (READERS.has(p)) return 'read';
  if (EDITORS.has(p)) return 'edit';
  if (FETCHERS.has(p)) return 'browse';
  return 'run';
}

// When a line runs several commands, the sign shows the one that says most about the work.
const RANK: Record<ActivityKind, number> = { ci: 9, test: 8, build: 7, git: 6, edit: 5, browse: 4, read: 3, run: 2, qa: 1, fix: 1, talk: 1 };

// A word worth showing after the program: a subcommand or a short name. Long mixes of letters and digits could be a
// key passed on the command line, so the sign stops before them.
const plainWord = (w: string) => /^[\w@.:+-]+$/.test(w) && !w.startsWith('-') && w.length <= 24 && !(w.length > 10 && /\d/.test(w) && /[a-z]/i.test(w));
const pathWord = (w: string) => /[\\/]/.test(w) || /^[\w.-]+\.[A-Za-z]{1,5}$/.test(w);

/** A shell command line as a sign: its most telling command, as its program and first few plain words. */
export function shellActivity(line: string, max = DETAIL_MAX): AgentActivity {
  let best: { kind: ActivityKind; words: string[] } | null = null;
  for (const all of splitCommand(line)) {
    let words = all;
    while (words.length && (WRAPPERS.has(program(words[0])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))) words = words.slice(1);
    if (!words.length) continue;
    const kind = commandKind(words);
    if (kind && (!best || RANK[kind] >= RANK[best.kind])) best = { kind, words };
  }
  if (!best) return { kind: 'run', detail: '' };
  const shown = [program(best.words[0])];
  for (const w of best.words.slice(1)) {
    if (shown.length >= 4) break;
    if (w === '-m' && shown[0].startsWith('py')) shown.push(w); // python -m pytest
    else if (plainWord(w) && !pathWord(w)) shown.push(w);
    else if (pathWord(w) && !w.startsWith('-') && !outsideDesk(w) && (best.kind === 'read' || best.kind === 'edit' || best.kind === 'test')) {
      shown.push(basename(w));
      break;
    } else break;
  }
  return { kind: best.kind, detail: clipText(redact(shown.join(' ')), max) };
}

// ---------- tool calls ----------

const hostOf = (url: string) => url.trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/?#\s]+)/i)?.[1] ?? '';

const OFFICE_KINDS: Record<string, ActivityKind> = {
  company_status: 'read',
  agent_detail: 'read',
  set_floor_profile: 'edit',
  update_job: 'edit',
  file_issue: 'git',
  close_issue: 'git',
  route_issue: 'git',
  retry_qa: 'git',
  send_back: 'git',
  rerun_checks: 'ci',
  close_pull: 'git',
  propose_hire: 'talk',
  propose_let_go: 'talk',
  escalate: 'talk',
};

/**
 * One tool call (a log line: the tool's name and the office's description of it, "⏺ Edit src/store.ts") as an
 * activity; null for bookkeeping calls (the todo list) that don't change what someone is doing.
 */
export function toolActivity(tool: string, text: string, max = DETAIL_MAX): AgentActivity | null {
  const body = text.replace(/^\s*⏺\s*/u, '').trim();
  const rest = body.replace(/^\S+\s*/, ''); // what follows the verb ("Edit", "Read", …)
  const clip = (s: string) => clipText(redact(s), max);
  if (body.startsWith('$ ')) return shellActivity(body.slice(2), max);
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
    case 'LS':
      return { kind: 'read', detail: clip(fileLabel(rest)) };
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'apply_patch':
      return { kind: 'edit', detail: clip(fileLabel(rest.split(',')[0].replace(/^(add|delete)\s+/, ''))) };
    case 'Glob':
      return { kind: 'read', detail: clip(outsideDesk(rest) ? fileLabel(rest) : rest) };
    case 'Grep':
      return { kind: 'read', detail: clip(`grep ${rest.replace(/^"|"$/g, '')}`) };
    case 'WebFetch':
      return { kind: 'browse', detail: clip(hostOf(rest)) };
    case 'WebSearch':
      return { kind: 'browse', detail: clip(`search ${rest.replace(/^"|"$/g, '')}`) };
    case 'Task':
    case 'Agent':
      return { kind: 'read', detail: clip(body.replace(/^Subagent:\s*/, '') || 'subagent') };
    case 'TodoWrite':
    case 'ToolSearch':
    case 'ExitPlanMode':
      return null;
  }
  const mcp = tool.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (mcp) {
    const [, server, action] = mcp;
    if (server === 'playwright') {
      const verb = action.replace(/^browser_/, '').replace(/_/g, ' ');
      const url = verb === 'navigate' ? hostOf(body.replace(/^🌐\s*navigate\s*/u, '')) : '';
      return { kind: 'browse', detail: clip(url ? `${verb} ${url}` : verb) };
    }
    if (server === 'office') {
      const pr = body.match(/#(\d+)/)?.[1];
      return { kind: OFFICE_KINDS[action] ?? 'run', detail: clip(`${action.replace(/_/g, ' ')}${pr ? ` #${pr}` : ''}`) };
    }
    return { kind: /git(hub|lab)?/i.test(server) ? 'git' : 'run', detail: clip(action.replace(/_/g, ' ')) };
  }
  return { kind: 'run', detail: clip(tool.replace(/[^\w .-]/g, '')) };
}

/** A log line as an activity: a tool call, or a message from the manager (they stop to read it); null otherwise. */
export function lineActivity(line: Pick<LogLine, 'kind' | 'text' | 'tool'>, max = DETAIL_MAX): AgentActivity | null {
  if (line.kind === 'tool') return toolActivity(line.tool ?? '', line.text, max);
  if (line.kind === 'manager' && line.text.startsWith('▶')) return { kind: 'talk', detail: 'your message' };
  return null;
}

/** A log line as one line on the hover card ("✏️ store.ts", "🧪 npm test"); null for lines that aren't actions. */
export function actionSummary(line: Pick<LogLine, 'kind' | 'text' | 'tool'>, max = 36): string | null {
  const a = lineActivity(line, max);
  if (a) return `${ACTIVITY_ICONS[a.kind]} ${a.detail || ACTIVITY_LABELS[a.kind]}`;
  if (line.kind === 'done') return clipText(redact(line.text), max + 3);
  return null;
}

/** The newest `n` actions in a log tail, newest first. */
export function recentActions(log: readonly Pick<LogLine, 'kind' | 'text' | 'tool'>[], n = 3, max = 36): string[] {
  const out: string[] = [];
  for (let i = log.length - 1; i >= 0 && i >= log.length - 400 && out.length < n; i--) {
    const s = actionSummary(log[i], max);
    if (s) out.push(s);
  }
  return out;
}

// ---------- the agent's sign ----------

export interface ActivityInput {
  status: AgentStatus;
  task: AgentTask | null;
  currentTool: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  startedAt: number | null;
}

/** The last activity seen in an agent's log, and when (epoch ms). */
export type SeenActivity = AgentActivity & { at: number };

/**
 * What the sign over an agent shows: nothing unless they're busy; setting up their desk; or their latest action this
 * session, under the task's own sign while testing (🔍) or fixing (🔧) a PR, except waiting on CI and talking.
 * `chat`: the CEO is answering the manager.
 */
export function agentActivity(a: ActivityInput, last: SeenActivity | null, chat = false): AgentActivity | null {
  if (a.status === 'preparing') return { kind: 'build', detail: a.currentTool === INSTALL_STEP ? 'installing deps' : 'setting up desk' };
  if (a.status !== 'working') return null;
  const seen = last && (a.startedAt == null || last.at >= a.startedAt) ? { kind: last.kind, detail: last.detail } : null;
  if (chat) return { kind: 'talk', detail: seen?.detail ?? '' };
  if (seen?.kind === 'talk' || seen?.kind === 'ci') return seen;
  const pr = a.prNumber ? `PR #${a.prNumber}` : '';
  if (a.task === 'qa') return { kind: 'qa', detail: seen?.detail || pr };
  if (a.task === 'fix') return { kind: 'fix', detail: seen?.detail || pr };
  return seen ?? { kind: 'read', detail: a.issueNumber ? `issue #${a.issueNumber}` : '' };
}

/** Two activities show the same sign. */
export const sameActivity = (x: AgentActivity | null | undefined, y: AgentActivity | null | undefined) => (x?.kind ?? null) === (y?.kind ?? null) && (x?.detail ?? '') === (y?.detail ?? '');
