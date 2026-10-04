// Every office sound, synthesized with WebAudio (no audio files). One shared AudioContext feeds a
// master gain, so volume and mute apply to everything at once; sounds in a group (footsteps, typing,
// toys, alerts) pass through that group's gain first. Audio is optional: when it's blocked or
// unavailable (headless browsers), sounds just don't play.

import { normalizeAudioPrefs, parseAudioPrefs, SOUND_GROUPS, sliderGain, type AudioPrefs, type SoundGroup } from './audioPrefs';

const PREFS_KEY = 'cubefarm:audio';

function loadPrefs(): AudioPrefs {
  try {
    return parseAudioPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parseAudioPrefs(null);
  }
}

let prefs = loadPrefs();
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
const groupGains: Partial<Record<SoundGroup, GainNode>> = {};
const groupLevels = {} as Record<SoundGroup, number>;
for (const g of SOUND_GROUPS) groupLevels[g] = sliderGain(prefs[g]);

const masterLevel = () => (prefs.muted ? 0 : sliderGain(prefs.volume));

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
      for (const g of SOUND_GROUPS) {
        const gain = ctx.createGain();
        gain.gain.value = groupLevels[g];
        gain.connect(master);
        groupGains[g] = gain;
      }
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

/** Glide a gain to a new level (a short ramp, so slider drags don't click). */
function glide(gain: GainNode, level: number) {
  if (!ctx) return;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.015);
  } catch {
    // audio is optional
  }
}

/** One sound group's level, 0-1 (default 1), under the master volume. */
export function setGroupLevel(group: SoundGroup, level: number) {
  groupLevels[group] = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 1));
  const gain = groupGains[group];
  if (gain) glide(gain, groupLevels[group]);
}

export function setAudioPrefs(patch: Partial<AudioPrefs>) {
  const clamped: Record<string, unknown> = { ...prefs, ...patch };
  for (const k of ['volume', ...SOUND_GROUPS] as const) clamped[k] = Math.max(0, Math.min(100, Number(clamped[k])));
  prefs = normalizeAudioPrefs(clamped);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
  if (master) glide(master, masterLevel());
  for (const g of SOUND_GROUPS) setGroupLevel(g, sliderGain(prefs[g]));
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
  group?: SoundGroup; // mixed under that group's level as well as the master volume
  pan?: number; // -1 (left) to 1 (right)
}

/** Route a voice to its group's gain (or straight to the master), through a stereo panner when it has a pan. */
function output(a: { ctx: AudioContext; out: GainNode }, pan?: number, group?: SoundGroup): AudioNode {
  const out = (group && groupGains[group]) || a.out;
  if (!pan || !a.ctx.createStereoPanner) return out;
  const p = a.ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  return p;
}

/** One enveloped oscillator note. */
export function tone({ freq, to, type = 'sine', at = 0, dur, peak, attack = 0.015, group, pan }: ToneOpts) {
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
    osc.connect(gain).connect(output(a, pan, group));
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
  group?: SoundGroup;
  pan?: number;
}

let noiseBuf: AudioBuffer | null = null;

/** A burst of filtered white noise: footsteps, whooshes, pops. */
export function noise({ at = 0, dur, peak, filter = 'lowpass', freq, to, q = 1, attack = 0.005, group, pan }: NoiseOpts) {
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
    src.connect(bq).connect(gain).connect(output(a, pan, group));
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
  [1046.5, 1568].forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.11, dur: 0.18, peak: 0.12, group: 'alerts' }));
}

/** The roomba's happy chirp: a quick rising warble and a bright little "boop". */
export function roombaChirp() {
  tone({ freq: 660, to: 1320, type: 'square', dur: 0.12, peak: 0.035, group: 'toys' });
  tone({ freq: 1320, to: 990, type: 'triangle', at: 0.12, dur: 0.1, peak: 0.08, group: 'toys' });
  tone({ freq: 1760, type: 'triangle', at: 0.24, dur: 0.18, peak: 0.07, group: 'toys' });
}

/** The elevator "ding": two soft sine tones. */
export function ding() {
  [880, 1318.5].forEach((freq, i) => tone({ freq, at: i * 0.16, dur: 1.1, peak: 0.18, attack: 0.02, group: 'alerts' }));
}

/** Air rushing past the elevator car while it travels, rising then settling. */
export function whoosh(dur = 0.75) {
  noise({ dur, peak: 0.1, filter: 'bandpass', freq: 220, to: 900, q: 0.8, attack: dur * 0.45, group: 'alerts' });
  tone({ freq: 70, to: 55, dur, peak: 0.05, attack: dur * 0.4, group: 'alerts' });
}

/** A foam blaster's "thwip": a puff of air through the barrel with a springy little pop. */
export function thwip() {
  noise({ dur: 0.09, peak: 0.1, filter: 'bandpass', freq: 2600, to: 900, q: 1.4, attack: 0.003, group: 'toys' });
  tone({ freq: 520, to: 190, type: 'triangle', dur: 0.08, peak: 0.07, attack: 0.004, group: 'toys' });
}

/** Someone hit by a toy: a soft, round "boop". */
export function boop() {
  tone({ freq: 520, to: 330, dur: 0.16, peak: 0.13, attack: 0.008, group: 'toys' });
  tone({ freq: 1040, to: 660, type: 'triangle', dur: 0.07, peak: 0.025, attack: 0.004, group: 'toys' });
}

/** The roomba sucking up a dart: a rising slurp of air with a little pop at the end. */
export function slurp() {
  noise({ dur: 0.28, peak: 0.07, filter: 'bandpass', freq: 350, to: 2400, q: 2.2, attack: 0.05, group: 'toys' });
  tone({ freq: 220, to: 660, type: 'triangle', dur: 0.24, peak: 0.035, attack: 0.03, group: 'toys' });
  noise({ at: 0.24, dur: 0.05, peak: 0.05, filter: 'bandpass', freq: 1800, q: 1.5, attack: 0.002, group: 'toys' });
}

/** A basket: the net's swish, then a small cheer. */
export function swish() {
  noise({ dur: 0.3, peak: 0.14, filter: 'bandpass', freq: 5200, to: 2600, q: 0.8, attack: 0.03, group: 'toys' });
  noise({ at: 0.18, dur: 0.9, peak: 0.05, filter: 'bandpass', freq: 900, to: 1500, q: 0.5, attack: 0.2, group: 'toys' });
  [784, 988, 1318.5].forEach((freq, i) => tone({ freq, type: 'triangle', at: 0.2 + i * 0.08, dur: 0.3, peak: 0.06, group: 'toys' }));
}

// ---------- event cues ----------

export type Cue = 'error' | 'qaFailed' | 'ready' | 'merged' | 'welcome';

const CUES: Record<Cue, { rank: number; play: () => void }> = {
  // An agent hit an error: a soft low buzz.
  error: {
    rank: 5,
    play: () => [0, 0.2].forEach((at) => tone({ freq: 110, type: 'sawtooth', at, dur: 0.16, peak: 0.035, attack: 0.02, group: 'alerts' })),
  },
  // QA failed a PR: a gentle descending "womp".
  qaFailed: {
    rank: 4,
    play: () => {
      tone({ freq: 392, to: 370, type: 'triangle', dur: 0.26, peak: 0.12, group: 'alerts' });
      tone({ freq: 311, to: 196, type: 'triangle', at: 0.26, dur: 0.55, peak: 0.12, group: 'alerts' });
    },
  },
  // A PR passed QA and is ready to merge: a short bright arpeggio.
  ready: {
    rank: 3,
    play: () => [784, 988, 1175, 1568].forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.07, dur: 0.28, peak: 0.09, group: 'alerts' })),
  },
  // A PR was merged: a pop and a little cheer.
  merged: {
    rank: 2,
    play: () => {
      noise({ dur: 0.07, peak: 0.16, filter: 'bandpass', freq: 1400, q: 1.2, attack: 0.002, group: 'alerts' });
      tone({ freq: 523, to: 1046, type: 'square', at: 0.04, dur: 0.12, peak: 0.04, group: 'alerts' });
      [1046.5, 1318.5, 1568].forEach((freq) => tone({ freq, type: 'triangle', at: 0.14, dur: 0.5, peak: 0.05, group: 'alerts' }));
      noise({ at: 0.12, dur: 0.6, peak: 0.03, filter: 'bandpass', freq: 2500, q: 0.6, attack: 0.08, group: 'alerts' });
    },
  },
  // A hire was approved or a new teammate arrived: a small welcome jingle.
  welcome: {
    rank: 1,
    play: () => [659, 784, 1046.5].forEach((freq, i) => tone({ freq, type: 'sine', at: i * 0.12, dur: i === 2 ? 0.5 : 0.2, peak: 0.12, group: 'alerts' })),
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
