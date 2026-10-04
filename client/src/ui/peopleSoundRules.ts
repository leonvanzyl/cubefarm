// When the people around the office make a sound, kept free of WebAudio so it can be tested: a step each half walk
// cycle (only from the few walkers nearest you, so a busy floor stays calm), the chair as they get up or sit down,
// a gesture starting or ending, and now and then a murmur while two of them stand chatting. peopleSounds.ts plays them.

import type { Stage } from '../world/body';
import { createStepTracker, trackSteps, type StepTracker } from './footstepRules';

/** Only this many walkers, the nearest, are heard stepping at once. */
export const MAX_WALKERS = 3;
/** Steps (and chats) farther away than this aren't played at all (metres). */
export const HEAR_RANGE = 12;
/** Faster than this is a walk, not a shuffle on the spot (m/s). */
export const WALKING = 0.15;
/** At or above this they're hurrying: brisker steps (m/s). */
export const HURRYING = 1.8;
/** Two people standing still this close are chatting (metres). */
export const CHAT_RADIUS = 1.8;
/** Seconds between one person's murmurs while chatting, and before their first. */
export const MURMUR_GAP = { min: 2.5, max: 6 };
export const FIRST_MURMUR = { min: 0.6, max: 2.5 };
/** Seconds between any two murmurs on the floor: chats take turns and never pile up. */
export const MURMUR_SPACING = 1.2;

/** What one person's frame asks to play. */
export type PersonEvent = 'step' | 'scuff' | 'rise' | 'sit' | 'seated' | 'murmur' | `start:${string}` | `end:${string}`;

/** One person as the sounds see them, kept between frames. */
export interface Hearing {
  x: number;
  z: number;
  /** Distance from the listener (metres). */
  d: number;
  walking: boolean;
  /** Up from their desk and standing still. */
  still: boolean;
  stage: Stage;
  gesture: string;
  steps: StepTracker;
  /** Seconds until they murmur, while chatting. */
  murmurIn: number;
  /** What this frame asks to play (refilled every frame, so nothing is allocated). */
  out: PersonEvent[];
}

export const newHearing = (): Hearing => ({
  x: 0,
  z: 0,
  d: Infinity,
  walking: false,
  still: false,
  stage: 'seated',
  gesture: 'none',
  steps: createStepTracker(),
  murmurIn: -1,
  out: [],
});

/** Everyone on the floor, and when the last murmur was (seconds). */
export interface Crowd {
  people: readonly Hearing[];
  lastMurmur: number;
}

/** This frame's body, as body.ts left it, plus the gesture they're making and how far they are from the listener. */
export interface Frame {
  stage: Stage;
  x: number;
  z: number;
  speed: number;
  phase: number;
  gesture: string;
  d: number;
}

/** How many other walkers are nearer the listener than `h`. */
export function nearerWalkers(people: readonly Hearing[], h: Hearing) {
  let n = 0;
  for (const o of people) if (o !== h && o.walking && o.d < h.d) n++;
  return n;
}

/** Someone else standing still within CHAT_RADIUS of `h`. */
export function chatting(people: readonly Hearing[], h: Hearing) {
  for (const o of people) if (o !== h && o.still && Math.hypot(o.x - h.x, o.z - h.z) <= CHAT_RADIUS) return true;
  return false;
}

const between = (r: number, { min, max }: { min: number; max: number }) => min + r * (max - min);

/**
 * Advance one person by a frame of `dt` seconds at clock `now` (seconds); `rand` is a random number in [0, 1).
 * Returns what to play in `h.out`.
 */
export function hearPerson(h: Hearing, f: Frame, crowd: Crowd, dt: number, now: number, rand: number): PersonEvent[] {
  const out = h.out;
  out.length = 0;
  const up = f.stage === 'up';
  h.x = f.x;
  h.z = f.z;
  h.d = f.d;
  h.walking = up && f.speed > WALKING;
  h.still = up && !h.walking;

  // the chair: rolled back as they get up, rolled in and settled into as they sit
  if (h.stage === 'seated' && f.stage !== 'seated') out.push('rise');
  else if (h.stage !== 'sitting' && h.stage !== 'seated' && f.stage === 'sitting') out.push('sit');
  else if (h.stage === 'sitting' && f.stage === 'seated') out.push('seated');
  h.stage = f.stage;

  const step = trackSteps(h.steps, f.phase, h.walking);
  if (step && h.d <= HEAR_RANGE && nearerWalkers(crowd.people, h) < MAX_WALKERS) out.push(step);

  if (f.gesture !== h.gesture) {
    if (h.gesture !== 'none') out.push(`end:${h.gesture}`);
    if (f.gesture !== 'none') out.push(`start:${f.gesture}`);
    h.gesture = f.gesture;
  }

  if (!h.still || !chatting(crowd.people, h)) h.murmurIn = -1;
  else if (h.murmurIn < 0) h.murmurIn = between(rand, FIRST_MURMUR);
  else if ((h.murmurIn -= dt) <= 0) {
    if (now - crowd.lastMurmur < MURMUR_SPACING) h.murmurIn = MURMUR_SPACING * rand;
    else {
      h.murmurIn = between(rand, MURMUR_GAP);
      if (h.d <= HEAR_RANGE) {
        crowd.lastMurmur = now;
        out.push('murmur');
      }
    }
  }
  return out;
}
