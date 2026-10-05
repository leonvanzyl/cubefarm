// The merge cheer's decisions, kept free of WebAudio so they can be tested: each agent's own cartoon voice (stable
// from their id and look), who gets a full voice (the nearest few) and who blends into the soft crowd layer, the
// scatter of start times that makes it a crowd and not a chord, and how often a cheer may play. cheerSfx.ts sings it.

import { MAX_DISTANCE } from './sfxMix';

/** Only this many cheerers, the nearest, get a voice of their own; the rest are one soft crowd layer. */
export const CHEER_VOICES = 6;
/** Each voice starts this many seconds after the arms go up, at random (0 to STAGGER_MAX). */
export const STAGGER_MAX = 0.35;
/** The whole cheer waits this long (seconds) so the gong's hit lands first. */
export const CHEER_LEAD = 0.14;
/** At most one cheer this often (ms): merges in a row don't stack. */
export const CHEER_GAP_MS = 4000;
/** Arms that go up later than this after the merge (a panel was covering the view) stay silent (ms). */
export const CHEER_LATE_MS = 1000;

export type CheerWord = 'woo' | 'yay' | 'hey';
/** What some cheerers add after their word: a second, smaller "woo", or three claps. */
export type CheerExtra = 'none' | 'woo' | 'clap';

/** One agent's cheering voice. */
export interface CheerVoice {
  /** The voice's pitch (Hz). */
  pitch: number;
  /** Formant scale: higher is a smaller, brighter-sounding head. */
  formant: number;
  word: CheerWord;
  extra: CheerExtra;
  /** 0-1: how much of the brighter second formant comes through. */
  bright: number;
}

/** FNV-1a: a stable 32-bit hash of a string. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32) giving numbers in [0, 1). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS: readonly CheerWord[] = ['woo', 'yay', 'hey'];

/** The voice an agent always cheers with, from their id and look. */
export function cheerVoice(id: string, look = ''): CheerVoice {
  const r = seeded(hashSeed(`${id}:${look}`));
  const high = look === 'feminine';
  const pitch = (high ? 300 : 210) + r() * (high ? 130 : 100);
  const formant = (high ? 1.08 : 0.96) + r() * 0.12;
  const word = WORDS[Math.floor(r() * WORDS.length) % WORDS.length];
  const e = r();
  const extra: CheerExtra = e < 0.3 ? 'woo' : e < 0.5 ? 'clap' : 'none';
  return { pitch: Math.round(pitch * 10) / 10, formant: Math.round(formant * 1000) / 1000, word, extra, bright: Math.round(r() * 100) / 100 };
}

/** Who sings what: indices into the cheerers, the nearest first. */
export interface CheerPlan {
  voiced: number[];
  crowd: number[];
}

/**
 * Splits cheerers (with their distance `d` from the listener, metres) into the nearest CHEER_VOICES who get a voice
 * each and the rest, who blend into one crowd layer. Anyone beyond MAX_DISTANCE isn't heard at all.
 */
export function planCheer(people: readonly { d: number }[], voices = CHEER_VOICES): CheerPlan {
  const heard: number[] = [];
  for (let i = 0; i < people.length; i++) if (people[i].d <= MAX_DISTANCE) heard.push(i);
  heard.sort((a, b) => people[a].d - people[b].d || a - b);
  return { voiced: heard.slice(0, voices), crowd: heard.slice(voices) };
}

/** A voice's start (seconds after the arms go up) for a random number `r` in [0, 1). */
export const stagger = (r: number) => Math.min(STAGGER_MAX, Math.max(0, r) * STAGGER_MAX);

/** How loud the crowd layer is (0-1) for `n` people in it: grows slowly, so a big floor never gets loud. */
export const crowdLevel = (n: number) => (n <= 0 ? 0 : Math.min(1, Math.sqrt(n) / 3));

/** Whether a cheer may play at `now` (ms), the last one having played at `last`, for a party that began at `startedAt`. */
export const mayCheer = (last: number, now: number, startedAt: number) => now - last >= CHEER_GAP_MS && now - startedAt <= CHEER_LATE_MS;
