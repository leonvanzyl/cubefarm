// The office's time of day: one clock the sun, sky, city lights and indoor light all follow. Pure (no
// three.js scene code), so every moment of the day is tested without a browser. A phase t in [0, 1):
// 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Colours are 0xrrggbb numbers (THREE.Color.setHex).

export const DAY_MODES = ['cycle', 'clock', 'day'] as const;
/** 'cycle': a full day every 30 minutes; 'clock': the viewer's local time; 'day': always mid-afternoon. */
export type DayMode = (typeof DAY_MODES)[number];
export const DEFAULT_DAY_MODE: DayMode = 'cycle';

export const CYCLE_MS = 30 * 60_000;
/** The phase in 'day' mode: mid-afternoon, the office's look before the sky had a clock. */
export const AFTERNOON_T = 0.6;
export const SUNRISE_T = 0.25;
export const SUNSET_T = 0.75;

/**
 * The 30-minute day as [minute, t] knots, linear between them: night races by (about a quarter of the
 * cycle), dawn and blue hour get a minute or two each and golden hour (t 0.70–0.76) exactly two.
 */
const CYCLE_KNOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [2.75, 0.2], // night, midnight to first light
  [4.75, 0.28], // dawn
  [23.75, 0.7], // day
  [25.75, 0.76], // golden hour
  [27.25, 0.8], // blue hour
  [30, 1], // night, to midnight
];

const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Where in the 30-minute day `ms` (0 ≤ ms < CYCLE_MS) falls. */
function cyclePhase(ms: number): number {
  const minute = ms / 60_000;
  for (let i = 1; i < CYCLE_KNOTS.length; i++) {
    const [m1, t1] = CYCLE_KNOTS[i];
    if (minute <= m1) {
      const [m0, t0] = CYCLE_KNOTS[i - 1];
      return t0 + ((minute - m0) / (m1 - m0)) * (t1 - t0);
    }
  }
  return 0;
}

/** The phase of the day at `nowMs` (epoch milliseconds) in [0, 1). */
export function dayPhase(nowMs: number, mode: DayMode): number {
  if (mode === 'day') return AFTERNOON_T;
  if (mode === 'clock') {
    const d = new Date(nowMs);
    const s = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    return frac(s / 86_400);
  }
  return frac(cyclePhase(((nowMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS));
}

/** How far the sun's path leans south (+z), so its light comes in through the side windows. */
const SOUTH_TILT = 0.45; // radians

/**
 * Unit vector towards the sun: rises in the east (+x), sets in the west (−x), below the horizon (y < 0) at night.
 * Pass `out` to fill it instead of allocating (frame loops).
 */
export function sunDirection(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const a = 2 * Math.PI * (t - SUNRISE_T);
  // Already unit length: cos² + sin²(cos² + sin²) = 1.
  out[0] = Math.cos(a);
  out[1] = Math.sin(a) * Math.cos(SOUTH_TILT);
  out[2] = Math.sin(a) * Math.sin(SOUTH_TILT);
  return out;
}

/** 0 by day, 1 at night, easing through dusk (t 0.74–0.80) and dawn (0.20–0.26). */
export function nightFactor(t: number): number {
  return smoothstep(0.24, 0.3, Math.abs(frac(t) - 0.5));
}

/** Everything the outside and the light need at one moment. */
export interface SkyPalette {
  zenith: number;
  horizon: number;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  ambient: number;
  exposure: number;
  /** 0..1 */
  starsOpacity: number;
  /** How many of the city's windows and streetlights are lit, 0..1. */
  cityLights: number;
}

type Key = [t: number, palette: SkyPalette];

const NIGHT: SkyPalette = {
  zenith: 0x0d1638,
  horizon: 0x26346b,
  fog: 0x1d2850,
  sunColor: 0x8fa6ff, // moonlight
  sunIntensity: 0.25,
  hemiSky: 0x4a5a9a,
  hemiGround: 0x2a2440,
  ambient: 0.22,
  exposure: 0.9,
  starsOpacity: 1,
  cityLights: 1,
};

/** Afternoon is the office as it was before the sky had a clock (Game.tsx, Shell.tsx's Lights). */
const AFTERNOON: SkyPalette = {
  zenith: 0x8ccaf5,
  horizon: 0xbfe3ff,
  fog: 0xf3ece2,
  sunColor: 0xffffff,
  sunIntensity: 1.55,
  hemiSky: 0xfffaf0,
  hemiGround: 0xa48a6a,
  ambient: 0.18,
  exposure: 1,
  starsOpacity: 0,
  cityLights: 0,
};

const KEYS: Key[] = [
  [0, NIGHT],
  [0.2, { ...NIGHT, horizon: 0x2c3a74 }],
  // dawn blue hour, then a pink-peach sunrise
  [0.235, { zenith: 0x24336e, horizon: 0x6a72b0, fog: 0x4e5590, sunColor: 0xff9a7a, sunIntensity: 0.35, hemiSky: 0x6f78b8, hemiGround: 0x3a3048, ambient: 0.2, exposure: 0.92, starsOpacity: 0.5, cityLights: 0.7 }],
  [0.27, { zenith: 0x6f8fd0, horizon: 0xffb4a0, fog: 0xf0c4b4, sunColor: 0xffb48a, sunIntensity: 0.8, hemiSky: 0xffe0d0, hemiGround: 0x7a6560, ambient: 0.18, exposure: 0.96, starsOpacity: 0, cityLights: 0.15 }],
  [0.33, { zenith: 0x86c0f0, horizon: 0xcfe6ff, fog: 0xf0ebe6, sunColor: 0xfff1e0, sunIntensity: 1.35, hemiSky: 0xfff6ee, hemiGround: 0x9c8670, ambient: 0.18, exposure: 1, starsOpacity: 0, cityLights: 0 }],
  [0.5, { zenith: 0x7cc2f7, horizon: 0xc4e6ff, fog: 0xf2eee6, sunColor: 0xffffff, sunIntensity: 1.65, hemiSky: 0xfffcf4, hemiGround: 0xa48a6a, ambient: 0.18, exposure: 1, starsOpacity: 0, cityLights: 0 }],
  [AFTERNOON_T, AFTERNOON],
  // golden hour, warm orange and pink, peaking at sunset
  [0.71, { zenith: 0x7fa8e0, horizon: 0xffc888, fog: 0xf6d6b0, sunColor: 0xffc070, sunIntensity: 1.35, hemiSky: 0xffe6c0, hemiGround: 0x9a7458, ambient: 0.18, exposure: 1.02, starsOpacity: 0, cityLights: 0 }],
  [SUNSET_T, { zenith: 0x5f6fb8, horizon: 0xff9a6a, fog: 0xf2a88a, sunColor: 0xff8a50, sunIntensity: 0.9, hemiSky: 0xffb8a0, hemiGround: 0x6e5060, ambient: 0.19, exposure: 1, starsOpacity: 0, cityLights: 0.25 }],
  // blue hour
  [0.775, { zenith: 0x2a3a80, horizon: 0x7a6ab8, fog: 0x5a5a96, sunColor: 0xb0a0ff, sunIntensity: 0.35, hemiSky: 0x7a7ac0, hemiGround: 0x3a3050, ambient: 0.21, exposure: 0.94, starsOpacity: 0.35, cityLights: 0.8 }],
  [0.81, NIGHT],
  [1, NIGHT],
];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function lerpColor(a: number, b: number, k: number): number {
  const ch = (shift: number) => Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const COLORS = ['zenith', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'] as const;
const NUMBERS = ['sunIntensity', 'ambient', 'exposure', 'starsOpacity', 'cityLights'] as const;

/**
 * The palette at phase t, eased between the key moments (noon, golden hour, blue hour, night, dawn).
 * Pass `out` to fill it instead of allocating (frame loops).
 */
export function skyAt(t: number, out = {} as SkyPalette): SkyPalette {
  const x = frac(t);
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] <= x) i++;
  const [t0, a] = KEYS[i - 1];
  const [t1, b] = KEYS[i];
  const k = smoothstep(t0, t1, x);
  for (const c of COLORS) out[c] = lerpColor(a[c], b[c], k);
  for (const n of NUMBERS) out[n] = lerp(a[n], b[n], k);
  return out;
}

// ---------- overrides and settings ----------

/** `?daytime=0.73` freezes the clock at that phase (for tests and QA); null when absent or not a number in [0, 1]. */
export function parseDaytimeParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('daytime');
  if (raw === null || raw.trim() === '') return null;
  const t = Number(raw);
  if (!Number.isFinite(t) || t < 0 || t > 1) return null;
  return frac(t);
}

/** A saved mode, or the default when it's missing or unknown. */
export function parseDayMode(raw: unknown): DayMode {
  return DAY_MODES.includes(raw as DayMode) ? (raw as DayMode) : DEFAULT_DAY_MODE;
}
