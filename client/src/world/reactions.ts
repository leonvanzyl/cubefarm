// Who should react at their desk when something happens in the office (fidgets.ts plays the reaction): a facepalm
// when their session errors, a fist pump when their PR passes QA, and a wave from the neighbours of someone whose PR
// just merged. Pure: reactionFeed.ts runs these over each store change.

import type { AgentStatus, PullInfo, QaStatus } from '../../../shared/types';

/** Agents whose status just turned to 'error'. */
export function newlyErrored(prev: Record<string, { status: AgentStatus }>, next: Record<string, { status: AgentStatus }>) {
  const out: string[] = [];
  for (const id in next) {
    const was = prev[id];
    if (was && was.status !== 'error' && next[id].status === 'error') out.push(id);
  }
  return out;
}

type Qa = { status: QaStatus; devAgentId: string | null };

/** The developers whose PR just passed QA. */
export function newlyPassed(prev: Record<string, Qa>, next: Record<string, Qa>) {
  const out: string[] = [];
  for (const key in next) {
    const q = next[key];
    if (q.status === 'passed' && prev[key]?.status !== 'passed' && q.devAgentId) out.push(q.devAgentId);
  }
  return out;
}

type Repo = { id: string; pulls: Pick<PullInfo, 'number' | 'state' | 'headRefName'>[] };

/** PRs that were open and are now merged. */
export function newlyMerged(prev: Repo[], next: Repo[]) {
  const out: { repoId: string; number: number; headRefName: string }[] = [];
  for (const r of next) {
    const before = prev.find((p) => p.id === r.id);
    if (!before) continue;
    for (const pr of r.pulls) {
      if (pr.state === 'MERGED' && before.pulls.some((p) => p.number === pr.number && p.state === 'OPEN')) out.push({ repoId: r.id, number: pr.number, headRefName: pr.headRefName });
    }
  }
  return out;
}

type Dev = { id: string; repoId: string; prNumber: number | null; branch: string | null };

/** Who wrote a merged PR: QA's record of it if we saw one, else the agent working on it or its branch. */
export function mergedBy(pr: { repoId: string; number: number; headRefName: string }, qaDev: string | null | undefined, agents: Dev[]) {
  if (qaDev) return qaDev;
  return agents.find((a) => a.repoId === pr.repoId && (a.prNumber === pr.number || (a.branch != null && a.branch === pr.headRefName)))?.id ?? null;
}

/** How far away (metres, seat to seat) a neighbour may sit and still wave: the desks around yours. */
export const NEIGHBOUR_RADIUS = 7.6;

/** Everyone seated within NEIGHBOUR_RADIUS of `id`'s seat, nearest first, at most `max`. */
export function neighboursOf(id: string, seats: ReadonlyMap<string, { seatX: number; seatZ: number }>, max = 4) {
  const me = seats.get(id);
  if (!me) return [];
  const near: { id: string; d: number }[] = [];
  for (const [other, s] of seats) {
    if (other === id) continue;
    const d = Math.hypot(s.seatX - me.seatX, s.seatZ - me.seatZ);
    if (d <= NEIGHBOUR_RADIUS) near.push({ id: other, d });
  }
  return near
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((n) => n.id);
}
