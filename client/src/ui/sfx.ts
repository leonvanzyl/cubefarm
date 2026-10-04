// Every office sound, synthesized with WebAudio (no audio files). One shared AudioContext feeds a
// master gain, so volume and mute apply to everything at once. Audio is optional: when it's blocked
// or unavailable (headless browsers), sounds just don't play.

export interface AudioPrefs {
  volume: number; // 0-100
  muted: boolean;
}

const PREFS_KEY = 'cubefarm:audio';

function loadPrefs(): AudioPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<AudioPrefs> | null;
    const volume = Number(p?.volume);
    return { volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 70, muted: p?.muted === true };
  } catch {
    return { volume: 70, muted: false };
  }
}

let prefs = loadPrefs();
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

// Perceived loudness is roughly logarithmic, so the slider maps to a squared gain.
const masterLevel = () => (prefs.muted ? 0 : (prefs.volume / 100) ** 2);

/** The shared context and master gain, or null until the first user gesture / when audio is unavailable. */
export function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!unlocked) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    // Don't queue sounds on a stopped clock: they'd all fire at once when it starts.
    return ctx.state === 'running' && master ? { ctx, out: master } : null;
  } catch {
    return null;
  }
}

/** Start audio from a user gesture ("Enter the office", or any first click/key). */
export function unlockAudio() {
  unlocked = true;
  audio();
}

for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlockAudio, { once: true, capture: true });

// ---------- volume & mute ----------

export const getAudioPrefs = () => prefs;

export function subscribeAudio(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function setAudioPrefs(patch: Partial<AudioPrefs>) {
  prefs = { ...prefs, ...patch, volume: Math.max(0, Math.min(100, Math.round(patch.volume ?? prefs.volume))) };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
  if (ctx && master) {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.015);
    } catch {
      // audio is optional
    }
  }
  for (const fn of listeners) fn();
}

export const toggleMute = () => setAudioPrefs({ muted: !prefs.muted });

// ---------- building blocks (exported so toys can add their sounds through the same mixer) ----------

export interface ToneOpts {
  freq: number;
  to?: number; // glide to this frequency by the end
  type?: OscillatorType;
  at?: number; // seconds from now
  dur: number;
  peak: number; // 0-1, before the master volume
  attack?: number;
  pan?: number; // -1 (left) to 1 (right)
}

/** Route a voice to the master gain, through a stereo panner when it has a pan. */
function output(a: { ctx: AudioContext; out: GainNode }, pan?: number): AudioNode {
  if (!pan || !a.ctx.createStereoPanner) return a.out;
  const p = a.ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(a.out);
  return p;
}

/** One enveloped oscillator note. */
export function tone({ freq, to, type = 'sine', at = 0, dur, peak, attack = 0.015, pan }: ToneOpts) {
  const a = audio();
  if (!a) return;
  try {
    const t0 = a.ctx.currentTime + at;
    const osc = a.ctx.createOscillator();
    const gain = a.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(output(a, pan));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // audio is optional
  }
}

export interface NoiseOpts {
  at?: number;
  dur: number;
  peak: number;
  filter?: BiquadFilterType;
  freq: number; // filter frequency
  to?: number; // sweep the filter to this frequency by the end
  q?: number;
  attack?: number;
  pan?: number;
}

let noiseBuf: AudioBuffer | null = null;

/** A burst of filtered white noise: footsteps, whooshes, pops. */
export function noise({ at = 0, dur, peak, filter = 'lowpass', freq, to, q = 1, attack = 0.005, pan }: NoiseOpts) {
  const a = audio();
  if (!a) return;
  try {
    if (!noiseBuf || noiseBuf.sampleRate !== a.ctx.sampleRate) {
      noiseBuf = a.ctx.createBuffer(1, a.ctx.sampleRate * 2, a.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = a.ctx.currentTime + at;
    const src = a.ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bq = a.ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(freq, t0);
    if (to) bq.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = a.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq).connect(gain).connect(output(a, pan));
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  } catch {
    // audio is optional
  }
}

// ---------- the office's sounds ----------

let lastChirp = -Infinity;

/** The phone's message chirp: two quick rising blips (messages that arrive together chirp once). */
export function chirp() {
  if (performance.now() - lastChirp < 800) return;
  lastChirp = performance.now();
  [1046.5, 1568].forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.11, dur: 0.18, peak: 0.12 }));
}

/** The roomba's happy chirp: a quick rising warble and a bright little "boop". */
export function roombaChirp() {
  tone({ freq: 660, to: 1320, type: 'square', dur: 0.12, peak: 0.035 });
  tone({ freq: 1320, to: 990, type: 'triangle', at: 0.12, dur: 0.1, peak: 0.08 });
  tone({ freq: 1760, type: 'triangle', at: 0.24, dur: 0.18, peak: 0.07 });
}

/** The elevator "ding": two soft sine tones. */
export function ding() {
  [880, 1318.5].forEach((freq, i) => tone({ freq, at: i * 0.16, dur: 1.1, peak: 0.18, attack: 0.02 }));
}

/** Air rushing past the elevator car while it travels, rising then settling. */
export function whoosh(dur = 0.75) {
  noise({ dur, peak: 0.1, filter: 'bandpass', freq: 220, to: 900, q: 0.8, attack: dur * 0.45 });
  tone({ freq: 70, to: 55, dur, peak: 0.05, attack: dur * 0.4 });
}

/** A foam blaster's "thwip": a puff of air through the barrel with a springy little pop. */
export function thwip() {
  noise({ dur: 0.09, peak: 0.1, filter: 'bandpass', freq: 2600, to: 900, q: 1.4, attack: 0.003 });
  tone({ freq: 520, to: 190, type: 'triangle', dur: 0.08, peak: 0.07, attack: 0.004 });
}

/** Someone hit by a toy: a soft, round "boop". */
export function boop() {
  tone({ freq: 520, to: 330, dur: 0.16, peak: 0.13, attack: 0.008 });
  tone({ freq: 1040, to: 660, type: 'triangle', dur: 0.07, peak: 0.025, attack: 0.004 });
}

/** The roomba sucking up a dart: a rising slurp of air with a little pop at the end. */
export function slurp() {
  noise({ dur: 0.28, peak: 0.07, filter: 'bandpass', freq: 350, to: 2400, q: 2.2, attack: 0.05 });
  tone({ freq: 220, to: 660, type: 'triangle', dur: 0.24, peak: 0.035, attack: 0.03 });
  noise({ at: 0.24, dur: 0.05, peak: 0.05, filter: 'bandpass', freq: 1800, q: 1.5, attack: 0.002 });
}

/** A basket: the net's swish, then a small cheer. */
export function swish() {
  noise({ dur: 0.3, peak: 0.14, filter: 'bandpass', freq: 5200, to: 2600, q: 0.8, attack: 0.03 });
  noise({ at: 0.18, dur: 0.9, peak: 0.05, filter: 'bandpass', freq: 900, to: 1500, q: 0.5, attack: 0.2 });
  [784, 988, 1318.5].forEach((freq, i) => tone({ freq, type: 'triangle', at: 0.2 + i * 0.08, dur: 0.3, peak: 0.06 }));
}

// ---------- event cues ----------

export type Cue = 'error' | 'qaFailed' | 'ready' | 'merged' | 'welcome';

const CUES: Record<Cue, { rank: number; play: () => void }> = {
  // An agent hit an error: a soft low buzz.
  error: {
    rank: 5,
    play: () => [0, 0.2].forEach((at) => tone({ freq: 110, type: 'sawtooth', at, dur: 0.16, peak: 0.035, attack: 0.02 })),
  },
  // QA failed a PR: a gentle descending "womp".
  qaFailed: {
    rank: 4,
    play: () => {
      tone({ freq: 392, to: 370, type: 'triangle', dur: 0.26, peak: 0.12 });
      tone({ freq: 311, to: 196, type: 'triangle', at: 0.26, dur: 0.55, peak: 0.12 });
    },
  },
  // A PR passed QA and is ready to merge: a short bright arpeggio.
  ready: {
    rank: 3,
    play: () => [784, 988, 1175, 1568].forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.07, dur: 0.28, peak: 0.09 })),
  },
  // A PR was merged: a pop and a little cheer.
  merged: {
    rank: 2,
    play: () => {
      noise({ dur: 0.07, peak: 0.16, filter: 'bandpass', freq: 1400, q: 1.2, attack: 0.002 });
      tone({ freq: 523, to: 1046, type: 'square', at: 0.04, dur: 0.12, peak: 0.04 });
      [1046.5, 1318.5, 1568].forEach((freq) => tone({ freq, type: 'triangle', at: 0.14, dur: 0.5, peak: 0.05 }));
      noise({ at: 0.12, dur: 0.6, peak: 0.03, filter: 'bandpass', freq: 2500, q: 0.6, attack: 0.08 });
    },
  },
  // A hire was approved or a new teammate arrived: a small welcome jingle.
  welcome: {
    rank: 1,
    play: () => [659, 784, 1046.5].forEach((freq, i) => tone({ freq, type: 'sine', at: i * 0.12, dur: i === 2 ? 0.5 : 0.2, peak: 0.12 })),
  },
};

const GATHER_MS = 150; // cues that arrive together are gathered, and only the most important plays
const GAP_MS = 1000; // at most one cue a second
let pending: Cue | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRank = 0;
let lastAt = -Infinity;

const better = (a: Cue | null, b: Cue) => (a && CUES[a].rank >= CUES[b].rank ? a : b);

/** Play an event cue, rate-limited: bursts collapse into their most important cue. */
export function cue(c: Cue) {
  const now = performance.now();
  // Inside the gap after a cue, only something more important than what just played gets through.
  if (now - lastAt < GAP_MS && CUES[c].rank <= lastRank && !pending) return;
  pending = better(pending, c);
  if (timer) return;
  timer = setTimeout(flush, Math.max(GATHER_MS, lastAt + GAP_MS - now));
}

function flush() {
  timer = null;
  const c = pending;
  pending = null;
  if (!c) return;
  lastAt = performance.now();
  lastRank = CUES[c].rank;
  CUES[c].play();
}
