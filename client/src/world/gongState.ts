import { gong as boom } from '../ui/sfx';
import { celebrating, createGong, strike, type Strike } from './gongRules';

// The merge gong's live state, shared by store.ts (a merge on this floor), Gong.tsx (pressing E; drawing the swing),
// Character.tsx (cheering) and window.__swarmGong (QA and e2e). No three.js here, so the store can import it.

export const gongState = createGong();

/** Gong.tsx says which floor's gong is on screen (null when it goes). */
export function setGongHere(repoId: string | null) {
  gongState.here = repoId;
}

/**
 * Strike the gong on `repoId`'s floor (default: the one on screen): it booms, swings and, with `celebrate`, everyone
 * on the floor cheers. Returns 'absent' when that floor's gong isn't on screen, so the caller can chime instead.
 */
export function hitGong(opts: { repoId?: string | null; celebrate?: boolean } = {}): Strike {
  const result = strike(gongState, performance.now(), opts);
  if (result === 'boom') boom();
  return result;
}

/** Whether the agents of `repoId` are celebrating a merge (`now` is performance.now()). */
export const isCelebrating = (repoId: string, now: number) => celebrating(gongState, repoId, now);

// For QA and e2e: __swarmGong.hit({ celebrate: true }) strikes the gong on screen, __swarmGong.hits() counts the booms.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmGong = {
    hit: (opts?: { celebrate?: boolean }) => void hitGong({ celebrate: opts?.celebrate === true }),
    hits: () => gongState.hits,
  };
}
