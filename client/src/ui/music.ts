// The jukebox's player: synthesizes a song (world/jukeboxSongs.ts) note by note with WebAudio, from where the jukebox
// stands, through the Music group. A timer schedules a fraction of a second ahead (so a busy frame never makes it
// stumble), and doesn't depend on the frame loop, which stops while a panel pauses the 3D view. The song's clock is
// performance.now(), so the jukebox keeps dancing, and moves on to the next song, when audio is locked or
// unavailable. Out of earshot, with the tab hidden, or while it's quiet (a panel, the phone, the elevator ride),
// nothing is scheduled and it fades out, but the song runs on. Its volume level (musicMix.ts) sets how loud it is and
// how far it carries, and it ducks under the office's alerts and spoken messages so it never hides them.
// Lo-fi songs ask for a texture: a vinyl bed (one looped source), warmth (a lower speaker lowpass), a tape wobble (one
// slow wave on a short delay the keys and pads go through), an electric piano, pads and softer drums. Those few nodes
// live with the song's chain and stop with it; only the notes come and go.

import { SONGS, midiHz, stepAt, stepTime, trackFor, type Instrument, type Song, type Track } from '../world/jukeboxSongs';
import { CRACKLE_SECONDS, WOBBLE, fillCrackle } from './lofi';
import { DEFAULT_MUSIC_LEVEL, DUCK_ATTACK, DUCK_GAIN, DUCK_RELEASE, clampMusicLevel, duckHold, musicEdge, musicFalloff, musicLevel } from './musicMix';
import { createPanner, groupOutput, listenerAt, occlusionAt, onAlertSound, recordSfx, type Vec3 } from './sfx';
import { distance } from './sfxMix';

const TICK_MS = 50;
/** Seconds of notes scheduled ahead of the clock. */
const LOOKAHEAD = 0.2;
/** A new song starts this long after it's asked for, so its first notes aren't late. */
const LEAD_IN = 0.1;
/** A gap between the last bar and the next song. */
const TAIL = 1.2;
/** The whole band's level at volume level gain 1 (the old fixed level), before the Music slider. */
const LEVEL = 0.16;
/** Its loudest moments at gain 1 before distance, for __swarmSfx (measured offline: about half the merge cue's peak). */
const PEAK = 0.075;
/** Square and saw waves sound much louder than sines at the same gain. */
const WAVE: Record<OscillatorType, number> = { sine: 1, triangle: 0.9, square: 0.4, sawtooth: 0.45, custom: 0.5 };
/** The jukebox speaker's lowpass, and the vinyl bed's level under the music (its pops reach 1 in the buffer). */
const SPEAKER_HZ = 5200;
const CRACKLE = 0.06;

/** A song's band: where its notes go, through its tone (and texture), before the jukebox's ducking and distance. */
interface Band {
  bus: GainNode;
  /** Where the keys and pads go: through the tape wobble, or the bus. */
  keys: AudioNode;
  tone: BiquadFilterNode;
  /** The vinyl bed and the wobble's wave: stopped with the band. */
  sources: AudioScheduledSourceNode[];
  /** How many nodes the band itself holds (not its notes). */
  nodes: number;
  crackle: boolean;
}

interface Chain extends Band {
  /** The song's own tone (Hz), and what the tone filter was last set to (lower when walls are in the way). */
  toneHz: number;
  sentHz: number;
  /** Dips under alerts and speech. */
  duck: GainNode;
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
let crackleBuf: AudioBuffer | null = null;
/** A count of nodes alive (made, not yet ended), for the probes: the jukebox's notes, or the soundtrack's. */
export interface Tally {
  nodes: number;
}
/** The jukebox's notes in flight: they come and go, the chain's nodes stay put. */
const notes: Tally = { nodes: 0 };
let quiet = false;
/** Whether __swarmSfx has this song as heard (true), as asked for but silent (false), or not at all yet (null). */
let heard: boolean | null = null;
let level = DEFAULT_MUSIC_LEVEL;
/** The level and duck state __swarmSfx last saw, so a change gets an entry of its own. */
let recorded = { level: 0, ducked: false };
// Ducking: the context time the last alert lets go of the music, and how many spoken messages hold it down.
let duckCtx: BaseAudioContext | null = null;
let duckEnd = 0;
let duckHolds = 0;
/** Other music's duck gains (the soundtrack's), dipping with the jukebox's. */
const followers = new Set<GainNode>();

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

/** The volume level (1-6): how loud the music is and how far across the floor it carries. */
export function setMusicLevel(n: number) {
  const lv = clampMusicLevel(n);
  if (lv === level) return;
  level = lv;
  if (chain) {
    glide(chain.bus, LEVEL * musicLevel(lv).gain);
    fitPanner(chain.panner);
  }
  tick();
}

/** Whether the music is ducked right now (an alert ringing or a message being spoken). */
export const musicDucked = () => duckHolds > 0 || (duckCtx !== null && duckCtx.currentTime < duckEnd);

/** Ducks the music until the returned function is called: for spoken messages and voice clips. */
export function holdMusicDuck(): () => void {
  duckHolds++;
  scheduleDuck(0);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    duckHolds--;
    if (duckCtx) duckEnd = Math.max(duckEnd, duckCtx.currentTime);
    scheduleDuck(0);
  };
}

// Every alert (the gong, cues, chimes) ducks the music while it rings, up to a few seconds.
onAlertSound((c, start, end) => {
  duckCtx = c;
  duckEnd = Math.max(duckEnd, start + duckHold(end - start));
  scheduleDuck(start);
});

/** Makes another music layer's `duck` gain (the soundtrack's) dip with the jukebox's, until the returned function is called. */
export function followMusicDuck(duck: GainNode): () => void {
  followers.add(duck);
  duckNode(duck, 0);
  return () => void followers.delete(duck);
}

/** Points the ducks' gains at where they should be from context time `from`: down while ducked, then back up smoothly. */
function scheduleDuck(from: number) {
  if (chain) duckNode(chain.duck, from);
  for (const d of followers) duckNode(d, from);
}

function duckNode(duck: GainNode, from: number) {
  const g = duck.gain;
  const c = duck.context;
  try {
    const s = Math.max(c.currentTime, from);
    g.cancelScheduledValues(s);
    if (duckHolds > 0 || (duckCtx === c && duckEnd > s)) g.setTargetAtTime(DUCK_GAIN, s, DUCK_ATTACK);
    if (duckHolds === 0) g.setTargetAtTime(1, duckCtx === c ? Math.max(s, duckEnd) : s, DUCK_RELEASE);
  } catch {
    // audio is optional
  }
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

/** WebAudio nodes the jukebox holds now: its chain (fixed while a song is heard, 0 when silent) and its notes in flight. */
export const musicNodes = () => ({ chain: chain?.nodes ?? 0, notes: notes.nodes, crackle: chain?.crackle ?? false });

/** How much of the jukebox reaches the listener now, 0-1 (0 while it's off, quiet or out of earshot): the soundtrack gives way to it. */
export function jukeboxHeard(): number {
  if (!track || quiet || document.hidden) return 0;
  return musicEdge(level, distance(listenerAt(), at));
}

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
  const out = !quiet && !document.hidden && musicEdge(level, d) > 0 ? groupOutput('music') : null;
  if (!out) {
    // Nobody to hear it: let the song run on silently, its vinyl and wobble stopped too.
    next = Math.max(next, stepAt(t, sec));
    release(chain);
    chain = null;
    if (heard !== false || recorded.level !== level) record(t, false);
    return;
  }
  try {
    const c = out.context;
    if (!chain || chain.bus.context !== c) {
      chain = build(c, out);
      scheduleDuck(0);
    }
    // Through a wall (out on a balcony, in the elevator) it's quieter and duller.
    const occ = occlusionAt(at, d);
    glide(chain.edge, musicEdge(level, d) * (occ?.gain ?? 1));
    const hz = Math.min(chain.toneHz, occ?.cutoff ?? Infinity);
    if (hz !== chain.sentHz) glideParam(c, chain.tone.frequency, (chain.sentHz = hz), 0.15);
    // Line the audio clock up with the song's the first time, and again if it slipped (a suspended context).
    if (offset === null || Math.abs(c.currentTime - sec - offset) > 0.1) {
      offset = c.currentTime - sec;
      next = Math.max(next, stepAt(t, sec));
    }
    const from = next;
    for (; next < t.totalSteps && stepTime(t, next) <= sec + LOOKAHEAD; next++) playStep(c, chain, t, next, stepTime(t, next) + offset);
    if ((next > from && heard !== true) || (heard && (recorded.level !== level || recorded.ducked !== musicDucked()))) record(t, true);
  } catch {
    // audio is optional
  }
}

/**
 * One __swarmSfx entry when the song goes silent, each time notes start reaching the listener, and when the level or
 * the ducking changes; not per note.
 */
function record(t: Track, played: boolean) {
  heard = played;
  const ducked = musicDucked();
  recorded = { level, ducked };
  const lv = level;
  const rec = recordSfx(`jukebox:${t.song.id}`, {
    group: 'music',
    pos: at,
    peak: PEAK * musicLevel(lv).gain * (ducked ? DUCK_GAIN : 1),
    played,
    falloff: (d) => musicFalloff(lv, d) * musicEdge(lv, d),
  });
  rec.level = lv;
  rec.ducked = ducked;
  rec.crackle = played && chain?.crackle === true;
  if (occlusionAt(at)) rec.occluded = true;
}

/** The level's distance model on the music's panner. */
function fitPanner(p: PannerNode) {
  const { ref, rolloff, reach } = musicLevel(level);
  p.refDistance = ref;
  p.rolloffFactor = rolloff;
  p.maxDistance = reach;
}

function build(c: BaseAudioContext, out: AudioNode): Chain {
  release(chain);
  const band = buildBand(c, track!.song, LEVEL * musicLevel(level).gain);
  const duck = c.createGain();
  const edge = c.createGain();
  edge.gain.value = 0;
  const panner = createPanner(c, at);
  fitPanner(panner);
  band.tone.connect(duck).connect(edge).connect(panner).connect(out);
  const hz = band.tone.frequency.value;
  return { ...band, nodes: band.nodes + 3, toneHz: hz, sentHz: hz, duck, edge, panner };
}

/** A song's band at `gain`: the bus, the speaker's tone (warmer for lo-fi), and the song's vinyl and wobble if it asks. */
function buildBand(c: BaseAudioContext, song: Song, gain: number): Band {
  const tex = song.texture;
  const bus = c.createGain();
  bus.gain.value = gain;
  // Takes the fizz off the square waves: a little jukebox speaker.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(SPEAKER_HZ, tex?.warmth ?? SPEAKER_HZ);
  tone.Q.value = 0.5;
  bus.connect(tone);
  const band: Band = { bus, keys: bus, tone, sources: [], nodes: 2, crackle: false };
  if (tex?.wobble) {
    // Tape wobble: the keys and pads through a short delay that a slow wave swings, bending their pitch a few cents.
    const delay = c.createDelay(0.05);
    delay.delayTime.value = WOBBLE.delay;
    const wave = c.createOscillator();
    wave.frequency.value = WOBBLE.hz;
    const depth = c.createGain();
    depth.gain.value = WOBBLE.depth;
    wave.connect(depth).connect(delay.delayTime);
    delay.connect(bus);
    wave.start();
    band.keys = delay;
    band.sources.push(wave);
    band.nodes += 3;
  }
  if (tex?.crackle) {
    // The vinyl: one looped bed of hiss and pops, from a random place in it.
    const src = c.createBufferSource();
    src.buffer = vinyl(c);
    src.loop = true;
    const g = c.createGain();
    g.gain.value = CRACKLE;
    src.connect(g).connect(bus);
    src.start(c.currentTime, Math.random() * CRACKLE_SECONDS);
    band.sources.push(src);
    band.nodes += 2;
    band.crackle = true;
  }
  return band;
}

/** The vinyl bed (lofi.ts), written once per audio context. */
function vinyl(c: BaseAudioContext) {
  if (!crackleBuf || crackleBuf.sampleRate !== c.sampleRate) {
    crackleBuf = c.createBuffer(1, Math.round(c.sampleRate * CRACKLE_SECONDS), c.sampleRate);
    fillCrackle(crackleBuf.getChannelData(0), c.sampleRate, Math.random);
  }
  return crackleBuf;
}

function release(ch: Chain | null) {
  if (!ch) return;
  glide(ch.bus, 0);
  setTimeout(() => {
    for (const s of ch.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    try {
      ch.panner.disconnect();
    } catch {
      // already gone
    }
  }, 600);
}

function glide(g: GainNode, level: number) {
  glideParam(g.context, g.gain, Math.max(0, level), 0.05);
}

function glideParam(c: BaseAudioContext, p: AudioParam, v: number, tau: number) {
  try {
    const now = c.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tau);
  } catch {
    // audio is optional
  }
}

// ---------- the band ----------

function playStep(c: BaseAudioContext, band: Band, t: Track, step: number, when: number) {
  if (when < c.currentTime) return; // too late to play in time
  const mix = t.mixes[Math.floor(step / t.stepsPerPass)];
  const { sound, texture } = t.song;
  const dest = band.bus;
  const soft = texture?.softDrums === true;
  for (const n of t.events[step % t.stepsPerPass]) {
    const dur = n.steps * t.stepSec;
    switch (n.voice) {
      case 'lead':
        if (mix.lead) part(c, band, sound.lead, n.midi, when, dur, 'lead', 1);
        if (mix.lead && mix.lift) part(c, band, sound.lead, n.midi + 12, when, dur, 'lead', 0.2);
        break;
      case 'bass':
        voice(c, dest, sound.bass, n.midi, when, dur, 0.16, 0.008, 0.7);
        break;
      case 'chord':
        part(c, band, sound.chord, n.midi, when, dur, n.steps >= 4 ? 'long chord' : 'chord', 1);
        break;
      case 'kick':
        if (mix.kick) (soft ? softKick : kick)(c, dest, when);
        break;
      case 'snare':
        if (mix.snare) (soft ? rimshot : snare)(c, dest, when);
        break;
      case 'hat':
        if (mix.hat) hiss(c, dest, when, soft ? 0.03 : 0.035, soft ? 0.022 : 0.035, soft ? 'bandpass' : 'highpass', soft ? 5200 : 7500);
        break;
    }
  }
}

/** A melody or chord note on its instrument: the keys and pads through the band's wobble, plain waves as before. */
function part(c: BaseAudioContext, band: Band, inst: Instrument, midi: number, when: number, dur: number, role: 'lead' | 'chord' | 'long chord', scale: number) {
  const lead = role === 'lead';
  if (inst === 'keys') keys(c, band.keys, midi, when, dur, (lead ? 0.09 : 0.022) * scale);
  else if (inst === 'pad') pad(c, band.keys, midi, when, dur, (lead ? 0.08 : 0.04) * scale);
  else if (lead) voice(c, band.bus, inst, midi, when, dur, 0.13 * scale, 0.012, 0.55);
  else voice(c, band.bus, inst, midi, when, dur, 0.045 * scale, role === 'long chord' ? 0.12 : 0.015, 0.5);
}

/** Counts a note's nodes in `tally` while it sounds, for the probes. */
function alive(src: AudioScheduledSourceNode, nodes: number, tally: Tally) {
  if (!(src.context instanceof AudioContext)) return; // an offline render for the probe
  tally.nodes += nodes;
  src.onended = () => {
    tally.nodes -= nodes;
  };
}

/** One pitched note: a quick attack, a decay to its sustain, then let go a touch before its length is up. */
export function voice(c: BaseAudioContext, dest: AudioNode, type: OscillatorType, midi: number, when: number, dur: number, peak: number, attack: number, sustain: number, tally = notes) {
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
  alive(o, 2, tally);
}

/**
 * A mellow electric piano: a sine whose pitch another sine shakes (FM) hard as the hammer strikes, then gently, so the
 * note starts with a soft bell and settles round; it fades like a struck tine while held, and rings a moment after.
 */
export function keys(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, peak: number, tally = notes) {
  const hz = midiHz(midi);
  const o = c.createOscillator();
  const mod = c.createOscillator();
  const depth = c.createGain();
  const g = c.createGain();
  o.frequency.value = hz;
  mod.frequency.value = hz;
  depth.gain.setValueAtTime(hz * 1.6, when);
  depth.gain.setTargetAtTime(hz * 0.2, when, 0.15);
  const end = when + Math.max(0.1, dur * 0.95);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.005);
  g.gain.setTargetAtTime(peak * 0.3, when + 0.005, 0.45);
  g.gain.setTargetAtTime(0, end, 0.09);
  mod.connect(depth).connect(o.frequency);
  o.connect(g).connect(dest);
  o.start(when);
  mod.start(when);
  o.stop(end + 0.5);
  mod.stop(end + 0.5);
  alive(o, 4, tally);
}

/** A slow pad: two slightly detuned triangles (at `peak` together) swelling in and fading out past the note's end, into the next chord. */
export function pad(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, peak: number, tally = notes) {
  const hz = midiHz(midi);
  const each = peak / 2;
  const g = c.createGain();
  const a = c.createOscillator();
  const b = c.createOscillator();
  a.type = b.type = 'triangle';
  a.frequency.value = b.frequency.value = hz;
  a.detune.value = -6;
  b.detune.value = 6;
  const attack = Math.min(1.4, dur * 0.4);
  const end = when + dur;
  const fade = Math.min(0.7, dur * 0.25);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(each, when + attack);
  g.gain.setTargetAtTime(0, end, fade);
  a.connect(g);
  b.connect(g);
  g.connect(dest);
  a.start(when);
  b.start(when);
  a.stop(end + fade * 6);
  b.stop(end + fade * 6);
  alive(a, 3, tally);
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
  alive(o, 2, notes);
}

/** The lo-fi kick: rounder and lower, a soft thump rather than a click. */
function softKick(c: BaseAudioContext, dest: AudioNode, when: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(105, when);
  o.frequency.exponentialRampToValueAtTime(42, when + 0.16);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.16, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.32);
  alive(o, 2, notes);
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
  alive(o, 2, notes);
}

/** The lo-fi snare: a dry rimshot's knock with a brush's soft swish behind it. */
function rimshot(c: BaseAudioContext, dest: AudioNode, when: number) {
  hiss(c, dest, when, 0.16, 0.045, 'bandpass', 2400);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, when);
  o.frequency.exponentialRampToValueAtTime(410, when + 0.03);
  g.gain.setValueAtTime(0.05, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.06);
  alive(o, 2, notes);
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
  alive(src, 3, notes);
}

// ---------- probe ----------

// window.__swarmJukeboxPeak('song-id', seconds?): renders a song offline at the jukebox's gain 1 (before distance, the
// ducking and the Music slider) and resolves to its peak and RMS, so QA can check every song stays within the jukebox's
// limits (PEAK) at every volume step.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmJukeboxPeak')) {
  Object.defineProperty(window, '__swarmJukeboxPeak', {
    value: async (id: string, seconds = 60) => {
      const i = SONGS.findIndex((s) => s.id === id);
      if (i < 0 || typeof OfflineAudioContext === 'undefined') return null;
      const t = trackFor(i);
      const rate = 44100;
      const len = Math.min(seconds, t.duration + TAIL);
      const c = new OfflineAudioContext(1, Math.ceil(rate * len), rate);
      const band = buildBand(c, t.song, LEVEL);
      band.tone.connect(c.destination);
      for (let s = 0; s < t.totalSteps && stepTime(t, s) < len; s++) playStep(c, band, t, s, stepTime(t, s));
      const data = (await c.startRendering()).getChannelData(0);
      let peak = 0;
      let sum = 0;
      for (const v of data) {
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      return { id, seconds: len, peak, rms: Math.sqrt(sum / data.length), limit: PEAK };
    },
    enumerable: false,
    configurable: false,
  });
}
