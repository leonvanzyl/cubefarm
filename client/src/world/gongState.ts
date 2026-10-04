import { gong as boom } from '../ui/sfx';
import { celebrating, createGong, strike, type Strike } from './gongRules';

// The merge gong's live state, shared by store.ts (a merge on this floor), Gong.tsx (pressing E; drawing the swing),
// Character.tsx (cheering) and window.__swarmGong (QA and e2e). No three.js here, so the store can import it.

export const gongState = createGong();

/** How loud the boom is, 0-1: the time-lapse plays its merges quieter. */
let volume = 1;

export function setGongVolume(level: number) {
  volume = level;
}

/** Gong.tsx says which floor's gong is on screen (null when it goes). */
export function setGongHere(repoId: string | null) {
  gongState.here = repoId;
}

const partyListeners = new Set<(repoId: string) => void>();

/** Called with the floor's repo whenever a strike starts a celebration there (MergeConfetti.tsx bursts over the gong). */
export function onGongParty(fn: (repoId: string) => void) {
  partyListeners.add(fn);
  return () => void partyListeners.delete(fn);
}

/**
 * Strike the gong on `repoId`'s floor (default: the one on screen): it booms, swings and, with `celebrate`, everyone
 * on the floor cheers and confetti bursts over it. Returns 'absent' when that floor's gong isn't on screen, so the
 * caller can chime instead.
 */
export function hitGong(opts: { repoId?: string | null; celebrate?: boolean } = {}): Strike {
  const result = strike(gongState, performance.now(), opts);
  if (result === 'boom') boom(volume);
  if (result !== 'absent' && opts.celebrate && gongState.celebrateRepo) for (const fn of partyListeners) fn(gongState.celebrateRepo);
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
