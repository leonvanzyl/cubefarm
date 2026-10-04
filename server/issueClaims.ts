import type { PullInfo } from '../shared/types.ts';

// Whether an issue is still free work. A merged PR's issue stays open on GitHub until "Closes #N" catches up (or for
// good, when the link wasn't recognised), so an issue counts as taken while a PR is open for it and as done for a
// while after one merged. The office also closes what it merges itself (issuesResolvedBy).

/** How long a merged PR keeps its issues off the market, however long GitHub takes to close them. */
export const RECENT_MERGE_MS = 6 * 60 * 60_000;

export type ClaimPull = Pick<PullInfo, 'state' | 'headRefName' | 'closesIssues' | 'mergedAt'>;

export interface ClaimAgent {
  role: string;
  task: string | null;
  issueNumber: number | null;
  status: string;
}

/** The issue a swarm/issue-<n>-… branch was cut for. */
export function branchIssue(headRefName: string): number | null {
  const m = /^swarm\/issue-(\d+)-/.exec(headRefName);
  return m ? Number(m[1]) : null;
}

/** Issues a PR resolves: the ones it formally links, plus its swarm/issue-<n>-… branch's (people's branches only link). */
export function issuesResolvedBy(pr: Pick<PullInfo, 'headRefName' | 'closesIssues'>): number[] {
  const n = branchIssue(pr.headRefName);
  return [...new Set(n == null ? pr.closesIssues : [...pr.closesIssues, n])];
}

/** Issue n is taken (a developer is on it, or a PR is open for it) or done (a PR for it merged recently). */
export function issueTaken(n: number, agents: ClaimAgent[], pulls: ClaimPull[], now: number): boolean {
  if (agents.some((a) => a.role === 'dev' && a.task !== 'qa' && a.issueNumber === n && a.status !== 'idle' && a.status !== 'error')) return true;
  return pulls.some((p) => {
    if (p.state === 'CLOSED') return false; // closed without merging: the issue is free again
    if (p.state === 'MERGED' && (!p.mergedAt || now - Date.parse(p.mergedAt) > RECENT_MERGE_MS)) return false;
    return issuesResolvedBy(p).includes(n);
  });
}
