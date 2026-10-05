// A merge's coins, as the store hears them (a 'reward' event): CoinBurst.tsx bursts them over the author's desk and
// the HUD's coin chip counts them up. Nothing is queued: a reward nobody is listening for is dropped.
import type { RewardView } from '../../../../shared/progress';

const listeners = new Set<(r: RewardView) => void>();

export function onReward(fn: (r: RewardView) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitReward(r: RewardView) {
  for (const fn of listeners) fn(r);
}
