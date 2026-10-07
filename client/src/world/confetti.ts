// Merge confetti, the pure side: which PRs just merged, whose desk the burst goes over, and the
// event the store fires for MergeConfetti.tsx. Nothing is queued: a merge nobody is listening for is dropped.
import type { AgentView, PullInfo, QaView, RepoView } from '../../../shared/types';

export interface MergeBurst {
  repoId: string;
  prNumber: number;
  /** The agent whose desk gets the burst; null sends it over the floor's Kanban board. */
  agentId: string | null;
}

type Author = Pick<AgentView, 'id' | 'name' | 'role' | 'repoId'>;

/** PRs that were open before this repo update and are merged in it. */
export function newlyMerged(before: PullInfo[] | undefined, after: PullInfo[]): PullInfo[] {
  const wasOpen = new Set(before?.filter((p) => p.state === 'OPEN').map((p) => p.number));
  return after.filter((p) => p.state === 'MERGED' && wasOpen.has(p.number));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Who wrote a merged PR: the QA record's author if they're still on the floor, else the agent whose name
 * matches the head branch (`swarm/issue-<n>-<name>`, any case), else nobody.
 */
export function mergeAuthor(repoId: string, pr: Pick<PullInfo, 'headRefName'>, qa: QaView | undefined, agents: Author[]): string | null {
  const team = agents.filter((a) => a.repoId === repoId && a.role !== 'ceo');
  if (qa?.devAgentId && team.some((a) => a.id === qa.devAgentId)) return qa.devAgentId;
  const m = /^swarm\/issue-\d+-(.+)$/i.exec(pr.headRefName);
  if (!m) return null;
  const name = slug(m[1]);
  return team.find((a) => slug(a.name) === name)?.id ?? null;
}

/**
 * The bursts for one `repo` event. `live` is false until the first snapshot, so page loads and
 * reconnects (which arrive as snapshots) never replay old merges.
 */
export function mergeBursts(live: boolean, before: RepoView | undefined, after: RepoView, qaFor: (prNumber: number) => QaView | undefined, agents: Author[]): MergeBurst[] {
  if (!live) return [];
  return newlyMerged(before?.pulls, after.pulls).map((p) => ({ repoId: after.id, prNumber: p.number, agentId: mergeAuthor(after.id, p, qaFor(p.number), agents) }));
}

/**
 * What a burst starting now is: flying confetti, a soft glow that fades in and out where it would fly (with reduced
 * motion), or nothing. A hidden tab or a panel covering the view stops the frame loop, so a burst started then would
 * freeze and play when the view comes back: it's dropped instead.
 */
export const burstKind = (o: { hidden: boolean; covered: boolean; reducedMotion: boolean }): 'confetti' | 'glow' | null =>
  o.hidden || o.covered ? null : o.reducedMotion ? 'glow' : 'confetti';

/** Whether a flying burst (coins, confetti) may start now: not hidden, not covered, and not with reduced motion. */
export const canBurst = (o: { hidden: boolean; covered: boolean; reducedMotion: boolean }) => burstKind(o) === 'confetti';

// ---------- QA records that just left ----------

// The server drops a PR's QA record (qaRemoved) just before it sends the repo update that shows the
// merge, so the store keeps the last few here to still know the author.
const recentQa = new Map<string, QaView>();
const RECENT_KEEP = 30;

export function rememberQa(key: string, q: QaView) {
  recentQa.delete(key);
  recentQa.set(key, q);
  if (recentQa.size > RECENT_KEEP) recentQa.delete(recentQa.keys().next().value!);
}

export const recentQaRecord = (key: string) => recentQa.get(key);

// ---------- the event ----------

const listeners = new Set<(b: MergeBurst) => void>();

export function onMerge(fn: (b: MergeBurst) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitMerge(b: MergeBurst) {
  for (const fn of listeners) fn(b);
}
