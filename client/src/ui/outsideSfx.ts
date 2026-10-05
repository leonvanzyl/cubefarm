// What it sounds like outside, all synthesized: a soft wind bed, the city's distant hum and the odd car going by, birds
// by day and crickets at night (outsideMix.ts decides how loud, how muffled and which layers). Full out on a balcony,
// quiet and muffled indoors near an open side door, almost silent deep inside. One fixed graph, built once: bird
// calls, crickets and cars are scheduled on a few long-lived voices, so nothing is added however long the office is
// left open. A timer (not the frame loop, which stops behind a panel) moves it with you; it's silent while quiet (a
// panel, the phone, the elevator), with the tab hidden or off the floor, and cut off from the mixer once silent.

import { doorOpen } from '../world/doors';
import { SIDES, type Side } from '../world/layout';
import { sampleDayTime } from '../world/sky/useDayTime';
import { weatherLayers } from '../world/weather/weatherRules';
import { weather } from '../world/weather/weatherState';
import {
  birdCall,
  BIRD_CALL_MAX,
  BURST_LEVEL,
  cricketPhrase,
  CRICKET_PHRASE_MAX,
  cutoffHz,
  nextBirdIn,
  nextCarIn,
  nextCricketIn,
  nextDueAt,
  outsideHearing,
  outsideLayers,
  RECHECK,
  type Note,
  type OutsideHearing,
  type OutsideLayers,
} from './outsideMix';
import { groupOutput, listenerAt, listenerFacing, recordSfx } from './sfx';
import { panOf } from './sfxMix';

type FloorKind = 'office' | 'lobby' | 'roof';

const TICK_MS = 100;
/** Each layer's gain at full level, before the Outside slider: a bed well under footsteps (peaks ~0.03). */
const GAIN = { wind: 0.026, city: 0.032, car: 0.05, bird: 0.014, cricket: 0.005 };
/** Their loudest moments after filtering, for __swarmSfx (measured offline at full level: the air's average is ~0.004). */
const PEAK = { air: 0.028, car: 0.015, bird: 0.014, cricket: 0.005 };
const BIRDS = 3;
const CRICKETS = 2;
/** Seconds of silence before the graph is cut off from the mixer. */
const UNHOOK_AFTER = 1.5;
/** Calls are scheduled this far ahead, so a late tick never clips their start. */
const LEAD = 0.05;

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  /** Context time the voice is free again. */
  free: number;
  /** Its own pitch (crickets). */
  hz: number;
}

interface Graph {
  ctx: BaseAudioContext;
  out: AudioNode;
  hooked: boolean;
  /** The last node: hooked to (and unhooked from) the Outside group. */
  tail: AudioNode;
  level: GainNode;
  muffle: BiquadFilterNode;
  doorPan: StereoPannerNode | null;
  wind: GainNode;
  windDepth: GainNode[];
  city: GainNode;
  cityFilter: BiquadFilterNode;
  car: { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode | null; free: number };
  birds: Voice[];
  crickets: Voice[];
  nodes: number;
}

let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let kind: FloorKind = 'office';
let quiet = false;
let silentFor = 0;
const next = { bird: 0, car: 0, cricket: [0, 0] };
let hearing: OutsideHearing = { level: 0, clarity: 0, from: null };
let layers: OutsideLayers = outsideLayers(0.5);
/** Whether __swarmSfx has the outside's air as heard (true), silent (false) or not at all yet (null). */
let heard: boolean | null = null;
const sent = { level: -1, cutoff: -1, pan: 2, wind: -1, city: -1, cityHz: -1 };
const open: Record<Side, number> = { west: 0, east: 0 };

// ---------- the API the floor uses ----------

/** The floor you're on came into view (Outside.tsx): the outside starts following you there. */
export function startOutside(floorKind: FloorKind) {
  kind = floorKind;
  const now = performance.now() / 1000;
  next.bird = now + 1 + Math.random() * 3;
  next.car = now + 3 + Math.random() * 10;
  next.cricket = [now + Math.random() * 2, now + 1 + Math.random() * 3];
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** The floor's gone (a floor change, or the office closing): fade out and stop scheduling. */
export function stopOutside() {
  if (timer) clearInterval(timer);
  timer = null;
  if (graph) glide(graph.level.gain, 0, 0.08);
  sent.level = 0;
  if (heard) record('outside:air', 0, false);
  heard = null;
  setTimeout(() => {
    if (!timer && graph) hook(graph, false);
  }, 600);
}

/** Quiet (a panel or the phone open, the elevator travelling): fades out, like the other loops. */
export function setOutsideQuiet(q: boolean) {
  if (q === quiet) return;
  quiet = q;
  if (timer) tick();
}

// ---------- the loop ----------

function tick() {
  const now = performance.now() / 1000;
  const ear = listenerAt();
  for (const side of SIDES) open[side] = doorOpen(side);
  hearing = outsideHearing(kind, ear.x, ear.z, open);
  layers = weatherLayers(outsideLayers(sampleDayTime(), kind), weather.mix); // birds go quiet in the rain, snow hushes the city
  const silent = quiet || document.hidden;
  const level = silent ? 0 : hearing.level;

  const out = groupOutput('outside');
  const g = out ? getGraph(out) : null;
  if (g) {
    silentFor = level > 0 ? 0 : silentFor + TICK_MS / 1000;
    hook(g, silentFor < UNHOOK_AFTER);
    mix(g, level);
  }
  // Bursts only while you can really hear outside: deep inside it's just the faint bed.
  const near = level >= BURST_LEVEL;
  if (near && !!g !== heard) {
    heard = !!g;
    record('outside:air', PEAK.air * level, heard);
  } else if (!near && heard !== false) {
    heard = false;
    record('outside:air', PEAK.air * level, false);
  }
  if (!near) {
    // Come back to a short wait rather than a backlog.
    next.bird = Math.max(next.bird, now + 0.5);
    next.car = Math.max(next.car, now + 2);
    for (let i = 0; i < CRICKETS; i++) next.cricket[i] = Math.max(next.cricket[i], now + 0.3 * (i + 1));
    return;
  }
  if (now >= next.bird) {
    const wait = nextBirdIn(layers.birds, Math.random());
    next.bird = nextDueAt(now, wait);
    if (Number.isFinite(wait)) bird(g, level);
  }
  if (now >= next.car) {
    const wait = nextCarIn(layers.carsPerMin, Math.random());
    next.car = nextDueAt(now, wait);
    if (Number.isFinite(wait)) car(g, level);
  }
  for (let i = 0; i < CRICKETS; i++) {
    if (now < next.cricket[i]) continue;
    if (layers.crickets < 0.05) {
      next.cricket[i] = now + RECHECK;
      continue;
    }
    const pulses = cricketPhrase(Math.random);
    next.cricket[i] = now + ends(pulses) + nextCricketIn(layers.crickets, Math.random());
    cricket(g, i, pulses, level);
  }
}

/** Gain, muffling, pan towards the door and the day's layers, sent only when they've moved. */
function mix(g: Graph, level: number) {
  const cutoff = cutoffHz(hearing.clarity);
  let pan = 0;
  if (hearing.from) {
    const f = listenerFacing();
    pan = 0.6 * (1 - hearing.clarity) * panOf(listenerAt(), f.fwd, f.up, { x: hearing.from.x, y: listenerAt().y, z: hearing.from.z });
  }
  if (Math.abs(level - sent.level) > 0.002) glide(g.level.gain, (sent.level = level), 0.35);
  if (Math.abs(cutoff / sent.cutoff - 1) > 0.03) glide(g.muffle.frequency, (sent.cutoff = cutoff), 0.3);
  if (g.doorPan && Math.abs(pan - sent.pan) > 0.03) glide(g.doorPan.pan, (sent.pan = pan), 0.25);
  const wind = GAIN.wind * layers.wind;
  if (Math.abs(wind - sent.wind) > 0.001) {
    glide(g.wind.gain, (sent.wind = wind), 2);
    g.windDepth.forEach((d, i) => glide(d.gain, wind * (i ? 0.2 : 0.35), 2));
  }
  const city = GAIN.city * layers.city;
  if (Math.abs(city - sent.city) > 0.001) glide(g.city.gain, (sent.city = city), 2);
  if (Math.abs(layers.cityHz - sent.cityHz) > 2) glide(g.cityFilter.frequency, (sent.cityHz = layers.cityHz), 2);
}

/** One entry in __swarmSfx per call, car, cricket phrase, or the air becoming heard or silent. */
function record(name: string, peak: number, played: boolean, pan = 0) {
  recordSfx(name, { group: 'outside', pan, peak, played });
}

// ---------- the bursts ----------

function bird(g: Graph | null, level: number) {
  const v = g?.birds.find((b) => b.free <= g.ctx.currentTime);
  const pan = (Math.random() * 2 - 1) * 0.85;
  // Some birds are nearer than others.
  const peak = GAIN.bird * layers.birds * (0.4 + Math.random() * 0.6);
  record('outside:bird', (PEAK.bird / GAIN.bird) * peak * level, !!v, pan);
  if (!g || !v) return;
  try {
    const t0 = g.ctx.currentTime + LEAD;
    if (v.pan) v.pan.pan.setValueAtTime(pan, t0);
    const notes = birdCall(Math.random);
    for (const n of notes) play(v, t0, n, peak, true);
    v.free = t0 + Math.min(BIRD_CALL_MAX, ends(notes)) + 0.05;
  } catch {
    // audio is optional
  }
}

function cricket(g: Graph | null, i: number, pulses: Note[], level: number) {
  const v = g?.crickets[i];
  const usable = !!g && !!v && v.free <= g.ctx.currentTime;
  const peak = GAIN.cricket * layers.crickets;
  record('outside:crickets', (PEAK.cricket / GAIN.cricket) * peak * level, usable, v?.pan?.pan.value ?? 0);
  if (!g || !v || !usable) return;
  try {
    const t0 = g.ctx.currentTime + LEAD;
    v.osc.frequency.setValueAtTime(v.hz * (0.985 + Math.random() * 0.03), t0);
    for (const n of pulses) play(v, t0, n, peak, false);
    v.free = t0 + Math.min(CRICKET_PHRASE_MAX, ends(pulses)) + 0.05;
  } catch {
    // audio is optional
  }
}

/** When the last of these notes ends, in seconds from the start. */
const ends = (notes: Note[]) => notes.reduce((end, n) => Math.max(end, n.at + n.dur), 0);

/** One car going by, left to right or back: it swells and fades, its tyres' roar rising and falling in pitch. */
function car(g: Graph | null, level: number) {
  const c = g?.car;
  const usable = !!g && !!c && c.free <= g.ctx.currentTime;
  const peak = GAIN.car * (0.5 + Math.random() * 0.5) * layers.city;
  record('outside:car', (PEAK.car / GAIN.car) * peak * level, usable);
  if (!g || !c || !usable) return;
  try {
    const dur = 5 + Math.random() * 3;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const t0 = g.ctx.currentTime + LEAD;
    const mid = t0 + dur * (0.45 + Math.random() * 0.1);
    const hz = 0.8 + Math.random() * 0.4;
    c.gain.gain.setValueAtTime(0.0001, t0);
    c.gain.gain.exponentialRampToValueAtTime(peak, mid);
    c.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    c.filter.frequency.setValueAtTime(380 * hz, t0);
    c.filter.frequency.linearRampToValueAtTime(820 * hz, mid);
    c.filter.frequency.linearRampToValueAtTime(300 * hz, t0 + dur);
    if (c.pan) {
      c.pan.pan.setValueAtTime(-0.8 * dir, t0);
      c.pan.pan.linearRampToValueAtTime(0.8 * dir, t0 + dur);
    }
    c.free = t0 + dur + 0.1;
  } catch {
    // audio is optional
  }
}

/** One note on a voice: a quick fade in and out (and a glide in pitch for birds). */
function play(v: Voice, t0: number, n: Note, peak: number, glides: boolean) {
  const s = t0 + n.at;
  if (glides) {
    v.osc.frequency.setValueAtTime(n.from, s);
    v.osc.frequency.exponentialRampToValueAtTime(n.to, s + n.dur);
  }
  const attack = Math.min(0.012, n.dur / 3);
  v.gain.gain.setValueAtTime(0, s);
  v.gain.gain.linearRampToValueAtTime(peak * n.peak, s + attack);
  if (!glides) v.gain.gain.setValueAtTime(peak * n.peak, s + n.dur - attack);
  v.gain.gain.linearRampToValueAtTime(0, s + n.dur);
}

// ---------- the graph ----------

function getGraph(out: AudioNode): Graph | null {
  if (graph?.ctx === out.context && graph.out === out) return graph;
  try {
    graph = buildOutside(out.context, out);
    for (const k of Object.keys(sent) as (keyof typeof sent)[]) sent[k] = k === 'pan' ? 2 : -1;
    return graph;
  } catch {
    return null;
  }
}

/** Two seconds of white noise, looped by the wind, the city and the cars. */
function noiseBuffer(c: BaseAudioContext) {
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** The whole outside, silent until mixed: every layer into a muffling lowpass, the level and a pan towards the door. */
function buildOutside(c: BaseAudioContext, out: AudioNode): Graph {
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
  const stereo = () => (typeof c.createStereoPanner === 'function' ? n(c.createStereoPanner()) : null);
  const osc = (type: OscillatorType, hz: number) => {
    const o = n(c.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    o.start();
    return o;
  };
  const chain = (...parts: (AudioNode | null)[]) => {
    const live = parts.filter((p): p is AudioNode => !!p);
    for (let i = 1; i < live.length; i++) live[i - 1].connect(live[i]);
    return live[live.length - 1];
  };

  const muffle = filter('lowpass', cutoffHz(0), 0.5);
  const level = gain(0);
  const doorPan = stereo();
  const tail = chain(muffle, level, doorPan);

  const buf = noiseBuffer(c);
  const source = (offset: number) => {
    const s = n(c.createBufferSource());
    s.buffer = buf;
    s.loop = true;
    s.start(0, offset);
    return s;
  };
  const air = source(0);
  const road = source(1);

  // The wind: low noise, swelling and easing on two slow, unrelated waves, its brightness drifting on a third.
  const windFilter = filter('lowpass', 420, 0.6);
  const wind = gain(0);
  chain(air, windFilter, wind, muffle);
  const windDepth = [0.043, 0.11].map((hz) => {
    const d = gain(0);
    osc('sine', hz).connect(d).connect(wind.gain);
    return d;
  });
  const drift = gain(160);
  osc('sine', 0.067).connect(drift).connect(windFilter.frequency);

  // The city: a deep, steady rumble far away.
  const cityFilter = filter('lowpass', 240, 0.7);
  const city = gain(0);
  chain(air, cityFilter, city, muffle);

  // A car: road noise through a bandpass that sweeps as it passes.
  const carFilter = filter('bandpass', 400, 0.9);
  const carGain = gain(0);
  const carPan = stereo();
  chain(road, carFilter, carGain, carPan, muffle);

  const voice = (type: OscillatorType, hz: number): Voice => {
    const o = osc(type, hz);
    const g = gain(0);
    const p = stereo();
    chain(o, g, p, muffle);
    return { osc: o, gain: g, pan: p, free: 0, hz };
  };
  const birds = Array.from({ length: BIRDS }, () => voice('sine', 3000));
  const crickets = Array.from({ length: CRICKETS }, (_, i) => {
    const v = voice('sine', 4300 + i * 380);
    if (v.pan) v.pan.pan.value = i ? 0.55 : -0.45;
    return v;
  });

  return {
    ctx: c,
    out,
    hooked: false,
    tail,
    level,
    muffle,
    doorPan,
    wind,
    windDepth,
    city,
    cityFilter,
    car: { gain: carGain, filter: carFilter, pan: carPan, free: 0 },
    birds,
    crickets,
    nodes,
  };
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

// ---------- probe ----------

// window.__swarmOutsideSfx: what the outside sounds like from here, for QA (a fresh snapshot per read).
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmOutsideSfx')) {
  Object.defineProperty(window, '__swarmOutsideSfx', {
    get: () => ({
      running: timer !== null,
      quiet: quiet || document.hidden,
      kind,
      level: hearing.level,
      clarity: hearing.clarity,
      cutoff: Math.round(cutoffHz(hearing.clarity)),
      from: hearing.from,
      layers: { ...layers },
      /** How many WebAudio nodes it uses: fixed once built (0 before audio starts). */
      nodes: graph?.nodes ?? 0,
      hooked: graph?.hooked ?? false,
    }),
    enumerable: false,
    configurable: false,
  });
}
