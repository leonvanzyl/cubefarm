// The agents' babble voices (babbleRules.ts plans each line): a line of text as quick syllable blips in their own
// voice, the Animal Crossing way. A blip is an oscillator in the voice's wave through two formant filters (the vowel),
// with a puff of noise for a consonant. There are MAX_SPEAKERS fixed speaker slots, each a formant pair, a level, a
// muffle for walls and a panner at the speaker's head, made once per audio context; a line only adds its blips' own
// short-lived nodes, which disconnect themselves when they end, so the node count stays bounded however long the
// office talks. Everything goes through the 'babble' group: its slider, the master volume and M, the room's reverb,
// and ducking under a message read aloud.

import { MAX_SPEAKERS, type BabbleNote, type BabbleVoice, type Onset } from './babbleRules';
import { audio, createPanner, groupOutput, occlusionAt, recordSfx, setPannerPosition, type Vec3 } from './sfx';

/** A line's peak before distance: soft, well under the merge cue (its pop alone peaks at 0.16) and the gong. */
export const BABBLE_PEAK = 0.05;
/**
 * The formants keep only a slice of the buzz: this brings each wave back up, so that a line rendered straight out
 * (renderBabble) peaks around 0.02-0.055 with an RMS under 0.009, quieter than the merge cue (0.1 and 0.011 the same way).
 */
const MAKEUP: Record<BabbleVoice['wave'], number> = { triangle: 2.1, square: 1.15, sawtooth: 1.6 };
/** Each consonant's puff of noise: its band (Hz), length (s) and level against the vowel. */
const PUFF: Partial<Record<Onset, { freq: number; dur: number; level: number }>> = {
  stop: { freq: 2600, dur: 0.018, level: 0.9 },
  hiss: { freq: 5200, dur: 0.045, level: 0.55 },
};

// ---------- the slots ----------

/** One speaker's fixed chain: the blips go into `input` (and consonants into `hiss`), out through `level`, `muffle` and `wall`. */
interface Chain {
  input: GainNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  hiss: BiquadFilterNode;
  level: GainNode;
  muffle: BiquadFilterNode;
  wall: GainNode;
}

/** How many nodes one chain is made of (plus its panner, for a slot). */
const CHAIN_NODES = 8;

function buildChain(c: BaseAudioContext, out: AudioNode): Chain {
  const input = c.createGain();
  const f1 = c.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 3;
  const f2 = c.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 6;
  const f2Level = c.createGain();
  f2Level.gain.value = 0.6;
  const hiss = c.createBiquadFilter();
  hiss.type = 'bandpass';
  hiss.Q.value = 1.2;
  const level = c.createGain();
  const muffle = c.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 20000;
  muffle.Q.value = 0.5;
  const wall = c.createGain();
  input.connect(f1).connect(level);
  input.connect(f2).connect(f2Level).connect(level);
  hiss.connect(level);
  level.connect(muffle).connect(wall).connect(out);
  return { input, f1, f2, hiss, level, muffle, wall };
}

interface Slot {
  chain: Chain;
  panner: PannerNode;
  /** The current line's sources, to cut it short. */
  sources: Set<AudioScheduledSourceNode>;
}

interface Bank {
  ctx: AudioContext;
  slots: Slot[];
  noise: AudioBuffer;
}

let bank: Bank | null = null;

/** The live nodes, for the probe: the slots' fixed ones, the blips alive now, the most ever alive and all ever made. */
const nodes = { persistent: 0, live: 0, peak: 0, made: 0 };

export const babbleNodes = () => ({ ...nodes });

function noiseBuffer(c: BaseAudioContext) {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function slots(): Bank | null {
  const a = audio();
  const out = groupOutput('babble');
  if (!a || !out) return null;
  if (bank?.ctx === a.ctx) return bank;
  try {
    const ctx = a.ctx;
    const made: Slot[] = [];
    for (let i = 0; i < MAX_SPEAKERS; i++) {
      const panner = createPanner(ctx, { x: 0, y: 0, z: 0 });
      panner.connect(out);
      made.push({ chain: buildChain(ctx, panner), panner, sources: new Set() });
    }
    bank = { ctx, slots: made, noise: noiseBuffer(ctx) };
    nodes.persistent = MAX_SPEAKERS * (CHAIN_NODES + 1);
    return bank;
  } catch {
    return null;
  }
}

// ---------- singing ----------

/** A short-lived node pair is alive until its source ends; then it lets go of the chain. Only live slots are counted. */
function track(src: AudioScheduledSourceNode, env: GainNode, slot: Slot | null) {
  if (slot) {
    nodes.live += 2;
    nodes.made += 2;
    nodes.peak = Math.max(nodes.peak, nodes.live);
    slot.sources.add(src);
  }
  src.onended = () => {
    if (slot) {
      nodes.live -= 2;
      slot.sources.delete(src);
    }
    try {
      src.disconnect();
      env.disconnect();
    } catch {
      // already disconnected
    }
  };
}

/** Sings `notes` into a chain from context time `t0`; `peak` is the loudest blip's level. Returns when it ends. */
function sing(c: BaseAudioContext, chain: Chain, notes: readonly BabbleNote[], v: BabbleVoice, t0: number, peak: number, noise: AudioBuffer, slot: Slot | null): number {
  let end = t0;
  const top = peak * MAKEUP[v.wave];
  for (const n of notes) {
    const t = t0 + n.at;
    const t1 = t + n.dur;
    end = t1;
    // the vowel: the formants glide there, so syllables run into each other the way speech does
    chain.f1.frequency.setTargetAtTime(n.f1, t, 0.012);
    chain.f2.frequency.setTargetAtTime(n.f2, t, 0.012);
    const osc = c.createOscillator();
    osc.type = v.wave;
    // a hum or a glide scoops up into its vowel
    const scoop = n.onset === 'hum' || n.onset === 'glide';
    osc.frequency.setValueAtTime(n.freq * (scoop ? 0.88 : 1), t);
    if (scoop) osc.frequency.linearRampToValueAtTime(n.freq, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(n.to, t1);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(top * n.level, t + Math.min(0.015, n.dur * 0.25));
    env.gain.exponentialRampToValueAtTime(top * n.level * 0.6, t + n.dur * 0.65);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(env).connect(chain.input);
    osc.start(t);
    osc.stop(t1 + 0.02);
    track(osc, env, slot);
    // the consonant: a puff of noise just before the vowel
    const puff = PUFF[n.onset];
    if (puff && v.breath > 0) {
      chain.hiss.frequency.setValueAtTime(puff.freq, t);
      const src = c.createBufferSource();
      src.buffer = noise;
      const nenv = c.createGain();
      nenv.gain.setValueAtTime(0.0001, t);
      nenv.gain.exponentialRampToValueAtTime(peak * puff.level * v.breath * 2, t + 0.004);
      nenv.gain.exponentialRampToValueAtTime(0.0001, t + puff.dur);
      src.connect(nenv).connect(chain.hiss);
      src.start(t, Math.random() * 0.8);
      src.stop(t + puff.dur + 0.01);
      track(src, nenv, slot);
    }
  }
  return end;
}

/** Forgets the vowels and consonants a cut-off line had still to come. */
function clearChain(ch: Chain, now: number) {
  for (const p of [ch.f1.frequency, ch.f2.frequency, ch.hiss.frequency, ch.level.gain]) p.cancelScheduledValues(now);
}

/** Stops a slot's line now: a quick fade, its blips stopped, the slot ready for the next. */
export function hushBabble(slot: number) {
  const s = bank?.slots[slot];
  if (!bank || !s) return;
  const now = bank.ctx.currentTime;
  try {
    clearChain(s.chain, now);
    s.chain.level.gain.setTargetAtTime(0, now, 0.012);
    s.chain.level.gain.setValueAtTime(1, now + 0.08);
    for (const src of s.sources) src.stop(now + 0.06);
  } catch {
    // audio is optional
  }
}

/** Moves a slot's voice with the speaker's head (allocates nothing, so it's fine every frame). */
export function moveBabble(slot: number, x: number, y: number, z: number) {
  const s = bank?.slots[slot];
  if (s) setPannerPosition(s.panner, x, y, z);
}

/**
 * Babbles a line from `pos` in slot `slot` (cutting off whatever it was saying). Recorded in window.__swarmSfx as
 * `babble:<name>`, played or not (audio locked, too far away). Returns whether it plays.
 */
export function babble(slot: number, pos: Vec3, notes: readonly BabbleNote[], v: BabbleVoice, name: string): boolean {
  const rec = recordSfx(`babble:${name}`, { group: 'babble', pos, peak: BABBLE_PEAK });
  if (!notes.length || slot < 0 || slot >= MAX_SPEAKERS) return false;
  const occ = occlusionAt(pos);
  if (occ) {
    rec.occluded = true;
    rec.gain *= occ.gain;
  }
  if (rec.gain === 0) return false; // beyond earshot (recordSfx culls by distance), or the Chatter slider is down
  const b = slots();
  if (!b) return false;
  const s = b.slots[slot];
  try {
    for (const src of s.sources) src.stop();
    const now = b.ctx.currentTime;
    clearChain(s.chain, now);
    s.chain.level.gain.setValueAtTime(1, now);
    s.chain.muffle.frequency.setValueAtTime(occ?.cutoff ?? 20000, now);
    s.chain.wall.gain.setValueAtTime(occ?.gain ?? 1, now);
    setPannerPosition(s.panner, pos.x, pos.y, pos.z);
    sing(b.ctx, s.chain, notes, v, now + 0.03, BABBLE_PEAK, b.noise, s);
    rec.played = true;
    return true;
  } catch {
    return false;
  }
}

/** For QA: renders a line offline, straight out (no distance, group or master), and measures its peak sample and RMS. */
export async function renderBabble(notes: readonly BabbleNote[], v: BabbleVoice): Promise<{ peak: number; rms: number; seconds: number }> {
  const rate = 44100;
  const seconds = (notes.length ? notes[notes.length - 1].at + notes[notes.length - 1].dur : 0) + 0.2;
  const c = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
  sing(c, buildChain(c, c.destination), notes, v, 0.01, BABBLE_PEAK, noiseBuffer(c), null);
  const data = (await c.startRendering()).getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (const x of data) {
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  return { peak: Math.round(peak * 10000) / 10000, rms: Math.round(Math.sqrt(sum / data.length) * 10000) / 10000, seconds: Math.round(seconds * 100) / 100 };
}
