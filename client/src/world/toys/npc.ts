// Other people's hands: the agents on toy errands (toyErrands.ts) pick up a loose ball, carry it, throw it with the
// player's own throw maths (throwing.ts) and put it down again. Plain module state, like hands.ts: the errands write
// here from the render loop, the toy world (ToyWorld.tsx) carries it out on its next physics step and publishes
// where every ball is after each one. Kept out of the physics chunk so the errands can import it.
// Manners live here too: nobody takes a ball from the player, and the player can always take one from them.

import { useStore } from '../../store';
import type { BallKind } from './balls';
import type { Vec3 } from './hoopScore';
import type { NpcAim, NpcPose } from './npcAim';

// ---------- state ----------

interface Grip {
  ball: string;
  pose: NpcPose;
  pull: number;
}

type Release = { kind: 'throw'; aim: NpcAim } | { kind: 'drop' };

/** A ball as the errands see it, updated in place by the toy world after every physics step. */
export interface NpcBall extends Vec3 {
  id: string;
  kind: BallKind;
  r: number;
  /** Where it starts out on this floor: where it's put back. */
  home: Vec3;
  vx: number;
  vy: number;
  vz: number;
  sleeping: boolean;
}

/** Why someone's ball left their hands without them letting go: the player took it, or it got stuck behind something. */
export type Lost = 'taken' | 'stuck';

const grips = new Map<string, Grip>();
const releases = new Map<string, Release>();
const lost = new Map<string, Lost>();
const thrower = new Map<string, { who: string; at: number }>();
const catching = new Map<string, string>();
const scored = new Map<string, number>();
let balls: NpcBall[] = [];
let roomba: (() => NpcRoomba) | null = null;
const stats = { shots: 0, tosses: 0, baskets: 0, catches: 0, pokes: 0, taken: 0 };

/** The roomba, as the people walking past it see it. */
export interface NpcRoomba {
  x: number;
  z: number;
  /** roombaBrain.ts's state ('cleaning', 'charging', …) and move ('spin' while doing its happy spin). */
  state: string;
  move: string;
}

// ---------- for the errands ----------

/** Every ball on this floor (empty while there's no toy world). */
export const npcBalls = (): readonly NpcBall[] => balls;
export const npcBall = (id: string) => balls.find((b) => b.id === id);

/** Who has the ball: 'player', someone's id, or null when it's loose. */
export function ballHolder(id: string): string | null {
  const held = useStore.getState().held;
  if (held?.kind === 'ball' && held.id === id) return 'player';
  for (const [who, g] of grips) if (g.ball === id) return who;
  return null;
}

/** The ball `who` is holding, or null. */
export const npcHolding = (who: string) => grips.get(who)?.ball ?? null;

/** Picks up a loose ball. False when there's no toy world or someone (the player above all) already has it. */
export function npcPickUp(who: string, id: string): boolean {
  if (!npcBall(id) || ballHolder(id) !== null) return false;
  if (grips.has(who)) return false;
  grips.set(who, { ball: id, pose: 'carry', pull: 0 });
  releases.delete(who);
  lost.delete(who);
  if (catching.get(who) === id) stats.catches++;
  catching.delete(who);
  return true;
}

/** How they hold what they're holding. */
export function npcPose(who: string, pose: NpcPose, pull = 0) {
  const g = grips.get(who);
  if (!g) return;
  g.pose = pose;
  g.pull = pull;
}

/** Throws what they're holding on the next physics step, from where `npcHoldPoint` puts it. */
export function npcThrow(who: string, aim: NpcAim) {
  if (grips.has(who)) releases.set(who, { kind: 'throw', aim });
}

/** Lets go gently (put it down, or just drop it). */
export function npcLetGo(who: string) {
  if (grips.has(who)) releases.set(who, { kind: 'drop' });
  catching.delete(who);
}

/** Whether the toy world took their ball away since they picked it up, and why (null if not). Reading clears it. */
export function npcLost(who: string): Lost | null {
  const l = lost.get(who) ?? null;
  lost.delete(who);
  return l;
}

/** `who` is waiting for ball `id` to come to them: it doesn't count as hitting them, and catching it counts as a catch. */
export function npcExpect(who: string, id: string | null) {
  if (id) catching.set(who, id);
  else catching.delete(who);
}

/** Whether a basket from a ball `who` threw went in after `since` (performance.now()). */
export const npcScoredSince = (who: string, since: number) => (scored.get(who) ?? -Infinity) > since;

/** The roomba on this floor, or null. */
export const npcRoomba = () => roomba?.() ?? null;

/** Someone poked the roomba (for the probe's count). */
export const countPoke = () => void stats.pokes++;

// ---------- for the toy world ----------

/** Every grip, for the toy world to carry out. */
export const npcGrips = (): ReadonlyMap<string, Grip> => grips;

/** The throw or drop `who` asked for, once. */
export function takeRelease(who: string): Release | null {
  const r = releases.get(who) ?? null;
  releases.delete(who);
  return r;
}

/** The toy world let go of `who`'s ball: thrown, dropped, or lost (taken by the player, or stuck behind something). */
export function released(who: string, how: 'thrown' | 'dropped' | Lost) {
  const g = grips.get(who);
  grips.delete(who);
  releases.delete(who);
  if (!g) return;
  if (how === 'thrown') {
    thrower.set(g.ball, { who, at: performance.now() });
    if (g.ball === 'basketball') stats.shots++;
    else stats.tosses++;
  } else if (how !== 'dropped') {
    lost.set(who, how);
    if (how === 'taken') stats.taken++;
  }
}

/** The player picked ball `id` up: from now on, whatever it does is theirs. */
export const playerTook = (id: string) => void thrower.delete(id);

/** A basket with ball `id`: the id of whoever threw it if that wasn't the player (and remembers it), else null. */
export function basketBy(id: string): string | null {
  const t = thrower.get(id);
  if (!t) return null;
  scored.set(t.who, performance.now());
  stats.baskets++;
  return t.who;
}

/** A ball reaching person `who` that shouldn't count as a hit: the one they hold, just threw, or are about to catch. */
export function npcIgnores(who: string, id: unknown): boolean {
  if (typeof id !== 'string') return false;
  if (grips.get(who)?.ball === id || catching.get(who) === id) return true;
  const t = thrower.get(id);
  return !!t && t.who === who && performance.now() - t.at < 1500;
}

/** The toy world says which balls this floor has (null when it goes away): everything held or pending is dropped. */
export function setNpcBalls(list: NpcBall[] | null) {
  balls = list ?? [];
  grips.clear();
  releases.clear();
  lost.clear();
  thrower.clear();
  catching.clear();
}

export function setNpcRoomba(fn: (() => NpcRoomba) | null) {
  roomba = fn;
}

/** For window.__swarmToys: who holds what, and what the people on toy errands have done this session. */
export function npcSnapshot() {
  return { holding: [...grips].map(([who, g]) => ({ who, ball: g.ball, pose: g.pose })), ...stats };
}
