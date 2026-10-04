// When the issues behind recently merged PRs were filed, for the whiteboard's "issue → merge" time. A merge closes
// its issue, so the office remembers when each issue it saw open was filed, and looks up (once) the few merged in the
// last day that it never saw, e.g. after a restart. Kept in memory only: it's a statistic, not state.

import type { IssueInfo, PullInfo } from '../shared/types.ts';

/** How far back the whiteboard's average reaches. */
export const MERGE_WINDOW_MS = 24 * 3600_000;

const parse = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export class IssueAges {
  private born = new Map<string, number>(); // `${repoId}#${issue}` → when it was filed (ms)
  private asked = new Set<string>();

  /** Remember when the open issues were filed. */
  learn(repoId: string, issues: Pick<IssueInfo, 'number' | 'createdAt'>[]) {
    for (const i of issues) this.know(repoId, i.number, i.createdAt);
  }

  know(repoId: string, issue: number, createdAt: string | null | undefined) {
    const t = parse(createdAt);
    if (t !== null) this.born.set(`${repoId}#${issue}`, t);
  }

  /** Issues closed by PRs merged in the last day whose filing time isn't known and hasn't been asked for yet. */
  wanted(repoId: string, pulls: Pick<PullInfo, 'state' | 'mergedAt' | 'closesIssues'>[], now: number): number[] {
    const out = new Set<number>();
    for (const p of pulls) {
      const merged = parse(p.mergedAt);
      if (p.state !== 'MERGED' || merged === null || now - merged > MERGE_WINDOW_MS) continue;
      for (const n of p.closesIssues) if (!this.born.has(`${repoId}#${n}`) && !this.asked.has(`${repoId}#${n}`)) out.add(n);
    }
    for (const n of out) this.asked.add(`${repoId}#${n}`);
    return [...out];
  }

  /** Sets each PR's issueCreatedAt: when the earliest issue it closes was filed, or null when none is known. */
  stamp(repoId: string, pulls: PullInfo[]) {
    for (const p of pulls) {
      const times = p.closesIssues.map((n) => this.born.get(`${repoId}#${n}`)).filter((t): t is number => t !== undefined);
      p.issueCreatedAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
    }
  }
}
