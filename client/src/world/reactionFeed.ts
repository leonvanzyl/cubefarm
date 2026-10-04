// Watches the store for the moments people react to at their desk (reactions.ts) and queues a fidget for each
// person, which Character.tsx picks up on its next frame. window.__swarmDeskLife plays any fidget by hand and lists
// what everyone is doing, for QA.

import { useStore } from '../store';
import type { DeskLife, Fidget } from './fidgets';
import { liveBodies } from './people';
import { mergedBy, neighboursOf, newlyErrored, newlyMerged, newlyPassed } from './reactions';

export interface Queued {
  fidget: Fidget;
  /** For a wave: where (world x/z) the one they wave to sits. */
  x: number;
  z: number;
  /** When it was queued (ms); people who aren't drawn (another floor) never take it, so it goes stale. */
  at: number;
}

const STALE_MS = 3000;

const queue = new Map<string, Queued>();
const lives = new Map<string, DeskLife>();
/** The last few queued, newest last, for the probe. */
const recent: { id: string; fidget: Fidget; at: number }[] = [];
/** Who wrote each PR QA has seen (`${repoId}#${number}`), kept after QA lets go of it, for when it merges. */
const devOf = new Map<string, string>();

/** The fidget queued for this person, if any and still fresh; taking it clears it. */
export function takeReaction(id: string, now = Date.now()) {
  const q = queue.get(id);
  if (!q) return undefined;
  queue.delete(id);
  return now - q.at < STALE_MS ? q : undefined;
}

export function queueFidget(id: string, fidget: Fidget, x = 0, z = 0) {
  const at = Date.now();
  queue.set(id, { fidget, x, z, at });
  recent.push({ id, fidget, at });
  if (recent.length > 30) recent.shift();
}

/** Character.tsx registers each person's fidget schedule, so the probe can report it. */
export function trackLife(id: string, s: DeskLife) {
  lives.set(id, s);
  return () => {
    if (lives.get(id) === s) lives.delete(id);
  };
}

useStore.subscribe((state, prev) => {
  if (!prev.loaded) return; // the first snapshot: nothing just happened
  if (state.qa !== prev.qa) {
    for (const key in state.qa) {
      const dev = state.qa[key].devAgentId;
      if (dev) devOf.set(key, dev);
    }
    for (const id of newlyPassed(prev.qa, state.qa)) queueFidget(id, 'fistPump');
  }
  if (state.agents !== prev.agents) for (const id of newlyErrored(prev.agents, state.agents)) queueFidget(id, 'facepalm');
  if (state.repos !== prev.repos) {
    const merged = newlyMerged(prev.repos, state.repos);
    if (!merged.length) return;
    const agents = [...Object.values(prev.agents), ...Object.values(state.agents)];
    const seats = liveBodies();
    for (const pr of merged) {
      const dev = mergedBy(pr, devOf.get(`${pr.repoId}#${pr.number}`), agents);
      const seat = dev ? seats.get(dev) : undefined;
      if (!dev || !seat) continue;
      for (const n of neighboursOf(dev, seats)) queueFidget(n, 'wave', seat.seatX, seat.seatZ);
    }
  }
});

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmDeskLife = {
    /** Plays a fidget at someone's desk now; a wave goes to `towardId`'s seat. */
    play(id: string, fidget: Fidget, towardId?: string) {
      const s = towardId ? liveBodies().get(towardId) : undefined;
      queueFidget(id, fidget, s?.seatX ?? 0, s?.seatZ ?? 0);
    },
    /** What everyone drawn is up to: their mood and current fidget (null: none). */
    list() {
      return [...lives].map(([id, s]) => ({ id, mood: s.mood, fidget: s.fidget }));
    },
    /** The reactions (and fidgets played by hand) queued lately. */
    recent: () => [...recent],
  };
}
