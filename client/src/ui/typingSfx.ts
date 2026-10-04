// Typing from working agents' desks. A few fixed channels (one per heard typist, each its own panner at
// their keyboard) feed the 'typing' group, under its slider and the master volume. Keystrokes are pre-rendered samples
// started a little ahead on the AudioContext clock, so each one costs a buffer source and a gain.
// Every sound asked for is logged to window.__swarmSfx, even while audio is locked or unavailable, with where its
// panner really was (`from`) next to where it was meant to come from (`at`).

import { audio, groupOutput } from './sfx';
import { KEYBOARDS, MOUSE_CLICK, WHEEL_NOTCH, renderKey, type KeySound } from './keyboards';

export type TypingSound = 'key' | 'space' | 'enter' | 'click' | 'scroll';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How many typists are heard at once (the nearest ones). */
export const TYPING_CHANNELS = 4;
/** Beyond this distance (metres) a desk isn't heard at all. */
export const TYPING_RANGE = 16;

// The whole group sits well below footsteps (peak ~0.045); a keystroke at arm's length is a soft tick.
const KEY_GAIN = 0.022;
const GAIN: Record<TypingSound, number> = { key: 1, space: 1.25, enter: 1.35, click: 0.7, scroll: 0.3 };
const VARIANTS = 4;

// ---------- probe ----------

interface SfxEntry {
  name: string;
  group: string;
  at: Vec3 | null;
  gain: number;
  played: boolean;
  from: Vec3 | null; // the channel panner's position when it played (null when it didn't, or can't be read)
  t: number;
}

const probe = window as unknown as { __swarmSfx?: SfxEntry[] };

function record(name: string, at: Vec3, gain: number, played: boolean, panner?: PannerNode) {
  const log = (probe.__swarmSfx ??= []);
  const from = played && panner?.positionX ? { x: panner.positionX.value, y: panner.positionY.value, z: panner.positionZ.value } : null;
  log.push({ name, group: 'typing', at: { x: at.x, y: at.y, z: at.z }, gain, played, from, t: performance.now() });
  if (log.length > 50) log.splice(0, log.length - 50);
}

// ---------- the mixer chain ----------

interface Chain {
  ctx: AudioContext;
  channels: PannerNode[];
  keys: AudioBuffer[][]; // [keyboard][variant]
  thunks: AudioBuffer[];
  click: AudioBuffer;
  wheel: AudioBuffer;
}

let chain: Chain | null = null;
let generation = 0; // bumped whenever the channels are rebuilt (a new AudioContext)

function toBuffer(ctx: AudioContext, sound: KeySound, seed: number, detune = 1) {
  const data = renderKey(sound, ctx.sampleRate, seed, detune);
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

function setPos(p: PannerNode, at: Vec3) {
  if (p.positionX) {
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
  } else p.setPosition(at.x, at.y, at.z);
}

function getChain(): Chain | null {
  const a = audio();
  const group = groupOutput('typing');
  if (!a || !group) return null;
  if (chain?.ctx === a.ctx) return chain;
  try {
    const { ctx } = a;
    const channels = Array.from({ length: TYPING_CHANNELS }, () => {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 1.5;
      p.rolloffFactor = 1.5; // a desk 10 m away is faint
      p.maxDistance = TYPING_RANGE;
      p.connect(group);
      return p;
    });
    chain = {
      ctx,
      channels,
      keys: KEYBOARDS.map((kb, k) => Array.from({ length: VARIANTS }, (_, v) => toBuffer(ctx, kb.key, k * 31 + v, 0.92 + v * 0.05))),
      thunks: KEYBOARDS.map((kb, k) => toBuffer(ctx, kb.thunk, 1000 + k)),
      click: toBuffer(ctx, MOUSE_CLICK, 2000),
      wheel: toBuffer(ctx, WHEEL_NOTCH, 3000),
    };
    generation++;
    return chain;
  } catch {
    return null;
  }
}

// ---------- the API the desks use ----------

/**
 * Builds the channels once audio is ready and says which set is live: a number that changes whenever they're
 * rebuilt, since new channels all sit at the origin until placed again. 0 while audio is locked or unavailable.
 */
export function typingGeneration(): number {
  return getChain() ? generation : 0;
}

/** Move a channel to its typist's keyboard (or mouse). False when it couldn't (audio still locked or unavailable). */
export function placeTypingChannel(channel: number, at: Vec3): boolean {
  const c = getChain();
  if (!c) return false;
  try {
    setPos(c.channels[channel], at);
    return true;
  } catch {
    return false; // audio is optional
  }
}

/**
 * One keystroke, click or wheel notch on a channel, `delay` seconds from now. `variation` (0..1) picks
 * the key and nudges its pitch and loudness, so no two in a row sound quite the same.
 */
export function typingSound(channel: number, name: TypingSound, keyboard: number, variation: number, delay: number, at: Vec3) {
  const kb = KEYBOARDS[keyboard];
  const gain = KEY_GAIN * GAIN[name] * (name === 'click' || name === 'scroll' ? 1 : kb.level) * (0.8 + variation * 0.35);
  const c = getChain();
  record(name, at, gain, !!c, c?.channels[channel]);
  if (!c) return;
  try {
    const src = c.ctx.createBufferSource();
    src.buffer =
      name === 'click' ? c.click : name === 'scroll' ? c.wheel : name === 'key' ? c.keys[keyboard][Math.floor(variation * 997) % VARIANTS] : c.thunks[keyboard];
    src.playbackRate.value = 0.94 + variation * 0.12;
    const g = c.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(c.channels[channel]);
    src.start(c.ctx.currentTime + Math.max(0, delay));
  } catch {
    // audio is optional
  }
}

/** Point the AudioListener where the camera is (a column-major world matrix), without allocating. */
export function moveListener(m: ArrayLike<number>) {
  const c = chain;
  if (!c) return;
  try {
    const l = c.ctx.listener;
    // forward is the camera's -Z axis, up its +Y axis
    if (l.positionX) {
      l.positionX.value = m[12];
      l.positionY.value = m[13];
      l.positionZ.value = m[14];
      l.forwardX.value = -m[8];
      l.forwardY.value = -m[9];
      l.forwardZ.value = -m[10];
      l.upX.value = m[4];
      l.upY.value = m[5];
      l.upZ.value = m[6];
    } else {
      l.setPosition(m[12], m[13], m[14]);
      l.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
    }
  } catch {
    // audio is optional
  }
}
