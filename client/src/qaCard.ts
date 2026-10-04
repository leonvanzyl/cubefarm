// How an open PR's QA state reads on a Kanban card (note and colour), and which PRs count as needing the manager.
// Only needs-human is red: failed and fixing go back to the developer by themselves, so they are amber.

import type { PullInfo, QaView } from '../../shared/types';

export type CardTone = 'warn' | 'bad' | 'good';

/** A PR the office can't move on its own: the only kind that is red and counted as "needs you". */
export const needsManager = (q: Pick<QaView, 'status'> | null | undefined) => q?.status === 'needs-human';

/**
 * The note and tone of an open PR's card. mergeNote is only shown where it still means something: on a passed PR
 * waiting to merge, or on one that needs the manager. A note left over from an earlier round never shows while the
 * PR is queued, testing or being fixed.
 */
export function qaCardNote(
  rec: Pick<QaView, 'status' | 'round' | 'mergeNote'> | null | undefined,
  pr: Pick<PullInfo, 'isDraft' | 'mergeable' | 'checks'>,
  autoMerge: boolean,
): { note: string; tone?: CardTone } {
  switch (rec?.status) {
    case 'passed':
      return {
        note: rec.mergeNote
          ? `QA ✓ · ${rec.mergeNote}`
          : pr.mergeable === 'CONFLICTING'
            ? 'QA ✓ · conflicts'
            : pr.checks === 'failing'
              ? 'QA ✓ · CI failing'
              : autoMerge && pr.checks === 'pending'
                ? 'QA ✓ · waiting for checks'
                : '✅ QA passed',
        tone: pr.mergeable === 'CONFLICTING' || pr.checks === 'failing' ? 'warn' : 'good',
      };
    case 'needs-human':
      return { note: `⚠️ needs you${rec.mergeNote ? ` · ${rec.mergeNote}` : ''}`, tone: 'bad' };
    case 'failed':
      return { note: '🔧 back to the developer', tone: 'warn' };
    case 'fixing':
      return { note: `🔧 fixing · round ${rec.round}`, tone: 'warn' };
    case 'testing':
      return { note: `🔍 testing · round ${rec.round}` };
    case 'queued':
      return { note: `waiting for QA${rec.round > 1 ? ` · round ${rec.round}` : ''}` };
    default:
      return { note: pr.isDraft ? 'draft' : 'not tested yet', tone: 'warn' };
  }
}

/** How long a test has been running, as the whiteboard says it: "<1 min", "12 min", "1 h 5 min". */
export function elapsedLabel(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return '<1 min';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * What a card out for testing says on the 3D whiteboard: who has it (`who`), and its round and how long the test has
 * run (`meta`, longest wording first, so the board can use the first that fits). `since` is when the test started (the
 * QA record's updatedAt: nothing changes it while a test runs); without a usable one no time is shown.
 */
export function testingLabel(tester: string | undefined, round: number, since: number | null | undefined, now: number): { who: string; meta: string[] } {
  const who = tester ? `🔍 ${tester} · testing` : '🔍 testing';
  const time = since != null && Number.isFinite(since) && since > 0 && since <= now + 60_000 ? elapsedLabel(now - since) : null;
  const r = round >= 1 ? round : null;
  if (r && time) return { who, meta: [`round ${r} · ${time}`, `R${r} · ${time}`, time] };
  if (r) return { who, meta: [`round ${r}`, `R${r}`] };
  return { who, meta: time ? [time] : [] };
}
