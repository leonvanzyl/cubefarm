// The merge gong's rules, free of three.js and WebAudio so they can be tested: how often it can be struck, who
// celebrates and for how long, and how the disc swings after a strike. Which repo updates are merges is confetti.ts's.

/** At most one strike this often (ms). The boom rings for ~6 s; spamming E in between does nothing. */
export const GONG_GAP_MS = 1500;
/** How long everyone on the floor cheers after a merge (ms). */
export const CELEBRATE_MS = 6000;

export interface GongState {
  /** The repo whose floor's gong is on screen (only the player's floor is drawn), or null. */
  here: string | null;
  /** performance.now() of the last strike that boomed. */
  hitAt: number;
  hits: number;
  celebrateRepo: string | null;
  celebrateUntil: number;
}

export const createGong = (): GongState => ({ here: null, hitAt: -Infinity, hits: 0, celebrateRepo: null, celebrateUntil: -Infinity });

/** What a strike did: boomed, nothing because the gong is still ringing from the last one, or no gong on that floor. */
export type Strike = 'boom' | 'ringing' | 'absent';

/**
 * Strike the gong on `repoId`'s floor (default: the one on screen). Only the gong on screen can be struck. A
 * celebration starts (or carries on) even while the gong is still ringing, so a merge right after a playful hit
 * still gets its party.
 */
export function strike(g: GongState, now: number, { repoId = g.here, celebrate = false }: { repoId?: string | null; celebrate?: boolean } = {}): Strike {
  if (!repoId || repoId !== g.here) return 'absent';
  if (celebrate) {
    g.celebrateRepo = repoId;
    g.celebrateUntil = now + CELEBRATE_MS;
  }
  if (now - g.hitAt < GONG_GAP_MS) return 'ringing';
  g.hitAt = now;
  g.hits++;
  return 'boom';
}

export const celebrating = (g: GongState, repoId: string, now: number) => repoId === g.celebrateRepo && now < g.celebrateUntil;

// ---------- the swing ----------

/** The disc's damped swing (radians about the crossbar; + swings the bottom back towards the wall) and twist. */
export const SWING = { amp: 0.26, hz: 0.85, decay: 1.5, twistAmp: 0.07, twistHz: 2.3, twistDecay: 0.9, settle: 6 };

/** The swing angle `t` seconds after a strike: pushed back by the hit, then rocking to rest. */
export const swingAngle = (t: number) => (t < 0 || t > SWING.settle ? 0 : SWING.amp * Math.exp(-t / SWING.decay) * Math.sin(2 * Math.PI * SWING.hz * t));

/** The disc's wobble (radians about its own axis and the vertical) `t` seconds after a strike. */
export const twistAngle = (t: number) => (t < 0 || t > SWING.settle ? 0 : SWING.twistAmp * Math.exp(-t / SWING.twistDecay) * Math.sin(2 * Math.PI * SWING.twistHz * t));

/** The bright flash on the disc's face, 0-1: a sharp flash at the strike, then a faint shimmer while it rings. */
export const flashLevel = (t: number) =>
  t < 0 || t > SWING.settle ? 0 : Math.min(1, Math.exp(-t / 0.18) + 0.25 * Math.exp(-t / 1.8) * (0.5 + 0.5 * Math.sin(t * 15)));
