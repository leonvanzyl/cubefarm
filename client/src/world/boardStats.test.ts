import { describe, expect, it } from 'vitest';
import type { PullInfo, QaStatus } from '../../../shared/types';
import { boardStats, dayStartOf, MERGED_LISTED, minuteOf, statsChips } from './boardStats';

const NOW = new Date(2026, 9, 4, 15, 30, 20).getTime(); // 15:30:20 local time
const MIDNIGHT = new Date(2026, 9, 4).getTime();
const H = 3600_000;
const iso = (t: number) => new Date(t).toISOString();
type P = Pick<PullInfo, 'number' | 'state' | 'mergedAt' | 'issueCreatedAt'>;
const merged = (number: number, mergedAgo: number, filedBefore: number | null = null): P => ({
  number,
  state: 'MERGED',
  mergedAt: iso(NOW - mergedAgo),
  issueCreatedAt: filedBefore === null ? null : iso(NOW - mergedAgo - filedBefore),
});
const open = (number: number): P => ({ number, state: 'OPEN', mergedAt: null, issueCreatedAt: null });
const none = () => undefined;

describe('boardStats', () => {
  it('counts what merged since midnight', () => {
    const s = boardStats([merged(1, H), merged(2, 2 * H), merged(3, 16 * H), open(4)], none, NOW, MIDNIGHT);
    expect(s.mergedToday).toBe(2);
    expect(s.more).toBe(false);
  });

  it('says there may be more when every merged PR the sync lists is from today', () => {
    const all = Array.from({ length: MERGED_LISTED }, (_, i) => merged(i + 1, (i + 1) * 60_000));
    expect(boardStats(all, none, NOW, MIDNIGHT)).toMatchObject({ mergedToday: MERGED_LISTED, more: true });
  });

  it('averages issue → merge over the last day, leaving out merges it has no issue time for', () => {
    const s = boardStats([merged(1, H, 2 * H), merged(2, 3 * H, 4 * H), merged(3, 5 * H), merged(4, 30 * H, 1 * H)], none, NOW, MIDNIGHT);
    expect(s.avgMs).toBe(3 * H);
    expect(boardStats([merged(3, 5 * H)], none, NOW, MIDNIGHT).avgMs).toBeNull();
    expect(boardStats([], none, NOW, MIDNIGHT).avgMs).toBeNull();
  });

  it('counts the QA queue and what needs the manager, among open PRs only', () => {
    const recs: Record<number, { status: QaStatus; ceoLooking: boolean }> = {
      1: { status: 'queued', ceoLooking: false },
      2: { status: 'queued', ceoLooking: false },
      3: { status: 'needs-human', ceoLooking: false },
      4: { status: 'needs-human', ceoLooking: true }, // the CEO is triaging it first
      5: { status: 'testing', ceoLooking: false },
      6: { status: 'queued', ceoLooking: false },
    };
    const pulls = [open(1), open(2), open(3), open(4), open(5), merged(6, H)];
    expect(boardStats(pulls, (n) => recs[n], NOW, MIDNIGHT)).toMatchObject({ queue: 2, needsYou: 1 });
  });
});

describe('statsChips', () => {
  it('reads like the board shows it, with "needs you" in red only when something does', () => {
    expect(statsChips({ mergedToday: 3, more: false, avgMs: 2 * H + 10 * 60_000, queue: 2, needsYou: 0 })).toEqual([
      { text: '🎉 3 merged today' },
      { text: '⏱ 2 h 10 min issue → merge' },
      { text: '🔍 2 in the QA queue' },
    ]);
    expect(statsChips({ mergedToday: 8, more: true, avgMs: null, queue: 0, needsYou: 1 })).toEqual([
      { text: '🎉 8+ merged today' },
      { text: '⏱ – issue → merge' },
      { text: '🔍 0 in the QA queue' },
      { text: '⚠️ 1 needs you', alarm: true },
    ]);
    expect(statsChips({ mergedToday: 0, more: false, avgMs: null, queue: 0, needsYou: 2 }).at(-1)).toEqual({ text: '⚠️ 2 need you', alarm: true });
  });
});

describe('the minute and the day', () => {
  it('works the stats out on the minute, so they change at most once a minute', () => {
    expect(minuteOf(NOW)).toBe(new Date(2026, 9, 4, 15, 30).getTime());
    expect(minuteOf(NOW + 39_000)).toBe(minuteOf(NOW));
    expect(minuteOf(NOW + 40_000)).toBe(minuteOf(NOW) + 60_000);
    expect(dayStartOf(NOW)).toBe(MIDNIGHT);
  });
});
