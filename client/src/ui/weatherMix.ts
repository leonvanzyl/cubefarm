// The weather's sounds' pure decisions (weatherSfx.ts plays them): how loud and how muffled the rain, the wind, the
// snow's hush and the thunder are from where you stand, and the pattering of drops on the glass. The rain is heard on
// the windows all through the office, muffled, where the rest of the outside is almost silent; thunder shakes through
// the walls. Out on a balcony everything is full and clear.

import { cutoffHz, type OutsideHearing } from './outsideMix';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The rain on the glass anywhere indoors: how loud, and how clear (cutoffHz) it is through the panes. */
export const RAIN_INDOORS = { level: 0.32, clarity: 0.42 };
/** Thunder through the walls. */
export const THUNDER_INDOORS = { level: 0.6, clarity: 0.2 };

export interface Heard {
  level: number;
  /** Lowpass cutoff in Hz. */
  cutoff: number;
}

/** The rain from where you are (`h`: the outside's own hearing there). */
export function rainHeard(h: Readonly<OutsideHearing>): Heard {
  return { level: Math.max(h.level, RAIN_INDOORS.level), cutoff: cutoffHz(Math.max(h.clarity, RAIN_INDOORS.clarity)) };
}

/** Thunder from where you are. */
export function thunderHeard(h: Readonly<OutsideHearing>): Heard {
  return { level: Math.max(h.level, THUNDER_INDOORS.level), cutoff: cutoffHz(Math.max(h.clarity, THUNDER_INDOORS.clarity)) };
}

/** The weather's layers, 0-1 of their full gain, for a mix: rain, a storm's wind and the hush of snow. */
export function weatherSoundLayers(m: { rain: number; snow: number; storm: number; wind: number; cloud: number }): { rain: number; patter: number; gust: number; hush: number } {
  return {
    rain: clamp01(m.rain),
    // the drops on the glass stand out most in a light shower
    patter: clamp01(m.rain * 1.6) * (1 - 0.35 * clamp01(m.rain)),
    gust: clamp01(m.wind * (0.4 + 0.6 * m.storm) * m.cloud * 1.2),
    hush: clamp01(m.snow),
  };
}

/**
 * Raindrops on a pane, as a looped buffer: `perSecond` little ticks at random moments in `seconds`, each a short
 * decaying burst, some brighter than others. Fills and returns `out` (the buffer's channel data).
 */
export function patterSamples(out: Float32Array, sampleRate: number, perSecond: number, rand: () => number): Float32Array {
  out.fill(0);
  const drops = Math.round((out.length / sampleRate) * perSecond);
  for (let d = 0; d < drops; d++) {
    const at = Math.floor(rand() * out.length);
    const decay = sampleRate * (0.002 + rand() * 0.006);
    const amp = 0.25 + rand() * 0.75;
    const len = Math.min(Math.floor(decay * 5), out.length);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      // a bright crack that rings down: noise, lightly smoothed, under an exponential decay
      const n = rand() * 2 - 1;
      prev = prev * 0.35 + n * 0.65;
      out[(at + i) % out.length] += prev * amp * Math.exp(-i / decay);
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}
