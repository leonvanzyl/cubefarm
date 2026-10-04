// The jukebox's lo-fi texture as pure numbers (no WebAudio, so they're unit tested): the vinyl bed's hiss and pops,
// written once into a looped buffer that music.ts plays as a single source, and how far the tape wobble bends the
// pitch.

/** Seconds of vinyl in the looped bed: long enough that its pops don't fall into a pattern you'd notice. */
export const CRACKLE_SECONDS = 5.3;
/** Small crackles a second, on average, and the rarer big pops. */
export const CRACKLES_PER_SEC = 7;
export const POPS_PER_SEC = 0.5;
/** The hiss's level in the bed (pops reach 1; music.ts turns the whole bed down to sit under the music). */
export const HISS = 0.05;
/** No two pops closer than this (seconds). */
export const MIN_GAP = 0.015;

/** One crackle or pop: when (s into the bed), how big (0-1) and how long it rings (s). */
export interface Pop {
  at: number;
  size: number;
  len: number;
}

/** Seconds to the next of a stream of random events at `perSec` a second, for a roll in [0, 1). */
const gap = (perSec: number, roll: number) => -Math.log(1 - Math.min(Math.max(roll, 0), 0.999)) / perSec;

/**
 * Where the bed's pops fall over `seconds`, from `rand` (a source of [0, 1) numbers): many small crackles at random,
 * now and then a big pop, never two closer than MIN_GAP (the smaller one gives way). Sorted by time.
 */
export function cracklePops(seconds: number, rand: () => number): Pop[] {
  const all: Pop[] = [];
  for (let t = gap(CRACKLES_PER_SEC, rand()); t < seconds; t += gap(CRACKLES_PER_SEC, rand())) all.push({ at: t, size: 0.12 + 0.3 * rand(), len: 0.0006 + 0.0012 * rand() });
  for (let t = gap(POPS_PER_SEC, rand()); t < seconds; t += gap(POPS_PER_SEC, rand())) all.push({ at: t, size: 0.6 + 0.4 * rand(), len: 0.0018 + 0.0025 * rand() });
  all.sort((a, b) => a.at - b.at);
  const out: Pop[] = [];
  for (const p of all) {
    const last = out[out.length - 1];
    if (!last || p.at - last.at >= MIN_GAP) out.push(p);
    else if (p.size > last.size) out[out.length - 1] = p;
  }
  return out.filter((p) => p.at + p.len < seconds);
}

/**
 * Writes the bed into `out` (samples at `rate` Hz): a soft hiss (white noise with its rumble taken off) and the pops,
 * each a quick decaying click of random polarity. Returns the pops.
 */
export function fillCrackle(out: Float32Array, rate: number, rand: () => number): Pop[] {
  let x0 = 0;
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const x = rand() * 2 - 1;
    y = 0.97 * (y + x - x0); // one-pole highpass, about 230 Hz at 48 kHz
    x0 = x;
    out[i] = HISS * y;
  }
  const pops = cracklePops(out.length / rate, rand);
  for (const p of pops) {
    const start = Math.floor(p.at * rate);
    const n = Math.max(2, Math.round(p.len * rate));
    const sign = rand() < 0.5 ? -1 : 1;
    for (let k = 0; k < n && start + k < out.length; k++) {
      // a click: full size at once, decaying, its polarity flipping as it rings
      out[start + k] += sign * p.size * Math.exp((-4 * k) / n) * (k % 2 === 0 ? 1 : -0.6);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return pops;
}

/** The tape wobble: a slow wave swinging a short delay by ±depth seconds around `delay`, bending the pitch. */
export const WOBBLE = { hz: 0.45, depth: 0.0016, delay: 0.006 } as const;

/** How far a delay swinging ±depth seconds at `hz` bends the pitch at most, in cents. */
export const wobbleCents = (hz: number, depth: number) => 1200 * Math.log2(1 + 2 * Math.PI * hz * depth);
