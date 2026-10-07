import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Backend } from './backend.ts';
import type { PreviewBackend } from './previewRunner.ts';
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { CLIS } from './clis.ts';
import { FLOOR_SEATS, type GhRepoSummary, type IssueInfo, type PullInfo } from '../shared/types.ts';
import type { LocalFolder } from './workspace.ts';
import { HOME_DIR, type DemoScale } from './config.ts';
import { DAY_MS, emptyHistory, HOUR_MS, prune, startOfDay, type OpsHistory } from './metrics.ts';
import { takeLastUpdate, underLauncher, type OfficeHost } from './officeUpdate.ts';
import type { UsageWarning } from './pacing.ts';
import { VoiceApiError, type VoiceApi } from './voice.ts';
import type { WeatherApi } from './weather.ts';
import type { NotifyTransport } from './notifier.ts';

// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// build → QA → fix loop) can be explored without spending any usage or touching real repos.

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
const stalls = new Map<string, () => void>(); // agent id -> silences their running fake session (the office doctor's demo)

const fakeSha = () => crypto.randomBytes(20).toString('hex');

// GitHub never gives two PRs the same number, and the office's ledger (coins, careers) counts each PR once by it, so
// the fake's numbers carry on across restarts (the issues and PRs themselves start over).
const NUMBERS_FILE = path.join(HOME_DIR, 'demo-github.json');

function restoreNumbers() {
  try {
    const saved = JSON.parse(fs.readFileSync(NUMBERS_FILE, 'utf8')) as Record<string, number>;
    for (const r of repos.values()) if (Number.isInteger(saved[r.fullName])) r.nextNumber = Math.max(r.nextNumber, saved[r.fullName]);
  } catch {
    // first run
  }
}

/** The repo's next issue or PR number, remembered for the next start. */
function takeNumber(r: FakeRepo) {
  const n = r.nextNumber++;
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(`${NUMBERS_FILE}.tmp`, JSON.stringify(Object.fromEntries([...repos.values()].map((x) => [x.fullName, x.nextNumber]))));
    fs.renameSync(`${NUMBERS_FILE}.tmp`, NUMBERS_FILE);
  } catch (err) {
    console.warn('could not save the demo PR numbers', err);
  }
  return n;
}

/**
 * An issue or PR number the fake GitHub handed out before the office restarted: it starts over on every start (only
 * its numbers carry on), so what it forgot was closed while the office was down, as far as the office can tell.
 */
function forgotten(fullName: string, n: number) {
  const r = repos.get(fullName);
  return !!r && n > 0 && n < r.nextNumber && !r.issues.some((i) => i.number === n) && !r.pulls.some((p) => p.number === n);
}

let runSeq = 1000; // fake Actions run ids, so the office can re-run a failed one
/**
 * Fake CI: checks run for a while after every push, and now and then one fails so the fix loop shows. They say they
 * took a few minutes, like real CI, though the demo doesn't make you wait that long.
 */
function runChecks(pr: PullInfo, fail = Math.random() < 0.2) {
  Object.assign(pr, { checks: 'pending', pendingChecks: ['CI / build', 'Vercel'], failedChecks: [], checkRun: null });
  setTimeout(() => {
    Object.assign(pr, {
      checks: fail ? 'failing' : 'passing',
      pendingChecks: [],
      failedChecks: fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++runSeq}/job/1` }] : [],
      checkRun: { ms: Math.round((2.5 + Math.random() * 5) * 60_000), doneAt: Date.now() },
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

// ---------- the big company (--floors / --agents, #228) ----------

const PRODUCTS: [string, string][] = [
  ['pixel-todo', 'A cheerful todo app'],
  ['weather-api', 'Tiny weather REST API'],
  ['recipe-box', 'Recipes with a shopping list'],
  ['budget-buddy', 'Personal budgets and bills'],
  ['chat-lite', 'A small team chat'],
  ['photo-wall', 'Shared photo albums'],
  ['fit-log', 'Workouts and streaks'],
  ['book-club', 'Reading lists for friends'],
  ['trip-planner', 'Itineraries and packing lists'],
  ['beat-maker', 'A browser drum machine'],
  ['garden-diary', 'What to plant and when'],
  ['habit-hero', 'Daily habits, gently tracked'],
  ['invoice-flow', 'Invoices for freelancers'],
  ['pet-pals', 'Vet visits and walks'],
  ['study-cards', 'Flashcards with spaced repetition'],
  ['parking-spot', 'Find and share parking'],
  ['meal-prep', 'Weekly meal plans'],
  ['job-board', 'A tiny job board'],
  ['event-hub', 'Meetups and RSVPs'],
  ['link-short', 'A link shortener with stats'],
];

const FEATURES = [
  'Add dark mode', 'Search with filters', 'Export to CSV', 'Keyboard shortcuts', 'Offline support', 'Undo and redo',
  'Email reminders', 'Drag and drop to reorder', 'Share links', 'Profile pictures', 'Paginate long lists', 'Rate limiting',
  'An audit log', 'Two-factor login', 'Bulk edit', 'Tags and colours', 'An activity feed', 'Translations',
  'Accessibility pass', 'Friendly empty states', 'Loading skeletons', 'Fix the flaky date test', 'Speed up the build',
  'Clearer error messages',
];

/** The big company's floors: `floors` products, each with a long backlog (topped up as it shrinks, see listIssues). */
function seedBigCompany(floors: number) {
  repos.clear();
  for (let f = 0; f < floors; f++) {
    const [name, description] = PRODUCTS[f] ?? [`project-${f + 1}`, `Project number ${f + 1}`];
    seed(`demo-co/${name}`, description, []);
    topUp(repos.get(`demo-co/${name}`)!, 30);
  }
}

/** Files new issues until the repo has `open` of them, so a big floor's agents always have something to pick up. */
function topUp(r: FakeRepo, open: number) {
  while (r.issues.length < open) {
    const n = r.nextNumber++;
    const feature = FEATURES[n % FEATURES.length];
    const title = n > FEATURES.length ? `${feature} (part ${Math.ceil(n / FEATURES.length)})` : feature;
    r.issues.push(issue(n, title, `Users of ${r.fullName.split('/')[1]} asked for this: ${feature.toLowerCase()}.`, r.fullName));
  }
}

/** How many agents each demo floor starts with: six on floor 1 and four on the others, or a big company's `agents`. */
export function demoTeam(scale: DemoScale | null, floor: number): number {
  if (!scale) return floor === 1 ? 6 : 4;
  return Math.max(1, Math.min(FLOOR_SEATS, scale.agents));
}

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

function issueScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
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
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run typecheck' }, { kind: 'result', text: '  ⎿ (no output)' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Took a screenshot of the current page' }],
    [{ kind: 'text', text: '● Looks right in the browser. A production build, then the PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.62s' }],
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
    ...(pushes ? [[{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr checks ${pr} --watch` }, { kind: 'result', text: '  ⎿ All checks were successful' }] as LogEntry[]] : []),
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
  let stalled = false; // stuck: no more output, and messages go unanswered
  if (opts.agentId) {
    stalls.set(opts.agentId, () => {
      stalled = true;
      timers.forEach(clearTimeout);
    });
  }
  const nudged = /^You pushed nothing/.test(opts.prompt); // the office's nudge after a fix that pushed nothing
  const resumedFix = opts.resumeSessionId?.startsWith('demo-fix-') ?? false;
  // The task picks the script; a session started without one (a follow-up) is read from its prompt.
  const fixPrompt = !opts.task && /FAILED|taking over pull request|git push origin HEAD:/.test(opts.prompt);
  const kind = opts.task === 'qa' ? 'qa' : opts.task === 'fix' || nudged || resumedFix || fixPrompt ? 'fix' : 'issue';
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
  const body = kind === 'qa' ? qaScript(cb, number, title, round, checks) : kind === 'fix' ? fixScript(number, pushes, nudged) : issueScript(opts, cb, number, title);
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
      const n = takeNumber(repo);
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
    if (stopped || stalled) return;
    if (i >= script.length) {
      if (opts.agentId) stalls.delete(opts.agentId);
      return finish();
    }
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
          if (stopped || stalled) return;
          cb.log([{ kind: 'text', text: `● Got it — "${text.slice(0, 60)}". Adjusting my approach.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      if (opts.agentId) stalls.delete(opts.agentId);
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

/**
 * Claude's usage on demand (the manager's console → Mission control, in the demo): a weekly-limit warning at 91% that
 * resets at midnight, or the 5-hour limit reached for 3 minutes.
 */
export function demoUsage(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number } {
  if (kind === 'limit') return { limitResetsAt: now + 3 * 60_000 };
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return { resetsAt: midnight.getTime(), rateLimitType: 'seven_day', utilization: 0.91 };
}

/**
 * A believable past week for mission control: each floor merged a few PRs every working day (the first floor more),
 * most QA rounds and check runs passed, and sessions cost around a dollar. `rand` is there for the tests.
 */
export function demoPastWeek(repos: string[], now: number, rand: () => number = Math.random): OpsHistory {
  const h = emptyHistory();
  const min = 60_000;
  let n = 0;
  repos.forEach((repo, floor) => {
    const pace = floor === 0 ? 1 : 0.6;
    for (let day = 6; day >= 0; day--) {
      const midnight = startOfDay(now) - day * DAY_MS;
      const merges = Math.round((3 + rand() * 4) * pace);
      for (let k = 0; k < merges; k++) {
        const at = midnight + (9 + rand() * 9) * HOUR_MS; // working hours
        const rounds = rand() < 0.3 ? 2 : 1; // now and then QA failed it once first
        h.merges.push([at, repo, 0, Math.round((25 + rand() * 200) * min)]);
        for (let r = 0; r < rounds; r++) {
          const before = (rounds - r) * 20 * min;
          h.qa.push([at - before, repo, r === rounds - 1, Math.round((1 + rand() * 14) * min)]);
          h.checks.push([at - before - 6 * min, repo, `past${String(n++).padStart(4, '0')}`, rand() > 0.12, Math.round((2.5 + rand() * 5) * min)]);
          h.cost.push([at - before, repo, Math.round((0.3 + rand()) * 100) / 100], [at - before - 40 * min, repo, Math.round((0.4 + rand() * 1.2) * 100) / 100]);
        }
      }
      for (const hour of [10, 15]) h.cost.push([midnight + hour * HOUR_MS, '', Math.round((0.5 + rand() * 0.8) * 100) / 100]); // the CEO's reviews
    }
  });
  for (const list of [h.merges, h.qa, h.checks, h.cost] as [number, ...unknown[]][][]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i][0] > now) list.splice(i, 1); // nothing from later today
  }
  prune(h, now);
  return h;
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

/** A made-up install and build of 300-900 MB freed, so the idle-desk setting and its phone message can be seen. */
async function fakeTrim(stillIdle: () => boolean) {
  await new Promise((r) => setTimeout(r, 300));
  if (!stillIdle()) return null;
  return { freed: Math.round((300 + Math.random() * 600) * 2 ** 20), removed: ['node_modules', 'dist'], skipped: [] };
}

/** The demo's fake world; `scale` (--floors / --agents) makes it the big company instead of the usual two floors. */
export function createDemoBackend(scale: DemoScale | null = null): Backend {
  if (scale) seedBigCompany(scale.floors);
  restoreNumbers();
  // Tie each fake session back to its repo via the desk directory name.
  const deskRepo = new Map<string, string>();
  // Desks whose pretend dependencies are installed: the first task on a desk installs, the next ones skip.
  const installedDesks = new Set<string>();
  // The branch each desk has checked out (null: detached), so a PR branch another desk holds plays out as for real (#199).
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
      restoreNumbers();
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
    listIssues: async (fullName) => {
      const r = repos.get(fullName);
      if (r && scale) topUp(r, scale.agents * 2);
      return [...(r?.issues ?? [])];
    },
    // Like GitHub's list: the open PRs and the 8 latest merges, never closed ones, so the office asks about those.
    listPulls: async (fullName) => {
      const pulls = repos.get(fullName)?.pulls ?? [];
      return [...pulls.filter((p) => p.state === 'OPEN'), ...pulls.filter((p) => p.state === 'MERGED').slice(0, 8)];
    },
    createIssue: async (fullName, title, body, labels = []) => {
      const r = repos.get(fullName);
      if (!r) throw new Error('Unknown repo');
      const n = takeNumber(r);
      r.issues.push(issue(n, title, body, fullName, labels));
      return n;
    },
    issueState: async (fullName, number) => {
      const r = repos.get(fullName);
      return r?.issues.some((i) => i.number === number) ? 'OPEN' : closedIssues.has(`${fullName}#${number}`) || forgotten(fullName, number) ? 'CLOSED' : null;
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
      if (!pr && forgotten(fullName, number)) {
        // From before a restart: the fake GitHub starts over, so it was closed while the office was down.
        return {
          number,
          title: `PR #${number}`,
          body: '',
          url: `https://github.com/${fullName}/pull/${number}`,
          headRefName: '',
          headSha: fakeSha(),
          isCrossRepository: false,
          closesIssues: [],
          state: 'CLOSED',
          mergeable: 'UNKNOWN',
          mergeState: 'UNKNOWN',
          checks: 'none',
          checkNames: [],
          failedChecks: [],
          pendingChecks: [],
        };
      }
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
      return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '', createdAt: i?.createdAt };
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
    // The fake desks are the ones set up since the demo started: after a restart, every desk is gone.
    deskExists: (dir) => deskRepo.has(dir),
    prepareDesk: async (fullName, _base, slug) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      deskRepo.set(dir, fullName);
      return dir;
    },
    // Each agent's machine has a clone of its own, so no other desk ever holds its branch.
    machines: {
      deskDir: (machine, fullName) => `/demo/machines/${machine}/work/${fullName}`,
      prepareDesk: async (machine, fullName) => {
        await new Promise((r) => setTimeout(r, 900));
        const dir = `/demo/machines/${machine}/work/${fullName}`;
        deskRepo.set(dir, fullName);
        return dir;
      },
      env: () => ({}),
      release: async () => undefined,
      trimDesk: (_machine, _fullName, stillIdle) => fakeTrim(stillIdle),
      sweep: async () => 0,
      remove: async () => ({ removed: true, patches: [] }),
      list: async () => [],
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
    trimDesk: (_fullName, _slug, stillIdle) => fakeTrim(stillIdle),
    releaseDesk: async () => undefined,
    startSession: (opts, cb) => {
      // The big company is for measuring the office at full speed, so it never paces.
      if (++sessionsStarted === USAGE_WARNING_AT && !scale) fakeUsageWarning(cb);
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
    weather: demoWeather,
    notify: demoNotify,
    seedOps: (ids, at) => demoPastWeek(ids, at),
    demoTeam: (floor) => demoTeam(scale, floor),
    simulateUsage: demoUsage,
    demoDoctor: {
      dropDesk: (dir) => {
        deskRepo.delete(dir);
        installedDesks.delete(dir);
      },
      finishQuietly: (fullName, kind, n) => {
        const r = repos.get(fullName);
        if (!r) return;
        const pr = kind === 'pr' ? r.pulls.find((p) => p.number === n) : undefined;
        if (pr) Object.assign(pr, { state: 'MERGED', mergedAt: now() });
        for (const i of kind === 'issue' ? [n] : (pr?.closesIssues ?? [])) {
          closedIssues.add(`${fullName}#${i}`);
          r.issues = r.issues.filter((x) => x.number !== i);
        }
      },
      stall: (agentId) => {
        const stall = stalls.get(agentId);
        stall?.();
        return !!stall;
      },
      unclosedMerge: (fullName, mergedAgoMs) => {
        const r = repos.get(fullName);
        const open = r?.issues[r.issues.length - 1];
        if (!r || !open) return null;
        const n = takeNumber(r);
        r.pulls.unshift({
          number: n,
          title: open.title,
          url: `https://github.com/${fullName}/pull/${n}`,
          headRefName: `fix/issue-${open.number}`,
          state: 'MERGED',
          isDraft: false,
          mergeable: 'MERGEABLE',
          reviewDecision: null,
          closesIssues: [open.number],
          createdAt: new Date(Date.now() - mergedAgoMs - 3_600_000).toISOString(),
          mergedAt: new Date(Date.now() - mergedAgoMs).toISOString(),
          additions: 12,
          deletions: 3,
          checks: 'passing',
          headSha: fakeSha(),
          mergeState: 'CLEAN',
          failedChecks: [],
          pendingChecks: [],
        });
        return { issue: open.number, pr: n };
      },
    },
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

/**
 * The demo's stand-in for a floor's app: a page per path (Home and About link to each other), long enough to scroll.
 * A PR's build says so and shows its change, so main and the PR look different side by side.
 */
function placeholderPage(title: string, hue: number, at: string, pr: { number: number; title: string } | null) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  const rows = Array.from({ length: 24 }, (_, i) => `<li>Todo ${i + 1}: ${['water the plants', 'reply to Sam', 'book the dentist', 'buy coffee', 'fix the bike', 'plan the trip'][i % 6]}</li>`);
  if (pr) rows.splice(2, 0, `<li class="new">✨ New in PR #${pr.number}: ${safe(pr.title)}</li>`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><link rel="icon" href="data:,">
<style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: hsl(${hue},60%,96%); color: #222; }
  nav { position: sticky; top: 0; display: flex; gap: 18px; align-items: center; padding: 12px 24px; background: hsl(${hue},70%,55%); color: #fff; }
  nav a { color: #fff; font-weight: 600; }
  nav .at { margin-left: auto; font-family: Consolas, monospace; font-size: 14px; opacity: .9; }
  .pr { margin: 18px auto 0; max-width: 560px; padding: 10px 16px; border-radius: 12px; background: #fff3c4; border: 2px dashed hsl(${hue},60%,45%); font-weight: 600; }
  main { margin: 22px auto; max-width: 560px; padding: 28px 36px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px hsla(${hue},50%,40%,.18); }
  h1 { margin: 0 0 6px; font-size: 26px; color: hsl(${hue},60%,38%); }
  p { margin: 0 0 18px; color: #666; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border: 0; border-radius: 999px; background: hsl(${hue},70%,55%); color: #fff; cursor: pointer; }
  button:active { transform: scale(.97); }
  #count { display: block; margin-top: 16px; font-size: 15px; color: #444; }
  ol { margin: 22px 0 0; padding-left: 22px; line-height: 2.2; }
  li.new { font-weight: 700; color: hsl(${hue},60%,32%); background: #fff3c4; border-radius: 6px; padding: 0 6px; }
</style></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a><span class="at">${safe(at)}</span></nav>
${pr ? `<div class="pr">🧪 This is PR #${pr.number}'s build: ${safe(pr.title)}</div>` : ''}
<main>
  <h1>${safe(title)}</h1>
  <p>${at === '/about' ? 'About this app: a placeholder served by the demo office.' : 'A placeholder app served by the demo office.'}</p>
  <button id="btn" type="button">Click me</button>
  <span id="count">Clicked 0 times</span>
  <ol>${rows.join('')}</ol>
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
    const pull = job.pr ? repos.get(job.fullName)?.pulls.find((p) => p.number === job.pr) : undefined;
    const hue = ([...job.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) + (job.pr ? 150 : 0)) % 360;
    const sha = (job.pr ? pull?.headRefName ?? String(job.pr) : job.fullName + job.defaultBranch)
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
        const at = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (at.includes('.')) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(placeholderPage(job.title, hue, at, job.pr ? { number: job.pr, title: pull?.title ?? `PR #${job.pr}` } : null));
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
}

const PROFILES: Record<string, Profile> = {
  'pixel-todo': {
    summary: 'Todo web app · React + Vite + TypeScript',
    qa: '- Add, complete, edit and delete todos; they survive a reload\n- Keyboard only: every action reachable, focus always visible\n- Phone width (375px): nothing overflows or gets cut off\n- No errors in the browser console',
  },
  'weather-api': {
    summary: 'REST API · Node + Express',
    qa: '- Every endpoint: happy path, bad input (400), unknown city (404)\n- Response shapes match the OpenAPI document\n- Rate limiting returns 429 with Retry-After\n- Tests and lint pass',
  },
};

const GENERIC: Profile = {
  summary: 'Web project · early stage',
  qa: '- The app builds and starts\n- The changed feature works end to end in the browser\n- Phone width: nothing overflows\n- No console errors',
};

/** A floor in company_status, as far as the demo CEO reads it. */
export interface DemoFloor {
  floor: number;
  repo: string;
  brief: string | null;
  team: { size: number; max: number; free: number; pendingHires: number; pendingLetGos: number };
  capacity: { issuesReadyToStart: number; prsAwaitingQa: number };
  backlog: { number: number; title: string; inProgress: boolean }[];
  pullRequests: unknown[];
}

interface DemoStatus {
  company: { scaling: string }; // how team changes go, in words ("team changes apply straight away")
  floors: DemoFloor[];
  pendingChanges: unknown[];
}

/** The team a floor will have once the changes waiting for the manager are decided. */
const plannedSize = (t: DemoFloor['team']) => t.size + t.pendingHires - t.pendingLetGos;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The demo CEO grows a floor up to this many agents on its own (the real CEO's "rarely more than 4 to 6"). */
const DEMO_GROW_TO = 6;

/**
 * The demo CEO's call to grow a floor: when the issues ready to start (`ready`) outnumber its free agents and the
 * agents already on their way, up to DEMO_GROW_TO and the floor's max. Null: the team can keep up.
 */
export function demoGrow(f: DemoFloor, ready: number): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const waiting = ready - f.team.free - f.team.pendingHires;
  const size = Math.min(f.team.max, Math.max(now, DEMO_GROW_TO), now + waiting);
  if (waiting <= 0 || size <= now) return null;
  return {
    size,
    reason: `${plural(ready, 'issue')} ${ready === 1 ? 'is' : 'are'} ready to start on floor ${f.floor} and ${plural(f.team.free, 'agent')} ${f.team.free === 1 ? 'is' : 'are'} free: with ${size} agents they're worked on side by side instead of waiting.`,
  };
}

/** The demo CEO's call to shrink a floor: several agents idle with nothing ready to start or test. Never below one. */
export function demoShrink(f: DemoFloor): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const idle = f.team.free - f.team.pendingLetGos;
  if (idle < 2 || f.capacity.issuesReadyToStart > 0 || f.capacity.prsAwaitingQa > 0) return null;
  const size = Math.max(1, now - (idle - 1));
  if (size >= now) return null;
  return { size, reason: `${idle} of ${f.team.size} agents on floor ${f.floor} are idle with nothing ready to start or test; ${size} can keep up with what comes in.` };
}

/** A scripted CEO that uses the real office tools, so team changes, profiles and issues behave exactly as in the real thing. */
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
    const s = JSON.parse(await office.call('company_status', {})) as DemoStatus;
    const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
    const free = s.floors.reduce((n, f) => n + f.team.free, 0);
    const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
    cb.log([{ kind: 'result', text: `  ⎿ ${s.floors.length} floors · ${agents} agents · ${free} free · ${issues} open issues · ${s.pendingChanges.length} team changes pending` }]);
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
  const refused = (out: string) => out.replace(/^Refused: /, '');
  /** What happens next, by Settings → Team changes; `added`: new agents (negative: agents leaving). */
  const after = (s: DemoStatus, added: number) => {
    const who = added === 1 ? 'The new agent' : 'The new agents';
    if (/auto|straight away/i.test(s.company.scaling)) return added > 0 ? `${who} ${added === 1 ? 'is' : 'are'} on the way up.` : 'Idle agents leave first; anyone busy finishes their task.';
    return added > 0 ? `${who} ${added === 1 ? 'waits' : 'wait'} in the lobby for you to set up and hire.` : "It's an envelope on the desk of whoever I picked to leave, waiting for your decision.";
  };
  /** scale_team with the call made, and a sentence on how it went. */
  const scale = async (s: DemoStatus, f: DemoFloor, call: { size: number; reason: string }) => {
    const out = await use('scale_team', { floor: f.floor, ...call });
    return out.startsWith('Refused')
      ? `I wanted floor ${f.floor} at ${plural(call.size, 'agent')}, but the office said no: ${refused(out)}`
      : `Floor ${f.floor} goes from ${f.team.size} to ${plural(call.size, 'agent')}: ${call.reason} ${after(s, call.size - plannedSize(f.team))}`;
  };

  /** Files the brief's first three issues; returns the skeleton's number. */
  const planIssues = async (floor: number, mission: string) => {
    const first = await use('file_issue', {
      floor,
      title: 'Set up the project skeleton',
      body: `Scaffold the app so the rest of the milestone has something to build on.\n\nBrief: ${mission}\n\nAcceptance criteria:\n- The dev server starts\n- A placeholder home page renders\n- Lint, tests and build scripts exist`,
    });
    const n = Number(first.match(/#(\d+)/)?.[1] ?? 0);
    await use('file_issue', {
      floor,
      title: `Build the core: ${short(mission, 60)}`,
      body: `${n ? `Depends on #${n}\n\n` : ''}Implement the heart of the brief.\n\nAcceptance criteria:\n- The main flow works end to end\n- Covered by tests`,
    });
    await use('file_issue', {
      floor,
      title: 'Polish: phone layout and empty states',
      body: `${n ? `Depends on #${n}\n\n` : ''}Make every screen work at 375px and add friendly empty states.`,
    });
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
      await think(`${p.summary}. Let me size the team for the work in sight.`);
      await use('set_floor_profile', { floor, summary: p.summary, qa_brief: p.qa });
      const ready = f.capacity.issuesReadyToStart;
      const grow = demoGrow(f, ready);
      const team = grow ? await scale(s, f, grow) : `Its ${plural(f.team.size, 'agent')} can keep up with the ${plural(ready, 'issue')} ready to start.`;
      const next = f.brief ? ' Your brief is next on my list: I plan it as soon as this is done.' : f.backlog.length === 0 ? ' The backlog is empty: tell me what you would like built and I will plan it.' : '';
      return [`Floor ${floor}: ${p.summary}. I wrote a QA brief for it.`, team, next].filter(Boolean).join(' ');
    },
    async plan(floor: number, mission: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'That floor has gone, so there was nothing to plan.';
      await read(`${f.repo}/README.md`, 12);
      await think("Foundation first, so the parallel work doesn't collide.");
      const n = await planIssues(floor, mission);
      const grow = demoGrow(f, f.capacity.issuesReadyToStart + (n ? 1 : 0));
      const team = grow ? ` ${await scale(s, f, grow)}` : '';
      return `I turned the brief into three issues on floor ${floor}. #${n} sets up the skeleton; the other two say "Depends on #${n}", so nobody starts them early.${team}`;
    },
    async review() {
      const s = await status();
      await think('Checking each floor for work waiting on free agents, and agents waiting on work.');
      for (const f of s.floors) {
        const call = demoShrink(f) ?? demoGrow(f, f.capacity.issuesReadyToStart);
        if (call) return scale(s, f, call);
      }
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const prs = s.floors.reduce((n, f) => n + f.pullRequests.length, 0);
      return `All ${s.floors.length} floors look healthy: ${issues} open issues and ${prs} pull requests in flight. No changes needed.`;
    },
    // A stuck PR: read what QA and GitHub say, then act through the real triage tools, as the real CEO would.
    async triage(floor: number, pr: number, facts: string) {
      await step([{ kind: 'tool', tool: 'Read', text: `⏺ Read PR #${pr}'s QA report` }, { kind: 'result', text: '  ⎿ Read 38 lines' }]);
      const conflict = /mergeable: CONFLICTING/.test(facts);
      const red = /GitHub checks: failing/.test(facts);
      const again = !/triage 1 of/.test(facts);
      await think(conflict ? 'It only conflicts with main; the change itself is fine.' : red ? 'A red check that looks like a flake.' : again ? 'Stuck a second time. This needs a call from the manager.' : 'The fix sessions stalled, not the code. Another QA round should settle it.');
      const [tool, args, done] = conflict
        ? ['send_back', { note: 'Merge main and keep both changes working; QA already liked the rest.' }, 'went back for a fix: merging main']
        : red
          ? ['rerun_checks', {}, 'had its failed checks re-run']
          : again
            ? ['escalate', { reason: 'It got stuck twice for the same reason; worth a look at the issue itself.' }, 'is with you now']
            : ['retry_qa', {}, 'is back in the QA queue'];
      const out = await use(tool, { floor, pr, ...args });
      if (!out.startsWith('Refused')) return `PR #${pr} on floor ${floor} was stuck. It ${done}.`;
      await use('escalate', { floor, pr, reason: `I tried ${tool}, but the office refused: ${refused(out)}` });
      return `PR #${pr} on floor ${floor} is stuck and I couldn't move it, so it's with you now.`;
    },
    async chat(text: string) {
      const s = await status();
      await think('Reading your message.');
      // "close #3, superseded by #5": through the real tool.
      const close = text.match(/\bclose #(\d+)[\s,:;.-]*(.*)/i);
      const closeFloor = close && (s.floors.find((f) => f.backlog.some((i) => i.number === Number(close[1]))) ?? s.floors[0]);
      if (close && closeFloor) {
        const reason = close[2].trim() || 'No longer wanted.';
        const out = await use('close_issue', { floor: closeFloor.floor, number: Number(close[1]), reason });
        return out.startsWith('Refused') ? `I couldn't close #${close[1]}: ${refused(out)}` : `Done: ${out} I left "${short(reason, 80)}" on it as a comment.`;
      }
      // Asked for a bigger team: one more agent where the most work waits, through the real tool.
      if (/\b(hire|hiring|grow|team|bigger)\b/i.test(text)) {
        if (!s.floors.length) return 'There are no floors yet: add a project first, and I will size its team.';
        const room = s.floors.filter((f) => plannedSize(f.team) < f.team.max);
        if (!room.length) return `Every floor is at its most agents (${s.floors[0].team.max}). Raise it in Settings → Most agents per floor, and I'll grow the busiest one.`;
        const f = room.sort((a, b) => b.capacity.issuesReadyToStart - b.team.free - (a.capacity.issuesReadyToStart - a.team.free) || a.floor - b.floor)[0];
        const ready = f.capacity.issuesReadyToStart;
        return scale(s, f, {
          size: plannedSize(f.team) + 1,
          reason: `You asked for a bigger team, and floor ${f.floor} has the most work waiting: ${plural(ready, 'issue')} ready to start, ${plural(f.team.free, 'agent')} free.`,
        });
      }
      const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const pending = s.pendingChanges.length;
      // Real CEOs answer in Markdown, so the demo one does too: every element the phone renders.
      const rows = s.floors.map((f) => `| ${f.floor} | \`${f.repo.split('/').pop()}\` | ${f.team.size} | ${f.backlog.length} | ${f.pullRequests.length} |`);
      return [
        `**Quick status:** ${s.floors.length} floor${s.floors.length === 1 ? '' : 's'}, ${agents} agents and ${issues} open issues.`,
        '',
        '- The team is *heads down* on the backlog',
        `- ${pending ? `**${pending}** team change${pending === 1 ? ' is' : 's are'} waiting for your decision` : 'No team changes waiting on you'}`,
        '  - QA re-tests every PR after a fix',
        '',
        '| Floor | Repo | Agents | Issues | PRs |',
        '| ---: | --- | ---: | ---: | ---: |',
        ...(rows.length ? rows : ['| – | no projects yet | 0 | 0 | 0 |']),
        '',
        'What I would do next:',
        '',
        '1. Merge anything that passed QA',
        '2. Run `npm run build` on each floor before the next milestone',
        '3. Grow a team only where work keeps waiting for free agents',
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
  const triage = prompt.match(/^Triage: pull request #(\d+) on floor (\d+)/);
  const run = triage
    ? () => scripts.triage(Number(triage[2]), Number(triage[1]), prompt)
    : /no longer needs triage/.test(prompt)
      ? async () => 'Nothing to do.'
      : /just joined the company/.test(prompt)
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

/**
 * A short two-note chime as 8 kHz mono WAV: something to hear without ElevenLabs, a little longer for longer text, and
 * pitched by the voice, so a replayed clip is audibly the one made in the voice of its day.
 */
export function demoChime(chars: number, voiceId = ''): Buffer {
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
  const pitch = 2 ** ([...voiceId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 7, 0) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = (t < seconds / 2 ? 660 : 880) * pitch;
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

/** What the demo's Speech to Text hears in any recording (docs/voice.md). */
export const DEMO_TRANSCRIPT = "What's everyone working on?";

/** No network: any key works except one containing "bad", three voices, a chime for every message, and one fixed transcript. */
const demoVoice: VoiceApi = {
  checkKey: async (key) => {
    if (/bad/i.test(key)) throw new VoiceApiError(401, '401: invalid_api_key (demo)');
  },
  listVoices: async () => demoVoices,
  synthesize: async (_key, { text, voiceId }) => {
    await new Promise((r) => setTimeout(r, 300));
    return demoChime(text.length, voiceId);
  },
  transcribe: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return DEMO_TRANSCRIPT;
  },
};

// ---------- notifications ----------

/**
 * Nothing is sent: each channel logs the message it would get. A demo office starts with every chat app set up (fake
 * addresses in demo-secrets.json), so a needs-human PR shows one line per channel; an address containing "bad" fails.
 */
const demoNotify: NotifyTransport = {
  demoWebhooks: {
    ntfy: { url: 'https://ntfy.sh/cubefarm-demo-office' },
  },
  post: async ({ channel, url, text }) => {
    const ok = !/bad/i.test(url);
    console.log(`🔔 demo ${channel}${ok ? '' : ' (fails: "bad" address)'} would get: ${text.replace(/\n/g, ' ⏎ ')}`);
    return ok ? 200 : 404;
  },
};

// ---------- weather ----------

/** A weather word in the demo's city ("Rainytown", "Snow Hill") picks that weather: these WMO codes. */
const DEMO_SKIES: [RegExp, number][] = [
  [/storm|thunder/i, 95],
  [/snow/i, 75],
  [/fog|mist/i, 45],
  [/heavy|pour/i, 65],
  [/rain|drizzle/i, 61],
  [/cloud|grey|gray/i, 3],
  [/sun|clear/i, 0],
];
/** Any other city gets these in turn, a new one every 15 minutes. */
const DEMO_ROTATION = [0, 2, 61, 3, 45, 63, 95, 1, 71];
const demoPlaces = new Map<string, { code: number | null; offline: boolean }>();

/**
 * No network: any city is found ("Atlantis" and "Nowhere" aren't), at made-up coordinates. A weather word in its name
 * picks the weather; "offline" in it makes every reading fail, to see the office fall back to the calm cycle.
 */
const demoWeather: WeatherApi = {
  geocode: async (city) => {
    await new Promise((r) => setTimeout(r, 200));
    if (/atlantis|nowhere/i.test(city)) return null;
    const h = [...city.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const lat = Math.round(((h % 12000) / 100 - 60) * 100) / 100;
    const lon = Math.round((((h >>> 8) % 34000) / 100 - 170) * 100) / 100;
    demoPlaces.set(`${lat},${lon}`, { code: DEMO_SKIES.find(([re]) => re.test(city))?.[1] ?? null, offline: /offline/i.test(city) });
    return { name: `${city} (demo)`, lat, lon };
  },
  current: async (lat, lon) => {
    const p = demoPlaces.get(`${lat},${lon}`);
    if (p?.offline) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (p?.code != null) return { code: p.code, wind: p.code === 95 ? 55 : 12 };
    const slot = Math.floor(Date.now() / (15 * 60_000)) + Math.abs(Math.round(lat + lon));
    return { code: DEMO_ROTATION[slot % DEMO_ROTATION.length], wind: 10 };
  },
};
