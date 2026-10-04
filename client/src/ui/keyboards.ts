// The keyboards the agents type on, as tiny synthesized samples: each voice's keys, space bar and enter,
// plus a mouse click and a wheel notch. Rendered once into plain arrays (pure, no WebAudio), so a
// keystroke costs one buffer source and one gain instead of a chain of oscillators and filters.

export interface Hit {
  freq: number; // band-pass centre (Hz)
  q: number;
  decay: number; // seconds to fall to ~37%
  delay?: number; // seconds after the start
  mix: number; // relative level
}

export interface KeySound {
  hits: Hit[]; // noise transients, e.g. the click and the bottom-out
  ping?: { freq: number; decay: number; mix: number }; // a metallic ring (buckling springs)
}

export interface Keyboard {
  name: string;
  key: KeySound;
  thunk: KeySound; // space bar and enter: bigger and lower
  level: number; // how loud this keyboard is next to the others
}

/** Four keyboards; each person gets one from their id. */
export const KEYBOARDS: Keyboard[] = [
  {
    name: 'soft laptop',
    key: { hits: [{ freq: 3200, q: 1.2, decay: 0.005, mix: 1 }, { freq: 900, q: 1, decay: 0.008, delay: 0.004, mix: 0.4 }] },
    thunk: { hits: [{ freq: 2200, q: 1, decay: 0.006, mix: 0.8 }, { freq: 520, q: 1, decay: 0.016, delay: 0.005, mix: 0.8 }] },
    level: 0.75,
  },
  {
    name: 'clacky mechanical',
    key: { hits: [{ freq: 4800, q: 2, decay: 0.003, mix: 1 }, { freq: 1900, q: 1.5, decay: 0.01, delay: 0.012, mix: 0.8 }] },
    thunk: { hits: [{ freq: 3800, q: 1.6, decay: 0.004, mix: 0.9 }, { freq: 1000, q: 1.2, decay: 0.02, delay: 0.014, mix: 1 }] },
    level: 1,
  },
  {
    name: 'chunky old-school',
    key: {
      hits: [{ freq: 2600, q: 2.5, decay: 0.006, mix: 1 }, { freq: 700, q: 1.2, decay: 0.018, delay: 0.016, mix: 1 }],
      ping: { freq: 2350, decay: 0.03, mix: 0.12 },
    },
    thunk: {
      hits: [{ freq: 2000, q: 2, decay: 0.008, mix: 0.9 }, { freq: 420, q: 1.1, decay: 0.03, delay: 0.02, mix: 1.1 }],
      ping: { freq: 1900, decay: 0.04, mix: 0.12 },
    },
    level: 0.95,
  },
  {
    name: 'quiet membrane',
    key: { hits: [{ freq: 1400, q: 0.8, decay: 0.007, mix: 1 }, { freq: 480, q: 1, decay: 0.01, delay: 0.003, mix: 0.6 }] },
    thunk: { hits: [{ freq: 900, q: 0.8, decay: 0.01, mix: 1 }, { freq: 320, q: 1, decay: 0.018, delay: 0.004, mix: 0.7 }] },
    level: 0.55,
  },
];

export const MOUSE_CLICK: KeySound = { hits: [{ freq: 5200, q: 2.5, decay: 0.002, mix: 1 }, { freq: 2600, q: 2, decay: 0.003, delay: 0.002, mix: 0.5 }] };
export const WHEEL_NOTCH: KeySound = { hits: [{ freq: 2800, q: 3, decay: 0.0015, mix: 1 }] };

/** Which keyboard someone types on, from their id hash. */
export const keyboardFor = (hash: number) => hash % KEYBOARDS.length;

/** A tiny seeded random number generator (mulberry32), so samples render the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render one sound to mono samples, peak-normalized to 1. `detune` scales every frequency (0.9-1.1 makes
 * a few slightly different keys from one design).
 */
export function renderKey(sound: KeySound, sampleRate: number, seed: number, detune = 1): Float32Array {
  let len = 0;
  for (const h of sound.hits) len = Math.max(len, (h.delay ?? 0) + h.decay * 7);
  if (sound.ping) len = Math.max(len, sound.ping.decay * 7);
  const out = new Float32Array(Math.max(1, Math.ceil(len * sampleRate)));
  const rand = rng(seed);
  for (const h of sound.hits) {
    // RBJ band-pass biquad (constant 0 dB peak gain) over white noise.
    const w = (2 * Math.PI * Math.min(h.freq * detune, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * h.q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w)) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const start = Math.round((h.delay ?? 0) * sampleRate);
    const attack = Math.max(1, Math.round(sampleRate * 0.0006));
    for (let i = start; i < out.length; i++) {
      const n = i - start;
      const env = Math.min(1, n / attack) * Math.exp(-n / (h.decay * sampleRate));
      const x = (rand() * 2 - 1) * env;
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] += y * h.mix;
    }
  }
  if (sound.ping) {
    const { freq, decay, mix } = sound.ping;
    for (let i = 0; i < out.length; i++) out[i] += Math.sin((2 * Math.PI * freq * detune * i) / sampleRate) * Math.exp(-i / (decay * sampleRate)) * mix;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  // Fade the last couple of milliseconds so the sample never ends on a click of its own.
  const fade = Math.min(out.length, Math.round(sampleRate * 0.002));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
