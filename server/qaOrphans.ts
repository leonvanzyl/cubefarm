// QA a restart left behind. A tester is marked done before their report is posted, and the PR only leaves "testing"
// once it is: an office that stops in between comes back with a PR in "testing" that nobody is testing. Startup
// recovery only looks at agents that were busy, the scheduler and "Send to QA" both skip a PR in "testing", and the
// board offers no button for it, so the PR would sit there for good.

export interface OrphanQaRecord {
  repoId: string;
  prNumber: number;
  status: string;
  qaAgentId: string | null;
}

export interface OrphanQaAgent {
  id: string;
  repoId: string;
  status: string;
  task: string | null;
  prNumber: number | null;
}

/**
 * The QA records marked "testing" that no busy agent is testing. Only meaningful when nothing can be mid-way through
 * finishing a QA session, i.e. at startup: while the office runs, a finished tester's report may still be posting.
 */
export function orphanedQa<R extends OrphanQaRecord>(qa: readonly R[], agents: readonly OrphanQaAgent[], busy: readonly string[]): R[] {
  return qa.filter(
    (q) =>
      q.status === 'testing' &&
      !agents.some((a) => a.id === q.qaAgentId && busy.includes(a.status) && a.task === 'qa' && a.repoId === q.repoId && a.prNumber === q.prNumber),
  );
}
