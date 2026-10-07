import type { QaView } from './types.ts';

// Where an open PR stands in the pipeline, for mission control's numbers (server/metrics.ts) and the Kanban's counts
// and cards (client/src/qaCard.ts), so both say the same thing.

/** A PR the office can't move on its own and the CEO has handed on: the only kind that is red and counted as "needs you". */
export const needsManager = (q: Pick<QaView, 'status' | 'ceoLooking'> | null | undefined) => q?.status === 'needs-human' && !q.ceoLooking;

/** inQa: waiting for QA, being tested or not tested yet · fixing: back with an agent · triage: the CEO is looking first. */
export type PrStage = 'inQa' | 'fixing' | 'toMerge' | 'needsYou' | 'triage';

/** The stage of an open PR, from its QA record (none: not tested yet). */
export function prStage(q: Pick<QaView, 'status' | 'ceoLooking'> | null | undefined): PrStage {
  switch (q?.status) {
    case 'passed':
      return 'toMerge';
    case 'failed':
    case 'fixing':
      return 'fixing';
    case 'needs-human':
      return needsManager(q) ? 'needsYou' : 'triage';
    default:
      return 'inQa';
  }
}
