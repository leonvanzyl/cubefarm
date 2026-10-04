// The merge cheer: as everyone on the floor throws their arms up (Character.tsx, after the gong), each lets out their
// own little cartoon "woo!", "yay!" or "hey!" from their head, a sawtooth voice through two gliding formant filters.
// cheerRules.ts decides who: the nearest CHEER_VOICES get a voice each on a fixed set of panners, the rest blend into
// one soft crowd layer on one more, so a big floor never clips. People sounds share the 'typing' group with chats and
// sighs (peopleSounds.ts), under the master volume. Every voice is one entry in window.__swarmSfx, `from` being where
// its panner really was; the crowd is one entry at the middle of its people.

import { useStore } from '../store';
import { CELEBRATE_MS } from '../world/gongRules';
import { gongState } from '../world/gongState';
import { CHEER_LEAD, CHEER_VOICES, crowdLevel, mayCheer, planCheer, stagger, type CheerVoice, type CheerWord } from './cheerRules';
import { audio, createPanner, groupOutput, listenerAt, recordSfx, setPannerPosition, type Vec3 } from './sfx';
import { distance } from './sfxMix';

/** One voice's peak, before distance: well under the gong (its whole boom peaks around 0.5). */
const VOICE_PEAK = 0.1;
/** The crowd layer's peak with a crowd of nine or more (crowdLevel 1). */
const CROWD_PEAK = 0.05;
/** The formant filters keep only a slice of the sawtooth: this brings it back up to about the envelope's peak. */
const MAKEUP = 3;
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

// ---------- the channels ----------

interface Channels {
  ctx: AudioContext;
  voices: PannerNode[];
  crowd: PannerNode;
  noise: AudioBuffer;
}

let chan: Channels | null = null;

function channels(): Channels | null {
  const a = audio();
  const out = groupOutput('typing');
  if (!a || !out) return null;
  if (chan?.ctx === a.ctx) return chan;
  try {
    const { ctx } = a;
    const panner = () => {
      const p = createPanner(ctx, ORIGIN);
      p.connect(out);
      return p;
    };
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    chan = { ctx, voices: Array.from({ length: CHEER_VOICES }, panner), crowd: panner(), noise };
    return chan;
  } catch {
    return null;
  }
}

const pannerAt = (p: PannerNode): Vec3 | null => (p.positionX ? { x: p.positionX.value, y: p.positionY.value, z: p.positionZ.value } : null);

// ---------- the voice ----------

/** A word: its length (s) and pitch, F1 and F2 at its start, its peak (30% in) and its end. */
interface Shape {
  dur: number;
  pitch: [number, number, number];
  f1: [number, number, number];
  f2: [number, number, number];
  /** Seconds of breathy "h" before the vowel. */
  breath: number;
}

const SHAPES: Record<CheerWord, Shape> = {
  // lips rounded, sliding up and back down: "wooo!"
  woo: { dur: 0.46, pitch: [0.85, 1.28, 0.92], f1: [300, 370, 340], f2: [640, 920, 820], breath: 0 },
  // from a "y" through an open "ay" to an "ee"
  yay: { dur: 0.42, pitch: [1.06, 1.3, 1.0], f1: [290, 620, 450], f2: [2250, 1850, 2150], breath: 0 },
  // a puff of breath, then "ey"
  hey: { dur: 0.34, pitch: [1.18, 1.24, 0.95], f1: [520, 580, 420], f2: [1800, 1900, 2150], breath: 0.06 },
};

function glide(param: AudioParam, [a, b, c]: [number, number, number], scale: number, t0: number, tp: number, t1: number) {
  param.setValueAtTime(a * scale, t0);
  param.exponentialRampToValueAtTime(b * scale, tp);
  param.exponentialRampToValueAtTime(c * scale, t1);
}

/** A burst of the shared noise through a band-pass: the breath of a "hey", or a clap. */
function puff(c: Channels, dest: AudioNode, t0: number, dur: number, peak: number, freq: number, q: number) {
  const src = c.ctx.createBufferSource();
  src.buffer = c.noise;
  const bq = c.ctx.createBiquadFilter();
  bq.type = 'bandpass';
  bq.frequency.value = freq;
  bq.Q.value = q;
  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq).connect(env).connect(dest);
  src.start(t0, Math.random() * 0.8);
  src.stop(t0 + dur + 0.02);
}

/** One word in `v`'s voice at `t0`; returns when it ends. `pitch` and `size` nudge it (a second, smaller woo). */
function word(c: Channels, dest: AudioNode, t0: number, v: CheerVoice, w: CheerWord, peak: number, pitch = 1, size = 1): number {
  const s = SHAPES[w];
  if (s.breath) puff(c, dest, t0, s.breath + 0.04, peak * 0.45, 1500 * v.formant, 0.9);
  const ts = t0 + s.breath;
  const t1 = ts + s.dur * size;
  const tp = ts + s.dur * size * 0.3;
  const f = v.pitch * pitch * (0.96 + Math.random() * 0.08); // never quite the same twice
  const osc = c.ctx.createOscillator();
  osc.type = 'sawtooth';
  glide(osc.frequency, s.pitch, f, ts, tp, t1);
  const f1 = c.ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 2.5;
  glide(f1.frequency, s.f1, v.formant, ts, tp, t1);
  const f2 = c.ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 5;
  glide(f2.frequency, s.f2, v.formant, ts, tp, t1);
  const g2 = c.ctx.createGain();
  g2.gain.value = 0.45 + v.bright * 0.6;
  const env = c.ctx.createGain();
  env.gain.setValueAtTime(0.0001, ts);
  env.gain.exponentialRampToValueAtTime(peak * MAKEUP, ts + 0.04);
  env.gain.exponentialRampToValueAtTime(peak * MAKEUP * 0.7, t1 - 0.1 * size);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(f1).connect(env);
  osc.connect(f2).connect(g2).connect(env);
  env.connect(dest);
  osc.start(ts);
  osc.stop(t1 + 0.05);
  return t1;
}

/** An agent's cheer at `t0`: their word, then maybe a second, smaller "woo" or three claps. */
function cheer(c: Channels, dest: AudioNode, t0: number, v: CheerVoice) {
  const end = word(c, dest, t0, v, v.word, VOICE_PEAK);
  if (v.extra === 'woo') word(c, dest, end + 0.08 + Math.random() * 0.1, v, 'woo', VOICE_PEAK * 0.55, 1.12, 0.8);
  else if (v.extra === 'clap')
    for (let i = 0; i < 3; i++) puff(c, dest, end + 0.05 + i * 0.14 + Math.random() * 0.03, 0.045, VOICE_PEAK * 0.6, 1200 + Math.random() * 400, 1.3);
}

/** Everyone not voiced: a soft, mushy "yaaay" of a few voices through shared formants, over a hiss of clapping. */
function crowd(c: Channels, dest: AudioNode, t0: number, peak: number) {
  const { ctx } = c;
  const out = ctx.createGain();
  out.gain.value = peak * MAKEUP;
  out.connect(dest);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 620;
  f1.Q.value = 2.5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1900;
  f2.Q.value = 4;
  const g2 = ctx.createGain();
  g2.gain.value = 0.5;
  f1.connect(out);
  f2.connect(g2).connect(out);
  for (let i = 0; i < 4; i++) {
    const ts = t0 + stagger(Math.random());
    const dur = 0.5 + Math.random() * 0.25;
    const f = 230 + Math.random() * 190;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    glide(osc.frequency, SHAPES.yay.pitch, f, ts, ts + dur * 0.3, ts + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ts);
    env.gain.exponentialRampToValueAtTime(0.5, ts + 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, ts + dur);
    osc.connect(env);
    env.connect(f1);
    env.connect(f2);
    osc.start(ts);
    osc.stop(ts + dur + 0.05);
  }
  puff(c, out, t0 + 0.1, 1.1, 0.15, 2000, 0.6);
}

// ---------- who's cheering ----------

/** Someone whose arms just went up, collected over a frame. */
interface Cheerer extends Vec3 {
  voice: CheerVoice | null;
  d: number;
}

const MAX_CHEERERS = 64;
const pool: Cheerer[] = Array.from({ length: MAX_CHEERERS }, () => ({ voice: null, x: 0, y: 0, z: 0, d: 0 }));
const waiting: Cheerer[] = [];
let queued = false;
let lastCheer = -Infinity;

/**
 * Character.tsx calls this in the frame someone's arms go up for a merge, with their voice and where their head is.
 * Everyone who cheers in the same frame is one cheer, sung once the frame is done. Allocates nothing.
 */
export function cheerFrom(voice: CheerVoice, x: number, y: number, z: number) {
  if (waiting.length >= MAX_CHEERERS) return;
  const c = pool[waiting.length];
  c.voice = voice;
  c.x = x;
  c.y = y;
  c.z = z;
  waiting.push(c);
  if (!queued) {
    queued = true;
    queueMicrotask(sing);
  }
}

function sing() {
  queued = false;
  const now = performance.now();
  const st = useStore.getState();
  // Not while you're elsewhere (a panel, the elevator, another tab), nor for merges in a row.
  const ok = !document.hidden && st.travel === null && st.overlay === null && mayCheer(lastCheer, now, gongState.celebrateUntil - CELEBRATE_MS);
  if (ok && waiting.length) {
    lastCheer = now;
    try {
      play();
    } catch {
      // audio is optional
    }
  }
  for (const c of waiting) c.voice = null;
  waiting.length = 0;
}

function play() {
  const ear = listenerAt();
  for (const c of waiting) c.d = distance(ear, c);
  const plan = planCheer(waiting);
  const c = channels();
  const t0 = c ? c.ctx.currentTime + CHEER_LEAD : 0;
  plan.voiced.forEach((i, k) => {
    const who = waiting[i];
    const pos = { x: who.x, y: who.y, z: who.z };
    const p = c?.voices[k];
    if (p) setPannerPosition(p, pos.x, pos.y, pos.z);
    const rec = recordSfx(`cheer:${who.voice!.word}`, { group: 'typing', pos, peak: VOICE_PEAK, played: !!p });
    rec.from = p ? pannerAt(p) : null;
    if (c && p) cheer(c, p, t0 + stagger(Math.random()), who.voice!);
  });
  if (!plan.crowd.length) return;
  const mid = { x: 0, y: 0, z: 0 };
  for (const i of plan.crowd) {
    mid.x += waiting[i].x / plan.crowd.length;
    mid.y += waiting[i].y / plan.crowd.length;
    mid.z += waiting[i].z / plan.crowd.length;
  }
  const peak = CROWD_PEAK * crowdLevel(plan.crowd.length);
  if (c) setPannerPosition(c.crowd, mid.x, mid.y, mid.z);
  const rec = recordSfx('cheer:crowd', { group: 'typing', pos: mid, peak, played: !!c });
  rec.from = c ? pannerAt(c.crowd) : null;
  if (c) crowd(c, c.crowd, t0 + 0.05, peak);
}
