// Typing from working agents' desks. A few fixed channels (one per heard typist, each the office's panner at
// their keyboard) feed the 'typing' group, under its slider and the master volume. Keystrokes are pre-rendered samples
// started a little ahead on the AudioContext clock, so each one costs a buffer source and a gain. They skip the
// mixer's voice cap: at most TYPING_CHANNELS typists are heard. Every sound asked for is recorded in
// window.__swarmTyping (like __swarmSfx, which a busy floor would otherwise flood), even while audio is locked or
// unavailable, with where its panner really was (`from`).

import { audio, createPanner, groupOutput, recordSfx, setPannerPosition, type SfxRecord, type Vec3 } from './sfx';
import { KEYBOARDS, MOUSE_CLICK, WHEEL_NOTCH, renderKey, type KeySound } from './keyboards';
import { MAX_DISTANCE } from './sfxMix';

export type TypingSound = 'key' | 'space' | 'enter' | 'click' | 'scroll';

/** How many typists are heard at once (the nearest ones). */
export const TYPING_CHANNELS = 4;
/** Beyond this distance (metres) a desk isn't heard at all. */
export const TYPING_RANGE = MAX_DISTANCE;

// The whole group sits well below footsteps (peak ~0.045); a keystroke at arm's length is a soft tick.
const KEY_GAIN = 0.022;
const GAIN: Record<TypingSound, number> = { key: 1, space: 1.25, enter: 1.35, click: 0.7, scroll: 0.3 };
const VARIANTS = 4;
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

const log: SfxRecord[] = [];
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmTyping = log;

function record(name: string, at: Vec3, peak: number, panner?: PannerNode) {
  const rec = recordSfx(name, { group: 'typing', pos: at, peak, played: !!panner }, log);
  rec.from = panner?.positionX ? { x: panner.positionX.value, y: panner.positionY.value, z: panner.positionZ.value } : null;
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

function getChain(): Chain | null {
  const a = audio();
  const group = groupOutput('typing');
  if (!a || !group) return null;
  if (chain?.ctx === a.ctx) return chain;
  try {
    const { ctx } = a;
    const channels = Array.from({ length: TYPING_CHANNELS }, () => {
      const p = createPanner(ctx, ORIGIN);
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
    setPannerPosition(c.channels[channel], at.x, at.y, at.z);
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
  record(name, at, gain, c?.channels[channel]);
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
