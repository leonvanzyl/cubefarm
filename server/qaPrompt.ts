// The parts of a QA session's instructions that depend on the PR: what GitHub's checks say (QA doesn't re-run what
// they already cover) and, on a re-test, how much to look at again (what changed, not the whole plan). Pure, so the
// wording is tested.

import type { PrDetails } from './github.ts';

export interface QaPromptInput extends Pick<PrDetails, 'headSha' | 'checks' | 'checkNames' | 'failedChecks' | 'pendingChecks'> {
  round: number;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
  /** The commit the previous round tested (null on a first round or for records from before commits were tracked). */
  lastTestedSha: string | null;
  summary: string | null; // last round's findings
  fixInstructions: string | null;
  defaultBranch: string;
}

export interface QaInstructions {
  /** One line for the prompt: what the checks say right now. */
  checks: string;
  /** Step 3 of "How to test". */
  testStep: string;
  /** The re-test paragraph for the prompt, '' on a first round. */
  retest: string;
}

export function qaInstructions(i: QaPromptInput): QaInstructions {
  return { checks: checksLine(i), testStep: testStep(i.checks !== 'none'), retest: retest(i) };
}

function checksLine(i: QaPromptInput): string {
  const names = (list: string[]) => list.join(', ') || 'unnamed';
  const state =
    i.checks === 'passing'
      ? `passing (${names(i.checkNames)})`
      : i.checks === 'failing'
        ? `failing: ${names(i.failedChecks)}${i.pendingChecks.length ? `; still running: ${i.pendingChecks.join(', ')}` : ''}`
        : i.checks === 'pending'
          ? `pending: ${names(i.pendingChecks)}`
          : 'none';
  return `GitHub checks right now: ${state}`;
}

function testStep(hasChecks: boolean): string {
  return hasChecks
    ? "3. GitHub's checks run on this PR, and it merges only once they're green. Read .github/workflows to see what they cover and don't re-run that locally. Run only what you need to exercise the change (for example a build to start the app), anything the checks don't cover, or a failing check to reproduce it. A failing check is a finding: name it."
    : "3. Install dependencies if needed (e.g. npm install when node_modules is missing), then run the project's test suite, linters, type checks and build (whichever exist).";
}

function retest(i: QaPromptInput): string {
  // A retried session (it crashed or the office restarted) already recorded this head: there's no diff to go by.
  const since = i.lastTestedSha && i.lastTestedSha !== i.headSha ? i.lastTestedSha : null;
  const diff = since
    ? `(git diff ${since}..HEAD), plus a quick smoke test of the main flow. Don't repeat the full test plan for parts the change didn't touch.`
    : null;
  // A conflict fix only merged the base: the resolution, CI and the places where the two meet are what can break.
  if (i.fixReason === 'conflict') {
    const merges = since ? ` (git log --merges ${since}..HEAD)` : '';
    return `\nQA passed it before, but since then the branch was updated with ${i.defaultBranch} to resolve merge conflicts. Review the resolution with git show --remerge-diff on the merge commit(s)${merges}, confirm GitHub's checks are green on the new head, and smoke-test this PR's feature plus whatever the conflicting files touch. Don't repeat the full test plan.`;
  }
  if (i.fixReason === 'checks') {
    return `\nQA passed it before, but since then the developer changed the code to fix failing GitHub checks. ${diff ? `Test what changed since QA passed it ${diff}` : 'Re-check everything.'}`;
  }
  if (i.round > 1 && i.summary) {
    return `\nThis is a re-test after fixes. Last round's findings:\n${i.summary}\n${i.fixInstructions ?? ''}\nCheck those first, then ${diff ? `test what changed since the last round ${diff}` : 're-check everything else.'}`;
  }
  return '';
}
