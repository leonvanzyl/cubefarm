import { GONG_GAP_MS } from './gongRules';
import type { Pt } from './toys/roombaBrain';

// The gong run's rules, free of three.js and the frame loop so they can be tested: whether a merge sends its author
// running to the gong or the gong strikes by itself, the queue (one person at the gong at a time, one boom per merge,
// in order), the beats at the gong and when to give up. gongRunner.ts drives the bodies and the strikes from these.

/** Running to the gong (m/s); body.ts's walk is 1.1. */
export const RUN_SPEED = 2.8;
/** Hurrying back to their desk afterwards. */
export const HURRY_SPEED = 1.9;
/** Not at the gong this long after setting off (path blocked, tab hidden): the gong strikes by itself. The farthest
 * desk is about 26 m away, some 13 s with getting up and the corners. */
export const REACH_MS = 18_000;
/** How long each beat at the gong lasts (ms): take the mallet, wind up, the strike, the victory pose. */
export const BEATS = { take: 600, windup: 450, strike: 300, pose: 1600 };

/** What a merge does with the gong: the author runs to it, it strikes by itself, or there's no gong on screen. */
export type GongPlan = 'run' | 'solo' | 'absent';

/**
 * What a merge on `repoId` does, given the floor whose gong is on screen (`here`). The author runs only when they're
 * drawn on this floor and the view is showing (a hidden tab or a covering panel stops the frame loop, so a run would
 * freeze); otherwise the gong strikes by itself, so a merge is never silent.
 */
export function planGong(o: { repoId: string | null; here: string | null; agentId: string | null; present: boolean; covered: boolean; elsewhere?: boolean }): GongPlan {
  if (!o.repoId || o.repoId !== o.here) return 'absent';
  return o.agentId && o.present && !o.covered && !o.elsewhere ? 'run' : 'solo';
}

/**
 * Whether someone else is moving this person by hand (__swarmPeople.walkTo): they're up with a body target (people.ts)
 * that isn't the one a run of ours (`mine`) last set. Their merge then strikes the gong by itself, and a run whose
 * runner is taken over this way lets them go, so it never drags them off what they were doing or sits them back down
 * afterwards. An errand from the errand director (`errand`) doesn't count: the gong beats it, and the run claims them.
 */
export const elsewhere = (target: object | undefined, mine: object | undefined, errand = false) => !!target && target !== mine && !errand;

/** Whether a run has lost its runner to someone else: their body target is no longer the one it last set (or gone). */
export const takenOver = (r: GongRun, target: object | undefined) => target !== r.mine;

/** The run moving this person, to the gong or back from it, if any. */
export const runOf = (q: GongRuns, agentId: string) => (q.run?.agentId === agentId ? q.run : q.home.find((h) => h.agentId === agentId));

/** One merge waiting for the gong: `agentId` runs over and strikes it, or null strikes it by itself. */
export interface GongJob {
  agentId: string | null;
  celebrate: boolean;
}

export type Beat = 'run' | 'take' | 'windup' | 'strike' | 'pose' | 'back';

export interface GongRun {
  agentId: string;
  celebrate: boolean;
  beat: Beat;
  /** performance.now() when this beat started, and when they set off. */
  since: number;
  started: number;
  /** The waypoints of the current walk (to the gong, or back to their desk) and the one they're heading for. */
  legs: Pt[];
  leg: number;
  /** The body target (people.ts) this run last gave them; undefined once it has sat them down. */
  mine?: object;
}

export interface GongRuns {
  queue: GongJob[];
  /** The one person on their way to the gong or at it. */
  run: GongRun | null;
  /** Runners on their way back to their desks. */
  home: GongRun[];
}

export const createRuns = (): GongRuns => ({ queue: [], run: null, home: [] });

/** Whether the gong would boom if struck now (not still ringing from the last strike, `hitAt`). */
export const gongFree = (now: number, hitAt: number) => now - hitAt >= GONG_GAP_MS;

/**
 * The next merge to deal with, taken off the queue, or null to wait: while someone is on their way to the gong or at
 * it, nobody else goes; a strike by itself also waits until the gong would boom again, so each merge gets its own.
 */
export function nextJob(q: GongRuns, now: number, hitAt: number): GongJob | null {
  const job = q.queue[0];
  if (!job || q.run) return null;
  if (!job.agentId && !gongFree(now, hitAt)) return null;
  return q.queue.shift()!;
}

export function startRun(job: GongJob & { agentId: string }, now: number, legs: Pt[]): GongRun {
  return { agentId: job.agentId, celebrate: job.celebrate, beat: 'run', since: now, started: now, legs, leg: 0 };
}

/**
 * Whether a run should give up and let the gong strike by itself: not at the gong within REACH_MS of setting off.
 * Once they're there, the take, wind-up and strike always play out, so the boom lands with the mallet.
 */
export const timedOut = (r: GongRun, now: number) => r.beat === 'run' && now - r.started > REACH_MS;

/**
 * The beat after this one at the gong once it's time, or null to stay. The wind-up holds until the gong would boom,
 * so a run right after another merge's strike still gets its own boom. 'run' and 'back' end on arrival (the driver).
 */
export function nextBeat(r: GongRun, now: number, hitAt: number): Beat | null {
  const t = now - r.since;
  switch (r.beat) {
    case 'take':
      return t >= BEATS.take ? 'windup' : null;
    case 'windup':
      return t >= BEATS.windup && gongFree(now, hitAt) ? 'strike' : null;
    case 'strike':
      return t >= BEATS.strike ? 'pose' : null;
    case 'pose':
      return t >= BEATS.pose ? 'back' : null;
    default:
      return null;
  }
}

/** Whether the runner holds the mallet (it's off its hook) in this beat. */
export const holdsMallet = (b: Beat) => b === 'windup' || b === 'strike' || b === 'pose';

/** Anything left to do: a run, someone on their way back, or merges waiting. */
export const busy = (q: GongRuns) => q.run !== null || q.home.length > 0 || q.queue.length > 0;

/** Yaw for a body (body.ts: 0 faces -Z) walking from `a` towards `b`. */
export const headingTo = (a: Pt, b: Pt) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
