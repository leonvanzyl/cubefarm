// When the manager has stopped talking to the 🎙 (mic.ts). Speech shows up either as words the browser recognised or
// as microphone levels (recording for ElevenLabs); a short quiet after it means "done", and a mic that never hears
// anything closes. Pure, so it's tested without a microphone.
import { CLIP_MAX_MS } from '../../../shared/clipLimits';

/** Quiet after speech that means you've finished. */
export const SILENCE_MS = 1200;
/** How long a tapped 🎙 or the hands-free phone waits for you to start talking. */
export const NO_SPEECH_MS = 8000;
/** Below this level (RMS, 0-1) nothing counts as speech, however quiet the room. */
export const MIN_SPEECH_LEVEL = 0.02;
/** Speech is at least this many times the room's noise. */
export const SPEECH_RATIO = 3;
/** The room's noise is the quietest of the last this many levels (3 s at 20 a second): speech always has gaps. */
export const FLOOR_SAMPLES = 60;
/** The first levels only teach the mic the room. */
export const WARMUP_SAMPLES = 6;

/** How a session started: held (🎙 or V), tapped (listens until you stop talking), or opened by the hands-free phone. */
export type MicMode = 'hold' | 'tap' | 'handsfree';

/** What the mic has heard so far. Times are the caller's clock (performance.now()). */
export interface Ears {
  start: number;
  /** When speech was last heard; null until it starts. */
  lastSpeech: number | null;
  /** The latest microphone levels (RMS), newest last, at most FLOOR_SAMPLES. */
  levels: number[];
  /** How many levels it has heard in all. */
  heard: number;
}

export const freshEars = (now: number): Ears => ({ start: now, lastSpeech: null, levels: [], heard: 0 });

/** The room's noise: the quietest recent level. */
export const noiseFloor = (e: Ears) => (e.levels.length ? Math.min(...e.levels) : 0);

/** Words the browser is still recognising: someone is talking now. */
export const heardWords = (e: Ears, now: number): Ears => ({ ...e, lastSpeech: now });

/** One microphone level (about every 50 ms). Speech stands well above the room's noise, so a steady hum never counts. */
export function heardLevel(e: Ears, level: number, now: number): Ears {
  if (!Number.isFinite(level) || level < 0) return e;
  const levels = [...e.levels, level].slice(-FLOOR_SAMPLES);
  const speech = e.heard >= WARMUP_SAMPLES && level >= Math.max(MIN_SPEECH_LEVEL, noiseFloor({ ...e, levels }) * SPEECH_RATIO);
  return { ...e, levels, heard: e.heard + 1, lastSpeech: speech ? now : e.lastSpeech };
}

/** When a session ends by itself: after this quiet once speech was heard, with no speech this long, or at the cap. */
export interface ListenRules {
  silenceMs: number | null;
  noSpeechMs: number | null;
  maxMs: number;
}

/**
 * A held 🎙 listens until you let go (with auto-send on, also until you stop talking); a tap and the hands-free phone
 * end on a short quiet and give up when nobody speaks. Nothing listens longer than a clip may be.
 */
export function listenRules(mode: MicMode, autoSend: boolean): ListenRules {
  return {
    silenceMs: mode === 'hold' && !autoSend ? null : SILENCE_MS,
    noSpeechMs: mode === 'hold' ? null : NO_SPEECH_MS,
    maxMs: CLIP_MAX_MS,
  };
}

/** Whether what was heard is sent when listening ends by itself or by letting go: hands-free always, else with auto-send on. */
export const sendsWhenDone = (mode: MicMode, autoSend: boolean) => mode === 'handsfree' || autoSend;

export type Verdict = 'listening' | 'done' | 'no-speech' | 'too-long';

/** Whether to keep listening at `now`: 'done' (you've stopped talking), 'no-speech' (nobody spoke) or 'too-long'. */
export function verdict(e: Ears, now: number, rules: ListenRules): Verdict {
  if (now - e.start >= rules.maxMs) return 'too-long';
  if (e.lastSpeech === null) return rules.noSpeechMs !== null && now - e.start >= rules.noSpeechMs ? 'no-speech' : 'listening';
  return rules.silenceMs !== null && now - e.lastSpeech >= rules.silenceMs ? 'done' : 'listening';
}
