// The outside's settings and the real weather, shared by the server (which reads Open-Meteo for "My real weather")
// and the client (which draws it): the weather kinds, Open-Meteo's WMO codes mapped onto them, and the Settings →
// Weather and World events values, normalised field by field. Pure, so every code and every bad value is tested.

/** What the sky can do, from fair to wild. */
export const WEATHER_KINDS = ['clear', 'cloudy', 'light-rain', 'heavy-rain', 'storm', 'fog', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** Where the weather comes from: a gentle random day (default), always clear, or the manager's real local weather. */
export const WEATHER_MODES = ['cycle', 'off', 'real'] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export interface WeatherSettings {
  mode: WeatherMode;
  /** The city (or "lat, lon") for 'real'; '' when none was given. */
  city: string;
}

export const DEFAULT_WEATHER: WeatherSettings = { mode: 'cycle', city: '' };

/** How often a world event happens outside: never, now and then, every 6–20 minutes, or all the time. */
export const EVENT_FREQUENCIES = ['off', 'rare', 'normal', 'chaos'] as const;
export type EventFrequency = (typeof EVENT_FREQUENCIES)[number];

export interface WorldEventSettings {
  frequency: EventFrequency;
  /** Keep it calm: no absurd events (the kaiju, the giant duck, the whale) and no hurricane. */
  calm: boolean;
}

export const DEFAULT_WORLD_EVENTS: WorldEventSettings = { frequency: 'normal', calm: false };

/** A place the weather is read for. Coordinates are rounded to about a kilometre before they're stored or sent. */
export interface WeatherPlace {
  name: string;
  lat: number;
  lon: number;
}

/** The latest real reading: what it's doing there, how hard (0-1), the WMO code and wind (km/h), and when it was read. */
export interface WeatherReading {
  kind: WeatherKind;
  intensity: number;
  code: number;
  wind: number;
  at: number;
}

/** The server's side of "My real weather", in the snapshot and the `weather` event. */
export interface WeatherView {
  place: WeatherPlace | null;
  reading: WeatherReading | null;
  /** Why the last lookup failed (offline, city not found), or null. The office falls back to the calm cycle meanwhile. */
  error: string | null;
}

export const EMPTY_WEATHER_VIEW: WeatherView = { place: null, reading: null, error: null };

/** A reading older than this no longer counts (three missed 15-minute polls): the calm cycle takes over. */
export const READING_STALE_MS = 50 * 60_000;

const CITY_MAX = 80;

/** Weather settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function weatherSettings(base: WeatherSettings, patch: unknown): WeatherSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof WeatherSettings, unknown>>;
  const out = { ...base };
  if (WEATHER_MODES.includes(p.mode as WeatherMode)) out.mode = p.mode as WeatherMode;
  if (typeof p.city === 'string') out.city = p.city.replace(/\s+/g, ' ').trim().slice(0, CITY_MAX);
  return out;
}

/** World event settings, the same way. */
export function worldEventSettings(base: WorldEventSettings, patch: unknown): WorldEventSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof WorldEventSettings, unknown>>;
  const out = { ...base };
  if (EVENT_FREQUENCIES.includes(p.frequency as EventFrequency)) out.frequency = p.frequency as EventFrequency;
  if (typeof p.calm === 'boolean') out.calm = p.calm;
  return out;
}

/** About a kilometre: enough for the weather, and no more precise than that leaves the office. */
export const roundCoord = (v: number) => Math.round(v * 100) / 100;

/** "52.52, 13.41" typed as the city: coordinates used as they are (no lookup), or null for a name. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

/**
 * Open-Meteo's WMO weather code as one of the office's kinds, with how hard it's coming down (0-1). Hail and
 * thunder are storms, freezing drizzle and rain count as rain, snow grains and showers as snow. Unknown codes are clear.
 */
export function weatherFromCode(code: number): { kind: WeatherKind; intensity: number } {
  switch (code) {
    case 0:
      return { kind: 'clear', intensity: 0 };
    case 1:
      return { kind: 'clear', intensity: 0.3 };
    case 2:
      return { kind: 'cloudy', intensity: 0.6 };
    case 3:
      return { kind: 'cloudy', intensity: 1 };
    case 45:
      return { kind: 'fog', intensity: 0.8 };
    case 48:
      return { kind: 'fog', intensity: 1 };
    case 51:
    case 56:
      return { kind: 'light-rain', intensity: 0.4 };
    case 53:
    case 61:
    case 66:
    case 80:
      return { kind: 'light-rain', intensity: 0.7 };
    case 55:
    case 57:
      return { kind: 'light-rain', intensity: 1 };
    case 63:
    case 81:
      return { kind: 'heavy-rain', intensity: 0.7 };
    case 65:
    case 67:
    case 82:
      return { kind: 'heavy-rain', intensity: 1 };
    case 71:
    case 77:
    case 85:
      return { kind: 'snow', intensity: 0.5 };
    case 73:
      return { kind: 'snow', intensity: 0.75 };
    case 75:
    case 86:
      return { kind: 'snow', intensity: 1 };
    case 95:
      return { kind: 'storm', intensity: 0.8 };
    case 96:
    case 99:
      return { kind: 'storm', intensity: 1 };
    default:
      return { kind: 'clear', intensity: 0 };
  }
}

/** A fresh enough reading for the office to show, or null (none yet, or stale: the calm cycle shows instead). */
export function liveReading(view: Pick<WeatherView, 'reading'> | null | undefined, now: number): WeatherReading | null {
  const r = view?.reading;
  return r && now - r.at < READING_STALE_MS && now - r.at > -60_000 ? r : null;
}
