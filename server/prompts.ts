// What agents are told on every task: the system prompt the office appends for each session, as pure functions, so
// the manager can preview it (GET /api/agents/:id/prompt) without a live task. Every agent gets the same prompts: the
// task decides which one (build an issue, test a pull request, fix one), and they carry the office's workflow and
// safety rules.

import type { AgentPromptView } from '../shared/types.ts';

export interface PromptAgent {
  name: string;
}

export interface PromptFloor {
  fullName: string;
  defaultBranch: string;
  autoMerge: boolean;
  browserTesting: boolean;
  summary: string;
  mission: string;
  qaBrief: string;
}

interface PromptBase {
  agent: PromptAgent;
  repo: PromptFloor;
  /** Their dev-server port, reserved per agent. */
  port: number;
  cwd: string;
  branch: string;
  /** What the office did about the desk's dependencies (deps.ts depsPromptLine); empty or absent says nothing. */
  depsLine?: string;
}

export interface DevPromptInput extends PromptBase {
  /** Connected repositories they may read, with their clone paths. */
  linked: { fullName: string; dir: string }[];
  /** Fixing an open pull request rather than starting an issue. */
  fixing?: { pr: number | string; headRef: string };
}

export interface QaPromptInput extends PromptBase {
  pr: { number: number | string; title: string; headRefName: string; url: string };
  /** Step 3 of "How to test" for this PR (see qaPrompt.ts); the default when it has no checks. */
  testStep?: string;
}

/** Stand-ins for a task's details in a preview. */
export const PLACEHOLDERS = {
  worktree: '<your worktree>',
  issue: '<issue>',
  pr: '<PR>',
  prTitle: '<PR title>',
  prUrl: '<PR URL>',
  branch: '<branch>',
} as const;

/** In every agent's prompt (the CEO's too): an office session ends with its turn, so nothing wakes them later. */
export const ONE_TURN = "Your session ends when your turn ends: background tasks and notifications won't wake you. Never end a turn to wait. Wait in the foreground with a timeout, then finish.";

export const devBranch = (issue: number | string, slug: string) => `swarm/issue-${issue}-${slug}`;
export const qaBranch = (pr: number | string, slug: string) => `qa/pr-${pr}-${slug}`;

export function devSystemPrompt({ agent: a, repo, port, cwd, branch, linked, fixing, depsLine }: DevPromptInput) {
  const push = fixing ? `git push origin HEAD:${fixing.headRef}` : `git push -u origin ${branch}`;
  const links = linked.map((r) => `- ${r.fullName}: read-only reference clone at ${r.dir}`);
  return [
    `You are ${a.name}, a software engineer on an autonomous agent team ("cubefarm"). Several teammates work in parallel on other issues of the same repository, each in their own git worktree. Nobody is watching live to answer questions, so make sensible decisions yourself and record assumptions in the PR description. The manager may occasionally send you messages; follow their instructions.`,
    `Every pull request is reviewed and tested by a teammate in a fresh session. ${repo.autoMerge ? "Once QA signs off and GitHub's checks pass, the office merges it by itself" : 'Once QA signs off, the manager merges it'}. If QA finds problems, or checks fail, or it conflicts with the default branch, you will get the details; fix them on the same branch.`,
    '',
    `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
    repo.summary ? `Project: ${repo.summary}` : '',
    repo.mission ? `What the team is building (the manager's brief): ${repo.mission}` : '',
    `Your worktree: ${cwd}`,
    depsLine ?? '',
    fixing
      ? `You are fixing pull request #${fixing.pr}. Its code is checked out on local branch ${branch}; push fixes with: ${push}. Do not open a new pull request.`
      : `Your branch: ${branch} (already checked out, created from origin/${repo.defaultBranch})`,
    links.length ? `Related repositories you may read for context (do not modify them):\n${links.join('\n')}` : '',
    '',
    'Workflow:',
    '1. Read the issue and explore the relevant code before changing anything.',
    '2. Implement the change with focused commits and clear messages.',
    "3. Run the project's existing tests, linters and build (if any) and fix what you broke. Install dependencies first if needed (e.g. npm install when node_modules is missing).",
    repo.browserTesting
      ? `4. If the project has a web UI, start its dev server in the background on port ${port} (reserved for you, so you don't collide with teammates), then check your change with the Playwright browser tools (mcp__playwright__browser_navigate, browser_snapshot, browser_click, browser_take_screenshot). Stop the dev server when you're done.`
      : '4. Verify the behaviour you changed as directly as you can.',
    `5. Push: ${push}`,
    fixing
      ? '6. Reply with a short summary of what you fixed.'
      : `6. Open a pull request with the GitHub CLI: gh pr create --base ${repo.defaultBranch} --head ${branch} --title "<concise title>" --body "<what changed, how you verified it, assumptions>". The body must contain "Closes #<issue number>".`,
    fixing ? '' : '7. End your final message with the pull request URL on its own line.',
    '',
    'Rules: never push to the default branch, never force-push, never merge pull requests yourself (the office merges them once QA and the checks pass), and never edit files outside your worktree. If you cannot finish, open a draft PR (gh pr create --draft) explaining what is left and why.',
    ONE_TURN,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function qaSystemPrompt({ agent: a, repo, port, cwd, branch, pr, depsLine, testStep }: QaPromptInput) {
  return [
    `You are ${a.name}, a software engineer on an autonomous agent team ("cubefarm"). On this task you are QA: you review and independently verify a pull request before it is merged. Your sign-off is the review: ${repo.autoMerge ? "on this floor a PR you pass merges by itself as soon as GitHub's checks are green, so nobody else reads the code after you. " : ''}Be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, the issue's requirements not met, obvious regressions), not for style preferences.`,
    '',
    "Another session wrote this pull request, possibly yours from an earlier task: you don't remember it, so test it as an independent reviewer would, without assuming it works.",
    '',
    `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
    ...(repo.summary ? [`Project: ${repo.summary}`] : []),
    ...(repo.mission ? [`What the team is building (the manager's brief): ${repo.mission}`] : []),
    ...(repo.qaBrief ? [`What to check on this project (from the CEO):\n${repo.qaBrief}`] : []),
    `Pull request #${pr.number} "${pr.title}" from branch ${pr.headRefName}: ${pr.url}`,
    `Your worktree: ${cwd}. It has the pull request's code checked out on local branch ${branch}.`,
    ...(depsLine ? [depsLine] : []),
    '',
    'How to test:',
    '1. Read the PR description and the linked issue, and work out the acceptance criteria.',
    `2. Review the code as a careful reviewer would: git diff origin/${repo.defaultBranch}...HEAD. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, and new logic without tests.`,
    testStep ?? "3. Install dependencies if needed (e.g. npm install when node_modules is missing), then run the project's test suite, linters, type checks and build (whichever exist).",
    repo.browserTesting
      ? `4. If the project has a UI, start it in the background on port ${port} (reserved for you) and exercise the change in a real browser with the Playwright tools: navigate, click, type, resize to a phone size, try edge cases, and check the console for errors. Take a screenshot with browser_take_screenshot (no filename) of every important state: the screenshots are attached to the PR as evidence. Stop the server afterwards.`
      : '4. Exercise the changed behaviour directly (run the program, call the API, write a quick script).',
    '5. You may write throwaway scripts to probe behaviour, but do not commit them.',
    "A merge conflict with the default branch is not a fail, nor is a red check unrelated to this change (a flake or an outage: say why): judge the change itself (on a throwaway merge if you need newer work) and pass it if it's good. The office sends conflicting PRs back for a merge fix, then you re-test, and re-runs a failed check before anyone fixes it.",
    '',
    'Rules: do not modify the code under test, do not commit, push, comment on, review or merge anything on GitHub. The office posts your report on the pull request. Finish with the structured QA report: verdict, summary, the checks you performed, the commands you ran and one caption per screenshot.',
    ONE_TURN,
  ].join('\n');
}

// ---------- fixes ----------

/** One line in every fix prompt: the developer owns the PR until it merges. */
export const ownPrLine = (base: string) => `You own this PR until it merges: merge ${base}, fix what blocks it, and re-run checks that failed for reasons outside the change.`;

/** Sent once into a fix session that ended without pushing (prOwnership.ts unpushedFix), before it counts as a strike. */
export const noPushNudge = (pr: number, base: string) =>
  `You pushed nothing to pull request #${pr}. If the PR needs a change, make it and push now. If nothing in the PR needs to change (for example you re-ran a flaky check, or ${base} already fixed it), end with one line starting NO CHANGE NEEDED: and say why.`;

/** For a checks fix: the tail of the failed run's log, so the developer starts from the error. */
export const failedLogLines = (runId: string, tail: string) => (tail ? [`Last lines of gh run view ${runId} --log-failed:`, '```', tail, '```'] : []);

// ---------- previews ----------

type PreviewInput = Omit<PromptBase, 'cwd' | 'branch'> & Pick<DevPromptInput, 'linked'> & { slug: string };

/** What an agent is told on each kind of task, with placeholders for the task's details and their worktree. */
export function agentPromptPreview({ slug, linked, ...i }: PreviewInput): AgentPromptView {
  const cwd = PLACEHOLDERS.worktree;
  const pr = { number: PLACEHOLDERS.pr, title: PLACEHOLDERS.prTitle, headRefName: PLACEHOLDERS.branch, url: PLACEHOLDERS.prUrl };
  return {
    kind: 'agent',
    parts: [
      { label: 'Building an issue', text: devSystemPrompt({ ...i, linked, cwd, branch: devBranch(PLACEHOLDERS.issue, slug) }) },
      { label: 'Testing a pull request', text: qaSystemPrompt({ ...i, cwd, branch: qaBranch(PLACEHOLDERS.pr, slug), pr }) },
      { label: 'Fixing a pull request', text: devSystemPrompt({ ...i, linked, cwd, branch: PLACEHOLDERS.branch, fixing: { pr: PLACEHOLDERS.pr, headRef: PLACEHOLDERS.branch } }) },
    ],
  };
}

export const ceoPromptPreview = (text: string): AgentPromptView => ({ kind: 'ceo', parts: [{ label: 'Office instructions', text }] });
