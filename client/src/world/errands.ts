// Errands: the reasons people leave their desk. An errand is a walk to a named spot (walkways.ts), a few gestures
// there, maybe something carried, and a walk back to sit down. This is the pure part: the registry later issues add
// to, who may go when, the walker cap, the per-person queue and following a path. ErrandDirector.tsx runs it on the
// floor you're on. Purely cosmetic: nothing here touches the store or the server.

import type { AgentStatus } from '../../../shared/types';
import type { Gesture } from './body';
import type { Pt } from './toys/roombaBrain';
import type { FloorKind, Spot } from './walkways';

/** What an errand needs to know about someone. */
export interface ErrandAgent {
  id: string;
  status: AgentStatus;
  role: string;
}

/** Someone else on the floor, where their desk is. */
export interface ErrandPeer extends ErrandAgent {
  home: Spot;
}

/** What the director knows about someone, for `when`. Seconds are the director's clock (it stops with the render). */
export interface ErrandState {
  floor: FloorKind;
  /** Seconds since their status last changed (counted from when you arrived on the floor). */
  statusFor: number;
  /** Seconds sat at their desk since they last came back (or since you arrived). */
  seatedFor: number;
  /** How long they sit before getting restless: drawn afresh each time they sit down. */
  restless: number;
  /** Their own desk's spot, and everyone else on the floor (for errands to a teammate). */
  home?: Spot;
  others?: readonly ErrandPeer[];
}

export interface ErrandStep {
  gesture: Gesture;
  seconds: number;
  /** Look this far (radians, + to their left) away from the spot's facing, for a look around. */
  turn?: number;
  /** Turn to the nearest teammate instead (a wave hello). */
  face?: 'peer';
  /** Say something: a small emoji bubble over their head (chats). */
  say?: boolean;
  /** Walk to this spot first (a few steps, say along the board); the step lasts at least as long as the walk. */
  to?: (agentId: string) => string | null;
  /** Passed to the errand's `cue` as the step starts. */
  cue?: string;
}

export interface Errand {
  name: string;
  /** Short, work-related errands (the board, QA): they may start while preparing and finish while working. */
  work?: boolean;
  /** Does this person want to go now? Checked every half second or so while they're at their desk. */
  when(agent: ErrandAgent, state: ErrandState): boolean;
  /** Where to: spot ids from walkways.ts; `prefix*` matches every spot starting with prefix. Nearer ones win. */
  spot: readonly string[];
  /** A spot of its own instead of `spot` (beside a teammate, say); null when there's nowhere to go. */
  place?(agent: ErrandAgent, state: ErrandState): Spot | null;
  /** What they do once there, in order. */
  steps: readonly ErrandStep[];
  /** What their hands do on the walk back (carrying something). */
  carry?: Gesture;
  /** How likely this one is picked when several idle errands are wanted at once (default 1). */
  weight?: number;
  /** ...and on the walk there. */
  bring?: Gesture;
  /** Walking speed (m/s) there and back, when it's brisker than a stroll. */
  speed?: number;
  /** Work errands that may still start this many seconds into 'working' (a tester fetching the PR they were just given). */
  grace?: number;
  /** Where to for this person, overriding `spot` (an errand to one particular board column). */
  where?(agentId: string): readonly string[];
  /** Asked just before they set off, once a spot is free: false leaves it queued for now (only so many at the board at once). */
  claim?(agentId: string): boolean;
  /** A step with a `cue` is starting; false cuts the errand short and sends them back. */
  cue?(agentId: string, cue: string): boolean;
  /** They're done with it and heading back ('done' after every step), or it was cut short or never got going ('cut'). */
  end?(agentId: string, how: 'done' | 'cut'): void;
  /** At most this many people on this errand per floor at once. */
  max?: number;
  /** Errands with more to them than gestures at one spot (coffee): run by an actor once they've arrived, instead of `steps`. */
  act?: (agentId: string) => ErrandActor;
}

/** What an errand's actor asks for each frame: walk to a spot (then stand there), stand where they are, or head home. */
export type ActStep = { walk: string; gesture: Gesture } | { stand: Gesture } | 'done';

export interface ErrandActor {
  /** Called every frame while there, on the director's clock; `arrived`: they reached the spot last walked to. */
  step(now: number, arrived: boolean): ActStep;
  /** What their hands do on the walk home. */
  readonly carry: Gesture;
  /** Work called them back: they're about to hurry home. */
  abort(): void;
  /** Sat back down (`seated`), or the floor was left. */
  end(seated: boolean): void;
}

// ---------- who may go, and how many at once ----------

/** At most this many people away from their desks on a floor at once; anyone else waits their turn or skips it. */
export const MAX_WALKERS = 4;
/** A walk speed (m/s) for hurrying back to work. */
export const HURRY_SPEED = 2.3;

const FREE: readonly AgentStatus[] = ['idle', 'done', 'stopped'];

/** Free to wander: nothing to work on. ('error' stays slumped at the desk, where the manager will see it.) */
export const isFree = (status: AgentStatus) => FREE.includes(status);

/** May someone with this status set off on this errand? Work errands also while preparing (or within their `grace`). */
export const mayStart = (status: AgentStatus, errand: Pick<Errand, 'work' | 'grace'>, statusFor = Infinity) =>
  isFree(status) || (!!errand.work && (status === 'preparing' || (status === 'working' && statusFor < (errand.grace ?? 0))));

/** May they carry on with it, or must they hurry back to their desk? Work errands may finish once the work starts. */
export const mayContinue = (status: AgentStatus, errand: Pick<Errand, 'work'>) =>
  isFree(status) || (!!errand.work && (status === 'preparing' || status === 'working'));

/**
 * Who of those with an errand waiting sets off now: longest waiting first, while there's room on the floor. Work
 * errands (the board's, with their own limits) always go, ahead of the rest and whatever the cap.
 */
export function admit<T extends { queue: readonly Queued[] }>(waiting: readonly T[], away: number, cap = MAX_WALKERS): T[] {
  const queued = waiting.filter((p) => p.queue.length > 0).sort((a, b) => a.queue[0].at - b.queue[0].at);
  const work = queued.filter((p) => p.queue[0].work);
  const room = Math.max(0, cap - away - work.length);
  return [...work, ...queued.filter((p) => !p.queue[0].work).slice(0, room)];
}

/** Seconds someone sits before their next idle errand: tens of seconds, sooner on arrival so the floor isn't still. */
export const restlessSeconds = (rand: number, arriving = false) => (arriving ? 6 + rand * 40 : 25 + rand * 45);

/** The errands this person wants to go on now and may: work errands first, then in registry order. */
export function wanted(registry: readonly Errand[], agent: ErrandAgent, state: ErrandState): Errand[] {
  const out = registry.filter((e) => mayStart(agent.status, e, state.statusFor) && e.when(agent, state));
  return [...out.filter((e) => e.work), ...out.filter((e) => !e.work)];
}

/** One of the wanted errands: a work errand first, else an idle one at random by weight (`rand` in [0, 1)). */
export function choose(list: readonly Errand[], rand: number): Errand | null {
  const work = list.find((e) => e.work);
  if (work) return work;
  const total = list.reduce((t, e) => t + (e.weight ?? 1), 0);
  let r = rand * total;
  for (const e of list) {
    r -= e.weight ?? 1;
    if (r < 0) return e;
  }
  return list[list.length - 1] ?? null;
}

// ---------- the queue ----------

/** Errands waiting for a free slot: a couple per person, each dropped if it hasn't started within QUEUE_SECONDS. */
export interface Queued {
  name: string;
  at: number;
  /** A work errand: it goes ahead of idle ones. */
  work?: boolean;
}

export const QUEUE_MAX = 2;
export const QUEUE_SECONDS = 20;

/**
 * Adds `name` unless it's already waiting or the queue is full (then it's skipped). A work errand goes ahead of the
 * idle ones, bumping the last of them off a full queue. Returns the queue to keep.
 */
export function enqueue(q: readonly Queued[], name: string, now: number, max = QUEUE_MAX, work = false): Queued[] {
  if (q.some((x) => x.name === name)) return q as Queued[];
  if (!work) return q.length >= max ? (q as Queued[]) : [...q, { name, at: now }];
  const ahead = q.filter((x) => x.work);
  if (ahead.length >= max) return q as Queued[];
  return [...ahead, { name, at: now, work: true }, ...q.filter((x) => !x.work)].slice(0, max);
}

/** Drops what has waited too long or may no longer go (`ok`), keeping the order. */
export function prune(q: readonly Queued[], now: number, ok: (name: string) => boolean): Queued[] {
  const kept = q.filter((x) => now - x.at < QUEUE_SECONDS && ok(x.name));
  return kept.length === q.length ? (q as Queued[]) : kept;
}

// ---------- where to ----------

/** The spot ids an errand's patterns pick out of a floor's, leaving out any someone else is using. */
export function spotChoices(patterns: readonly string[], ids: readonly string[], taken: ReadonlySet<string>): string[] {
  const match = (id: string) => patterns.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p));
  return ids.filter((id) => match(id) && !taken.has(id));
}

/** One of the `near` spots closest to `from`, at random (`rand` in [0, 1)); null when there are none. */
export function pickSpot<T extends Pt & { id: string }>(spots: readonly T[], from: Pt, rand: number, near = 2): T | null {
  if (!spots.length) return null;
  const d = (s: Pt) => Math.hypot(s.x - from.x, s.z - from.z);
  const close = [...spots].sort((a, b) => d(a) - d(b)).slice(0, near);
  return close[Math.min(close.length - 1, Math.floor(rand * close.length))];
}

/** Where someone's errands start and end: their desk's or station's stand-up spot, or the CEO's; null for nobody. */
export function homeSpotId(floor: FloorKind, agent: { role: string; desk: number }): string | null {
  if (floor === 'lobby') return agent.role === 'ceo' ? 'ceo' : null;
  if (agent.role === 'qa') return `qa-${agent.desk}`;
  return agent.role === 'dev' ? `desk-${agent.desk}` : null;
}

// ---------- following a path ----------

/** How close to a waypoint (m) counts as passing it; the last one is walked right up to. */
export const PASS = 0.4;

/** The waypoint to head for from (x, z): moves past those already reached. Returns the new index. */
export function nextWaypoint(path: readonly Pt[], i: number, at: Pt): number {
  while (i < path.length - 1 && Math.hypot(path[i].x - at.x, path[i].z - at.z) < PASS) i++;
  return i;
}

/** Heading (body.ts: a yaw, 0 facing -Z) for a walkways.ts facing (0 east, π/2 south). */
export const headingFor = (facing: number) => Math.atan2(-Math.cos(facing), -Math.sin(facing));

// ---------- the registry ----------

/** Idle people get up now and then: to the water cooler or a window, stand a few seconds, and back. */
const stretch: Errand = {
  name: 'stretch',
  when: (agent, s) => isFree(agent.status) && s.seatedFor >= s.restless,
  spot: ['cooler', 'window-*'],
  steps: [
    { gesture: 'none', seconds: 3 },
    { gesture: 'stretch', seconds: 1.4 },
    { gesture: 'none', seconds: 1.5 },
  ],
};

const registry: Errand[] = [stretch];

/** Every errand, in the order they're considered. */
export const errands = (): readonly Errand[] => registry;

/** Adds an errand (later issues: the board, coffee, toys, chats). Replaces one with the same name. */
export function registerErrand(e: Errand) {
  const i = registry.findIndex((x) => x.name === e.name);
  if (i >= 0) registry[i] = e;
  else registry.push(e);
}

export const errandNamed = (name: string) => registry.find((e) => e.name === name);
