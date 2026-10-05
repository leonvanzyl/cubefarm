// The weather's sounds, synthesized like the rest of the outside (outsideSfx.ts) and through its Outside group, so its
// slider, the master volume and M apply and it ducks with everything else: rain washing down and pattering on the
// glass (muffled indoors, full on a balcony), a storm's gusting wind, the soft hush of snow, and thunder rolling in
// after a flash. One fixed graph, built the first time the weather needs it; a timer (not the frame loop) follows you
// and the weather; silent while quiet (a panel, the phone, the elevator) or hidden, and cut off from the mixer once
// silent. weatherMix.ts decides how loud and how muffled.

import { doorOpen } from '../world/doors';
import { SIDES, type Side } from '../world/layout';
import { outsideHearing, type OutsideHearing } from './outsideMix';
import { groupOutput, listenerAt, recordSfx } from './sfx';
import { patterSamples, rainHeard, thunderHeard, weatherSoundLayers } from './weatherMix';

type FloorKind = 'office' | 'lobby' | 'roof';
type Mix = { rain: number; snow: number; storm: number; wind: number; cloud: number };

const TICK_MS = 100;
/** Each layer at full strength, before the Outside slider: rain sits about where the outside's air does. */
const GAIN = { rain: 0.05, patter: 0.035, gust: 0.06, hush: 0.012, thunder: 0.32 };
const UNHOOK_AFTER = 1.5;

interface Graph {
  ctx: BaseAudioContext;
  out: AudioNode;
  hooked: boolean;
  tail: GainNode;
  rain: GainNode;
  patter: GainNode;
  rainMuffle: BiquadFilterNode;
  rainLevel: GainNode;
  gust: GainNode;
  gustDepth: GainNode;
  hush: GainNode;
  airMuffle: BiquadFilterNode;
  airLevel: GainNode;
  thunderMuffle: BiquadFilterNode;
  thunderLevel: GainNode;
  noise: AudioBuffer;
  nodes: number;
}

let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let kind: FloorKind = 'office';
let read: (() => Readonly<Mix>) | null = null;
let quiet = false;
let silentFor = 0;
let hearing: OutsideHearing = { level: 0, clarity: 0, from: null };
let heard = false;
const sent = { rain: -1, patter: -1, rainLevel: -1, rainCut: -1, gust: -1, hush: -1, airLevel: -1, airCut: -1, thunderLevel: -1, thunderCut: -1 };
const open: Record<Side, number> = { west: 0, east: 0 };

// ---------- the API ----------

/** The weather has something to say on this floor (weather/Weather.tsx): follow it and the listener. */
export function startWeatherSounds(floorKind: FloorKind, mix: () => Readonly<Mix>) {
  kind = floorKind;
  read = mix;
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** Clear skies again, or the floor's gone: fade out and stop following. */
export function stopWeatherSounds() {
  if (timer) clearInterval(timer);
  timer = null;
  read = null;
  if (graph) for (const g of [graph.rainLevel, graph.airLevel]) glide(g.gain, 0, 0.3);
  for (const k of Object.keys(sent) as (keyof typeof sent)[]) sent[k] = -1;
  if (heard) recordSfx('weather:rain', { group: 'outside', peak: 0, played: false });
  heard = false;
  setTimeout(() => {
    if (!timer && graph) hook(graph, false);
  }, 1500);
}

/** Quiet (a panel or the phone open, the elevator travelling), like the other loops. */
export function setWeatherQuiet(q: boolean) {
  if (q === quiet) return;
  quiet = q;
  if (timer) tick();
}

/**
 * Thunder `delay` seconds from now, `strength` 0-1 (nearer is louder and starts with a crack), from the west (-1) or
 * east (1). Skipped while quiet; still recorded in __swarmSfx.
 */
export function thunder(delay: number, strength: number, side: number) {
  const silent = quiet || (typeof document !== 'undefined' && document.hidden) || !timer;
  const h = thunderHeard(hearing);
  const out = silent ? null : groupOutput('outside');
  const g = out ? getGraph(out) : null;
  recordSfx('weather:thunder', { group: 'outside', peak: GAIN.thunder * strength * h.level, pan: side * 0.4, played: !!g });
  if (!g) return;
  try {
    hook(g, true);
    silentFor = 0;
    const c = g.ctx;
    const t0 = c.currentTime + Math.max(0, delay);
    const src = c.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    const env = c.createGain();
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    const dur = 4 + 3 * (1 - strength) + Math.random() * 2;
    // a crack for the near ones, then the rumble: a low roar swelling and rolling away in a few uneven waves
    lp.frequency.setValueAtTime(strength > 0.6 ? 2600 : 900, t0);
    lp.frequency.exponentialRampToValueAtTime(320, t0 + 0.35);
    lp.frequency.exponentialRampToValueAtTime(110, t0 + dur);
    const peak = GAIN.thunder * strength;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak * (strength > 0.6 ? 1 : 0.55), t0 + (strength > 0.6 ? 0.03 : 0.25));
    let at = t0 + 0.4;
    for (let i = 0; i < 4; i++) {
      at += 0.3 + Math.random() * (dur / 5);
      env.gain.exponentialRampToValueAtTime(peak * (0.25 + Math.random() * 0.5) * (1 - i * 0.18), Math.min(at, t0 + dur - 0.3));
    }
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (pan) pan.pan.setValueAtTime(side * 0.4, t0);
    src.connect(lp).connect(env);
    (pan ? env.connect(pan) : env).connect(g.thunderMuffle);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.1);
  } catch {
    // audio is optional
  }
}

// ---------- the loop ----------

function tick() {
  const ear = listenerAt();
  for (const side of SIDES) open[side] = doorOpen(side);
  hearing = outsideHearing(kind, ear.x, ear.z, open);
  const silent = quiet || document.hidden || !read;
  const m = read?.();
  const layers = m ? weatherSoundLayers(m) : { rain: 0, patter: 0, gust: 0, hush: 0 };
  const any = !silent && (layers.rain > 0.005 || layers.gust > 0.005 || layers.hush > 0.005);
  const out = any || (graph?.hooked ?? false) ? groupOutput('outside') : null;
  const g = out ? getGraph(out) : null;
  if (g) {
    silentFor = any ? 0 : silentFor + TICK_MS / 1000;
    hook(g, silentFor < UNHOOK_AFTER);
    const rain = rainHeard(hearing);
    const th = thunderHeard(hearing);
    set(g.rain.gain, 'rain', GAIN.rain * layers.rain, 1.5);
    set(g.patter.gain, 'patter', GAIN.patter * layers.patter, 1.5);
    set(g.rainLevel.gain, 'rainLevel', silent ? 0 : rain.level, 0.35);
    set(g.rainMuffle.frequency, 'rainCut', rain.cutoff, 0.3, true);
    set(g.gust.gain, 'gust', GAIN.gust * layers.gust, 2);
    g.gustDepth.gain.value = GAIN.gust * layers.gust * 0.6;
    set(g.hush.gain, 'hush', GAIN.hush * layers.hush, 2);
    set(g.airLevel.gain, 'airLevel', silent ? 0 : hearing.level, 0.35);
    set(g.airMuffle.frequency, 'airCut', rain.cutoff * 0.5 + 200, 0.3, true);
    set(g.thunderLevel.gain, 'thunderLevel', silent ? 0 : th.level, 0.35);
    set(g.thunderMuffle.frequency, 'thunderCut', th.cutoff, 0.3, true);
  }
  const nowHeard = any && layers.rain > 0.05 && !!g;
  if (nowHeard !== heard) {
    heard = nowHeard;
    recordSfx('weather:rain', { group: 'outside', peak: GAIN.rain * layers.rain * rainHeard(hearing).level, played: heard });
  }
}

/** Glides a param to `v` when it has moved enough since last sent. */
function set(p: AudioParam, key: keyof typeof sent, v: number, tau: number, ratio = false) {
  const last = sent[key];
  if (last >= 0 && (ratio ? Math.abs(v / Math.max(last, 1e-6) - 1) < 0.03 : Math.abs(v - last) < 0.0005)) return;
  sent[key] = v;
  glide(p, v, tau);
}

// ---------- the graph ----------

function getGraph(out: AudioNode): Graph | null {
  if (graph?.ctx === out.context && graph.out === out) return graph;
  try {
    graph = build(out.context, out);
    for (const k of Object.keys(sent) as (keyof typeof sent)[]) sent[k] = -1;
    return graph;
  } catch {
    return null;
  }
}

function build(c: BaseAudioContext, out: AudioNode): Graph {
  let nodes = 0;
  const n = <T extends AudioNode>(node: T) => (nodes++, node);
  const gain = (v: number) => {
    const g = n(c.createGain());
    g.gain.value = v;
    return g;
  };
  const filter = (type: BiquadFilterType, hz: number, q: number) => {
    const f = n(c.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  };
  const loop = (buf: AudioBuffer, offset: number) => {
    const s = n(c.createBufferSource());
    s.buffer = buf;
    s.loop = true;
    s.start(0, offset);
    return s;
  };
  const osc = (hz: number) => {
    const o = n(c.createOscillator());
    o.frequency.value = hz;
    o.start();
    return o;
  };

  const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const patterBuf = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
  patterSamples(patterBuf.getChannelData(0), c.sampleRate, 38, Math.random);

  const tail = gain(1);
  // the rain: a wash of high noise and the drops ticking on the glass, muffled through the panes indoors
  const rainMuffle = filter('lowpass', 2000, 0.5);
  const rainLevel = gain(0);
  rainMuffle.connect(rainLevel).connect(tail);
  const rain = gain(0);
  loop(noise, 0.3).connect(filter('highpass', 450, 0.5)).connect(filter('lowpass', 6500, 0.4)).connect(rain).connect(rainMuffle);
  const patter = gain(0);
  loop(patterBuf, 0).connect(filter('bandpass', 3200, 0.6)).connect(patter).connect(rainMuffle);

  // the storm's wind and the snow's hush, heard like the rest of the outside
  const airMuffle = filter('lowpass', 1200, 0.5);
  const airLevel = gain(0);
  airMuffle.connect(airLevel).connect(tail);
  const gustFilter = filter('bandpass', 520, 1.4);
  const gust = gain(0);
  loop(noise, 1.1).connect(gustFilter).connect(gust).connect(airMuffle);
  const gustDepth = gain(0);
  osc(0.13).connect(gustDepth).connect(gust.gain);
  const howl = gain(240);
  osc(0.07).connect(howl).connect(gustFilter.frequency);
  const hush = gain(0);
  loop(noise, 0.7).connect(filter('bandpass', 2600, 0.35)).connect(hush).connect(airMuffle);

  // thunder, one-shots straight in (thunder())
  const thunderMuffle = filter('lowpass', 900, 0.5);
  const thunderLevel = gain(0);
  thunderMuffle.connect(thunderLevel).connect(tail);

  return { ctx: c, out, hooked: false, tail, rain, patter, rainMuffle, rainLevel, gust, gustDepth, hush, airMuffle, airLevel, thunderMuffle, thunderLevel, noise, nodes };
}

function hook(g: Graph, on: boolean) {
  if (on === g.hooked) return;
  try {
    if (on) g.tail.connect(g.out);
    else g.tail.disconnect();
    g.hooked = on;
  } catch {
    // audio is optional
  }
}

function glide(p: AudioParam, v: number, tau: number) {
  try {
    const now = graph?.ctx.currentTime ?? 0;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tau);
  } catch {
    // audio is optional
  }
}

// window.__swarmWeatherSfx: what the weather sounds like from here, for QA (a fresh snapshot per read).
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmWeatherSfx')) {
  Object.defineProperty(window, '__swarmWeatherSfx', {
    get: () => {
      const m = read?.();
      return {
        running: timer !== null,
        quiet: quiet || document.hidden,
        layers: m ? weatherSoundLayers(m) : null,
        rain: rainHeard(hearing),
        thunder: thunderHeard(hearing),
        nodes: graph?.nodes ?? 0,
        hooked: graph?.hooked ?? false,
      };
    },
    enumerable: false,
    configurable: false,
  });
}
