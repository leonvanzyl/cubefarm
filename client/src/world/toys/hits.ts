// Toys hitting people: which seated characters can be hit (targets), the rules for what counts as a hit and how
// often someone reacts, and the reaction's timing. Kept free of the physics engine so characters (main bundle) can
// use it and the rules can be tested; the sensors that detect hits live in HitTargets.tsx inside the toy world.
// Purely visual: nothing here touches the store or the server.

import type { Object3D } from 'three';

/** At most one reaction per person every gapMs; a reaction lasts ms. */
export const REACTION = { gapMs: 2000, ms: 1500 };

export type HitKind = 'ball' | 'dart';

/** Slowest a toy may be moving (m/s, just before it reaches someone) for the touch to count as a hit. */
export const HIT_SPEED: Record<HitKind, number> = { ball: 2.5, dart: 3 };

/** What a physics body is, from its userData (balls carry { toy: <ball id> }, darts { toy: 'dart' }); null for anything else. */
export function hitKind(tag: unknown, ballIds: readonly string[]): HitKind | null {
  const toy = tag && typeof tag === 'object' ? (tag as { toy?: unknown }).toy : undefined;
  if (toy === 'dart') return 'dart';
  return typeof toy === 'string' && ballIds.includes(toy) ? 'ball' : null;
}

/**
 * Does a toy reaching someone count as a hit? Only a thrown or fast ball, or a dart in flight: a ball in your hands,
 * one rolling gently or resting against a desk, or a dart lying about doesn't.
 */
export function countsAsHit(kind: HitKind | null, speed: number, held: boolean): boolean {
  return kind !== null && !held && speed >= HIT_SPEED[kind];
}

/** The per-person rate limit: may someone last hit at `last` (performance.now(), undefined for never) react at `now`? */
export const mayReact = (last: number | undefined, now: number, gapMs = REACTION.gapMs) => last === undefined || now - last >= gapMs;

// ---------- the reaction's shape ----------

const smooth = (t: number) => t * t * (3 - 2 * t);

/** How much of the reaction shows `ms` after the hit, 0 to 1: in quickly, held, then eased back to the normal pose. */
export function reactionWeight(ms: number): number {
  if (!(ms >= 0) || ms >= REACTION.ms) return 0;
  if (ms < 120) return smooth(ms / 120);
  const hold = 850;
  return ms < hold ? 1 : 1 - smooth((ms - hold) / (REACTION.ms - hold));
}

/** The flinch: a jolt that peaks about 70 ms after the hit and is gone by 400 ms, 0 to 1. */
export function flinch(ms: number): number {
  if (!(ms >= 0) || ms >= 400) return 0;
  return ms < 70 ? smooth(ms / 70) : 1 - smooth((ms - 70) / 330);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Turning a seated person (facing -Z) towards a point at (dx, dz) in their own frame: the head turns up to
 * `maxHead` radians and the upper body twists for the rest, up to `maxTwist`. Positive turns towards -X.
 */
export function turnToward(dx: number, dz: number, maxHead = 1.1, maxTwist = 0.5): { head: number; twist: number } {
  if (dx === 0 && dz === 0) return { head: 0, twist: 0 };
  const yaw = Math.atan2(-dx, -dz);
  const head = clamp(yaw, -maxHead, maxHead);
  return { head, twist: clamp(yaw - head, -maxTwist, maxTwist) };
}

// ---------- registry ----------

/** A seated character that toys can hit: its id and the group whose origin is the floor under its chair (facing -Z). */
export interface HitTarget {
  id: string;
  obj: Object3D;
  /** Unique per registration, for React keys. */
  key: number;
}

let targets: HitTarget[] = [];
let nextKey = 1;
const targetListeners = new Set<() => void>();
const hitListeners = new Map<string, Set<() => void>>();
const lastHit = new Map<string, number>();
let reactions = 0;

/** A character registers itself as a target while it's mounted; returns the unregister function. */
export function registerTarget(id: string, obj: Object3D): () => void {
  const t = { id, obj, key: nextKey++ };
  targets = [...targets, t];
  for (const fn of targetListeners) fn();
  return () => {
    targets = targets.filter((x) => x !== t);
    for (const fn of targetListeners) fn();
  };
}

/** The current targets (a new array whenever they change, so it works with useSyncExternalStore). */
export const hitTargets = () => targets;

export function onTargetsChange(fn: () => void): () => void {
  targetListeners.add(fn);
  return () => void targetListeners.delete(fn);
}

/** Call `fn` whenever the person with this id reacts to a hit. */
export function onAgentHit(id: string, fn: () => void): () => void {
  let set = hitListeners.get(id);
  if (!set) hitListeners.set(id, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) hitListeners.delete(id);
  };
}

/** A toy hit someone: they react unless they reacted less than REACTION.gapMs ago. True when they react. */
export function reportHit(id: string, now = performance.now()): boolean {
  if (!mayReact(lastHit.get(id), now)) return false;
  lastHit.set(id, now);
  reactions++;
  for (const fn of hitListeners.get(id) ?? []) fn();
  return true;
}

/** Reactions so far this session (every floor), for window.__swarmToys. */
export const reactionCount = () => reactions;
