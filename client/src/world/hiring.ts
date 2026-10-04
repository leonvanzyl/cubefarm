// In-person hiring (#227), the pure part: which chair in the lobby's waiting room each candidate takes, how the
// candidates follow the CEO's proposals (wait, take the manager's decision, leave), where they go, and a new hire's
// welcome tour of their floor. Candidates.tsx moves the candidates and ErrandDirector.tsx runs the tour; no three.js.

import type { HireRequestView } from '../../../shared/types';
import type { Gesture } from './body';
import { headingFor, type Act, type ErrandScript, type Me } from './errands';
import { BALCONY, HALF_W, SIDE_OPENINGS, WAITING } from './layout';
import { CABIN, headingTo, nearest } from './socials';
import type { Pt } from './toys/roombaBrain';
import { findPath, spot, type Spot, type Walkways } from './walkways';

// ---------- the waiting room ----------

/** waiting: in their chair · hired / declined: the manager has decided, and they're reacting or on their way out. */
export type CandidatePhase = 'waiting' | 'hired' | 'declined';

export interface LobbyCandidate {
  /** The proposal's id; it's their id as a person too. */
  id: string;
  /** Their chair: an index into WAITING.seats. */
  seat: number;
  phase: CandidatePhase;
}

export interface Lobby {
  list: LobbyCandidate[];
  /** Pending hires with no chair free: "+N waiting" on the sign. */
  outside: number;
}

type Proposal = Pick<HireRequestView, 'id' | 'kind' | 'status' | 'createdAt'>;

/**
 * The waiting room after the proposals changed. Everyone waiting keeps their chair; new candidates take the free ones,
 * longest waiting first; whoever doesn't fit waits outside. A candidate whose proposal was just decided stays (and
 * keeps the chair) until they've reacted and walked out (`leave`); one whose proposal vanished goes at once. Decisions
 * the lobby never saw pending (made before it was drawn) show nobody. Returns `prev` itself when nothing changed.
 */
export function syncCandidates(prev: Lobby, requests: readonly Proposal[], seats = WAITING.seats.length): Lobby {
  const byId = new Map(requests.map((r) => [r.id, r]));
  const list: LobbyCandidate[] = [];
  for (const c of prev.list) {
    const r = byId.get(c.id);
    if (c.phase !== 'waiting') list.push(c);
    else if (r?.status === 'pending') list.push(c);
    else if (r) list.push({ ...c, phase: r.status === 'approved' ? 'hired' : 'declined' });
  }
  const taken = new Set(list.map((c) => c.seat));
  const here = new Set(list.map((c) => c.id));
  let outside = 0;
  const waiting = requests.filter((r) => r.kind === 'hire' && r.status === 'pending' && !here.has(r.id)).sort((a, b) => a.createdAt - b.createdAt);
  for (const r of waiting) {
    let seat = 0;
    while (seat < seats && taken.has(seat)) seat++;
    if (seat >= seats) {
      outside++;
      continue;
    }
    taken.add(seat);
    list.push({ id: r.id, seat, phase: 'waiting' });
  }
  const same = list.length === prev.list.length && list.every((c, i) => c === prev.list[i]) && outside === prev.outside;
  return same ? prev : { list, outside };
}

/** The waiting room once candidate `id` has walked out. */
export function leave(lobby: Lobby, id: string): Lobby {
  return lobby.list.some((c) => c.id === id) ? { ...lobby, list: lobby.list.filter((c) => c.id !== id) } : lobby;
}

/** Hires that were waiting on the manager and have just been approved: they're due a welcome tour on their floor. */
export function newlyHired(prev: readonly HireRequestView[], next: readonly HireRequestView[]): { agentId: string; repoId: string }[] {
  const was = new Map(prev.map((r) => [r.id, r.status]));
  return next.filter((r) => r.kind === 'hire' && r.status === 'approved' && r.agentId && was.get(r.id) === 'pending').map((r) => ({ agentId: r.agentId!, repoId: r.repoId }));
}

// ---------- taking the decision ----------

/** How close (m) the manager must be for a hired candidate to come over and shake hands; further away they cheer. */
export const GREET_RANGE = 4.5;
/** How far from the manager (m) a candidate stands to shake hands. */
export const SHAKE_GAP = 1;

/** What a candidate does once the decision is in: stand up, react for a moment, then go. */
export interface Reaction {
  gesture: Gesture;
  seconds: number;
  /** A speech bubble while they react. */
  say: string;
}

/** Hired: a big smile and a handshake when the manager's there, a cheer when they decided from afar. Declined: a polite nod. */
export function reactionFor(phase: Exclude<CandidatePhase, 'waiting'>, managerNear: boolean): Reaction {
  if (phase === 'declined') return { gesture: 'nod', seconds: 2, say: '🙂' };
  return managerNear ? { gesture: 'shake', seconds: 3, say: '🤝' } : { gesture: 'cheer', seconds: 2.2, say: '🎉' };
}

/** Seconds from the decision until they're up and facing the right way. */
export const RISE_SECONDS = 1.1;

/** Where a candidate stands up to, just in front of their chair (they face west, into the lobby). */
export const chairFront = (seat: number): Pt => ({ x: WAITING.x - 0.6, z: WAITING.seats[seat] ?? WAITING.seats[0] });

/**
 * Where a hired candidate stands to shake hands: a step from the manager on the line to their chair (a little
 * further if furniture's in the way: `open`), when the manager is within GREET_RANGE; else in front of their chair.
 */
export function greetSpot(seat: number, manager: Pt, open: (x: number, z: number) => boolean): { at: Pt; near: boolean } {
  const front = chairFront(seat);
  const d = Math.hypot(front.x - manager.x, front.z - manager.z);
  if (d > GREET_RANGE) return { at: front, near: false };
  for (const gap of [SHAKE_GAP, SHAKE_GAP + 0.25, SHAKE_GAP + 0.5]) {
    if (gap >= d) break;
    const at = { x: manager.x + ((front.x - manager.x) * gap) / d, z: manager.z + ((front.z - manager.z) * gap) / d };
    if (open(at.x, at.z)) return { at, near: true };
  }
  return { at: front, near: true };
}

// ---------- leaving ----------

/** The lobby's front door: the glass door in the east wall by the waiting room, out onto the patio. */
const DOOR_Z = SIDE_OPENINGS.lobby.east.door;
export const FRONT_DOOR = {
  /** Just inside the doorway, where a walk round the lobby can end. */
  inside: { x: HALF_W - 0.9, z: DOOR_Z },
  /** Out on the patio, through the door. */
  outside: { x: HALF_W + 1.3, z: DOOR_Z },
  /** Down the patio towards the street, where they're gone. */
  away: { x: HALF_W + 1.3, z: BALCONY.maxZ - 0.9 },
};

/** Hired: from where they stand into the lobby's elevator, up to their floor. Null when there's no way. */
export function hiredRoute(w: Walkways, from: Pt): Pt[] | null {
  const lift = spot(w, 'elevator');
  const path = lift ? findPath(w, from, lift) : null;
  return path && [...path, CABIN];
}

/** Declined: out through the front door and away down the patio. Null when there's no way. */
export function declinedRoute(w: Walkways, from: Pt): Pt[] | null {
  const path = findPath(w, from, FRONT_DOOR.inside);
  return path && [...path, FRONT_DOOR.outside, FRONT_DOOR.away];
}

// ---------- the welcome tour ----------

/** One stop on a new hire's welcome tour: a spot (walkways.ts) and what they do there for a moment. */
export interface TourStop {
  spot: Spot;
  what: 'whiteboard' | 'coffee machine' | 'gong';
  gesture: Gesture;
  seconds: number;
}

const STOPS: { what: TourStop['what']; ids: (w: Walkways) => string[]; gesture: Gesture; seconds: number }[] = [
  // the whiteboard's middle column, where their sticky will go
  { what: 'whiteboard', ids: (w) => w.spots.filter((s) => s.id.startsWith('board-')).sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).map((s) => s.id), gesture: 'none', seconds: 2.2 },
  { what: 'coffee machine', ids: () => ['coffee'], gesture: 'tap', seconds: 1.8 },
  { what: 'gong', ids: () => ['gong'], gesture: 'none', seconds: 1.8 },
];

/** Seconds a new hire waves back at the teammate who waved to them, after each stop. */
export const WAVE_BACK = 1.2;
/** Seconds they try to reach a stop (someone in the way, say) before skipping it. */
export const STOP_PATIENCE = 30;
/** Held up this close (m) to a stop for this long (s), they have their moment from there: someone's using it. */
export const CLOSE_ENOUGH = { m: 1.6, s: 2 };

/**
 * The tour on this floor: the whiteboard, the coffee machine and the gong, nearest first from `from` (the elevator),
 * so it's one loop rather than back and forth across the floor. Stops the floor doesn't have are left out.
 */
export function planTour(w: Walkways, from: Pt): TourStop[] {
  const left = STOPS.flatMap((s) => {
    const at = s.ids(w).map((id) => spot(w, id)).find((x): x is Spot => !!x);
    return at ? [{ spot: at, what: s.what, gesture: s.gesture, seconds: s.seconds }] : [];
  });
  const out: TourStop[] = [];
  let here = from;
  while (left.length) {
    const d = (s: TourStop) => Math.hypot(s.spot.x - here.x, s.spot.z - here.z);
    const i = left.reduce((best, s, k) => (d(s) < d(left[best]) ? k : best), 0);
    const [next] = left.splice(i, 1);
    out.push(next);
    here = next.spot;
  }
  return out;
}

/** How far either side of the elevator doorway's middle a new hire steps out, round someone in front of the doors. */
export const DOOR_SIDESTEP = 0.75;

/**
 * Where a new hire steps out of the elevator to: its spot, or beside it, away from the player when they stand in
 * front of the doors (they've just ridden up together); with the player dead ahead, towards the tour's first stop.
 */
export function stepOut(lift: Pt, player: Pt, next: Pt | null): Pt {
  if (Math.hypot(player.x - lift.x, player.z - lift.z) > 2) return { x: lift.x, z: lift.z };
  const away = -Math.sign(player.x - lift.x);
  const side = Math.abs(player.x - lift.x) > 0.1 ? away : Math.sign((next?.x ?? lift.x + 1) - lift.x) || 1;
  return { x: lift.x + side * DOOR_SIDESTEP, z: lift.z };
}

export interface TourHooks {
  /** A stop's moment starts: a teammate waves to them. Where that teammate is, to wave back at, or null for nobody. */
  arrive(stop: TourStop, at: Pt): Pt | null;
  /** The stop they're heading for or at, for the probe (null: the tour is over, on to their desk). */
  progress(stop: TourStop | null): void;
}

/**
 * The tour as a scripted errand (errands.ts): walk to each stop, a moment there (its gesture, facing what's there),
 * a wave back at the teammate who waved, and on to the next; 'done' sends them to their desk. The director cuts it
 * short when work comes in.
 */
export function tourScript(stops: readonly TourStop[], hooks: TourHooks): ErrandScript {
  let i = 0;
  let sent = false; // the walk to stop i has been asked for (so a stale "arrived" from the last one doesn't count)
  let walked = 0; // seconds walking to stop i
  let still = 0; // seconds without getting any closer to it
  let last = { x: NaN, z: NaN };
  let t = -1; // seconds at stop i; -1 while walking there
  let waver: Pt | null = null;
  let pin: Pt = { x: 0, z: 0 };
  const next = () => {
    i++;
    sent = false;
    walked = 0;
    still = 0;
    t = -1;
    waver = null;
    hooks.progress(stops[i] ?? null);
  };
  const tick = (me: Me): Act => {
    const stop = stops[i];
    if (!stop) return { do: 'done', x: me.x, z: me.z, heading: me.heading, gesture: 'none' };
    const facing = headingFor(stop.spot.facing);
    if (t < 0) {
      const d = Math.hypot(me.x - stop.spot.x, me.z - stop.spot.z);
      still = Math.hypot(me.x - last.x, me.z - last.z) < 0.02 ? still + me.dt : 0;
      last = { x: me.x, z: me.z };
      const there = sent && ((me.arrived && d < 0.6) || (d < CLOSE_ENOUGH.m && still > CLOSE_ENOUGH.s));
      sent = true;
      walked += me.dt;
      if (walked > STOP_PATIENCE) {
        next();
        return tick({ ...me, dt: 0 });
      }
      if (!there) return { do: 'walk', x: stop.spot.x, z: stop.spot.z, heading: facing, gesture: 'none' };
      t = 0;
      pin = { x: me.x, z: me.z };
      waver = hooks.arrive(stop, pin);
    }
    t += me.dt;
    if (t < stop.seconds) return { do: 'stand', x: pin.x, z: pin.z, heading: facing, gesture: stop.gesture };
    if (waver && t < stop.seconds + WAVE_BACK) return { do: 'stand', x: pin.x, z: pin.z, heading: headingTo(pin, waver), gesture: 'wave' };
    next();
    return tick({ ...me, dt: 0 });
  };
  hooks.progress(stops[0] ?? null);
  return { tick, end: () => hooks.progress(null) };
}

/** Which seated teammate waves to a new hire at `at`: the nearest one (not the hire themselves), or null. */
export const waverFor = <T extends Pt & { id: string }>(hireId: string, at: Pt, seated: Iterable<T>): T | null => nearest({ id: hireId, ...at }, seated);
