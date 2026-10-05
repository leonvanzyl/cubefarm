import type { MergeBurst } from './confetti';
import { HURRY_SPEED, RUN_SPEED, busy, createRuns, elsewhere, headingTo, holdsMallet, nextBeat, nextJob, planGong, runOf, startRun, takenOver, timedOut, type GongJob, type GongPlan, type GongRun } from './gongRun';
import { gongState, hitGong } from './gongState';
import { GONG, GONG_SPOT } from './layout';
import { bodyState, bodyTarget, claimBody, onErrand, seatBody, setBody } from './people';
import type { BodyState, BodyTarget } from './body';
import type { Pt } from './toys/roombaBrain';
import { findPath, walkways } from './walkways';

// The gong run, live: a merge on the player's floor (store.ts) or __swarmGong.run() sends someone running to the gong
// along the walkways, where they take the mallet, strike (gongState.ts: the boom and the celebration), cheer and
// hurry back to their desk. The rules are in gongRun.ts; this moves bodies through people.ts. Gong.tsx pumps it every
// frame, and a coarse timer keeps it going while frames stop (a hidden tab), so a stalled run still ends in a boom.

const runs = createRuns();
const CORNER = 0.4; // m: head for the next waypoint this far short of one, so the run doesn't stop at every corner
const ARRIVED = 0.15;
const NORTH = 0; // body.ts heading facing -Z: the gong
// Where the runner strikes from: a step closer than GONG_SPOT, so the mallet reaches the disc.
const STRIKE = { x: GONG.x, z: GONG.z + 1 };
let timer: ReturnType<typeof setInterval> | null = null;
let heldAt: number | null = null; // performance.now() when photo mode froze the office, or null

/** Who has the mallet off its hook right now, or null. Read every frame by Character.tsx and Gong.tsx. */
export const malletHolder = () => (runs.run && holdsMallet(runs.run.beat) ? runs.run.agentId : null);

/**
 * A PR merged: queue its author's run to the gong, or a strike by itself. 'absent' when that floor's gong isn't on
 * screen, so the caller chimes instead. `covered`: a panel covers the 3D view.
 */
export function gongForMerge(b: MergeBurst, covered: boolean): GongPlan {
  return plan(b.repoId, b.agentId, true, covered);
}

function plan(repoId: string | null, agentId: string | null, celebrate: boolean, covered: boolean): GongPlan {
  const hidden = typeof document !== 'undefined' && document.hidden;
  const p = planGong({ repoId, here: gongState.here, agentId, present: !!agentId && !!bodyState(agentId), covered: covered || hidden, elsewhere: !!agentId && othersMove(agentId) });
  if (p === 'absent') return p;
  runs.queue.push({ agentId: p === 'run' ? agentId : null, celebrate });
  pumpGongRuns(performance.now());
  keepPumping();
  return p;
}

function keepPumping() {
  if (busy(runs) && !timer && heldAt === null) timer = setInterval(() => pumpGongRuns(performance.now()), 250);
}

/**
 * Photo mode's freeze: holds every run where it is (no strikes, no giving up) and, when released, moves their clocks
 * and the gong's on by the pause, so they carry on as if no time had passed. Merges meanwhile wait in the queue.
 */
export function holdGongRuns(on: boolean, now = performance.now()) {
  if (on) {
    if (heldAt === null) heldAt = now;
    stopTimer();
    return;
  }
  if (heldAt === null) return;
  const paused = now - heldAt;
  heldAt = null;
  for (const r of runs.run ? [runs.run, ...runs.home] : runs.home) {
    r.since += paused;
    r.started += paused;
  }
  gongState.hitAt += paused;
  gongState.celebrateUntil += paused;
  keepPumping();
}

/** Drops every queued and running trip, sending the runners back to their seats (the gong's floor went away). */
export function resetGongRuns() {
  if (runs.run) release(runs.run);
  for (const r of runs.home) release(r);
  runs.queue.length = 0;
  runs.home.length = 0;
  runs.run = null;
  stopTimer();
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------- whose body it is ----------

/** Whether someone other than the gong run or the errand director is moving them right now (by hand). */
const othersMove = (agentId: string) => elsewhere(bodyTarget(agentId), runOf(runs, agentId)?.mine, onErrand(agentId));

/** Moves the runner, remembering the target so a takeover by someone else shows (gongRun.ts takenOver). */
function move(r: GongRun, patch: Partial<Omit<BodyTarget, 'teleport'>>) {
  setBody(r.agentId, patch);
  r.mine = bodyTarget(r.agentId);
}

/** Back to their chair, unless someone else has them now. */
function release(r: GongRun) {
  if (!takenOver(r, bodyTarget(r.agentId))) seatBody(r.agentId);
  r.mine = undefined;
}

// ---------- walking the legs ----------

/** Sends the runner towards their current waypoint: along the leg, or turning to `end` at the last one. */
function aim(r: GongRun, speed: number, end: number) {
  const p = r.legs[r.leg];
  const heading = r.leg === r.legs.length - 1 ? end : headingTo(r.legs[r.leg - 1], p);
  move(r, { mode: 'walking', x: p.x, z: p.z, speed, heading, gesture: 'none' });
}

/** Moves on to the next waypoint when they're near this one; true once they've reached the last. */
function follow(r: GongRun, s: Readonly<BodyState>, speed: number, end: number) {
  const p = r.legs[r.leg];
  const last = r.leg === r.legs.length - 1;
  if (s.stage !== 'up' || Math.hypot(p.x - s.x, p.z - s.z) > (last ? ARRIVED : CORNER)) return false;
  if (last) return true;
  r.leg++;
  aim(r, speed, end);
  return false;
}

/** A walk from `from` along the walkways: [from, ...waypoints], or null when there's no way through. */
function route(from: Pt, to: Pt): Pt[] | null {
  const path = findPath(walkways('office'), from, to);
  return path && path.length ? [from, ...path] : null;
}

// ---------- the trip ----------

function start(job: GongJob & { agentId: string }, now: number) {
  // the gong beats any errand: the director lets them go, and they set off from wherever they are
  if (onErrand(job.agentId)) claimBody(job.agentId);
  const s = othersMove(job.agentId) ? undefined : bodyState(job.agentId);
  // Seated, they get up to the spot beside their chair first; plan from there.
  const from = s && (s.stage === 'seated' || s.stage === 'rising' ? { x: s.standX, z: s.standZ } : { x: s.x, z: s.z });
  const legs = from && route(from, GONG_SPOT);
  if (!legs) {
    // they left, someone else has them now, or no way through: it strikes by itself
    runs.queue.unshift({ agentId: null, celebrate: job.celebrate });
    return;
  }
  const i = runs.home.findIndex((h) => h.agentId === job.agentId);
  if (i >= 0) runs.home.splice(i, 1); // turned round on the way back from the last one
  const r = startRun(job, now, legs);
  r.mine = bodyTarget(job.agentId);
  r.leg = 1;
  runs.run = r;
  aim(r, RUN_SPEED, NORTH);
}

function goHome(r: GongRun, s: Readonly<BodyState>, now: number) {
  r.beat = 'back';
  r.since = now;
  const legs = route({ x: s.x, z: s.z }, { x: s.standX, z: s.standZ });
  if (legs) {
    r.legs = legs;
    r.leg = 1;
    aim(r, HURRY_SPEED, s.seatHeading);
  } else {
    r.legs = [];
    r.leg = 0;
    release(r); // straight back to their chair
  }
  runs.home.push(r);
}

function step(r: GongRun, now: number) {
  const s = bodyState(r.agentId);
  const struck = r.beat === 'strike' || r.beat === 'pose';
  const taken = takenOver(r, bodyTarget(r.agentId));
  if (!s || taken || (!struck && timedOut(r, now))) {
    // gone from the floor, taken over (by hand) or not there in time: the gong strikes by itself, and they head
    // back unless someone else has them now
    runs.run = null;
    if (!struck) runs.queue.unshift({ agentId: null, celebrate: r.celebrate });
    if (s && !taken) goHome(r, s, now);
    else release(r);
    return;
  }
  if (r.beat === 'run') {
    if (!follow(r, s, RUN_SPEED, NORTH)) return;
    r.beat = 'take';
    r.since = now;
    move(r, { mode: 'standing', x: STRIKE.x, z: STRIKE.z, heading: NORTH, speed: 1, gesture: 'take' });
    return;
  }
  const next = nextBeat(r, now, gongState.hitAt);
  if (!next) return;
  r.beat = next;
  r.since = now;
  if (next === 'windup') move(r, { gesture: 'windup' });
  else if (next === 'strike') {
    move(r, { gesture: 'strike' });
    hitGong({ celebrate: r.celebrate }); // the mallet lands
  } else if (next === 'pose') move(r, { gesture: 'cheer' });
  else if (next === 'back') {
    runs.run = null;
    goHome(r, s, now);
  }
}

/** Moves every trip along; Gong.tsx calls it each frame. Allocates nothing unless something changes. */
export function pumpGongRuns(now: number) {
  if (heldAt !== null) return;
  if (!busy(runs)) return stopTimer();
  for (let i = runs.home.length - 1; i >= 0; i--) {
    const r = runs.home[i];
    const s = bodyState(r.agentId);
    if (!s || takenOver(r, bodyTarget(r.agentId))) {
      release(r); // gone from the floor, or someone else has them now: theirs to finish
      runs.home.splice(i, 1);
    } else if (r.leg >= r.legs.length) {
      if (s.stage === 'seated') runs.home.splice(i, 1);
    } else if (follow(r, s, HURRY_SPEED, s.seatHeading)) {
      release(r); // the last step: to the spot beside the chair, and sit
      r.leg = r.legs.length;
    }
  }
  if (runs.run) step(runs.run, now);
  for (let job = nextJob(runs, now, gongState.hitAt); job; job = nextJob(runs, now, gongState.hitAt)) {
    if (job.agentId) start(job as GongJob & { agentId: string }, now);
    else hitGong({ celebrate: job.celebrate });
  }
}

// For QA and e2e: __swarmGong.run(agentId) sends someone on this floor to strike the gong (it strikes by itself when
// they can't go; returns which), __swarmGong.running() is true until every runner is back in their chair.
if (typeof window !== 'undefined') {
  const probe = (window as unknown as Record<string, Record<string, unknown> | undefined>).__swarmGong;
  if (probe)
    Object.assign(probe, {
      run: (agentId: string, opts?: { celebrate?: boolean }) => plan(gongState.here, agentId, opts?.celebrate === true, false),
      running: () => busy(runs),
    });
}
