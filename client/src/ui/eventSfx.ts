// World events' sounds (world/events/), all synthesized: an airliner's distant rumble, a helicopter's chop, a flock's
// wings, a balloon's burner, engines, fireworks, a UFO's hum and zip, a kaiju's roar and stomps, a rubber duck's
// squeak, whale song… Everything goes through one small bus into the Outside group (its slider, the master volume and
// M apply, and it ducks with the rest), muffled through the glass indoors and full on a balcony, panned towards where
// it happens and quieter with distance. Silent while quiet (a panel, the phone, the elevator) or hidden.

import { doorOpen } from '../world/doors';
import { SIDES, type Side } from '../world/layout';
import { birdCall, cutoffHz, outsideHearing, type OutsideHearing } from './outsideMix';
import { groupOutput, listenerAt, listenerFacing, recordSfx } from './sfx';
import { panOf } from './sfxMix';
import { patterSamples } from './weatherMix';

type FloorKind = 'office' | 'lobby' | 'roof';

/** Indoors the events are heard through the glass: at least this loud and this clear. */
const THROUGH_GLASS = { level: 0.28, clarity: 0.32 };
const TICK_MS = 100;

interface Bus {
  ctx: BaseAudioContext;
  out: AudioNode;
  input: GainNode;
  muffle: BiquadFilterNode;
  level: GainNode;
  hooked: boolean;
  noise: AudioBuffer;
  crackle: AudioBuffer;
}

let bus: Bus | null = null;
let kind: FloorKind = 'office';
let quiet = false;
let timer: ReturnType<typeof setInterval> | null = null;
let hearing: OutsideHearing = { level: 0, clarity: 0, from: null };
const open: Record<Side, number> = { west: 0, east: 0 };
const live = new Set<LoopImpl>();

// ---------- the floor, quiet, where you hear from ----------

/** Events are on (WorldEvents.tsx while any runs): follow the listener. */
export function eventSoundsOn(floorKind: FloorKind) {
  kind = floorKind;
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** No events any more: everything fades and the bus lets go of the mixer. */
export function eventSoundsOff() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const l of [...live]) l.stop(0.3);
  if (bus) glide(bus.level.gain, 0, 0.2);
  setTimeout(() => {
    if (!timer && bus) hook(bus, false);
  }, 1500);
}

export function setEventsQuiet(q: boolean) {
  quiet = q;
  if (timer) tick();
}

function tick() {
  const ear = listenerAt();
  for (const side of SIDES) open[side] = doorOpen(side);
  hearing = outsideHearing(kind, ear.x, ear.z, open);
  const b = getBus();
  if (!b) return;
  hook(b, true);
  const silent = quiet || document.hidden;
  glide(b.level.gain, silent ? 0 : Math.max(hearing.level, THROUGH_GLASS.level), 0.25);
  glide(b.muffle.frequency, cutoffHz(Math.max(hearing.clarity, THROUGH_GLASS.clarity)), 0.25);
}

/**
 * How a sound at (x, y, z) in the listener's frame (metres from the floor you're on) pans, and how loud it is from that
 * far: everything outside is far away, so it fades gently (half as loud at `ref` metres). Allocates nothing.
 */
export function placeAt(x: number, y: number, z: number, ref = 120): { pan: number; gain: number } {
  const ear = listenerAt();
  const f = listenerFacing();
  spot.x = x;
  spot.y = y;
  spot.z = z;
  heard.pan = panOf(ear, f.fwd, f.up, spot) * 0.85;
  heard.gain = 1 / (1 + Math.hypot(x - ear.x, y - ear.y, z - ear.z) / ref);
  return heard;
}
const spot = { x: 0, y: 0, z: 0 };
const heard = { pan: 0, gain: 0 };

// ---------- loops ----------

export type LoopKind = 'jet' | 'rotor' | 'hum' | 'flap' | 'flame' | 'engine' | 'gale';

export interface Loop {
  /** Its loudness (0-1 of its own full level) and pan; `pitch` bends it (1 = as built). Cheap: call it every frame. */
  set(gain: number, pan: number, pitch?: number): void;
  stop(fade?: number): void;
}

/** Each loop at full level, before the bus. */
const LOOP_GAIN: Record<LoopKind, number> = { jet: 0.09, rotor: 0.08, hum: 0.035, flap: 0.05, flame: 0.07, engine: 0.05, gale: 0.06 };

class LoopImpl implements Loop {
  private last = { gain: -1, pan: 2, pitch: -1 };
  private stopped = false;
  constructor(
    private c: BaseAudioContext,
    private gain: GainNode,
    private pan: StereoPannerNode | null,
    private tune: AudioParam[],
    private nodes: AudioScheduledSourceNode[],
    private max: number,
  ) {}
  set(gain: number, pan: number, pitch = 1) {
    if (this.stopped) return;
    const g = Math.max(0, Math.min(1, gain)) * this.max;
    if (Math.abs(g - this.last.gain) > 0.0005) glideOn(this.c, this.gain.gain, (this.last.gain = g), 0.12);
    if (this.pan && Math.abs(pan - this.last.pan) > 0.02) glideOn(this.c, this.pan.pan, (this.last.pan = pan), 0.12);
    if (Math.abs(pitch - this.last.pitch) > 0.005) {
      const was = this.last.pitch < 0 ? 1 : this.last.pitch;
      this.last.pitch = pitch;
      for (const p of this.tune) glideOn(this.c, p, (p.value / was) * pitch, 0.15);
    }
  }
  stop(fade = 0.6) {
    if (this.stopped) return;
    this.stopped = true;
    live.delete(this);
    const t = this.c.currentTime;
    try {
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setTargetAtTime(0, t, fade / 4);
      for (const n of this.nodes) n.stop(t + fade + 0.1);
    } catch {
      // audio is optional
    }
  }
}

const NONE: Loop = { set: () => undefined, stop: () => undefined };

/** A long sound for as long as the event wants it (an engine, a rotor); stop() it when done. Silent without audio. */
export function loop(k: LoopKind): Loop {
  const b = getBus();
  recordSfx(`event:${k}`, { group: 'outside', peak: LOOP_GAIN[k] * busLevel(), played: !!b });
  if (!b) return NONE;
  try {
    const c = b.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    (pan ? out.connect(pan) : out).connect(b.input);
    const srcs: AudioScheduledSourceNode[] = [];
    const tune: AudioParam[] = [];
    const noise = () => {
      const s = c.createBufferSource();
      s.buffer = b.noise;
      s.loop = true;
      s.start(0, Math.random() * 1.5);
      srcs.push(s);
      return s;
    };
    const osc = (type: OscillatorType, hz: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.start();
      srcs.push(o);
      return o;
    };
    const filter = (type: BiquadFilterType, hz: number, q = 0.7) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    /** `src` through a gain swung by an LFO: base ± depth at `hz`. */
    const throb = (src: AudioNode, hz: number, base: number, depth: number, type: OscillatorType = 'sine') => {
      const g = c.createGain();
      g.gain.value = base;
      const d = c.createGain();
      d.gain.value = depth;
      osc(type, hz).connect(d).connect(g.gain);
      src.connect(g);
      return g;
    };
    switch (k) {
      case 'jet': {
        // a distant airliner: a deep roar with a little whine on top
        const lp = filter('lowpass', 260, 0.8);
        noise().connect(lp).connect(out);
        const whine = filter('bandpass', 900, 6);
        const w = c.createGain();
        w.gain.value = 0.25;
        noise().connect(whine).connect(w).connect(out);
        tune.push(lp.frequency, whine.frequency);
        break;
      }
      case 'rotor': {
        const bp = filter('bandpass', 150, 1.2);
        throb(noise().connect(bp), 12.5, 0.45, 0.55, 'square').connect(out);
        tune.push(bp.frequency);
        break;
      }
      case 'hum': {
        // a UFO: two close tones beating, and a wavering theremin above
        for (const hz of [178, 181]) osc('sine', hz).connect(out);
        const t = osc('triangle', 560);
        const vib = c.createGain();
        vib.gain.value = 30;
        osc('sine', 5.5).connect(vib).connect(t.frequency);
        const tg = c.createGain();
        tg.gain.value = 0.35;
        t.connect(tg).connect(out);
        tune.push(t.frequency);
        break;
      }
      case 'flap': {
        const bp = filter('bandpass', 1100, 0.9);
        throb(noise().connect(bp), 8.5, 0.35, 0.65, 'square').connect(out);
        break;
      }
      case 'flame': {
        noise().connect(filter('lowpass', 520, 0.6)).connect(out);
        break;
      }
      case 'engine': {
        // a propeller airship's engines: a low buzz, throbbing gently
        const saw = osc('sawtooth', 52);
        throb(saw.connect(filter('lowpass', 240, 0.9)), 7, 0.6, 0.4).connect(out);
        tune.push(saw.frequency);
        break;
      }
      case 'gale': {
        const bp = filter('bandpass', 420, 1.1);
        const howl = c.createGain();
        howl.gain.value = 260;
        osc('sine', 0.09).connect(howl).connect(bp.frequency);
        throb(noise().connect(bp), 0.17, 0.6, 0.4).connect(out);
        break;
      }
    }
    const l = new LoopImpl(c, out, pan, tune, srcs, LOOP_GAIN[k]);
    live.add(l);
    return l;
  } catch {
    return NONE;
  }
}

// ---------- one-shots ----------

export type OneShot = 'roar' | 'stomp' | 'crash' | 'launch' | 'boom' | 'crackle' | 'zip' | 'beam' | 'squeak' | 'chime' | 'whale' | 'puff' | 'whoosh' | 'chirps' | 'burner';

/** Each one-shot at full level, before the bus. */
const SHOT_GAIN: Record<OneShot, number> = {
  roar: 0.22,
  stomp: 0.3,
  crash: 0.16,
  launch: 0.04,
  boom: 0.22,
  crackle: 0.1,
  zip: 0.06,
  beam: 0.05,
  squeak: 0.07,
  chime: 0.05,
  whale: 0.08,
  puff: 0.05,
  whoosh: 0.035,
  chirps: 0.03,
  burner: 0.09,
};

/** A one-off sound `delay` seconds from now, at `gain` (0-1 of its full level, distance included) from `pan`. */
export function play(k: OneShot, { gain = 1, pan = 0, delay = 0, pitch = 1 }: { gain?: number; pan?: number; delay?: number; pitch?: number } = {}) {
  const b = getBus();
  const peak = SHOT_GAIN[k] * Math.max(0, Math.min(1, gain));
  recordSfx(`event:${k}`, { group: 'outside', peak: peak * busLevel(), pan, played: !!b && !quiet });
  if (!b || quiet || peak < 1e-4) return;
  try {
    const c = b.ctx;
    const t0 = c.currentTime + 0.02 + Math.max(0, delay);
    const pn = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    if (pn) pn.pan.value = Math.max(-1, Math.min(1, pan));
    const dest: AudioNode = pn ?? b.input;
    if (pn) pn.connect(b.input);
    const env = (node: AudioNode, at: number, attack: number, hold: number, release: number, level = 1) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak * level, at + attack);
      g.gain.setValueAtTime(peak * level, at + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
      node.connect(g).connect(dest);
      return at + attack + hold + release;
    };
    const osc = (type: OscillatorType, from: number, to: number, at: number, dur: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(from * pitch, at);
      if (to !== from) o.frequency.exponentialRampToValueAtTime(to * pitch, at + dur);
      o.start(at);
      o.stop(at + dur + 0.05);
      return o;
    };
    const noise = (at: number, dur: number, buf = b.noise) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(at, Math.random());
      s.stop(at + dur + 0.05);
      return s;
    };
    const filter = (type: BiquadFilterType, from: number, to: number, at: number, dur: number, q = 0.8) => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(from, at);
      if (to !== from) f.frequency.exponentialRampToValueAtTime(to, at + dur);
      return f;
    };
    switch (k) {
      case 'roar': {
        // big, goofy and friendly: a wobbling growl through an opening mouth, a breathy rush, and a happy rise at the end
        const dur = 2.4;
        const g = osc('sawtooth', 120, 82, t0, dur);
        const vib = c.createGain();
        vib.gain.value = 7;
        const lfo = osc('sine', 6.5, 6.5, t0, dur);
        lfo.connect(vib).connect(g.frequency);
        env(g.connect(filter('bandpass', 380, 900, t0, dur * 0.4, 2.2)), t0, 0.25, 1.2, 0.9);
        env(osc('square', 61, 44, t0, dur).connect(filter('lowpass', 300, 200, t0, dur)), t0, 0.3, 1.2, 0.9, 0.6);
        env(noise(t0, dur).connect(filter('bandpass', 900, 500, t0, dur, 0.6)), t0, 0.4, 1.0, 1.0, 0.35);
        env(osc('sawtooth', 95, 150, t0 + dur, 0.35).connect(filter('bandpass', 600, 700, t0 + dur, 0.35, 2)), t0 + dur - 0.1, 0.08, 0.15, 0.2, 0.5);
        break;
      }
      case 'stomp':
        env(osc('sine', 62, 34, t0, 0.6), t0, 0.01, 0.05, 0.6);
        env(noise(t0, 0.4).connect(filter('lowpass', 260, 120, t0, 0.4)), t0, 0.005, 0.03, 0.35, 0.7);
        break;
      case 'crash':
        env(noise(t0, 1.4).connect(filter('bandpass', 2200, 700, t0, 1.4, 0.9)), t0, 0.005, 0.1, 1.2);
        for (const [hz, l] of [
          [523, 0.5],
          [791, 0.35],
          [1187, 0.2],
        ])
          env(osc('triangle', hz, hz * 0.97, t0, 1.6), t0 + 0.02, 0.003, 0.05, 1.5, l);
        env(osc('sine', 70, 40, t0, 0.5), t0, 0.01, 0.05, 0.45, 0.8);
        break;
      case 'launch':
        env(osc('sine', 700, 1900, t0, 1.1), t0, 0.05, 0.9, 0.2);
        env(noise(t0, 1.1).connect(filter('highpass', 3000, 3000, t0, 1.1)), t0, 0.05, 0.8, 0.3, 0.3);
        break;
      case 'boom':
        env(noise(t0, 1.8).connect(filter('lowpass', 700, 110, t0, 1.6)), t0, 0.005, 0.05, 1.6);
        env(osc('sine', 75, 42, t0, 0.8), t0, 0.005, 0.05, 0.7, 0.8);
        break;
      case 'crackle':
        env(noise(t0, 1.6, b.crackle).connect(filter('highpass', 1800, 1800, t0, 1.6)), t0, 0.05, 0.9, 0.6);
        break;
      case 'zip':
        env(osc('sine', 280, 2600, t0, 0.4), t0, 0.01, 0.25, 0.15);
        env(osc('triangle', 560, 3900, t0, 0.4), t0, 0.01, 0.2, 0.15, 0.4);
        break;
      case 'beam': {
        const o = osc('sine', 220, 760, t0, 1.6);
        const vib = c.createGain();
        vib.gain.value = 18;
        osc('sine', 9, 9, t0, 1.6).connect(vib).connect(o.frequency);
        env(o, t0, 0.2, 1.1, 0.3);
        env(noise(t0, 1.6).connect(filter('bandpass', 2500, 4000, t0, 1.6, 3)), t0, 0.3, 0.9, 0.4, 0.4);
        break;
      }
      case 'squeak':
        for (let i = 0; i < 2; i++) {
          const at = t0 + i * 0.22;
          env(osc('square', 950, 1350, at, 0.16).connect(filter('bandpass', 1500, 1500, at, 0.16, 3)), at, 0.01, 0.08, 0.08);
        }
        break;
      case 'chime':
        [1046.5, 1318.5, 1568, 2093, 2637].forEach((hz, i) => env(osc('sine', hz, hz, t0 + i * 0.14, 1.8), t0 + i * 0.14, 0.01, 0.05, 1.6, 0.8 - i * 0.08));
        break;
      case 'whale': {
        // a slow, sliding moan with an overtone
        const dur = 2.8;
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(170 * pitch, t0);
        o.frequency.exponentialRampToValueAtTime(330 * pitch, t0 + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(140 * pitch, t0 + dur);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
        env(o, t0, 0.5, dur - 1.1, 0.6);
        env(osc('sine', 340, 600, t0, dur), t0, 0.6, dur - 1.3, 0.6, 0.25);
        break;
      }
      case 'puff':
        env(noise(t0, 0.5).connect(filter('lowpass', 900, 500, t0, 0.5)), t0, 0.04, 0.1, 0.35);
        break;
      case 'whoosh':
        env(noise(t0, 0.9).connect(filter('bandpass', 2600, 500, t0, 0.9, 1.2)), t0, 0.1, 0.25, 0.5);
        break;
      case 'chirps':
        for (const n of birdCall(Math.random)) {
          const at = t0 + n.at;
          env(osc('sine', n.from, n.to, at, n.dur), at, Math.min(0.01, n.dur / 3), n.dur * 0.3, n.dur * 0.6, n.peak);
        }
        break;
      case 'burner':
        env(noise(t0, 1.4).connect(filter('lowpass', 420, 650, t0, 1.2, 0.6)), t0, 0.08, 0.9, 0.4);
        break;
    }
  } catch {
    // audio is optional
  }
}

// ---------- the bus ----------

const busLevel = () => (quiet ? 0 : Math.max(hearing.level, THROUGH_GLASS.level));

function getBus(): Bus | null {
  const out = groupOutput('outside');
  if (!out) return null;
  if (bus?.ctx === out.context && bus.out === out) return bus;
  try {
    const c = out.context;
    const input = c.createGain();
    const muffle = c.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.Q.value = 0.5;
    muffle.frequency.value = cutoffHz(THROUGH_GLASS.clarity);
    const level = c.createGain();
    level.gain.value = 0;
    input.connect(muffle).connect(level);
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const crackle = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    patterSamples(crackle.getChannelData(0), c.sampleRate, 70, Math.random);
    bus = { ctx: c, out, input, muffle, level, hooked: false, noise, crackle };
    return bus;
  } catch {
    return null;
  }
}

function hook(b: Bus, on: boolean) {
  if (on === b.hooked) return;
  try {
    if (on) b.level.connect(b.out);
    else b.level.disconnect();
    b.hooked = on;
  } catch {
    // audio is optional
  }
}

function glideOn(c: BaseAudioContext, p: AudioParam, v: number, tau: number) {
  try {
    p.cancelScheduledValues(c.currentTime);
    p.setTargetAtTime(v, c.currentTime, tau);
  } catch {
    // audio is optional
  }
}

const glide = (p: AudioParam, v: number, tau: number) => bus && glideOn(bus.ctx, p, v, tau);
