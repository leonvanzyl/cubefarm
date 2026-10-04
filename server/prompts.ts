// What developers and QA testers are told on every task: the system prompt the office appends for each session, as
// pure functions, so the manager can preview it (GET /api/agents/:id/prompt) without a live task. The job
// description is the one part the manager edits; the rest carries the office's workflow and safety rules.

import type { AgentPromptView, AgentRole, PromptPart } from '../shared/types.ts';

export interface PromptAgent {
  name: string;
  role: AgentRole;
  title: string;
  brief: string;
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
}

export interface DevPromptInput extends PromptBase {
  /** Connected repositories they may read, with their clone paths. */
  linked: { fullName: string; dir: string }[];
  /** Fixing an open pull request rather than starting an issue. */
  fixing?: { pr: number; headRef: string };
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

export const devBranch = (issue: number | string, slug: string) => `swarm/issue-${issue}-${slug}`;
export const qaBranch = (pr: number | string, slug: string) => `qa/pr-${pr}-${slug}`;

export function devSystemPrompt({ agent: a, repo, port, cwd, branch, linked, fixing }: DevPromptInput) {
  const push = fixing ? `git push origin HEAD:${fixing.headRef}` : `git push -u origin ${branch}`;
  const links = linked.map((r) => `- ${r.fullName}: read-only reference clone at ${r.dir}`);
  return [
    `You are ${a.name}, ${a.title ? `the team's ${a.title},` : 'a software engineer'} on an autonomous agent team ("cubefarm"). Several teammates work in parallel on other issues of the same repository, each in their own git worktree. Nobody is watching live to answer questions, so make sensible decisions yourself and record assumptions in the PR description. The manager may occasionally send you messages; follow their instructions.`,
    `Every pull request is reviewed and tested by a QA teammate. ${repo.autoMerge ? "Once they sign off and GitHub's checks pass, the office merges it by itself" : 'Once they sign off, the manager merges it'}. If they find problems, or checks fail, or it conflicts with the default branch, you will get the details; fix them on the same branch.`,
    a.brief ? `\nYour job description:\n${a.brief}` : '',
    '',
    `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
    repo.summary ? `Project: ${repo.summary}` : '',
    repo.mission ? `What the team is building (the manager's brief): ${repo.mission}` : '',
    `Your worktree: ${cwd}`,
    fixing
      ? `You are fixing pull request #${fixing.pr}. Its code is checked out on local branch ${branch}; push fixes with: ${push}. Do not open a new pull request.`
      : `Your branch: ${branch} (already checked out, created from origin/${repo.defaultBranch})`,
    links.length ? `Related repositories you may read for context (do not modify them):\n${links.join('\n')}` : '',
    '',
    'Workflow:',
    '1. Read the issue and explore the relevant code before changing anything.',
    '2. Implement the change with focused commits and clear messages.',
    "3. Run the project's existing tests, linters and build (if any) and fix what you broke. Install dependencies first if needed.",
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
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function qaSystemPrompt({ agent: a, repo, port, cwd, branch, pr, testStep }: QaPromptInput) {
  return [
    `You are ${a.name}, ${a.title ? `the team's ${a.title},` : 'a QA engineer'} on an autonomous agent team ("cubefarm"). Developers open pull requests; you review and independently verify each one before it is merged. Your sign-off is the review: ${repo.autoMerge ? "on this floor a PR you pass merges by itself as soon as GitHub's checks are green, so nobody else reads the code after you. " : ''}Be thorough and skeptical, but fair: fail a PR only for real problems (broken behaviour, failing tests or build, the issue's requirements not met, obvious regressions), not for style preferences.`,
    ...(a.brief ? ['', `Your job description:\n${a.brief}`] : []),
    ...(a.role === 'dev' ? ['', "You're a developer covering for the QA lab while its testers are busy. You didn't write this pull request: test it as an independent QA engineer would."] : []),
    '',
    `Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`,
    ...(repo.summary ? [`Project: ${repo.summary}`] : []),
    ...(repo.mission ? [`What the team is building (the manager's brief): ${repo.mission}`] : []),
    ...(repo.qaBrief ? [`What to check on this project (from the CEO):\n${repo.qaBrief}`] : []),
    `Pull request #${pr.number} "${pr.title}" from branch ${pr.headRefName}: ${pr.url}`,
    `Your worktree: ${cwd}. It has the pull request's code checked out on local branch ${branch}.`,
    '',
    'How to test:',
    '1. Read the PR description and the linked issue, and work out the acceptance criteria.',
    `2. Review the code as a careful reviewer would: git diff origin/${repo.defaultBranch}...HEAD. Look for bugs, unhandled errors and edge cases, security problems, leftover debug code, and new logic without tests.`,
    testStep ?? "3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).",
    repo.browserTesting
      ? `4. If the project has a UI, start it in the background on port ${port} (reserved for you) and exercise the change in a real browser with the Playwright tools: navigate, click, type, resize to a phone size, try edge cases, and check the console for errors. Take a screenshot with browser_take_screenshot (no filename) of every important state: the screenshots are attached to the PR as evidence. Stop the server afterwards.`
      : '4. Exercise the changed behaviour directly (run the program, call the API, write a quick script).',
    '5. You may write throwaway scripts to probe behaviour, but do not commit them.',
    '',
    'Rules: do not modify the code under test, do not commit, push, comment on, review or merge anything on GitHub. The office posts your report on the pull request. Finish with the structured QA report: verdict, summary, the checks you performed, the commands you ran and one caption per screenshot.',
  ].join('\n');
}

// ---------- previews ----------

const OFFICE = 'Office instructions';
// Stands in for the job description while the prompt is built, so the parts split exactly around it.
const MARK = '\u0000job description\u0000';

/** Splits a prompt around the job description, which is the one editable part. */
export function promptParts(build: (brief: string) => string, brief: string): PromptPart[] {
  if (!brief) return [{ label: OFFICE, text: build(''), editable: false }];
  const [before, after] = build(MARK).split(MARK);
  return [
    { label: OFFICE, text: before, editable: false },
    { label: 'Job description', text: brief, editable: true },
    { label: OFFICE, text: after, editable: false },
  ].filter((p) => p.text !== '');
}

const view = (kind: AgentPromptView['kind'], parts: PromptPart[]): AgentPromptView => ({ kind, text: parts.map((p) => p.text).join(''), parts });

type PreviewInput = Omit<PromptBase, 'cwd' | 'branch'> & { slug: string };

/** What a developer is told when they start an issue, with placeholders for the issue and their worktree. */
export function devPromptPreview({ slug, ...i }: PreviewInput & Pick<DevPromptInput, 'linked'>): AgentPromptView {
  const branch = devBranch(PLACEHOLDERS.issue, slug);
  return view('dev', promptParts((brief) => devSystemPrompt({ ...i, agent: { ...i.agent, brief }, cwd: PLACEHOLDERS.worktree, branch }), i.agent.brief));
}

/** What a QA tester is told when they test a pull request, with placeholders for the PR and their worktree. */
export function qaPromptPreview({ slug, ...i }: PreviewInput): AgentPromptView {
  const pr = { number: PLACEHOLDERS.pr, title: PLACEHOLDERS.prTitle, headRefName: PLACEHOLDERS.branch, url: PLACEHOLDERS.prUrl };
  const branch = qaBranch(PLACEHOLDERS.pr, slug);
  return view('qa', promptParts((brief) => qaSystemPrompt({ ...i, agent: { ...i.agent, brief }, cwd: PLACEHOLDERS.worktree, branch, pr }), i.agent.brief));
}

/** The CEO's prompt has no job description of theirs in it: all of it is the office's. */
export const ceoPromptPreview = (text: string): AgentPromptView => view('ceo', [{ label: OFFICE, text, editable: false }]);
