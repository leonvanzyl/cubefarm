// After an office restart: whose work picks up where it was, and what they're told. An agent still preparing a task
// hadn't started that task's session yet, so the session it remembers, or a CLI still busy in its terminal, belongs to
// an earlier task: resuming it would do that task again (a QA verdict posted twice) and pass the result off as this one.

export interface RestartAgent {
  status: string;
  task: 'issue' | 'qa' | 'fix' | null;
  sessionId: string | null;
  branch: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  prNumber: number | null;
}

/** A CLI the terminal keeper kept running through the restart. resumeId: the session it is on, when known. */
export interface KeptCli {
  busy: boolean;
  resumeId: string | null;
}

/** The office follows a CLI that kept working through the restart only when it is on the agent's current task. */
export function followKeptCli(a: RestartAgent, cli: KeptCli | undefined): boolean {
  if (!cli?.busy || a.status === 'preparing') return false;
  return !(a.sessionId && cli.resumeId && cli.resumeId !== a.sessionId);
}

/**
 * An agent cut off by the restart resumes its session (true), or its work goes back in line: QA, the demo, and a task
 * that was still being prepared (preparing: its status when the office stopped), whose session never started.
 */
export function resumesAfterRestart(a: RestartAgent, preparing: boolean, demo: boolean): boolean {
  return !demo && !preparing && a.task !== 'qa' && !!a.sessionId && !!a.branch;
}

/** What a resumed agent is told: the job it was on, not just "carry on". */
export function resumeNote(a: RestartAgent, fix?: { round: number; fixReason: 'qa' | 'checks' | 'conflict' | null } | null): string {
  const yours = 'Uncommitted changes in your worktree are yours to finish.';
  if (a.task === 'fix' && a.prNumber && a.branch) {
    const job =
      fix?.fixReason === 'conflict'
        ? `resolving the merge conflicts on PR #${a.prNumber}`
        : fix?.fixReason === 'checks'
          ? `fixing the failing checks on PR #${a.prNumber}`
          : `fixing PR #${a.prNumber}${fix ? ` after QA round ${fix.round}` : ''}`;
    return `The office server restarted while you were ${job}. Finish the fix, commit, and push with: git push origin HEAD:${a.branch}. ${yours}`;
  }
  if (a.task === 'issue' && a.issueNumber && a.branch) {
    const pr = a.prNumber
      ? `push with: git push origin ${a.branch} to update PR #${a.prNumber}`
      : `push with: git push -u origin ${a.branch}, and open the pull request with "Closes #${a.issueNumber}" (or push to it if it's already open)`;
    return `The office server restarted while you were working on issue #${a.issueNumber}${a.issueTitle ? ` (${a.issueTitle})` : ''} on branch ${a.branch}. Finish it, commit, ${pr}. ${yours}`;
  }
  return 'The office server restarted while you were working. Check the state of your worktree and continue where you left off.';
}
