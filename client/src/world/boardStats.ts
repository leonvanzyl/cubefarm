// The whiteboard's stats corner, the pure side: what merged today, the average issue → merge time over the last day,
// the QA queue, and whether anything needs the manager. KanbanBoard.tsx works it out on the minute (so it repaints the
// board at most once a minute) and drawKanban paints it.

import type { PullInfo, QaView } from '../../../shared/types';
import { elapsedLabel, needsManager } from '../qaCard';

/** The average looks back this far. */
export const STATS_WINDOW_MS = 24 * 3600_000;
/** The sync lists only the last 8 merged PRs (server/github.ts): when all of them merged today, there may be more. */
export const MERGED_LISTED = 8;

export interface BoardStats {
  mergedToday: number;
  /** Every merged PR the sync lists merged today, so the real count may be higher. */
  more: boolean;
  /** Average time from an issue being filed to its PR merging, over the last day's merges (null: none to go on). */
  avgMs: number | null;
  /** Open PRs waiting for a free QA tester. */
  queue: number;
  /** Open PRs only the manager can move on. */
  needsYou: number;
}

/** The minute `now` falls in: the stats are worked out at that time, so they change at most once a minute. */
export const minuteOf = (now: number) => Math.floor(now / 60_000) * 60_000;

/** Local midnight before `now`. */
export const dayStartOf = (now: number) => new Date(now).setHours(0, 0, 0, 0);

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function boardStats(
  pulls: readonly Pick<PullInfo, 'number' | 'state' | 'mergedAt' | 'issueCreatedAt'>[],
  qaFor: (prNumber: number) => Pick<QaView, 'status' | 'ceoLooking'> | undefined,
  now: number,
  dayStart: number,
): BoardStats {
  const merged = pulls.filter((p) => p.state === 'MERGED' && time(p.mergedAt) !== null);
  const today = merged.filter((p) => time(p.mergedAt)! >= dayStart && time(p.mergedAt)! <= now);
  const spans: number[] = [];
  for (const p of merged) {
    const at = time(p.mergedAt)!;
    const filed = time(p.issueCreatedAt);
    if (filed === null || at > now || now - at > STATS_WINDOW_MS || filed > at) continue;
    spans.push(at - filed);
  }
  let queue = 0;
  let needsYou = 0;
  for (const p of pulls) {
    if (p.state !== 'OPEN') continue;
    const rec = qaFor(p.number);
    if (rec?.status === 'queued') queue++;
    if (needsManager(rec)) needsYou++;
  }
  return {
    mergedToday: today.length,
    more: merged.length >= MERGED_LISTED && today.length === merged.length,
    avgMs: spans.length ? spans.reduce((s, x) => s + x, 0) / spans.length : null,
    queue,
    needsYou,
  };
}

/** The stats corner's chips, left to right. "needs you" only shows when something does, and is red. */
export function statsChips(s: BoardStats): { text: string; alarm?: boolean }[] {
  const out: { text: string; alarm?: boolean }[] = [
    { text: `🎉 ${s.mergedToday}${s.more ? '+' : ''} merged today` },
    { text: `⏱ ${s.avgMs === null ? '–' : elapsedLabel(s.avgMs)} issue → merge` },
    { text: `🔍 ${s.queue} in the QA queue` },
  ];
  if (s.needsYou > 0) out.push({ text: `⚠️ ${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you`, alarm: true });
  return out;
}
