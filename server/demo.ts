import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { Backend } from './backend.ts';
import type { PreviewBackend } from './previewRunner.ts';
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { CLIS } from './clis.ts';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';
import type { LocalFolder } from './workspace.ts';
import { HOME_DIR } from './config.ts';
import { takeLastUpdate, underLauncher, type OfficeHost } from './officeUpdate.ts';
import { VoiceApiError, type VoiceApi } from './voice.ts';

// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// dev → QA → fix loop) can be explored without spending any usage or touching real repos.

interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[];
  pulls: PullInfo[];
  nextNumber: number;
}

const now = () => new Date().toISOString();

function issue(n: number, title: string, body: string, fullName: string, labels: string[] = []): IssueInfo {
  return { number: n, title, body, url: `https://github.com/${fullName}/issues/${n}`, labels, createdAt: now() };
}

const repos = new Map<string, FakeRepo>();
/** Repos made in the demo (new projects, published folders): empty, so no package.json for the preview to fall back on. */
const bareRepos = new Set<string>();
const mergedSinceSync = new Map<string, number>(); // merges the fake project folder hasn't pulled yet
const closedIssues = new Set<string>(); // `${fullName}#${n}`: issues closed by a merge

const fakeSha = () => crypto.randomBytes(20).toString('hex');

let runSeq = 1000; // fake Actions run ids, so the office can re-run a failed one
/** Fake CI: checks run for a while after every push, and now and then one fails so the fix loop shows. */
function runChecks(pr: PullInfo, fail = Math.random() < 0.2) {
  Object.assign(pr, { checks: 'pending', pendingChecks: ['CI / build', 'Vercel'], failedChecks: [] });
  setTimeout(() => {
    Object.assign(pr, {
      checks: fail ? 'failing' : 'passing',
      pendingChecks: [],
      failedChecks: fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++runSeq}/job/1` }] : [],
    });
  }, 12_000 + Math.random() * 10_000);
}

function seed(fullName: string, description: string, titles: [string, string][]) {
  const r: FakeRepo = { fullName, description, issues: [], pulls: [], nextNumber: 1 };
  for (const [title, body] of titles) r.issues.push(issue(r.nextNumber++, title, body, fullName));
  repos.set(fullName, r);
}

seed('demo-co/pixel-todo', 'A cheerful todo app', [
  ['Add dark mode toggle', 'Users want a dark theme. Persist the choice in localStorage.'],
  ['Todos should support due dates', 'Add an optional due date and highlight overdue items.'],
  ['Drag and drop to reorder', 'Let users reorder todos by dragging.'],
  ['Empty state illustration', 'Show a friendly illustration when the list is empty.'],
  ['Keyboard shortcuts', 'N for new todo, / to search, ? for help.'],
  ['Fix: completed count off by one', 'The footer shows one more completed item than there is.'],
]);
seed('demo-co/weather-api', 'Tiny weather REST API', [
  ['Add /forecast endpoint', 'Return a 5-day forecast for a city.'],
  ['Rate limit anonymous callers', '60 requests per minute per IP.'],
  ['OpenAPI spec', 'Publish an OpenAPI 3.1 document at /openapi.json.'],
]);

function screenshotSvg(title: string, url: string, hue: number) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="hsl(${hue},60%,97%)"/>
  <rect width="640" height="56" fill="hsl(${hue},70%,55%)"/>
  <text x="24" y="37" font-family="Segoe UI, Arial" font-size="22" font-weight="700" fill="#fff">${safe(title)}</text>
  <text x="620" y="36" text-anchor="end" font-family="Segoe UI, Arial" font-size="13" fill="#fff">${safe(url)}</text>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<rect x="24" y="${84 + i * 70}" width="592" height="56" rx="10" fill="#fff" stroke="hsl(${hue},40%,85%)"/>
  <circle cx="54" cy="${112 + i * 70}" r="11" fill="none" stroke="hsl(${hue},60%,55%)" stroke-width="3"/>
  <rect x="80" y="${104 + i * 70}" width="${180 + ((i * 97) % 220)}" height="14" rx="7" fill="hsl(${hue},25%,80%)"/>`,
    )
    .join('\n')}
</svg>`;
}

type Step = LogEntry[] | (() => void);

function devScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
  const branch = path.basename(opts.cwd);
  const hue = (issueNumber * 67) % 360;
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][issueNumber % 4];
  const port = 5200 + (issueNumber % 50);
  return [
    [{ kind: 'text', text: `● I'll start by getting familiar with the codebase for "${issueTitle}".` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ Found 23 files' }],
    [{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ Read 184 lines' }],
    [{ kind: 'thinking', text: '✻ Thinking…' }],
    [
      { kind: 'tool', tool: 'TodoWrite', text: '⏺ Update todo list' },
      { kind: 'result', text: '  ◐ Understand current behaviour' },
      { kind: 'result', text: '  ☐ Implement the change' },
      { kind: 'result', text: '  ☐ Add tests' },
      { kind: 'result', text: '  ☐ Verify in the browser' },
    ],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ Found 6 matches in 4 files' }],
    [{ kind: 'text', text: "● The state lives in a single hook. I'll extend it and keep the API backwards compatible." }],
    [{ kind: 'tool', tool: 'Edit', text: `⏺ Edit ${file}` }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Write', text: '⏺ Write src/__tests__/feature.test.ts' }, { kind: 'result', text: '  ⎿ Saved' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' },
      { kind: 'result', text: '    Test Files  7 passed (7)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'text', text: '● Looks right in the browser. Committing and opening a PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ git commit -am "feat: ${issueTitle.toLowerCase()}"` }, { kind: 'result', text: `  ⎿ [${branch} 3f2a91c] feat: ${issueTitle.toLowerCase()}` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git push -u origin HEAD' }, { kind: 'result', text: '  ⎿ branch set up to track origin' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr create --title "${issueTitle}" --body "Closes #${issueNumber}"` }],
  ];
}

function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number, checks: string): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  // With GitHub checks on the PR, QA reads what they cover instead of re-running the suite.
  const verify: Step[] = checks.endsWith(': none')
    ? [
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm test -- --run' }],
        [
          { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' },
          { kind: 'result', text: '    Tests  41 passed (41)' },
        ],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run lint && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ]
    : [
        [{ kind: 'tool', tool: 'Read', text: '⏺ Read .github/workflows/ci.yml' }, { kind: 'result', text: '  ⎿ Read 41 lines' }],
        [{ kind: 'text', text: '● CI already runs the tests, lint and build, so I only need a build to start the app.' }],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ];
  return [
    [{ kind: 'text', text: `● Testing PR #${pr} "${title}" (round ${round}). ${checks}. First, the acceptance criteria from the issue.` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git diff origin/main...HEAD --stat' }, { kind: 'result', text: '  ⎿  3 files changed, 82 insertions(+), 9 deletions(-)' }],
    ...verify,
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run preview -- --port ${port} &` }, { kind: 'result', text: `  ⎿ Local: http://localhost:${port}/` }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_click', text: '⏺ 🌐 click "Add todo" button' }, { kind: 'result', text: '  ⎿ Clicked' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_resize', text: '⏺ 🌐 resize 375x740' }, { kind: 'result', text: '  ⎿ Resized' }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · mobile · ${title}`, `localhost:${port}`, (hue + 40) % 360)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_console_messages', text: '⏺ 🌐 console_messages' }, { kind: 'result', text: '  ⎿ No errors' }],
  ];
}

function fixScript(pr: number, pushes: boolean, nudged: boolean): Step[] {
  if (nudged) {
    return [
      [{ kind: 'text', text: `● Checking whether PR #${pr} still needs a change.` }],
      pushes
        ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
        : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git fetch origin && git diff origin/main --stat -- src/styles.css' }, { kind: 'result', text: '  ⎿ (no differences)' }],
    ];
  }
  return [
    [{ kind: 'text', text: `● Reading the QA report for PR #${pr}. The toolbar overflows on phones; I'll let it wrap.` }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/styles.css' }, { kind: 'result', text: '  ⎿ Read 212 lines' }],
    [{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/styles.css' }, { kind: 'result', text: '  ⎿ Updated' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }, { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' }],
    pushes
      ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: wrap toolbar on narrow screens" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
      : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git status --short' }, { kind: 'result', text: '  ⎿  M src/styles.css' }],
  ];
}

/** The PR a fix prompt is about ("QA passed pull request #6…", "Pull request #6 (url) conflicts…"), and its title if given. */
export function fixPromptPull(prompt: string): { number: number; title?: string } {
  const m = prompt.match(/pull request #(\d+)(?::\s*(.+))?/i);
  return { number: Number(m?.[1] ?? 0), title: m?.[2]?.trim() };
}

function fakeSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  const nudged = /^You pushed nothing/.test(opts.prompt); // the office's nudge after a fix that pushed nothing
  const resumedFix = opts.resumeSessionId?.startsWith('demo-fix-') ?? false;
  const kind = opts.role === 'qa' ? 'qa' : nudged || resumedFix || /FAILED|taking over pull request|git push origin HEAD:/.test(opts.prompt) ? 'fix' : 'issue';
  // Fix sessions can be resumed (the office's nudge), like real ones.
  if (kind === 'fix') cb.sessionId(opts.resumeSessionId ?? `demo-fix-${crypto.randomUUID()}`);
  const pull = fixPromptPull(opts.prompt);
  const issueMatch = opts.prompt.match(/#(\d+):\s*(.+)/);
  const number = kind === 'issue' ? Number(issueMatch?.[1] ?? 0) : pull.number;
  const title = (kind === 'issue' ? issueMatch?.[2]?.trim() : pull.title) ?? 'follow-up';
  const round = Number(opts.prompt.match(/QA round (\d+)/)?.[1] ?? 1);
  // Now and then a QA fix ends without pushing, so the office's nudge can be seen; half the nudged answer NO CHANGE NEEDED.
  const pushes = kind !== 'fix' || !(nudged || /FAILED|taking over pull request/.test(opts.prompt)) || Math.random() > (nudged ? 0.5 : 0.25);

  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
  ];
  const checks = opts.prompt.match(/^GitHub checks right now: .*$/m)?.[0] ?? 'GitHub checks right now: none';
  const body = kind === 'qa' ? qaScript(cb, number, title, round, checks) : kind === 'fix' ? fixScript(number, pushes, nudged) : devScript(opts, cb, number, title);
  const script = [header, ...body];

  const finish = () => {
    const costUsd = 0.3 + Math.random();
    const turns = 15 + Math.floor(Math.random() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass; some fail so the fix loop can be seen in action.
      const pass = round > 1 || Math.random() > 0.35;
      cb.log([{ kind: 'text', text: pass ? '● Everything checks out. Writing up the report.' : '● The toolbar overflows on a 375px screen. Failing this round.' }]);
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'The change does what the issue asks: the feature works on desktop and mobile, all 41 tests pass, and lint and build are clean.'
            : 'The feature works on desktop, but on a 375px-wide screen the toolbar overflows and the new button is cut off.',
          checks: [
            { name: 'Unit tests', result: 'pass', details: '41 passed, 0 failed' },
            { name: 'Lint + build', result: 'pass', details: 'No lint errors; production build succeeds' },
            { name: 'Feature works on desktop', result: 'pass', details: 'Clicked through the new flow at 1280x800' },
            { name: 'Mobile layout (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'Layout wraps correctly' : 'Toolbar overflows horizontally; button unreachable' },
            { name: 'Console errors', result: 'pass', details: 'None' },
          ],
          commands: [
            { command: 'npm test -- --run', result: '41 passed' },
            { command: 'npm run lint && npm run build', result: 'clean, built in 1.84s' },
          ],
          screenshots: ['Desktop view after the change', 'Mobile view at 375px'],
          fixInstructions: pass ? undefined : 'Make the toolbar wrap (flex-wrap: wrap) below 480px so every button stays visible.',
        },
      });
      return;
    }
    if (kind === 'fix') {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr && pushes) {
        pr.headSha = fakeSha();
        pr.mergeState = 'CLEAN';
        pr.mergeable = 'MERGEABLE';
        runChecks(pr, false);
      }
      const text = pushes
        ? `● Fixed PR #${number} and pushed. Ready for another QA round.`
        : nudged
          ? 'NO CHANGE NEEDED: main already makes the toolbar wrap, so the PR is right as it is.'
          : '● The toolbar wraps on narrow screens now. Ready for another QA round.';
      cb.log([{ kind: 'text', text }]);
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    const repo = repos.get(fullName);
    let url = '';
    if (repo && number) {
      const n = repo.nextNumber++;
      url = `https://github.com/${fullName}/pull/${n}`;
      repo.pulls.unshift({
        number: n,
        title,
        url,
        headRefName: `swarm/issue-${number}-${path.basename(opts.cwd).replace(/-[0-9a-f]{4}$/, '')}`,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [number],
        createdAt: now(),
        mergedAt: null,
        additions: 40 + ((number * 13) % 200),
        deletions: (number * 7) % 40,
        checks: 'pending',
        headSha: fakeSha(),
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
      });
      runChecks(repo.pulls[0]);
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    cb.log([{ kind: 'text', text: `● Opened ${url || 'the pull request'}. It closes #${number} and includes tests.` }]);
    cb.finished({ ok: true, text: url, costUsd, turns, errors: [] });
  };

  let i = 0;
  const step = () => {
    if (stopped) return;
    if (i >= script.length) return finish();
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      const tool = s.find((e) => e.kind === 'tool');
      cb.tool(tool?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, 1600 + Math.random() * 3800));
  };
  timers.push(setTimeout(step, 600));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          cb.log([{ kind: 'text', text: `● Got it — "${text.slice(0, 60)}". Adjusting my approach.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: ['Stopped by manager'] });
    },
  };
}

// ---------- the terminal runtime ----------

const ANSI: Record<LogEntry['kind'], (text: string) => string> = {
  text: (t) => t.replace(/^● /, '\x1b[97m●\x1b[0m '),
  tool: (t) => `\x1b[32m●\x1b[0m \x1b[1m${t.replace(/^⏺ /, '')}\x1b[0m`,
  result: (t) => `\x1b[2m${t}\x1b[0m`,
  thinking: (t) => `\x1b[35m${t}\x1b[0m`,
  error: (t) => `\x1b[31m${t}\x1b[0m`,
  system: (t) => `\x1b[2m${t}\x1b[0m`,
  manager: (t) => `\x1b[36m${t.replace(/^▶ /, '❯ ')}\x1b[0m`,
  done: (t) => `\x1b[32m${t}\x1b[0m`,
};

/**
 * With a terminal (the terminal runtime), the fake session's lines are drawn there the way Claude Code draws them,
 * and what the manager types into it is taken as a message.
 */
function inTerminal(opts: SessionOptions, cb: SessionCallbacks, start: (cb: SessionCallbacks) => SessionHandle): SessionHandle {
  const term = opts.terminal;
  if (!term) return start(cb);
  const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
  term.note(`── ${name}${opts.label ? ` · ${opts.label}` : ''} ──`);
  term.write(
    [
      '',
      ` \x1b[38;5;209m▐▛███▜▌\x1b[0m   \x1b[1m${name}\x1b[0m (demo)`,
      `\x1b[38;5;209m▝▜█████▛▘\x1b[0m  ${opts.model || 'default model'} · ${opts.effort} effort`,
      `\x1b[38;5;209m  ▘▘ ▝▝\x1b[0m    \x1b[2m${opts.cwd}\x1b[0m`,
      '',
      `\x1b[36m❯\x1b[0m ${opts.prompt.split('\n')[0].slice(0, 200)}`,
      '',
    ].join('\r\n'),
  );
  let handle: SessionHandle | null = null;
  let line = '';
  term.bind({
    write: (data) => {
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (ch === '\r') {
          const text = line.trim();
          line = '';
          term.write('\r\n');
          if (text && handle) {
            cb.log([{ kind: 'manager', text: `▶ Typed in the terminal: ${text}` }]);
            handle.send(text);
          }
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) term.write('\b \b');
          line = line.slice(0, -1);
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    },
    resize: () => undefined,
  });
  handle = start({
    ...cb,
    log: (entries) => {
      cb.log(entries);
      for (const e of entries) term.write(`${e.kind === 'tool' || (e.kind === 'text' && e.text.startsWith('●')) ? '\r\n' : ''}${ANSI[e.kind](e.text)}\r\n`);
    },
    finished: (r) => {
      term.bind(null);
      term.note(`── ${name} session ended ──`);
      cb.finished(r);
    },
  });
  return handle;
}

// Claude's usage warning, faked once so the office can be seen pacing new work: the 4th session gets it, and the
// window "resets" 5 minutes later.
const USAGE_WARNING_AT = 4;
const USAGE_WARNING_MS = 5 * 60_000;
let sessionsStarted = 0;

function fakeUsageWarning(cb: SessionCallbacks) {
  setTimeout(() => {
    const resetsAt = Date.now() + USAGE_WARNING_MS;
    cb.log([{ kind: 'error', text: `⚠ Subscription usage warning (five_hour) · resets ${new Date(resetsAt).toLocaleTimeString()} (demo)` }]);
    cb.usageWarning?.({ resetsAt, rateLimitType: 'five_hour', utilization: 0.82 });
  }, 3000);
}

export function createDemoBackend(): Backend {
  // Tie each fake session back to its repo via the desk directory name.
  const deskRepo = new Map<string, string>();
  // Desks whose pretend dependencies are installed: the first task on a desk installs, the next ones skip.
  const installedDesks = new Set<string>();
  // The branch each desk has checked out (null: detached), so a PR branch another desk holds plays out as for real (#199).
  const deskBranches = new Map<string, string | null>();
  // A pretend projects folder: the demo repos, one git folder that isn't on GitHub yet, and one plain folder.
  const folders = new Map<string, LocalFolder>();
  const addFolder = (name: string, github: string | null, git = true) =>
    folders.set(name, { name, path: `/demo/projects/${name}`, git, github, modified: Date.now() - folders.size * 3_600_000 });
  for (const r of repos.values()) addFolder(r.fullName.split('/')[1], r.fullName);
  addFolder('sketchbook', null);
  addFolder('recipe-notes', null, false);
  const newRepo = (name: string, description = '') => {
    const fullName = `demo-co/${name}`;
    if (!repos.has(fullName)) {
      repos.set(fullName, { fullName, description, issues: [], pulls: [], nextNumber: 1 });
      bareRepos.add(fullName);
    }
    addFolder(name, fullName);
    return fullName;
  };
  const folderOf = (dir: string) => {
    const f = folders.get(dir.replace(/\\/g, '/').split('/').pop() ?? '');
    if (!f) throw new Error(`${dir} is not a folder`);
    return f;
  };
  return {
    demo: true,
    user: async () => 'demo-manager',
    listMyRepos: async (): Promise<GhRepoSummary[]> =>
      [...repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: now() })),
    repoMeta: async (fullName) => {
      const r = repos.get(fullName);
      if (!r) throw new Error(`Unknown demo repo ${fullName}`);
      return { nameWithOwner: fullName, description: r.description, url: `https://github.com/${fullName}`, defaultBranch: 'main' };
    },
    setLocalPath: () => undefined,
    scanProjects: async () => [...folders.values()].sort((a, b) => b.modified - a.modified),
    inspectFolder: async (dir) => folderOf(dir),
    publishFolder: async (dir, opts) => {
      const f = folderOf(dir);
      return f.github ?? newRepo(f.name, opts.description);
    },
    createProject: async (_root, name, opts) => {
      if (folders.has(name)) throw new Error(`/demo/projects/${name} already exists. Pick another name, or connect that folder instead.`);
      return { fullName: newRepo(name, opts.description), path: `/demo/projects/${name}` };
    },
    listIssues: async (fullName) => [...(repos.get(fullName)?.issues ?? [])],
    listPulls: async (fullName) => [...(repos.get(fullName)?.pulls ?? [])],
    createIssue: async (fullName, title, body, labels = []) => {
      const r = repos.get(fullName);
      if (!r) throw new Error('Unknown repo');
      const n = r.nextNumber++;
      r.issues.push(issue(n, title, body, fullName, labels));
      return n;
    },
    issueState: async (fullName, number) => {
      const r = repos.get(fullName);
      return r?.issues.some((i) => i.number === number) ? 'OPEN' : closedIssues.has(`${fullName}#${number}`) ? 'CLOSED' : null;
    },
    editIssue: async (fullName, number, edit) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      if (!i) throw new Error(`Unknown issue #${number}`);
      if (edit.body !== undefined) i.body = edit.body;
      i.labels = [...i.labels.filter((l) => !edit.removeLabels?.includes(l)), ...(edit.addLabels ?? []).filter((l) => !i.labels.includes(l))];
    },
    mergePull: async (fullName, number, _method, headSha) => {
      const r = repos.get(fullName);
      const pr = r?.pulls.find((p) => p.number === number);
      if (!r || !pr) throw new Error('Unknown PR');
      if (headSha && pr.headSha !== headSha) throw new Error('Head branch was modified. Review and try the merge again.');
      mergedSinceSync.set(fullName, (mergedSinceSync.get(fullName) ?? 0) + 1);
      pr.state = 'MERGED';
      // Now and then a merge leaves another open PR conflicting, so conflict fixes (before QA and after it) can be seen.
      for (const other of r.pulls) if (other.state === 'OPEN' && Math.random() < 0.25) Object.assign(other, { mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
      pr.mergedAt = now();
      // GitHub closes what "Closes #N" links a little after the merge, not straight away.
      setTimeout(() => {
        for (const n of pr.closesIssues) closedIssues.add(`${fullName}#${n}`);
        r.issues = r.issues.filter((i) => !pr.closesIssues.includes(i.number));
      }, 20_000).unref();
    },
    closeIssue: async (fullName, number) => {
      const r = repos.get(fullName);
      if (!r?.issues.some((i) => i.number === number)) throw new Error(`Issue #${number} is not open`);
      closedIssues.add(`${fullName}#${number}`);
      r.issues = r.issues.filter((i) => i.number !== number);
    },
    updateBranch: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error('Unknown PR');
      Object.assign(pr, { headSha: fakeSha(), mergeState: 'CLEAN' });
      runChecks(pr, false);
    },
    failedRunLog: async (_fullName, runId) =>
      [
        `build\tRun npm test\t2025-01-01T00:00:00Z > vitest run (run ${runId})`,
        'build\tRun npm test\t2025-01-01T00:00:01Z  FAIL  src/__tests__/toolbar.test.ts > wraps below 480px',
        'build\tRun npm test\t2025-01-01T00:00:01Z AssertionError: expected "nowrap" to be "wrap"',
        'build\tRun npm test\t2025-01-01T00:00:02Z Test Files  1 failed | 7 passed (8)',
        'build\tRun npm test\t2025-01-01T00:00:02Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    rerunFailedJobs: async (fullName, runIds) => {
      // The re-run passes: a flake, as the office hoped.
      for (const pr of repos.get(fullName)?.pulls ?? []) {
        if (pr.failedChecks.some((c) => runIds.some((id) => c.url?.includes(`/actions/runs/${id}/`)))) runChecks(pr, false);
      }
    },
    closePull: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr) pr.state = 'CLOSED';
    },
    prForBranch: async () => null,
    prDetails: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error(`Unknown PR #${number}`);
      return {
        number,
        title: pr.title,
        body: `Implements the change.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
        url: pr.url,
        headRefName: pr.headRefName,
        headSha: pr.headSha,
        isCrossRepository: false,
        closesIssues: pr.closesIssues,
        state: pr.state,
        mergeable: pr.mergeable,
        mergeState: pr.mergeState,
        checks: pr.checks,
        checkNames: pr.checks === 'none' ? [] : ['CI / build', 'Vercel'],
        failedChecks: pr.failedChecks.map((c) => c.name),
        pendingChecks: pr.pendingChecks,
      };
    },
    issueDetails: async (fullName, number) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '' };
    },
    commentPull: async (fullName, number) => `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`,
    uploadEvidence: async (fullName, filePath) => `https://github.com/${fullName}/raw/swarm-qa-evidence/${filePath}`,
    ensureClone: async () => new Promise((r) => setTimeout(r, 400)),
    syncMain: async (fullName, _branch, { touch }) => {
      const behind = mergedSinceSync.get(fullName) ?? 0;
      if (behind === 0) return { status: 'in sync', behind: 0, updatable: false };
      if (!touch) return { status: `update ready (${behind} commit${behind === 1 ? '' : 's'})`, behind, updatable: true };
      mergedSinceSync.set(fullName, 0);
      return { status: `updated to ${fakeSha().slice(0, 7)}`, behind: 0, updatable: false };
    },
    mainDir: (fullName) => `/demo/${fullName}/main`,
    deskDir: (fullName, slug) => `/demo/${fullName}/desks/${slug}`,
    prepareDesk: async (fullName, base, slug, branch, note) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      // SWARM_DEMO_HELD_BRANCH=1: your folder has every PR's branch checked out, and a fix's desk fails the way #198's did.
      if (process.env.SWARM_DEMO_HELD_BRANCH === '1' && base.pr && !branch.startsWith('qa/')) {
        throw new Error(`git worktree add -B failed: fatal: '${branch}' is already used by worktree at '/demo/${fullName}/main'`);
      }
      const holder = [...deskBranches].find(([d, b]) => b === branch && d !== dir && deskRepo.get(d) === fullName)?.[0];
      if (holder) note?.(`${branch} is checked out at ${holder}, so this desk works on it as a detached HEAD at origin/pr/${base.pr}; push with git push origin HEAD:${branch}.`);
      deskBranches.set(dir, holder ? null : branch);
      deskRepo.set(dir, fullName);
      return dir;
    },
    installDeps: async (dir, cb) => {
      if (installedDesks.has(dir)) {
        cb.log(['Dependencies unchanged since the last install; skipping it.']);
        return 'skipped';
      }
      cb.log(['Installing dependencies…', '$ npm ci']);
      cb.installing();
      await new Promise((r) => setTimeout(r, 1500));
      cb.log(['Dependencies installed.']);
      installedDesks.add(dir);
      return 'installed';
    },
    removeDesk: async () => undefined,
    sweepDesks: async () => ({ desks: 0, folders: 0, branches: 0, patches: [], skipped: [] }),
    // A made-up install and build of 300-900 MB, so the setting and the phone message can be seen.
    trimDesk: async (_fullName, _slug, stillIdle) => {
      await new Promise((r) => setTimeout(r, 300));
      if (!stillIdle()) return null;
      return { freed: Math.round((300 + Math.random() * 600) * 2 ** 20), removed: ['node_modules', 'dist'], skipped: [] };
    },
    releaseDesk: async () => undefined,
    startSession: (opts, cb) => {
      if (++sessionsStarted === USAGE_WARNING_AT) fakeUsageWarning(cb);
      return inTerminal(opts, cb, (c) => (opts.role === 'ceo' ? ceoSession(opts, c) : fakeSession(opts, c, deskRepo.get(opts.cwd) ?? [...repos.keys()][0])));
    },
    terminals: true,
    reconnectClis: async () => [], // fake sessions end with the office
    hooksReady: () => undefined,
    releaseClis: async () => undefined,
    detectClis: async () =>
      CLIS.map((c) => ({ id: c.id, label: c.label, installed: true, version: 'demo', integrated: c.integrated })),
    previews: demoPreviews,
    office: demoOffice,
    voice: demoVoice,
  };
}

// ---------- the office's own update ----------

/**
 * Floor 1's folder plays the office's own folder, so merges there make an update ready. There is a launcher when
 * the real one started the demo, or with SWARM_DEMO_LAUNCHER=1; either way the update is faked: a short pause, then
 * the result message, and nothing restarts.
 */
const OFFICE_REPO = 'demo-co/pixel-todo';
const DEMO_HEAD = `0ff1ce5${'0'.repeat(33)}`;
const lastFakeUpdate = { to: '', commits: 0 };
const demoOffice: OfficeHost = {
  launcher: underLauncher() || process.env.SWARM_DEMO_LAUNCHER === '1',
  head: async () => DEMO_HEAD,
  isOwnFolder: (dir) => dir === `/demo/${OFFICE_REPO}/main`,
  // Only its own fake updates have a count; one the real launcher did (u) gets no count rather than a wrong one.
  commitsBetween: async (_from, to) => (to === lastFakeUpdate.to ? lastFakeUpdate.commits : null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    await new Promise((r) => setTimeout(r, 4000));
    lastFakeUpdate.commits = mergedSinceSync.get(OFFICE_REPO) ?? 0;
    mergedSinceSync.set(OFFICE_REPO, 0);
    lastFakeUpdate.to = fakeSha();
    return { from, to: lastFakeUpdate.to, ok: true, installed: true, built: true, at: Date.now() };
  },
};

// ---------- the demo preview ----------

function placeholderPage(title: string, hue: number) {
  const safe = title.replace(/[<>&"]/g, '');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe}</title><link rel="icon" href="data:,">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: 'Segoe UI', Arial, sans-serif; background: hsl(${hue},60%,96%); color: #222; }
  main { text-align: center; padding: 32px 40px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px hsla(${hue},50%,40%,.18); }
  h1 { margin: 0 0 6px; font-size: 26px; color: hsl(${hue},60%,38%); }
  p { margin: 0 0 22px; color: #666; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border: 0; border-radius: 999px; background: hsl(${hue},70%,55%); color: #fff; cursor: pointer; }
  button:active { transform: scale(.97); }
  #count { display: block; margin-top: 16px; font-size: 15px; color: #444; }
</style></head>
<body><main>
  <h1>${safe}</h1>
  <p>A placeholder app served by the demo office.</p>
  <button id="btn" type="button">Click me</button>
  <span id="count">Clicked 0 times</span>
</main>
<script>
  let n = 0;
  document.getElementById('btn').addEventListener('click', () => {
    n++;
    document.getElementById('count').textContent = 'Clicked ' + n + (n === 1 ? ' time' : ' times');
  });
</script>
</body></html>`;
}

/** Programs the demo pretends to have, so a bogus preview command fails the way it would for real. */
const DEMO_PROGRAMS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'vite', 'next', 'python', 'python3', 'py', 'php', 'ruby', 'go', 'cargo', 'dotnet'];

/**
 * No git, no npm: short fake delays through the real statuses, then a placeholder page on the floor's port.
 * Floors made in the demo have nothing to run until they get a command, and a command whose program isn't in
 * DEMO_PROGRAMS fails, so the viewer's unconfigured and error states can be tried out.
 */
const demoPreviews: PreviewBackend = {
  hasDefault: async (fullName) => !bareRepos.has(fullName),
  start(job, cb) {
    let stopped = false;
    let server: http.Server | null = null;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
    const hue = [...job.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const sha = (job.pr ? repos.get(job.fullName)?.pulls.find((p) => p.number === job.pr)?.headRefName ?? String(job.pr) : job.fullName + job.defaultBranch)
      .split('')
      .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(7, '0')
      .slice(0, 7);

    cb.status('preparing');
    later(700, () => {
      cb.commit(sha);
      cb.log([`HEAD is now at ${sha} (${job.pr ? `PR #${job.pr}` : job.defaultBranch})`]);
      if (!job.command && bareRepos.has(job.fullName)) {
        stopped = true;
        cb.failed('Nothing to run: this floor has no preview command and no package.json.', true);
        return;
      }
      cb.status('installing');
      cb.log(['$ npm ci', 'added 214 packages in 1s (demo)']);
    });
    later(1600, () => {
      cb.status('starting');
      cb.log([`$ ${job.command ?? 'npm run dev'}`.replaceAll('{port}', String(job.port))]);
      const program = job.command?.trim().split(/\s+/)[0] ?? 'npm';
      if (!DEMO_PROGRAMS.includes(program.toLowerCase())) {
        later(400, () => {
          cb.log([`'${program}' is not recognized as an internal or external command,`, 'operable program or batch file.']);
          stopped = true;
          cb.failed(`The app exited (code 1) before it listened on port ${job.port}.`);
        });
        return;
      }
      server = http.createServer((req, res) => {
        if (req.url !== '/' && !req.url?.startsWith('/?')) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(placeholderPage(job.title, hue));
      });
      server.once('error', (err) => {
        if (stopped) return;
        stopped = true;
        cb.failed(`Could not listen on port ${job.port}: ${err.message}`);
      });
      server.listen(job.port, '127.0.0.1', () => {
        if (stopped) return void server?.close();
        later(500, () => {
          cb.log([`  ➜  Local:   http://localhost:${job.port}/`]);
          cb.status('running');
        });
      });
    });

    return {
      async stop() {
        stopped = true;
        timers.forEach(clearTimeout);
        const s = server;
        server = null;
        if (!s?.listening) return;
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      },
    };
  },
};

// ---------- the demo CEO ----------

interface Profile {
  summary: string;
  qa: string;
  qaTitle: string;
  qaJob: string;
  devTitle: string;
  devSpecialty: string;
  devJob: string;
  hires: { title: string; specialty: string; job_description: string; reason: string }[];
}

const PROFILES: Record<string, Profile> = {
  'pixel-todo': {
    summary: 'Todo web app · React + Vite + TypeScript',
    qa: '- Add, complete, edit and delete todos; they survive a reload\n- Keyboard only: every action reachable, focus always visible\n- Phone width (375px): nothing overflows or gets cut off\n- No errors in the browser console',
    qaTitle: 'UI QA tester',
    qaJob: 'You test every PR the way a picky user would: click through the whole flow, try it on a phone-sized screen and with the keyboard only.',
    devTitle: 'React UI engineer',
    devSpecialty: 'frontend',
    devJob: 'You own the React components and styling. Keep components small, reuse the existing hooks, and check every change at desktop and phone widths.',
    hires: [
      {
        title: 'Accessibility engineer',
        specialty: 'a11y',
        job_description:
          'You make the app work for **everyone**:\n\n- Keyboard navigation and focus management\n- ARIA roles, checked with `axe`\n- Colour contrast (WCAG AA)\n\nTest with the keyboard only. The [WAI-ARIA practices](https://www.w3.org/WAI/ARIA/apg/) are your reference.',
        reason: 'Keyboard shortcuts and drag-and-drop are in the backlog, and both are *easy to get wrong* for keyboard and screen-reader users.',
      },
    ],
  },
  'weather-api': {
    summary: 'REST API · Node + Express',
    qa: '- Every endpoint: happy path, bad input (400), unknown city (404)\n- Response shapes match the OpenAPI document\n- Rate limiting returns 429 with Retry-After\n- Tests and lint pass',
    qaTitle: 'API QA tester',
    qaJob: 'You test the API from the outside: curl every endpoint, try bad input and edge cases, and compare responses with the OpenAPI document.',
    devTitle: 'Backend engineer',
    devSpecialty: 'backend',
    devJob: 'You own the routes and data layer. Validate input at the edge, return consistent error shapes, and add tests for every endpoint you touch.',
    hires: [
      {
        title: 'API reliability engineer',
        specialty: 'reliability',
        job_description: 'You own rate limiting, caching and error handling. Measure before you optimise and document every limit in the OpenAPI spec.',
        reason: 'Rate limiting is in the backlog and the forecast endpoint will call an upstream service that needs caching and timeouts.',
      },
    ],
  },
};

const GENERIC: Profile = {
  summary: 'Web project · early stage',
  qa: '- The app builds and starts\n- The changed feature works end to end in the browser\n- Phone width: nothing overflows\n- No console errors',
  qaTitle: 'QA tester',
  qaJob: 'You check every PR end to end in the browser, at desktop and phone widths.',
  devTitle: 'Full-stack engineer',
  devSpecialty: 'fullstack',
  devJob: 'You build features end to end, from the UI down to the data.',
  hires: [
    {
      title: 'Frontend engineer',
      specialty: 'frontend',
      job_description: 'You own the UI:\n\n1. Layout and components\n2. Styling, checked at **desktop and phone** widths',
      reason: 'The project needs someone who owns the UI from the start.',
    },
  ],
};

interface DemoFloor {
  floor: number;
  repo: string;
  brief: string | null;
  team: { id: string; name: string; role: string; specialty: string | null; status: string }[];
  backlog: unknown[];
  pullRequests: unknown[];
  seats: Record<'dev' | 'qa', { free: number }>;
}

/** A scripted CEO that uses the real office tools, so proposals, profiles and issues behave exactly as in the real thing. */
function ceoSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const office = opts.office!;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let done = false;
  const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
  const step = async (entries: LogEntry[], ms = 900 + Math.random() * 1500) => {
    if (stopped) throw new Error('Stopped by manager');
    cb.tool(entries.find((e) => e.tool)?.tool ?? null);
    cb.log(entries);
    await wait(ms);
  };
  const status = async () => {
    await step([{ kind: 'tool', tool: 'mcp__office__company_status', text: `⏺ ${describeOfficeTool('company_status', {})}` }]);
    const s = JSON.parse(await office.call('company_status', {})) as { floors: DemoFloor[]; pendingProposals: unknown[] };
    const people = s.floors.reduce((n, f) => n + f.team.length, 0);
    const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
    const free = s.floors.reduce((n, f) => n + f.seats.dev.free + f.seats.qa.free, 0);
    cb.log([{ kind: 'result', text: `  ⎿ ${s.floors.length} floors · ${people} people · ${free} free seats · ${issues} open issues · ${s.pendingProposals.length} proposals pending` }]);
    return s;
  };
  const use = async (name: string, args: Record<string, unknown>) => {
    await step([{ kind: 'tool', tool: `mcp__office__${name}`, text: `⏺ ${describeOfficeTool(name, args)}` }]);
    const out = await office.call(name, args);
    cb.log([{ kind: out.startsWith('Refused') ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 170)}` }]);
    return out;
  };
  const read = (file: string, lines: number) => step([{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: `  ⎿ Read ${lines} lines` }]);
  const think = (text: string) => step([{ kind: 'thinking', text: '✻ Thinking…' }, { kind: 'text', text: `● ${text}` }], 1800);
  const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

  const planIssues = async (floor: number, mission: string, team: DemoFloor['team']) => {
    const first = await use('file_issue', {
      floor,
      title: 'Set up the project skeleton',
      body: `Scaffold the app so the rest of the milestone has something to build on.\n\nBrief: ${mission}\n\nAcceptance criteria:\n- The dev server starts\n- A placeholder home page renders\n- Lint, tests and build scripts exist`,
      specialty: 'frontend',
    });
    const n = Number(first.match(/#(\d+)/)?.[1] ?? 0);
    await use('file_issue', {
      floor,
      title: `Build the core: ${short(mission, 60)}`,
      body: `${n ? `Depends on #${n}\n\n` : ''}Implement the heart of the brief.\n\nAcceptance criteria:\n- The main flow works end to end\n- Covered by tests`,
      specialty: 'frontend',
    });
    await use('file_issue', {
      floor,
      title: 'Polish: phone layout and empty states',
      body: `${n ? `Depends on #${n}\n\n` : ''}Make every screen work at 375px and add friendly empty states.`,
      specialty: 'frontend',
    });
    if (!team.some((a) => a.specialty === 'frontend')) {
      await use('propose_hire', { floor, role: 'dev', ...GENERIC.hires[0], reason: 'All three issues are UI work and nobody on the floor owns the frontend yet.' });
    }
    return n;
  };

  const scripts = {
    async onboard(floor: number, fullName: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to onboard.';
      const p = PROFILES[fullName.split('/')[1] ?? ''] ?? GENERIC;
      await read(`${f.repo}/README.md`, 48);
      await step([{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*' }, { kind: 'result', text: '  ⎿ Found 23 files' }]);
      await read('package.json', 36);
      await think(`${p.summary}. Let me shape the team around that.`);
      await use('set_floor_profile', { floor, summary: p.summary, qa_brief: p.qa });
      const qa = f.team.find((a) => a.role === 'qa');
      if (qa) {
        await step([{ kind: 'tool', tool: 'mcp__office__agent_detail', text: `⏺ ${describeOfficeTool('agent_detail', { agent_id: qa.id })}` }]);
        const d = JSON.parse(await office.call('agent_detail', { agent_id: qa.id })) as { title: string; jobDescription: string | null };
        cb.log([{ kind: 'result', text: `  ⎿ ${d.title} · job description ${d.jobDescription?.length ?? 0} chars` }]);
        await use('update_job', { agent_id: qa.id, title: p.qaTitle, job_description: p.qaJob });
      }
      const dev = f.team.find((a) => a.role === 'dev' && !a.specialty);
      if (dev) await use('update_job', { agent_id: dev.id, title: p.devTitle, specialty: p.devSpecialty, job_description: p.devJob });
      const proposed: string[] = [];
      for (const h of p.hires) if (!(await use('propose_hire', { floor, role: 'dev', ...h })).startsWith('Refused')) proposed.push(h.title);
      let planned = '';
      if (f.brief && f.backlog.length === 0) {
        const n = await planIssues(floor, f.brief, f.team);
        planned = ` I also turned your brief into three issues; #${n} sets up the skeleton and the other two wait for it.`;
      }
      return [
        `Floor ${floor}: ${p.summary}.`,
        `I wrote a QA brief for it${qa ? `, made ${qa.name} our ${p.qaTitle}` : ''}${dev ? ` and ${dev.name} our ${p.devTitle}` : ''}.`,
        proposed.length ? `I've proposed hiring: ${proposed.join(', ')}. The resume${proposed.length === 1 ? ' is' : 's are'} waiting on your phone.` : '',
        planned,
      ]
        .filter(Boolean)
        .join(' ');
    },
    async plan(floor: number, mission: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to plan.';
      await read(`${f.repo}/README.md`, 12);
      await think("Foundation first, so the parallel work doesn't collide.");
      const n = await planIssues(floor, mission, f.team);
      return `I turned the brief into three issues on floor ${floor}. #${n} sets up the skeleton; the other two say "Depends on #${n}", so nobody starts them early.`;
    },
    async review() {
      const s = await status();
      await think('Checking each floor for idle people and stuck work.');
      for (const f of s.floors) {
        const idle = f.team.filter((a) => a.role === 'dev' && !a.specialty && (a.status === 'idle' || a.status === 'done'));
        const devs = f.team.filter((a) => a.role === 'dev').length;
        if (devs >= 6 && idle.length >= 2 && f.backlog.length < devs) {
          await use('propose_let_go', { agent_id: idle[idle.length - 1].id, reason: `Floor ${f.floor} has ${devs} developers for ${f.backlog.length} open issues; ${idle.length} of them are idle.` });
          return `Floor ${f.floor} is overstaffed: ${devs} developers for ${f.backlog.length} open issues. I suggest letting ${idle[idle.length - 1].name} go; it's on your phone.`;
        }
      }
      // An issue nobody routed while the floor has a specialist: re-route it rather than file a duplicate.
      for (const f of s.floors) {
        const specialist = f.team.find((a) => a.role === 'dev' && a.specialty);
        const unrouted = (f.backlog as { number: number; specialty: string | null; inProgress: boolean }[]).find((i) => !i.specialty && !i.inProgress);
        if (!specialist || !unrouted) continue;
        const out = await use('route_issue', { floor: f.floor, number: unrouted.number, specialty: specialist.specialty });
        if (!out.startsWith('Refused')) return `Floor ${f.floor}: #${unrouted.number} had no specialty, so I routed it to ${specialist.specialty}, ${specialist.name}'s lane.`;
      }
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const prs = s.floors.reduce((n, f) => n + f.pullRequests.length, 0);
      return `All ${s.floors.length} floors look healthy: ${issues} open issues and ${prs} pull requests in flight. No changes needed.`;
    },
    async chat(text: string) {
      const s = await status();
      await think('Reading your message.');
      // "close #3, superseded by #5": the one request the demo CEO acts on, through the real tool.
      const close = text.match(/\bclose #(\d+)[\s,:;.-]*(.*)/i);
      const closeFloor = close && (s.floors.find((f) => (f.backlog as { number: number }[]).some((i) => i.number === Number(close[1]))) ?? s.floors[0]);
      if (close && closeFloor) {
        const reason = close[2].trim() || 'No longer wanted.';
        const out = await use('close_issue', { floor: closeFloor.floor, number: Number(close[1]), reason });
        return out.startsWith('Refused') ? `I couldn't close #${close[1]}: ${out.replace(/^Refused: /, '')}` : `Done: ${out} I left "${short(reason, 80)}" on it as a comment.`;
      }
      const people = s.floors.reduce((n, f) => n + f.team.length, 0);
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const pending = s.pendingProposals.length;
      // Real CEOs answer in Markdown, so the demo one does too: every element the phone renders.
      const rows = s.floors.map((f) => `| ${f.floor} | \`${f.repo.split('/').pop()}\` | ${f.team.length} | ${f.backlog.length} | ${f.pullRequests.length} |`);
      return [
        `**Quick status:** ${s.floors.length} floor${s.floors.length === 1 ? '' : 's'}, ${people} people and ${issues} open issues.`,
        '',
        '- The team is *heads down* on the backlog',
        `- ${pending ? `**${pending}** proposal${pending === 1 ? ' is' : 's are'} waiting for you in Hires` : 'No hiring decisions waiting on you'}`,
        '  - QA re-tests every PR after a fix',
        '',
        '| Floor | Repo | People | Issues | PRs |',
        '| ---: | --- | ---: | ---: | ---: |',
        ...(rows.length ? rows : ['| – | no projects yet | 0 | 0 | 0 |']),
        '',
        'What I would do next:',
        '',
        '1. Merge anything that passed QA',
        '2. Run `npm run build` on each floor before the next milestone',
        '3. Hire only where the backlog is piling up',
        '',
        '```bash',
        'SWARM_HOME=/tmp/cubefarm-demo SWARM_PORT=5260 node --import tsx server/index.ts --demo',
        '```',
        '',
        `> I'm the demo CEO, so I can't act on "${short(text)}", but the real one would. See the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview).`,
      ].join('\n');
    },
  };

  const prompt = opts.prompt;
  const where = prompt.match(/[Ff]loor (\d+) \(([^,)]+)/);
  const run = /just joined the company/.test(prompt)
    ? () => scripts.onboard(Number(where?.[1]), where?.[2] ?? '')
    : /has a brief for floor/.test(prompt)
      ? () => scripts.plan(Number(where?.[1]), prompt.match(/"""([\s\S]*?)"""/)?.[1]?.trim() ?? '')
      : /Periodic review/.test(prompt)
        ? () => scripts.review()
        : () => scripts.chat(prompt.split('\n').slice(1).join(' ').trim() || prompt);

  const finish = (ok: boolean, text: string, error?: string) => {
    if (done) return;
    done = true;
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.4 + Math.random() : 0.05, turns: 6 + Math.floor(Math.random() * 10), errors: error ? [error] : [] });
  };

  timers.push(
    setTimeout(async () => {
      try {
        cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · CEO` }]);
        const reply = await run();
        cb.log([{ kind: 'text', text: `● ${reply}` }]);
        cb.turn?.(reply);
        finish(true, reply);
      } catch (err) {
        finish(false, '', stopped ? 'Stopped by manager' : (err as Error).message);
      }
    }, 500),
  );

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || done) return;
          const said = text.split('\n').slice(1).join(' ').trim() || text;
          cb.log([{ kind: 'text', text: `● Noted: "${short(said, 70)}"` }]);
          cb.turn?.(`Noted, I'll factor that in: "${short(said, 90)}"`);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      finish(false, '', 'Stopped by manager');
    },
  };
}

// ---------- voice ----------

/** A short two-note chime as 8 kHz mono WAV: something to hear without ElevenLabs, a little longer for longer text. */
export function demoChime(chars: number): Buffer {
  const rate = 8000;
  const seconds = Math.min(0.4 + chars / 400, 2);
  const n = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = t < seconds / 2 ? 660 : 880;
    const fade = Math.min(1, (seconds - t) * 8, t * 40);
    wav[44 + i] = Math.round(128 + 40 * fade * Math.sin(2 * Math.PI * f * t));
  }
  return wav;
}

const demoVoices = [
  { id: 'demoVoiceAvery00001', name: 'Avery', category: 'premade', labels: { accent: 'american', gender: 'female', age: 'middle aged', description: 'calm', use_case: 'conversational' }, previewUrl: null },
  { id: 'demoVoiceBasil00002', name: 'Basil', category: 'premade', labels: { accent: 'british', gender: 'male', age: 'middle aged', description: 'warm', use_case: 'narration' }, previewUrl: null },
  { id: 'demoVoiceCleo000003', name: 'Cleo', category: 'premade', labels: { accent: 'australian', gender: 'female', age: 'young', description: 'friendly', use_case: 'conversational' }, previewUrl: null },
];

/** No network: any key works except one containing "bad", three voices, and a chime for every message. */
const demoVoice: VoiceApi = {
  checkKey: async (key) => {
    if (/bad/i.test(key)) throw new VoiceApiError(401, '401: invalid_api_key (demo)');
  },
  listVoices: async () => demoVoices,
  synthesize: async (_key, { text }) => {
    await new Promise((r) => setTimeout(r, 300));
    return demoChime(text.length);
  },
};
