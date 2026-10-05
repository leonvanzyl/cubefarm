// How the post-processing follows the time of day (time.ts): High's colour grade (warm highlights at golden hour,
// cool blue shadows at night while the lamplight stays warm, untouched at noon) and the bloom's strength (faint by day
// so daylight stays clean, strong after dusk). Pure, with `out` parameters for the frame loop; pipeline.ts turns these
// into shader uniforms.
import { nightFactor, skyAt, type SkyPalette } from '../sky/time';

/** An RGB multiplier with its luminance kept at 1, so it tints without brightening or darkening. */
export interface Tint {
  r: number;
  g: number;
  b: number;
}

export interface Grade {
  /** The tint for the darkest tones... */
  shadows: Tint;
  /** ...and for the brightest; the mid-tones blend the two. */
  highlights: Tint;
  /** 1 = unchanged. */
  saturation: number;
  contrast: number;
}

export interface BloomLook {
  intensity: number;
  /** Luminance (0..1, of the on-screen colour) where glowing things start to bloom. */
  threshold: number;
  smoothing: number;
}

/** How much of the key light's hue goes into the grade: the sun's into everything by day, the moon's into the shadows at night. */
const SUN_TINT = 0.14;
const MOON_TINT = 0.3;

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const palette = {} as SkyPalette;

/** `k` of the hue (r, g, b, brightest channel 1) as a luminance-neutral tint. */
function tint(out: Tint, r: number, g: number, b: number, k: number) {
  const tr = 1 + (r - 1) * k;
  const tg = 1 + (g - 1) * k;
  const tb = 1 + (b - 1) * k;
  const l = luma(tr, tg, tb);
  out.r = tr / l;
  out.g = tg / l;
  out.b = tb / l;
  return out;
}

/** The colour grade at phase t. Identity at noon and through the afternoon, whose light is pure white. */
export function gradeAt(t: number, out: Grade = { shadows: { r: 1, g: 1, b: 1 }, highlights: { r: 1, g: 1, b: 1 }, saturation: 1, contrast: 1 }): Grade {
  const p = skyAt(t, palette);
  const night = nightFactor(t);
  // The key light's hue, scaled so its brightest channel is 1: (1, 1, 1) by day, amber at sunset, blue moonlight.
  const top = Math.max((p.sunColor >> 16) & 0xff, (p.sunColor >> 8) & 0xff, p.sunColor & 0xff, 1);
  const r = ((p.sunColor >> 16) & 0xff) / top;
  const g = ((p.sunColor >> 8) & 0xff) / top;
  const b = (p.sunColor & 0xff) / top;
  const day = SUN_TINT * (1 - night);
  tint(out.highlights, r, g, b, day);
  tint(out.shadows, r, g, b, day + MOON_TINT * night);
  // Warmth: positive when the light is amber (golden hour).
  const warm = Math.max(0, r - b);
  out.saturation = 1 + 0.12 * warm - 0.04 * night;
  out.contrast = 1 + 0.03 * warm + 0.04 * night;
  return out;
}

// Strong enough to haze small bright things on the dark (lamps, LEDs, windows, terminal text), not so strong that a
// white page on a screen washes its own text away.
const DAY_BLOOM: BloomLook = { intensity: 0.35, threshold: 0.85, smoothing: 0.15 };
const NIGHT_BLOOM: BloomLook = { intensity: 1.6, threshold: 0.4, smoothing: 0.3 };

/** The bloom at phase t, easing between day and night with the sky. */
export function bloomAt(t: number, out = {} as BloomLook): BloomLook {
  const n = nightFactor(t);
  out.intensity = lerp(DAY_BLOOM.intensity, NIGHT_BLOOM.intensity, n);
  out.threshold = lerp(DAY_BLOOM.threshold, NIGHT_BLOOM.threshold, n);
  out.smoothing = lerp(DAY_BLOOM.smoothing, NIGHT_BLOOM.smoothing, n);
  return out;
}

/** Things that only glow after dark (the moon, the city's windows, the lamps) join the bloom past this much night. */
export const NIGHT_BLOOM_FROM = 0.5;
