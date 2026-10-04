// The weather's pure part: each kind of weather as a mix of clouds, rain, snow, fog, storm and wind; the ~20 s blend
// from one to the next; the calm cycle (a gentle random day, mostly fair, seeded by the date); what the weather does
// to the sky's palette, the outside's sounds, the wet balcony and the snow; and lightning's timing. No three.js and no
// allocation when given an `out`, so the frame loop can call it and every part is tested. weatherState.ts runs it.

import { WEATHER_KINDS, type WeatherKind } from '../../../../shared/outside';
import type { SkyPalette } from '../sky/time';

/** How much of each ingredient the sky has now, 0-1 each. All zero is the office's own clear sky. */
export interface WeatherMix {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  storm: number;
  wind: number;
}

export const MIX_KEYS = ['cloud', 'rain', 'snow', 'fog', 'storm', 'wind'] as const;

export const newMix = (): WeatherMix => ({ cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0 });

/** Each kind at full strength. Clear is all zero: exactly the sky the office had before it had weather. */
export const KIND_MIX: Record<WeatherKind, Readonly<WeatherMix>> = {
  clear: newMix(),
  cloudy: { cloud: 0.7, rain: 0, snow: 0, fog: 0.05, storm: 0, wind: 0.35 },
  'light-rain': { cloud: 0.8, rain: 0.35, snow: 0, fog: 0.15, storm: 0, wind: 0.35 },
  'heavy-rain': { cloud: 0.95, rain: 1, snow: 0, fog: 0.3, storm: 0, wind: 0.6 },
  storm: { cloud: 1, rain: 0.9, snow: 0, fog: 0.25, storm: 1, wind: 1 },
  fog: { cloud: 0.45, rain: 0, snow: 0, fog: 1, storm: 0, wind: 0.05 },
  snow: { cloud: 0.85, rain: 0, snow: 1, fog: 0.35, storm: 0, wind: 0.25 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/**
 * The mix for `kind` at `intensity` (0-1, how hard it comes down: a light snow or a heavy one). Clouds and fog stay
 * near full, so a gentle shower is still a grey day; what falls scales down to a third. `wind` (0-1) can raise the wind.
 */
export function kindMix(kind: WeatherKind, intensity = 1, wind = 0, out = newMix()): WeatherMix {
  const base = KIND_MIX[kind];
  const k = 0.35 + 0.65 * clamp01(intensity);
  out.cloud = base.cloud * (0.75 + 0.25 * k);
  out.fog = base.fog * (kind === 'fog' ? 0.6 + 0.4 * k : 1);
  out.rain = base.rain * k;
  out.snow = base.snow * k;
  out.storm = base.storm * k;
  out.wind = Math.max(base.wind, clamp01(wind));
  return out;
}

/** About how long one weather takes to turn into the next. */
export const BLEND_SECONDS = 20;

/** Moves `cur` towards `target` by dt: every ingredient at the same steady rate, all of it in `seconds`. True if it moved. */
export function blendMix(cur: WeatherMix, target: Readonly<WeatherMix>, dt: number, seconds = BLEND_SECONDS): boolean {
  const step = dt / seconds;
  let moved = false;
  for (const k of MIX_KEYS) {
    const d = target[k] - cur[k];
    if (d === 0) continue;
    cur[k] = Math.abs(d) <= step ? target[k] : cur[k] + Math.sign(d) * step;
    moved = true;
  }
  return moved;
}

/** Nothing to draw or hear: the clear sky, so the whole system can sleep. */
export const isClear = (m: Readonly<WeatherMix>) => MIX_KEYS.every((k) => m[k] < 0.002);

/** How gloomy it is (0-1): the lamps come on earlier, the city lights up a little, the sun dims. */
export const gloomOf = (m: Readonly<WeatherMix>) => clamp01(m.cloud * 0.55 + m.rain * 0.25 + m.storm * 0.35 + m.snow * 0.15 + m.fog * 0.2);

/** How much of the sky is covered (0-1): hides the sun's disc and the stars. */
export const coverOf = (m: Readonly<WeatherMix>) => clamp01(m.cloud * 0.9 + m.storm * 0.1 + m.fog * 0.4);

// ---------- the calm cycle ----------

/** Where the weather can go next, and how likely: mostly fair, rain building up and easing off rather than jumping. */
const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [
    ['clear', 5],
    ['cloudy', 3],
    ['fog', 0.5],
  ],
  cloudy: [
    ['clear', 4],
    ['cloudy', 1.5],
    ['light-rain', 2],
    ['fog', 0.5],
    ['snow', 1],
  ],
  'light-rain': [
    ['cloudy', 3],
    ['light-rain', 1],
    ['heavy-rain', 1.2],
  ],
  'heavy-rain': [
    ['light-rain', 3],
    ['storm', 1.3],
    ['cloudy', 0.7],
  ],
  storm: [
    ['heavy-rain', 2],
    ['light-rain', 2],
  ],
  fog: [
    ['clear', 2],
    ['cloudy', 3],
  ],
  snow: [
    ['cloudy', 3],
    ['snow', 1.5],
  ],
};

/** How long each spell lasts, in minutes: [shortest, longest]. Storms pass; fair spells linger. */
const SPELL_MIN: Record<WeatherKind, [number, number]> = {
  clear: [15, 40],
  cloudy: [10, 25],
  'light-rain': [6, 15],
  'heavy-rain': [4, 10],
  storm: [3, 7],
  fog: [8, 18],
  snow: [10, 25],
};

/** Snow only in the depths of winter (December to February). */
export const snowMonth = (month: number) => month === 11 || month === 0 || month === 1;

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(options: readonly [WeatherKind, number][], roll: number): WeatherKind {
  const total = options.reduce((t, [, w]) => t + w, 0);
  let r = roll * total;
  for (const [k, w] of options) {
    r -= w;
    if (r < 0) return k;
  }
  return options[options.length - 1][0];
}

/** One spell of the calm cycle: its weather, how hard, and when it starts and ends (epoch ms). */
export interface Spell {
  kind: WeatherKind;
  intensity: number;
  from: number;
  until: number;
}

/**
 * The calm cycle's spells for the local day `nowMs` falls in, from midnight to midnight: the same date always gives
 * the same day. `midnight` is that day's local midnight (epoch ms); `month` its month (0-11).
 */
export function calmDay(year: number, month: number, day: number, midnight: number, length = 86_400_000): Spell[] {
  const rnd = seeded(year * 10_000 + (month + 1) * 100 + day);
  const out: Spell[] = [];
  let kind: WeatherKind = rnd() < 0.7 ? 'clear' : 'cloudy';
  let at = midnight;
  while (at < midnight + length) {
    const [lo, hi] = SPELL_MIN[kind];
    const minutes = lo + rnd() * (hi - lo);
    const intensity = kind === 'clear' || kind === 'cloudy' ? 1 : 0.45 + rnd() * 0.55;
    out.push({ kind, intensity, from: at, until: at + minutes * 60_000 });
    at += minutes * 60_000;
    const options = NEXT[kind].filter(([k]) => k !== 'snow' || snowMonth(month));
    kind = pick(options, rnd());
  }
  return out;
}

/** The calm cycle's spell at `nowMs`, in the viewer's own time zone. */
export function calmSpell(nowMs: number): Spell {
  const d = new Date(nowMs);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const spells = calmDay(d.getFullYear(), d.getMonth(), d.getDate(), midnight, next - midnight);
  return spells.find((s) => nowMs < s.until) ?? spells[spells.length - 1];
}

// ---------- overrides ----------

const ALIASES: Record<string, WeatherKind> = {
  rain: 'heavy-rain',
  rainy: 'heavy-rain',
  heavy: 'heavy-rain',
  drizzle: 'light-rain',
  light: 'light-rain',
  showers: 'light-rain',
  cloud: 'cloudy',
  clouds: 'cloudy',
  overcast: 'cloudy',
  thunder: 'storm',
  thunderstorm: 'storm',
  lightning: 'storm',
  foggy: 'fog',
  mist: 'fog',
  snowy: 'snow',
  sun: 'clear',
  sunny: 'clear',
};

/** A weather's name as typed (`?weather=rain`, __swarmWeather.set('storm')), or null when it isn't one. */
export function parseWeatherKind(raw: unknown): WeatherKind | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase().replace(/_/g, '-');
  if (WEATHER_KINDS.includes(k as WeatherKind)) return k as WeatherKind;
  return ALIASES[k] ?? null;
}

/** `?weather=rain|storm|fog|snow|clear` (and the other kinds): holds the weather there for QA. */
export const parseWeatherParam = (search: string) => parseWeatherKind(new URLSearchParams(search).get('weather'));

// ---------- what it does to the sky ----------

const lum = (c: number) => (((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114) / 255;

/** `c` towards a cool grey of its own brightness (amount 0-1), times `bright`: night stays dark, day goes slate. */
function greyed(c: number, amount: number, bright: number): number {
  const l = lum(c);
  const ch = (shift: number, tint: number) => {
    const v = ((c >> shift) & 0xff) / 255;
    return Math.round(clamp01(lerp(v, l * tint, amount) * bright) * 255);
  };
  return (ch(16, 0.96) << 16) | (ch(8, 0.99) << 8) | ch(0, 1.05);
}

function mixHex(a: number, b: number, k: number): number {
  const ch = (shift: number) => Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * The sky's palette under the weather, changed in place: greyer and darker with clouds and rain, darkest in a storm,
 * a pale even grey in fog, the sun dimmed and the stars hidden by cloud, and the city's lights coming on in the gloom.
 */
export function weatherSky(p: SkyPalette, m: Readonly<WeatherMix>): SkyPalette {
  const over = clamp01(m.cloud * 0.8 + m.rain * 0.15 + m.storm * 0.2);
  const dark = 1 - 0.18 * m.cloud - 0.12 * m.rain - 0.25 * m.storm;
  p.zenith = greyed(p.zenith, over * 0.85, dark * (1 - 0.1 * m.cloud));
  p.horizon = greyed(p.horizon, over * 0.8, dark);
  p.fog = greyed(p.fog, Math.max(over, m.fog) * 0.85, dark * (1 + 0.04 * m.fog));
  // fog swallows the horizon and half the sky
  p.horizon = mixHex(p.horizon, p.fog, m.fog * 0.85);
  p.zenith = mixHex(p.zenith, p.fog, m.fog * 0.55);
  p.sunColor = greyed(p.sunColor, over * 0.6, 1);
  // overcast hides the sun: no sunny patches on the floor in the rain
  p.sunIntensity *= Math.max(0.05, 1 - 0.85 * over - 0.15 * m.fog);
  p.hemiSky = greyed(p.hemiSky, over * 0.6, 1 - 0.12 * over);
  p.hemiGround = greyed(p.hemiGround, over * 0.4, 1 - 0.1 * over);
  p.starsOpacity *= 1 - coverOf(m);
  p.exposure *= 1 - 0.06 * over;
  p.cityLights = Math.max(p.cityLights, 0.45 * gloomOf(m) * (1 - p.cityLights));
  return p;
}

/** How far the city's haze starts and is complete (metres): far out on a clear day, close in fog. */
export function hazeRange(m: Readonly<WeatherMix>, out: [number, number] = [0, 0]): [number, number] {
  const thick = clamp01(m.fog + m.rain * 0.35 + m.snow * 0.4 + m.storm * 0.2);
  out[0] = lerp(40, 6, thick);
  out[1] = lerp(500, 120, thick);
  return out;
}

// ---------- what it does to the sounds ----------

/** The outside's layers (outsideMix.ts) under the weather, in place: birds go quiet in rain, snow hushes the city, storms blow. */
export function weatherLayers<T extends { wind: number; city: number; birds: number; crickets: number; carsPerMin: number }>(l: T, m: Readonly<WeatherMix>): T {
  l.birds *= (1 - smoothstep(0.03, 0.3, m.rain + m.storm)) * (1 - 0.8 * m.snow) * (1 - 0.6 * m.fog);
  l.crickets *= 1 - smoothstep(0.05, 0.4, m.rain + m.snow + m.storm);
  l.wind *= 1 + 1.6 * m.wind * m.cloud;
  l.city *= 1 - 0.6 * m.snow - 0.25 * m.fog;
  l.carsPerMin *= 1 - 0.5 * m.snow;
  return l;
}

// ---------- the wet balcony and the snow ----------

/** Wetness (0-1) after dt seconds: soaks in within about a minute of heavy rain, dries over a few minutes. */
export function wetStep(wet: number, rain: number, dt: number): number {
  return rain > 0.05 ? Math.min(1, wet + dt * rain * 0.03) : Math.max(0, wet - dt / 240);
}

/** Snow lying on the ground (0-1) after dt seconds: settles over a minute or two of snow, melts over a few minutes. */
export function snowStep(cover: number, snow: number, rain: number, dt: number): number {
  return snow > 0.05 ? Math.min(1, cover + dt * snow * 0.012) : Math.max(0, cover - dt * (1 + rain * 4) / 300);
}

// ---------- lightning ----------

/** Seconds to the next flash in a storm of strength `storm` (a roll in [0, 1)); Infinity outside storms. */
export function nextFlashIn(storm: number, roll: number): number {
  if (storm < 0.3) return Infinity;
  return 4 + (6 + 16 * clamp01(roll)) / storm;
}

/** How bright a flash is `since` seconds after it struck (0-1): a bright strike and two after-flickers. */
export function flashLevel(since: number): number {
  if (since < 0 || since > 0.9) return 0;
  const bump = (at: number, w: number, h: number) => h * Math.max(0, 1 - Math.abs(since - at) / w);
  const strike = since < 0.03 ? since / 0.03 : Math.exp(-(since - 0.03) * 14);
  return clamp01(strike + bump(0.18, 0.07, 0.75) + bump(0.42, 0.09, 0.45));
}

/** Seconds between the flash and its thunder: 1-4 s, the nearer strikes sooner (and louder). */
export const thunderDelay = (roll: number) => 1 + 3 * clamp01(roll);
