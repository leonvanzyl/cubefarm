// The jukebox's player: synthesizes a song (world/jukeboxSongs.ts) note by note with WebAudio, from where the jukebox
// stands, through the Music group. A timer schedules a fraction of a second ahead (so a busy frame never makes it
// stumble), and doesn't depend on the frame loop, which stops while a panel pauses the 3D view. The song's clock is
// performance.now(), so the jukebox keeps dancing, and moves on to the next song, when audio is locked or
// unavailable. Out of earshot, with the tab hidden, or while it's quiet (a panel, the phone, the elevator ride),
// nothing is scheduled and it fades out, but the song runs on.

import { midiHz, passMix, stepAt, stepTime, type Track } from '../world/jukeboxSongs';
import { createPanner, groupOutput, listenerAt, recordSfx, type Vec3 } from './sfx';
import { audible, distance, MAX_DISTANCE } from './sfxMix';

const TICK_MS = 50;
/** Seconds of notes scheduled ahead of the clock. */
const LOOKAHEAD = 0.2;
/** A new song starts this long after it's asked for, so its first notes aren't late. */
const LEAD_IN = 0.1;
/** A gap between the last bar and the next song. */
const TAIL = 1.2;
/** The whole band's level before the Music slider: background music, so it stays under the merge cue even up close. */
const LEVEL = 0.16;
/** Its loudest moments before distance, for __swarmSfx (measured offline: about half the merge cue's peak). */
const PEAK = 0.075;
/** Square and saw waves sound much louder than sines at the same gain. */
const WAVE: Record<OscillatorType, number> = { sine: 1, triangle: 0.9, square: 0.4, sawtooth: 0.45, custom: 0.5 };

interface Chain {
  bus: GainNode;
  /** Fades the music out over the last few metres before it's too far away to hear. */
  edge: GainNode;
  panner: PannerNode;
}

let track: Track | null = null;
let startPerf = 0;
let onEnd: (() => void) | null = null;
const at: Vec3 = { x: 0, y: 0, z: 0 };
let next = 0; // the next step to schedule
let offset: number | null = null; // audio clock minus song clock, once audio is running
let chain: Chain | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let noiseBuf: AudioBuffer | null = null;
let quiet = false;
/** Whether __swarmSfx has this song as heard (true), as asked for but silent (false), or not at all yet (null). */
let heard: boolean | null = null;

/** Starts `t` from the top at `pos` (stopping whatever played); `ended` runs when it finishes by itself. */
export function playTrack(t: Track, pos: Vec3, ended: () => void) {
  stopMusic();
  track = t;
  startPerf = performance.now() + LEAD_IN * 1000;
  onEnd = ended;
  at.x = pos.x;
  at.y = pos.y;
  at.z = pos.z;
  next = 0;
  heard = null;
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Quiet (a panel or the phone open, the elevator travelling): the song runs on silently, like out of earshot. */
export function setMusicQuiet(q: boolean) {
  if (q === quiet) return;
  quiet = q;
  tick();
}

/** Stops the music with a quick fade. */
export function stopMusic() {
  if (timer) clearInterval(timer);
  timer = null;
  track = null;
  onEnd = null;
  offset = null;
  release(chain);
  chain = null;
}

/** Seconds into the song now playing (what you hear now), or null when nothing plays. Can be just below 0 at the start. */
export function musicTime(): number | null {
  return track ? (performance.now() - startPerf) / 1000 : null;
}

/** The song now playing, or null. */
export const nowPlaying = () => track;

function tick() {
  const t = track;
  if (!t) return;
  const sec = (performance.now() - startPerf) / 1000;
  if (sec >= t.duration + TAIL) {
    const fn = onEnd;
    stopMusic();
    fn?.();
    return;
  }
  const d = distance(listenerAt(), at);
  const out = !quiet && !document.hidden && audible(d) ? groupOutput('music') : null;
  if (!out) {
    // Nobody to hear it: let the song run on silently.
    next = Math.max(next, stepAt(t, sec));
    if (chain) glide(chain.edge, 0);
    if (heard !== false) record(t, false);
    return;
  }
  try {
    const c = out.context;
    if (!chain || chain.bus.context !== c) chain = build(c, out);
    glide(chain.edge, Math.min(1, (MAX_DISTANCE - d) / 3));
    // Line the audio clock up with the song's the first time, and again if it slipped (a suspended context).
    if (offset === null || Math.abs(c.currentTime - sec - offset) > 0.1) {
      offset = c.currentTime - sec;
      next = Math.max(next, stepAt(t, sec));
    }
    const from = next;
    for (; next < t.totalSteps && stepTime(t, next) <= sec + LOOKAHEAD; next++) playStep(c, chain.bus, t, next, stepTime(t, next) + offset);
    if (next > from && heard !== true) record(t, true);
  } catch {
    // audio is optional
  }
}

/** One __swarmSfx entry when the song goes silent and one each time notes start reaching the listener, not per note. */
function record(t: Track, played: boolean) {
  heard = played;
  recordSfx(`jukebox:${t.song.id}`, { group: 'music', pos: at, peak: PEAK, played });
}

function build(c: BaseAudioContext, out: AudioNode): Chain {
  release(chain);
  const bus = c.createGain();
  bus.gain.value = LEVEL;
  // Takes the fizz off the square waves: a little jukebox speaker.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  tone.Q.value = 0.5;
  const edge = c.createGain();
  edge.gain.value = 0;
  const panner = createPanner(c, at);
  bus.connect(tone).connect(edge).connect(panner).connect(out);
  return { bus, edge, panner };
}

function release(ch: Chain | null) {
  if (!ch) return;
  glide(ch.bus, 0);
  setTimeout(() => {
    try {
      ch.panner.disconnect();
    } catch {
      // already gone
    }
  }, 600);
}

function glide(g: GainNode, level: number) {
  try {
    const now = g.context.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(Math.max(0, level), now, 0.05);
  } catch {
    // audio is optional
  }
}

// ---------- the band ----------

function playStep(c: BaseAudioContext, dest: AudioNode, t: Track, step: number, when: number) {
  if (when < c.currentTime) return; // too late to play in time
  const mix = passMix(Math.floor(step / t.stepsPerPass), t.song.passes);
  const { sound } = t.song;
  for (const n of t.events[step % t.stepsPerPass]) {
    const dur = n.steps * t.stepSec;
    switch (n.voice) {
      case 'lead':
        if (mix.lead) voice(c, dest, sound.lead, n.midi, when, dur, 0.13, 0.012, 0.55);
        break;
      case 'bass':
        voice(c, dest, sound.bass, n.midi, when, dur, 0.16, 0.008, 0.7);
        break;
      case 'chord':
        voice(c, dest, sound.chord, n.midi, when, dur, 0.045, n.steps >= 4 ? 0.12 : 0.015, 0.5);
        break;
      case 'kick':
        kick(c, dest, when);
        break;
      case 'snare':
        if (mix.snare) snare(c, dest, when);
        break;
      case 'hat':
        hiss(c, dest, when, 0.035, 0.035, 'highpass', 7500);
        break;
    }
  }
}

/** One pitched note: a quick attack, a decay to its sustain, then let go a touch before its length is up. */
function voice(c: BaseAudioContext, dest: AudioNode, type: OscillatorType, midi: number, when: number, dur: number, peak: number, attack: number, sustain: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = midiHz(midi);
  const p = peak * WAVE[type];
  const end = when + Math.max(attack + 0.03, dur * 0.92);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(p, when + attack);
  g.gain.setTargetAtTime(p * sustain, when + attack, 0.12);
  g.gain.setTargetAtTime(0, end, 0.03);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(end + 0.2);
}

function kick(c: BaseAudioContext, dest: AudioNode, when: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(140, when);
  o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
  g.gain.setValueAtTime(0.3, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.22);
}

function snare(c: BaseAudioContext, dest: AudioNode, when: number) {
  hiss(c, dest, when, 0.13, 0.13, 'bandpass', 1800);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(190, when);
  o.frequency.exponentialRampToValueAtTime(130, when + 0.07);
  g.gain.setValueAtTime(0.06, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.1);
}

function hiss(c: BaseAudioContext, dest: AudioNode, when: number, dur: number, peak: number, type: BiquadFilterType, freq: number) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(when, Math.random() * 0.5);
  src.stop(when + dur + 0.02);
}
