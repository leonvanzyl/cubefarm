// How agents play ping-pong, pure: a skill rating per person, reading the ball's path (once their reaction time is
// up), where to stand and hold the paddle, whether they miss this one, and where they put the return, with an aim
// error that shrinks as the skill grows. The toy world (PingPong.tsx) runs it for every agent at the table.

import { bouncesOf, forecast, fromOwn, onHalf, otherEnd, ownFrame, PONG, TABLE, topspinOf, type BallState, type End, type Shot, type V3 } from './pongPhysics';

const TOP = TABLE.top;
const HALF_WID = TABLE.wid / 2;

/** Where a paddle meets the ball: once it has come back this far behind the end line (m), or is about to bounce again. */
export const CONTACT = { back: 0.12, low: 0.16 };

/** A ball at (p, v) is where the player at `end` meets it, after its bounce on their half. */
export function atContact(end: End, p: V3, v: V3): boolean {
  const { back } = ownFrame(end, p.x, p.z);
  return back >= CONTACT.back || (v.y < 0 && p.y <= TOP + CONTACT.low + PONG.ball.r && back > -TABLE.len / 2);
}

export interface Contact {
  /** Seconds from now. */
  t: number;
  p: V3;
  v: V3;
  w: V3;
}

/**
 * Where (and when) the player at `end` will meet a ball now at `b`: after it bounces on their half (already, if
 * `bounced`), at the contact point. Null when it won't come to them: it's going into the net, long, or onto its own half.
 */
export function contactFor(b: BallState, end: End, bounced: boolean): Contact | null {
  let mine = bounced;
  let found: Contact | null = null;
  forecast(b, (s, t, ev) => {
    if (ev?.kind === 'bounce') {
      if (mine || ev.end !== end) return true; // a second bounce, or one on the far half: theirs to lose, not mine
      mine = true;
      return false;
    }
    if (ev) return true;
    if (mine && atContact(end, s.p, s.v)) {
      found = { t, p: { ...s.p }, v: { ...s.v }, w: { ...s.w } };
      return true;
    }
    return false;
  });
  return found;
}

// ---------- skill ----------

export interface Skill {
  /** 0 (hopeless) to 1 (office champion). */
  rating: number;
  /** Seconds before they start moving for a ball. */
  reaction: number;
  /** How far off (m, one standard deviation) their returns land from where they meant. */
  aim: number;
  /** The chance they fluff an easy ball. */
  miss: number;
  /** How fast they shuffle sideways (m/s). */
  move: number;
}

/** A stable rating from someone's id: everyone gets their own, between 0.3 and 0.9. */
export function ratingOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.3 + ((h >>> 0) % 1000) / 1000 * 0.6;
}

export function skillFor(rating: number): Skill {
  const r = Math.min(1, Math.max(0, rating));
  return { rating: r, reaction: 0.36 - 0.24 * r, aim: 0.24 - 0.2 * r, miss: 0.13 - 0.11 * r, move: 2.2 + 1.6 * r };
}

/**
 * The chance they miss this ball: their own miss rate, plus more for a fast or heavily spun ball, a smash, and a
 * ball they have to stretch for (`stretch`: metres beyond a comfortable reach).
 */
export function missChance(s: Skill, incoming: Pick<BallState, 'v' | 'w'>, stretch = 0): number {
  const speed = Math.hypot(incoming.v.x, incoming.v.y, incoming.v.z);
  const spin = Math.abs(topspinOf(incoming)) + Math.abs(incoming.w.y);
  const p = s.miss + Math.max(0, speed - 6) * (0.05 - 0.03 * s.rating) + spin * 0.0002 * (1 - s.rating * 0.6) + Math.max(0, stretch) * 1.2;
  return Math.min(0.85, Math.max(0.01, p));
}

/** A normal sample from two uniform ones in [0, 1). */
const normal = (u: number, v: number) => Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);

/** How far off a hit leaves the paddle: turned (radians, to the left), tipped up (radians), and its pace (a factor). */
export interface Wobble {
  yaw: number;
  pitch: number;
  pace: number;
}

/**
 * The return an agent of skill `s` at `by` plays from `at`: somewhere on the far half (wider and deeper the better
 * they are), a pace and spin to match, a smash at a high ball if they dare; and how far off their hit is (`wobble`,
 * for pongPhysics offLine), which can put it into the net or out. `rand` gives uniform numbers in [0, 1).
 */
export function aiShot(s: Skill, by: End, at: V3, rand: () => number): { shot: Shot; smash: boolean; wobble: Wobble } {
  const r = s.rating;
  const edge = HALF_WID - (0.4 - 0.25 * r);
  const lat = (rand() * 2 - 1) * edge;
  const depth = 0.5 + 0.2 * r + rand() * 0.35;
  const high = at.y - TOP;
  const smash = high > 0.42 && rand() < r * 0.8;
  let speed = smash ? 9.5 + 2.5 * rand() : 4.4 + 2.8 * r + rand() * 1.2;
  let top = 80 + 220 * r * rand();
  if (!smash && high < 0.12 && rand() < 0.35) {
    top = -(120 + 120 * rand()); // a low ball: chop it back
    speed = Math.min(speed, 5);
  }
  const side = (rand() * 2 - 1) * 160 * r;
  // the aim error as angles off the line: a pitch error carries furthest, so it's the smaller
  const a = s.aim * (smash ? 1.6 : 1);
  const wobble = { yaw: (normal(rand(), rand()) * a) / 1.8, pitch: (normal(rand(), rand()) * a) / 2.5, pace: 1 + normal(rand(), rand()) * a * 0.4 };
  return { shot: { target: onHalf(otherEnd(by), depth, lat), speed, top, side, clear: smash ? 0.03 : 0.06 + 0.12 * (1 - r) }, smash, wobble };
}

/** An agent's serve from `at`: deep on the far half, to a random side, a bit of spin. */
export function aiServe(s: Skill, by: End, rand: () => number): Shot {
  const lat = (rand() * 2 - 1) * (HALF_WID - 0.25);
  return {
    target: onHalf(otherEnd(by), 0.85 + rand() * 0.35 + normal(rand(), rand()) * s.aim * 0.5, lat + normal(rand(), rand()) * s.aim * 0.5),
    speed: 4.8 + 1.4 * rand() * s.rating,
    top: (rand() * 2 - 1) * 160 * s.rating,
    side: (rand() * 2 - 1) * 120 * s.rating,
    serve: true,
  };
}

// ---------- where to stand, where the paddle goes ----------

/** Where they stand to meet a ball at `contact` (forehand: it passes on their right), in their own frame. */
export function standFor(end: End, contact: V3 | null): { x: number; z: number } {
  if (!contact) return fromOwn(end, READY.back, READY.lat);
  const o = ownFrame(end, contact.x, contact.z);
  return fromOwn(end, Math.min(1.25, Math.max(0.42, o.back + 0.4)), Math.min(1.35, Math.max(-1.35, o.lat - 0.38)));
}

/** Waiting for the ball: a little behind the end, a touch left of the middle so the forehand covers it. */
export const READY = { back: 0.65, lat: -0.18 };

/** How far from someone's right shoulder (standing at `stand`, at `end`) a point is: their reach is about 0.75 m. */
export function reachTo(end: End, stand: { x: number; z: number }, p: V3): number {
  const s = ownFrame(end, stand.x, stand.z);
  const q = ownFrame(end, p.x, p.z);
  return Math.hypot(q.back - s.back, q.lat - (s.lat + 0.27), p.y - SHOULDER);
}
export const REACH = 0.82;
const SHOULDER = 1.28;

/** The paddle's resting spot in front of someone standing at `stand`. */
export function readyPaddle(end: End, stand: { x: number; z: number }): V3 {
  const s = ownFrame(end, stand.x, stand.z);
  return { ...fromOwn(end, s.back - 0.38, s.lat + 0.3), y: TOP + 0.24 };
}

/**
 * Where an agent's paddle is `t` seconds into a swing at a ball met at `contact` (by `hitAt` seconds), taking it back
 * first (more the further off the ball is), through the ball, then a follow-through forward and up.
 */
export function swingPaddle(end: End, contact: V3, t: number, hitAt: number): V3 {
  const o = ownFrame(end, contact.x, contact.z);
  const to = (k: number) => Math.min(1, Math.max(0, k));
  if (t <= hitAt) {
    const left = hitAt - t;
    const back = to(left / 0.35) * 0.32;
    return { ...fromOwn(end, o.back + back, o.lat + back * 0.3), y: contact.y - back * 0.25 };
  }
  const k = to((t - hitAt) / 0.25);
  return { ...fromOwn(end, o.back - 0.38 * k, o.lat - 0.25 * k), y: contact.y + 0.3 * k };
}

/** Whether a serve or return from `b` lands on the far half for the player at `by` (a forecast, for tests and the probe). */
export function landsIn(b: BallState, by: End, serve = false): boolean {
  const { bounces } = bouncesOf(b, serve ? 2 : 1);
  const to = otherEnd(by);
  return serve ? bounces.length === 2 && bounces[0].end === by && bounces[1].end === to : bounces.length === 1 && bounces[0].end === to;
}
