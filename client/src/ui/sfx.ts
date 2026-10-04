// Every office sound, synthesized with WebAudio (no audio files). One shared AudioContext: sounds go
// through their group's gain (footsteps, typing, toys, alerts; or straight on), then the master gain, so
// volume and mute apply to everything at once, then a gentle compressor. Sounds placed in the world pan
// and fade with distance from the camera (SoundListener.tsx). Audio is optional: when it's blocked or
// unavailable (headless browsers), sounds just don't play, but window.__swarmSfx still records them.

import { normalizeAudioPrefs, parseAudioPrefs, SOUND_GROUPS, sliderGain, type AudioPrefs, type SoundGroup } from './audioPrefs';
import { audible, distance, distanceGain, DROP_NEW, MAX_DISTANCE, panOf, PLAY, REF_DISTANCE, ROLLOFF, type Vec3, voiceToDrop } from './sfxMix';

export type { SoundGroup } from './audioPrefs';
export type { Vec3 } from './sfxMix';

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

const COMPRESSOR_TRIM = 10 ** (-2.81 / 20);

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
      // Gentle: it only touches the loudest moments (many sounds at once), so single sounds are unchanged.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      // The compressor adds its own makeup gain (+2.8 dB for these settings, measured in Chromium): take it back off.
      const trim = ctx.createGain();
      trim.gain.value = COMPRESSOR_TRIM;
      master.connect(comp).connect(trim).connect(ctx.destination);
      for (const g of SOUND_GROUPS) {
        const gain = ctx.createGain();
        gain.gain.value = groupLevels[g];
        gain.connect(master);
        groupGains[g] = gain;
      }
      writeListener();
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

// ---------- the listener (the camera's ears) ----------

const ear = { x: 0, y: 1.65, z: 10 };
const earFwd = { x: 0, y: 0, z: -1 };
const earUp = { x: 0, y: 1, z: 0 };

function writeListener() {
  const l = ctx?.listener;
  if (!l) return;
  try {
    if (l.positionX) {
      l.positionX.value = ear.x;
      l.positionY.value = ear.y;
      l.positionZ.value = ear.z;
      l.forwardX.value = earFwd.x;
      l.forwardY.value = earFwd.y;
      l.forwardZ.value = earFwd.z;
      l.upX.value = earUp.x;
      l.upY.value = earUp.y;
      l.upZ.value = earUp.z;
    } else {
      // Older browsers (Firefox) only have the deprecated setters.
      l.setPosition(ear.x, ear.y, ear.z);
      l.setOrientation(earFwd.x, earFwd.y, earFwd.z, earUp.x, earUp.y, earUp.z);
    }
  } catch {
    // audio is optional
  }
}

/** Where the listener is and which way it faces (world metres, unit vectors). Called every frame: allocates nothing. */
export function setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) {
  ear.x = px;
  ear.y = py;
  ear.z = pz;
  earFwd.x = fx;
  earFwd.y = fy;
  earFwd.z = fz;
  earUp.x = ux;
  earUp.y = uy;
  earUp.z = uz;
  if (ctx?.state === 'running') writeListener();
}

// ---------- the probe (window.__swarmSfx) ----------

/** One sound that was asked for, as recorded for QA and e2e. */
export interface SfxRecord {
  name: string;
  group: SoundGroup | null;
  /** Where in the world, or null for a non-positional sound. */
  at: Vec3 | null;
  /** Peak after distance and the group level, before the master volume (0 when culled for distance). */
  gain: number;
  /** -1 (left) to 1 (right) from where the listener faces; a non-positional sound's own `pan` (default 0). */
  pan: number;
  /** Whether it was actually scheduled (false while locked, unavailable, too far away or over the voice cap). */
  played: boolean;
  /** performance.now() when it was asked for. */
  t: number;
}

const PROBE_SIZE = 50;
const probe: SfxRecord[] = [];
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmSfx = probe;

/**
 * Records a sound in window.__swarmSfx (the last 50). tone() and noise() call it themselves; long-lived loops call it
 * when they start. `peak` is the sound's level before distance; returns the record so `played` can be set later.
 */
export function recordSfx(
  name: string,
  { group, pos, pan = 0, peak, played = false }: { group?: SoundGroup; pos?: Vec3; pan?: number; peak: number; played?: boolean },
) {
  const d = pos ? distance(ear, pos) : 0;
  const rec: SfxRecord = {
    name,
    group: group ?? null,
    at: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    gain: (!pos || audible(d) ? peak * (pos ? distanceGain(d) : 1) : 0) * (group ? groupLevels[group] : 1),
    pan: pos ? panOf(ear, earFwd, earUp, pos) : pan,
    played,
    t: performance.now(),
  };
  probe.push(rec);
  if (probe.length > PROBE_SIZE) probe.splice(0, probe.length - PROBE_SIZE);
  return rec;
}

// ---------- routing (exported for long-lived loops that manage their own nodes) ----------

/** Where a sound of this group connects (its group gain, or the master without one), or null while audio is off. */
export function groupOutput(group?: SoundGroup): AudioNode | null {
  const a = audio();
  if (!a) return null;
  return (group && groupGains[group]) || a.out;
}

/** A PannerNode with the office's distance model, placed at `pos`. Connect it to groupOutput(). */
export function createPanner(c: BaseAudioContext, pos: Vec3) {
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = REF_DISTANCE;
  p.rolloffFactor = ROLLOFF;
  p.maxDistance = MAX_DISTANCE;
  setPannerPosition(p, pos.x, pos.y, pos.z);
  return p;
}

/** Moves a panner (safe to call every frame: allocates nothing). */
export function setPannerPosition(p: PannerNode, x: number, y: number, z: number) {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else p.setPosition(x, y, z);
}

// ---------- voices ----------

interface Voice {
  end: number; // context time it finishes
  loud: number;
  env: GainNode;
  src: AudioScheduledSourceNode;
}

const voices: Voice[] = [];

/** Options every building block takes. */
export interface PlaceOpts {
  /** For __swarmSfx. */
  name?: string;
  /** Mixer group; without one the sound goes straight to the master gain. */
  group?: SoundGroup;
  /** Where in the world (metres): the sound pans and fades with distance, and isn't played beyond ~16 m. */
  pos?: Vec3;
  /** A fixed stereo position, -1 (left) to 1 (right), for sounds without `pos` (the player's own feet). */
  pan?: number;
}

/**
 * Records a sound for the probe and decides whether it plays. Returns where to connect it (a panner, its group or
 * the master) and its loudness for the voice cap, or null to skip it.
 */
function place(kind: string, { name, group, pos, pan }: PlaceOpts, peak: number): { a: { ctx: AudioContext; out: GainNode }; dest: AudioNode; loud: number } | null {
  const rec = recordSfx(name ?? kind, { group, pos, pan, peak });
  const d = pos ? distance(ear, pos) : 0;
  if (pos && !audible(d)) return null;
  const loud = peak * (pos ? distanceGain(d) : 1);
  const a = audio();
  if (!a) return null;

  const now = a.ctx.currentTime;
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
  const drop = voiceToDrop(voices, loud);
  if (drop === DROP_NEW) return null;
  if (drop !== PLAY) {
    const v = voices[drop];
    voices.splice(drop, 1);
    try {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setTargetAtTime(0, now, 0.01);
      v.src.stop(now + 0.06);
    } catch {
      // already stopped
    }
  }

  let dest: AudioNode = (group && groupGains[group]) || a.out;
  try {
    if (pos) {
      const p = createPanner(a.ctx, pos);
      p.connect(dest);
      dest = p;
    } else if (pan && a.ctx.createStereoPanner) {
      const p = a.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(dest);
      dest = p;
    }
  } catch {
    return null;
  }
  rec.played = true;
  return { a, dest, loud };
}

// ---------- building blocks (exported so toys can add their sounds through the same mixer) ----------

export interface ToneOpts extends PlaceOpts {
  freq: number;
  to?: number; // glide to this frequency by the end
  type?: OscillatorType;
  at?: number; // seconds from now
  dur: number;
  peak: number; // 0-1, before the master volume
  attack?: number;
}

/** One enveloped oscillator note. */
export function tone(opts: ToneOpts) {
  const { freq, to, type = 'sine', at = 0, dur, peak, attack = 0.015 } = opts;
  const p = place('tone', opts, peak);
  if (!p) return;
  const a = p.a;
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
    osc.connect(gain).connect(p.dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    voices.push({ end: t0 + dur + 0.05, loud: p.loud, env: gain, src: osc });
  } catch {
    // audio is optional
  }
}

export interface NoiseOpts extends PlaceOpts {
  at?: number;
  dur: number;
  peak: number;
  filter?: BiquadFilterType;
  freq: number; // filter frequency
  to?: number; // sweep the filter to this frequency by the end
  q?: number;
  attack?: number;
}

let noiseBuf: AudioBuffer | null = null;

/** A burst of filtered white noise: footsteps, whooshes, pops. */
export function noise(opts: NoiseOpts) {
  const { at = 0, dur, peak, filter = 'lowpass', freq, to, q = 1, attack = 0.005 } = opts;
  const p = place('noise', opts, peak);
  if (!p) return;
  const a = p.a;
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
    src.connect(bq).connect(gain).connect(p.dest);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
    voices.push({ end: t0 + dur + 0.05, loud: p.loud, env: gain, src });
  } catch {
    // audio is optional
  }
}

// For QA: __swarmSfxPing(x, y, z) plays a soft test blip at that spot, to hear (and see in __swarmSfx) it pan and fade.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmSfxPing = (x: number, y: number, z: number) =>
    tone({ name: 'ping', group: 'alerts', pos: { x, y, z }, freq: 880, type: 'triangle', dur: 0.3, peak: 0.12 });
}

// ---------- the office's sounds ----------

let lastChirp = -Infinity;

/** The phone's message chirp: two quick rising blips (messages that arrive together chirp once). */
export function chirp() {
  if (performance.now() - lastChirp < 800) return;
  lastChirp = performance.now();
  [1046.5, 1568].forEach((freq, i) => tone({ name: 'chirp', group: 'alerts', freq, type: 'triangle', at: i * 0.11, dur: 0.18, peak: 0.12 }));
}

/** The roomba's happy chirp, from where it is: a quick rising warble and a bright little "boop". */
export function roombaChirp(pos: Vec3) {
  const o = { name: 'roomba:chirp', group: 'toys', pos } as const;
  tone({ ...o, freq: 660, to: 1320, type: 'square', dur: 0.12, peak: 0.035 });
  tone({ ...o, freq: 1320, to: 990, type: 'triangle', at: 0.12, dur: 0.1, peak: 0.08 });
  tone({ ...o, freq: 1760, type: 'triangle', at: 0.24, dur: 0.18, peak: 0.07 });
}

/** The elevator "ding": two soft sine tones. */
export function ding() {
  [880, 1318.5].forEach((freq, i) => tone({ name: 'ding', group: 'alerts', freq, at: i * 0.16, dur: 1.1, peak: 0.18, attack: 0.02 }));
}

/** Air rushing past the elevator car while it travels, rising then settling. */
export function whoosh(dur = 0.75) {
  noise({ name: 'whoosh', group: 'alerts', dur, peak: 0.1, filter: 'bandpass', freq: 220, to: 900, q: 0.8, attack: dur * 0.45 });
  tone({ name: 'whoosh', group: 'alerts', freq: 70, to: 55, dur, peak: 0.05, attack: dur * 0.4 });
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
export function slurp(pos: Vec3) {
  const o = { name: 'roomba:slurp', group: 'toys', pos } as const;
  noise({ ...o, dur: 0.28, peak: 0.07, filter: 'bandpass', freq: 350, to: 2400, q: 2.2, attack: 0.05 });
  tone({ ...o, freq: 220, to: 660, type: 'triangle', dur: 0.24, peak: 0.035, attack: 0.03 });
  noise({ ...o, at: 0.24, dur: 0.05, peak: 0.05, filter: 'bandpass', freq: 1800, q: 1.5, attack: 0.002 });
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
    play: () => [0, 0.2].forEach((at) => tone({ name: 'cue:error', group: 'alerts', freq: 110, type: 'sawtooth', at, dur: 0.16, peak: 0.035, attack: 0.02 })),
  },
  // QA failed a PR: a gentle descending "womp".
  qaFailed: {
    rank: 4,
    play: () => {
      tone({ name: 'cue:qaFailed', group: 'alerts', freq: 392, to: 370, type: 'triangle', dur: 0.26, peak: 0.12 });
      tone({ name: 'cue:qaFailed', group: 'alerts', freq: 311, to: 196, type: 'triangle', at: 0.26, dur: 0.55, peak: 0.12 });
    },
  },
  // A PR passed QA and is ready to merge: a short bright arpeggio.
  ready: {
    rank: 3,
    play: () => [784, 988, 1175, 1568].forEach((freq, i) => tone({ name: 'cue:ready', group: 'alerts', freq, type: 'triangle', at: i * 0.07, dur: 0.28, peak: 0.09 })),
  },
  // A PR was merged: a pop and a little cheer.
  merged: {
    rank: 2,
    play: () => {
      noise({ name: 'cue:merged', group: 'alerts', dur: 0.07, peak: 0.16, filter: 'bandpass', freq: 1400, q: 1.2, attack: 0.002 });
      tone({ name: 'cue:merged', group: 'alerts', freq: 523, to: 1046, type: 'square', at: 0.04, dur: 0.12, peak: 0.04 });
      [1046.5, 1318.5, 1568].forEach((freq) => tone({ name: 'cue:merged', group: 'alerts', freq, type: 'triangle', at: 0.14, dur: 0.5, peak: 0.05 }));
      noise({ name: 'cue:merged', group: 'alerts', at: 0.12, dur: 0.6, peak: 0.03, filter: 'bandpass', freq: 2500, q: 0.6, attack: 0.08 });
    },
  },
  // A hire was approved or a new teammate arrived: a small welcome jingle.
  welcome: {
    rank: 1,
    play: () => [659, 784, 1046.5].forEach((freq, i) => tone({ name: 'cue:welcome', group: 'alerts', freq, type: 'sine', at: i * 0.12, dur: i === 2 ? 0.5 : 0.2, peak: 0.12 })),
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
