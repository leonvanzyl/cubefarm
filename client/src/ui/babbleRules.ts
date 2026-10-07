// The babble voices' decisions, free of WebAudio so they're tested: each agent's own seeded voice (pitch, range,
// timbre, speed and the sing-song "accent" their syllables follow), a line of text as syllables and then as timed
// blips with a pitch and two formants each (Animal Crossing style gibberish), how many may speak at once (the nearest
// win) and how often (the chatter level's pace). babble.ts sings it; Chatter.tsx runs the talking.

import type { AgentLook, AgentRole } from '../../../shared/types';
import type { ChatterLevel } from './audioPrefs';
import { hashSeed, seeded } from './cheerRules';
import { DROP_NEW, PLAY } from './sfxMix';

/** One agent's babble voice. */
export interface BabbleVoice {
  /** The voice's middle pitch (Hz). */
  pitch: number;
  /** How far (semitones) the syllables wander from it. */
  range: number;
  /** The timbre's raw buzz: soft (triangle), hollow (square) or bright (sawtooth). */
  wave: 'triangle' | 'square' | 'sawtooth';
  /** Formant scale: above 1 a smaller, brighter-sounding head. */
  formant: number;
  /** Syllables a second. */
  rate: number;
  /** Their accent: a repeating pattern of steps (semitones, scaled by `range`) the syllables follow. */
  accent: number[];
  /** 0-1: how much breath the consonants have. */
  breath: number;
}

const WAVES: readonly BabbleVoice['wave'][] = ['triangle', 'triangle', 'square', 'square', 'sawtooth'];
const round = (n: number, k = 100) => Math.round(n * k) / k;

/** The voice someone always babbles with, from their id and look. The CEO's is lower, slower and grander. */
export function babbleVoice(id: string, look: AgentLook | '' = '', role: AgentRole = 'agent'): BabbleVoice {
  const r = seeded(hashSeed(`babble:${id}:${look}`));
  const high = look === 'feminine';
  if (role === 'ceo') {
    return { pitch: round((high ? 245 : 140) + r() * 30, 10), range: 3, wave: 'sawtooth', formant: round(0.88 + r() * 0.06, 1000), rate: round(7 + r(), 10), accent: [0, -2, 3, -1, -4], breath: 0.25 };
  }
  const pitch = (high ? 330 : 215) + r() * (high ? 150 : 115);
  const range = 3 + r() * 5;
  const wave = WAVES[Math.floor(r() * WAVES.length) % WAVES.length];
  const formant = (high ? 1.05 : 0.95) + r() * 0.22;
  const rate = 10 + r() * 5;
  const accent = [0, ...Array.from({ length: 3 }, () => Math.round((r() * 2 - 1) * 5))];
  return { pitch: round(pitch, 10), range: round(range, 10), wave, formant: round(formant, 1000), rate: round(rate, 10), accent, breath: round(0.15 + r() * 0.6) };
}

// ---------- a line as syllables ----------

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
/** How a syllable starts: a stop (p, t, k…), a hiss (s, f, sh…), a hum (m, n), a glide (l, r, w) or straight on the vowel. */
export type Onset = 'stop' | 'hiss' | 'hum' | 'glide' | 'none';
/** The line's tune: a statement, a question (rises at the end), an exclamation (higher, punchier) or trailing off. */
export type Tune = 'say' | 'ask' | 'exclaim' | 'trail';

export interface Syllable {
  vowel: Vowel;
  onset: Onset;
  /** The gap after it, in syllable steps: none inside a word, a little between words, more at a comma or a full stop. */
  pause: number;
}

/** A long line babbles its first this-many syllables: a line is a second or two of voice, never a speech. */
export const MAX_SYLLABLES = 18;

const ONSETS: [RegExp, Onset][] = [
  [/[pbtdkgcq]/, 'stop'],
  [/[sfvzhxj]/, 'hiss'],
  [/[mn]/, 'hum'],
  [/[lrwy]/, 'glide'],
];
const onsetOf = (c: string | undefined): Onset => (c ? (ONSETS.find(([re]) => re.test(c))?.[1] ?? 'none') : 'none');
const DIGIT_VOWELS: Record<string, Vowel> = { '0': 'o', '1': 'a', '2': 'u', '3': 'i', '4': 'o', '5': 'a', '6': 'i', '7': 'e', '8': 'e', '9': 'a' };

export function tuneOf(text: string): Tune {
  const t = text.replace(/[^\p{L}\p{N}.!?…]+$/u, '');
  if (/\?\S*$/.test(t)) return 'ask';
  if (/!\S*$/.test(t)) return 'exclaim';
  if (/(…|\.\.\.)$/.test(t)) return 'trail';
  return 'say';
}

/** The syllables of a line: a vowel group each, numbers digit by digit; emoji and symbols are silent. */
export function syllables(text: string, max = MAX_SYLLABLES): Syllable[] {
  const out: Syllable[] = [];
  const words = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/);
  for (const word of words) {
    const core = word.replace(/[^a-z0-9]/g, '');
    if (!core) continue;
    const tail = word.match(/[^a-z0-9]*$/)![0];
    const end = /[.!?…]/.test(tail) ? 1.6 : /[,;:]/.test(tail) ? 1.2 : 0.4;
    const parts: Syllable[] = [];
    for (const chunk of core.match(/[0-9]|[^aeiouy0-9]*[aeiouy]+|[^aeiouy0-9]+/g) ?? []) {
      if (/^[0-9]$/.test(chunk)) parts.push({ vowel: DIGIT_VOWELS[chunk], onset: chunk === '1' || chunk === '8' ? 'none' : 'hiss', pause: 0 });
      else if (/[aeiouy]/.test(chunk)) {
        const v = chunk.match(/[aeiouy]/)![0];
        const lead = chunk.slice(0, chunk.indexOf(v));
        parts.push({ vowel: (v === 'y' ? 'i' : v) as Vowel, onset: onsetOf(lead[lead.length - 1]), pause: 0 });
      } else if (!parts.length) parts.push({ vowel: 'e', onset: onsetOf(chunk[0]), pause: 0 }); // "pr", "ci": a letter's worth
    }
    if (!parts.length) continue;
    parts[parts.length - 1].pause = end;
    out.push(...parts);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

// ---------- the blips ----------

/** The first two formants of each vowel (Hz) for a mid-sized head; a voice's `formant` scales them. */
export const FORMANTS: Record<Vowel, [number, number]> = { a: [800, 1250], e: [520, 1900], i: [320, 2350], o: [520, 920], u: [360, 820] };

/** One syllable's blip: when (s from the start), how long, its pitch gliding from `freq` to `to`, its formants and level (0-1). */
export interface BabbleNote {
  at: number;
  dur: number;
  freq: number;
  to: number;
  f1: number;
  f2: number;
  onset: Onset;
  level: number;
}

/** How fast each tune falls over the line (semitones a syllable): a question doesn't, a trailing line sinks. */
const DECLINE: Record<Tune, number> = { say: 0.12, ask: 0, exclaim: 0.08, trail: 0.35 };

/** A line in a voice: its blips and how long it lasts (s). `rand` gives numbers in [0, 1): a little life in each line. */
export function planBabble(text: string, v: BabbleVoice, rand: () => number = Math.random): { notes: BabbleNote[]; length: number } {
  const syl = syllables(text);
  const tune = tuneOf(text);
  const step = 1 / v.rate;
  const notes: BabbleNote[] = [];
  let t = 0;
  syl.forEach((s, i) => {
    const last = i === syl.length - 1;
    let semis = v.accent[i % v.accent.length] * (v.range / 5) + (rand() * 2 - 1) * 0.8 - DECLINE[tune] * i;
    if (tune === 'exclaim') semis += 2;
    if (tune === 'ask' && i >= syl.length - 2) semis += last ? 5 : 2;
    const freq = v.pitch * 2 ** (semis / 12);
    const glide = tune === 'ask' && last ? 1.25 : tune === 'trail' && last ? 0.85 : last ? 0.92 : 0.97;
    const [f1, f2] = FORMANTS[s.vowel];
    notes.push({
      at: round(t, 1000),
      dur: round(step * (s.pause ? 0.95 : 0.78) * (last ? 1.5 : 1), 1000),
      freq: round(freq),
      to: round(freq * glide),
      f1: Math.round(f1 * v.formant),
      f2: Math.round(f2 * v.formant),
      onset: s.onset,
      level: round((tune === 'exclaim' ? 1 : 0.85) * (i % 2 ? 0.85 : 1) * (0.9 + rand() * 0.1)),
    });
    t += step * (1 + s.pause);
  });
  const end = notes[notes.length - 1];
  return { notes, length: end ? round(end.at + end.dur, 1000) : 0 };
}

/** How long a line's bubble stays up (s): long enough to read it. */
export const bubbleSeconds = (text: string) => Math.min(5.5, Math.max(2.4, 1.6 + text.length * 0.06));

// ---------- who speaks, and how often ----------

/** At most this many people speak at once on a floor. */
export const MAX_SPEAKERS = 3;

/**
 * Whether a new line from someone `d` metres away may start while `active` people speak: PLAY when there's room,
 * DROP_NEW when it's full of nearer (or as near) voices, else the index of the farthest one, whom the new one cuts off.
 */
export function admitSpeaker(active: readonly { d: number }[], d: number, cap = MAX_SPEAKERS): number {
  if (active.length < cap) return PLAY;
  let far = -1;
  for (let i = 0; i < active.length; i++) if (far < 0 || active[i].d > active[far].d) far = i;
  return far < 0 || d >= active[far].d ? DROP_NEW : far;
}

/** Why a line is said: the player said hi, something happened, a chat at the cooler, or just their work (lively). */
export type Priority = 'greet' | 'event' | 'chat' | 'ambient';

export interface Pace {
  /** Seconds between someone's lines about their work (ambient), and the least between any two lines on the floor. */
  agentGap: number;
  floorGap: number;
  /** Seconds between a busy person's lines about what they're doing (null: they don't), and the CEO's musings. */
  ambient: readonly [number, number] | null;
  ceo: readonly [number, number];
}

export const PACE: Record<Exclude<ChatterLevel, 'off'>, Pace> = {
  quiet: { agentGap: 20, floorGap: 3, ambient: null, ceo: [60, 120] },
  lively: { agentGap: 7, floorGap: 1.2, ambient: [14, 32], ceo: [25, 55] },
};

/** One person never starts lines closer together than this (s), whatever happened. */
export const EVENT_GAP = 3;
/** Lines that can't be said within this long (s) of what made them are dropped: old news. */
export const LINE_TTL = 8;

/**
 * Whether a line may start now (s): a greeting or a chat line always may (they have their own pace); news waits for
 * the floor's gap and EVENT_GAP since that person last spoke; small talk about work also waits out the person's gap.
 */
export function mayTalk(priority: Priority, pace: Pace, now: number, agentLast: number, floorLast: number): boolean {
  if (priority === 'greet' || priority === 'chat') return true;
  if (now - floorLast < pace.floorGap * (priority === 'ambient' ? 2 : 1)) return false;
  return now - agentLast >= (priority === 'ambient' ? pace.agentGap : EVENT_GAP);
}
