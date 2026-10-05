// "My real weather" (Settings → Weather): the city is looked up once with Open-Meteo's free, keyless geocoder (or
// typed as "lat, lon" and not looked up at all), then the current conditions are read for its rounded coordinates,
// and nothing else, every 15 minutes while that mode is on. The place and the last reading are cached in
// <SWARM_HOME>/weather.json, so a restart carries on from them. Any failure (offline, a city that isn't found) is
// kept as `error`, and the office shows its calm cycle until a reading comes in; nothing is retried faster than the
// poll. The demo has its own fake source (demo.ts) and cache file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EMPTY_WEATHER_VIEW, parseCoordinates, roundCoord, weatherFromCode, WEATHER_KINDS, type WeatherPlace, type WeatherReading, type WeatherSettings, type WeatherView } from '../shared/outside.ts';

export const POLL_MS = 15 * 60_000;
const TIMEOUT_MS = 8000;
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

export interface WeatherApi {
  /** The best match for a city name, or null when there's none. Throws when the service can't be reached. */
  geocode(city: string): Promise<WeatherPlace | null>;
  /** The WMO weather code and wind speed (km/h) there now. Throws when it can't be read. */
  current(lat: number, lon: number): Promise<{ code: number; wind: number }>;
}

// ---------- Open-Meteo ----------

/** The first result of a geocoder search as a place ("Cape Town, South Africa"), or null for none. */
export function placeFromSearch(json: unknown): WeatherPlace | null {
  const first = (json as { results?: unknown[] } | null)?.results?.[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const { name, country, latitude, longitude } = first;
  if (typeof name !== 'string' || typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { name: typeof country === 'string' && country ? `${name}, ${country}` : name, lat: roundCoord(latitude), lon: roundCoord(longitude) };
}

/** The current code and wind from a forecast response; throws when they're missing. */
export function currentFromForecast(json: unknown): { code: number; wind: number } {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  const code = c?.weather_code;
  if (typeof code !== 'number' || !Number.isFinite(code)) throw new Error('the forecast had no current weather');
  const wind = typeof c?.wind_speed_10m === 'number' && Number.isFinite(c.wind_speed_10m) ? c.wind_speed_10m : 0;
  return { code, wind };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  return res.json();
}

export const openMeteo: WeatherApi = {
  geocode: async (city) => placeFromSearch(await getJson(`${GEOCODER}?${new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' })}`)),
  current: async (lat, lon) =>
    currentFromForecast(await getJson(`${FORECAST}?${new URLSearchParams({ latitude: String(roundCoord(lat)), longitude: String(roundCoord(lon)), current: 'weather_code,wind_speed_10m' })}`)),
};

// ---------- pure parts ----------

export const readingFrom = (code: number, wind: number, at: number): WeatherReading => ({ ...weatherFromCode(code), code, wind: Math.max(0, Math.round(wind)), at });

/** Milliseconds until the next poll: now for no reading (or one from the future), else 15 minutes after the last. */
export function pollDelay(reading: WeatherReading | null, now: number): number {
  if (!reading || reading.at > now) return 0;
  return Math.max(0, reading.at + POLL_MS - now);
}

/** What weather.json held: the city its place was looked up for, the place and the last reading. Anything malformed is dropped. */
export function parseCache(raw: unknown): { city: string; place: WeatherPlace | null; reading: WeatherReading | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = o.place as Record<string, unknown> | undefined;
  const place =
    p && typeof p.name === 'string' && typeof p.lat === 'number' && typeof p.lon === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
      ? { name: p.name.slice(0, 120), lat: roundCoord(p.lat), lon: roundCoord(p.lon) }
      : null;
  const r = o.reading as Record<string, unknown> | undefined;
  const reading =
    r && typeof r.code === 'number' && typeof r.at === 'number' && Number.isFinite(r.at) && WEATHER_KINDS.includes(weatherFromCode(r.code).kind)
      ? readingFrom(r.code, typeof r.wind === 'number' ? r.wind : 0, r.at)
      : null;
  return { city: typeof o.city === 'string' ? o.city : '', place, reading: place ? reading : null };
}

const why = (err: unknown) => {
  const e = err as Error & { cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'Open-Meteo took too long to answer';
  if (e?.cause?.code || /fetch failed/i.test(e?.message ?? '')) return "couldn't reach Open-Meteo (offline?)";
  return e?.message || 'the weather lookup failed';
};

// ---------- the service ----------

export class WeatherService {
  private view: WeatherView = { ...EMPTY_WEATHER_VIEW };
  /** The city the cached place was looked up for. */
  private city = '';
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private o: {
      api: WeatherApi;
      file: string;
      settings: () => WeatherSettings;
      changed: (view: WeatherView) => void;
      log: (line: string) => void;
      now?: () => number;
    },
  ) {}

  private now = () => this.o.now?.() ?? Date.now();

  async init() {
    try {
      const cached = parseCache(JSON.parse(await fs.readFile(this.o.file, 'utf8')));
      this.city = cached.city;
      this.view = { place: cached.place, reading: cached.reading, error: null };
    } catch {
      // nothing cached yet
    }
    this.settingsChanged();
  }

  current(): WeatherView {
    return this.view;
  }

  /** Settings → Weather changed (or the office started): start, re-aim or stop the polling. */
  settingsChanged() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.o.settings();
    if (s.mode !== 'real') return;
    const city = s.city.trim();
    if (city.toLowerCase() !== this.city.toLowerCase()) {
      // another place: what we had was for somewhere else
      this.city = city;
      this.set({ place: null, reading: null, error: null });
    }
    if (!city) {
      this.set({ ...this.view, error: 'Enter a city to use your real weather.' });
      return;
    }
    this.schedule(this.view.place ? pollDelay(this.view.reading, this.now()) : 0);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
    this.timer.unref?.();
  }

  private async poll() {
    this.timer = null;
    const s = this.o.settings();
    if (s.mode !== 'real' || !s.city.trim() || this.running) return;
    this.running = true;
    const city = this.city;
    let notFound = false;
    try {
      let place = this.view.place;
      if (!place) {
        const coords = parseCoordinates(city);
        place = coords ? { name: `${coords.lat}, ${coords.lon}`, ...coords } : await this.o.api.geocode(city);
        if (this.city !== city) return; // the city changed while we looked
        if (!place) {
          notFound = true;
          this.set({ place: null, reading: null, error: `Couldn't find "${city}". Try "City, Country" or "lat, lon".` });
          return;
        }
        this.set({ ...this.view, place, error: null });
      }
      const { code, wind } = await this.o.api.current(place.lat, place.lon);
      if (this.city !== city) return;
      this.set({ place, reading: readingFrom(code, wind, this.now()), error: null });
    } catch (err) {
      if (this.city === city) {
        const text = why(err);
        this.o.log(`weather: ${text}`);
        this.set({ ...this.view, error: `${text[0].toUpperCase()}${text.slice(1)}: showing the calm cycle meanwhile.` });
      }
    } finally {
      this.running = false;
      // A city that isn't found waits for a new one; anything else tries again at the next poll.
      if (!notFound && this.city === city && this.o.settings().mode === 'real' && !this.timer) this.schedule(POLL_MS);
    }
  }

  private set(view: WeatherView) {
    this.view = view;
    this.o.changed(view);
    this.saving = this.saving.then(() => this.save());
  }

  private saving: Promise<void> = Promise.resolve();

  private async save() {
    const tmp = `${this.o.file}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.o.file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ city: this.city, place: this.view.place, reading: this.view.reading }, null, 2));
      await fs.rename(tmp, this.o.file);
    } catch (err) {
      this.o.log(`weather: couldn't save the cache: ${(err as Error).message}`);
    }
  }
}
