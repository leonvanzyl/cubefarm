// The office dog, building-wide. Kept out of the physics chunk, like npc.ts: which floor it's on and how it shows up
// there (dogTravel.ts), what reaches it from outside the toy world (a ball the player lets go of, a merge, QA's
// helpers), what the floor's Dog.tsx reports while it's drawn, and window.__swarmDog. One dog for the whole building:
// its brain (dogBrain.ts) lives in Dog.tsx while you're on its floor; elsewhere it only changes floors now and then.

import { DEFAULT_DOG_NAME } from '../../../../shared/types';
import { repoOnFloor, useStore } from '../../store';
import { onMerge } from '../confetti';
import { arrival, arriveAt, createWhere, hardTimes, pickFloor, settle, type Arrival, type DogWhere } from './dogTravel';

export const dogName = () => useStore.getState().settings.dogName?.trim() || DEFAULT_DOG_NAME;

let where: DogWhere | null = null;
/** Floors QA asked it to go to next (__swarmDog.ride). */
let nextFloor: number | null = null;

const floors = () => [0, ...useStore.getState().repos.map((r) => r.floor)].sort((a, b) => a - b);
const playerFloor = () => useStore.getState().floor;

// ---------- who's having a hard time ----------

const forced = new Set<string>();

/** The agents on the floor of `repoId` having a hard time (dogTravel.ts hardTimes), QA's forced ones included. */
export function troubled(repoId: string): string[] {
  const s = useStore.getState();
  const repo = s.repos.find((r) => r.id === repoId);
  return repo ? hardTimes(repo, Object.values(s.agents), s.qa, forced) : [];
}

function troubledFloors(): Set<number> {
  const out = new Set<number>();
  for (const r of useStore.getState().repos) if (troubled(r.id).length) out.add(r.floor);
  return out;
}

// ---------- where it is ----------

/** What Dog.tsx reports while the dog is drawn: for the probe. */
export interface DogLive {
  x: number;
  z: number;
  y: number;
  heading: number;
  state: string;
  pose: string;
  target: { kind: string; id: string | null; x: number; z: number } | null;
  carrying: string | null;
  happy: number;
  asleep: boolean;
  speed: number;
}

let live: (() => DogLive) | null = null;

/** Where the dog is on the floor drawn, every physics step (Elevator.tsx opens its doors for it). */
export const dogNow = { drawn: false, x: 0, z: 0 };

/** Dog.tsx registers itself while the dog is drawn on its floor. */
export function setDogLive(fn: (() => DogLive) | null) {
  live = fn;
}

/**
 * Whether the dog is on floor `level` now. Asked by every floor's Dog.tsx about once a second, which also moves it on
 * to another floor when it has stayed long enough where nobody's watching. It starts on the player's floor.
 */
export function dogOn(level: number, now = performance.now()): boolean {
  if (!useStore.getState().loaded) return false; // the floors aren't known yet
  where ??= createWhere(playerFloor(), now, Math.random());
  settle(where, now, live !== null && dogNow.drawn, floors(), playerFloor(), troubledFloors(), Math.random);
  return where.floor === level;
}

/** How it shows up on the floor it's on, once: out of the elevator, with the player, or where it was left. */
export function takeArrival(now = performance.now()): { how: Arrival; seen: DogWhere['seen']; called: boolean; follow: number } {
  const w = where ?? createWhere(playerFloor(), now, Math.random());
  const out = { how: arrival(w, now), seen: w.seen, called: w.called, follow: w.follow };
  w.arriving = null;
  w.seen = null;
  w.called = false;
  w.follow = 0;
  return out;
}

/** It walked into the elevator on `level`: off to another floor. */
export function dogLeft(level: number, now = performance.now()) {
  if (!where || where.floor !== level) return;
  const to = nextFloor !== null && floors().includes(nextFloor) ? nextFloor : pickFloor(level, floors(), playerFloor(), troubledFloors(), Math.random());
  nextFloor = null;
  arriveAt(where, to, now, 'cabin', Math.random());
}

/** It rode the elevator with the player to `to`, with `follow` seconds of following left. */
export function dogRides(to: number, follow: number, now = performance.now()) {
  if (!where) return;
  arriveAt(where, to, now, 'player', Math.random());
  where.follow = follow;
}

/** The player left the dog's floor with the dog still on it: remember where (heading in the brain's convention). */
export function dogSeen(level: number, x: number, z: number, heading: number, now = performance.now()) {
  if (!where || where.floor !== level) return;
  where.seen = { x, z, heading };
  where.since = now; // its stay there starts now
}

/** Whether there's another floor for it to go to. */
export const dogMayLeave = () => floors().length > 1;

// ---------- from outside the toy world ----------

let released: { id: string; at: number } | null = null;

/** The ball the player just let go of (thrown or dropped), once; null when there's none. */
export function takeRelease(): string | null {
  const r = released;
  released = null;
  return r && performance.now() - r.at < 1000 ? r.id : null;
}

const parties = new Map<string, { agentId: string | null; at: number }>();

/** A merge on `repoId`'s floor in the last few seconds, once: who wrote it (null: nobody on the floor). */
export function takeParty(repoId: string): { agentId: string | null } | null {
  const p = parties.get(repoId);
  parties.delete(repoId);
  return p && performance.now() - p.at < 5000 ? p : null;
}

/** QA's ways in, registered by the floor's Dog.tsx: the throw on every floor with toys, the rest while the dog is there. */
export interface DogHooks {
  pet(): void;
  come(): void;
  nap(): void;
  leave(): void;
  party(agentId: string | null): void;
}

let hooks: DogHooks | null = null;
let thrower: ((id: string | null, power: number) => string | null) | null = null;

export function setDogHooks(h: DogHooks | null) {
  hooks = h;
}

export function setDogThrow(fn: ((id: string | null, power: number) => string | null) | null) {
  thrower = fn;
}

/** What it's done since the page loaded, for the probe. Dog.tsx counts its brain's events here. */
export const dogStats = { fetches: 0, returned: 0, lost: 0, visits: 0, parties: 0, naps: 0, pets: 0, barks: 0, delighted: 0, lastDrop: null as number | null };

/** Calls it over: to the player's floor by elevator if it isn't there, then to the player. */
function come() {
  const level = playerFloor();
  if (where?.floor === level && hooks) return hooks.come();
  where ??= createWhere(level, performance.now(), Math.random());
  arriveAt(where, level, performance.now(), 'cabin', Math.random());
  where.called = true;
}

/** Off to `floor` next: by the elevator now if it's on your floor, else it's simply there now. */
function ride(floor: number) {
  if (!floors().includes(floor) || !where) return;
  if (where.floor === playerFloor() && hooks) {
    nextFloor = floor;
    hooks.leave();
    return;
  }
  arriveAt(where, floor, performance.now(), 'cabin', Math.random());
}

function snapshot() {
  let l: DogLive | null = null;
  try {
    l = live?.() ?? null;
  } catch {
    // being torn down
  }
  return {
    name: dogName(),
    floor: where?.floor ?? null,
    /** Drawn on your floor right now (not while it rides the elevator with you). */
    here: !!l && where?.floor === playerFloor(),
    x: l ? Math.round(l.x * 100) / 100 : null,
    z: l ? Math.round(l.z * 100) / 100 : null,
    y: l ? Math.round(l.y * 100) / 100 : null,
    heading: l ? Math.round(l.heading * 100) / 100 : null,
    state: l?.state ?? null,
    pose: l?.pose ?? null,
    target: l?.target ?? null,
    carrying: l?.carrying ?? null,
    happy: l ? Math.round(l.happy * 100) / 100 : null,
    asleep: l?.asleep ?? false,
    speed: l ? Math.round(l.speed * 100) / 100 : null,
    rides: where?.rides ?? 0,
    stressed: [...forced],
    ...dogStats,
    /** Calls it to you (by elevator from another floor). */
    come,
    /** Puts a loose ball (that one, or the nearest nobody holds) in your hands and throws it along your view with power 0-1, as a real throw. */
    fetch: (ballId?: string, power = 0.5) => thrower?.(ballId ?? null, power) ?? null,
    pet: () => hooks?.pet(),
    nap: () => hooks?.nap(),
    leave: () => hooks?.leave(),
    ride,
    /** Treats someone as having a hard time (as if their PR's checks were red), or not with on = false. */
    stress: (agentId: string, on = true) => void (on ? forced.add(agentId) : forced.delete(agentId)),
    /** As if `agentId`'s PR merged on your floor (null or nothing: the gong). */
    celebrate: (agentId: string | null = null) => hooks?.party(agentId),
  };
}

if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    const was = prev.held?.kind === 'ball' ? prev.held.id : null;
    const now = s.held?.kind === 'ball' ? s.held.id : null;
    if (was && was !== now) released = { id: was, at: performance.now() };
  });
  onMerge((b) => {
    const repo = repoOnFloor(useStore.getState().repos, playerFloor());
    if (repo?.id === b.repoId) parties.set(b.repoId, { agentId: b.agentId, at: performance.now() });
  });
  if (!Object.getOwnPropertyDescriptor(window, '__swarmDog')) Object.defineProperty(window, '__swarmDog', { get: snapshot, enumerable: false, configurable: false });
}
