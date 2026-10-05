import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeatherSettings, WeatherView } from '../shared/outside.ts';
import { currentFromForecast, parseCache, placeFromSearch, POLL_MS, pollDelay, readingFrom, WeatherService, type WeatherApi } from './weather.ts';

describe('Open-Meteo responses', () => {
  it("takes the geocoder's first result, rounded to about a kilometre", () => {
    const json = { results: [{ name: 'Berlin', country: 'Deutschland', latitude: 52.52437, longitude: 13.41053 }, { name: 'Berlin', latitude: 44.4, longitude: -71.2 }] };
    expect(placeFromSearch(json)).toEqual({ name: 'Berlin, Deutschland', lat: 52.52, lon: 13.41 });
    expect(placeFromSearch({ results: [{ name: 'X', latitude: 1, longitude: 2 }] })).toEqual({ name: 'X', lat: 1, lon: 2 });
    expect(placeFromSearch({})).toBeNull();
    expect(placeFromSearch({ results: [{ name: 'Nope', latitude: 'north' }] })).toBeNull();
    expect(placeFromSearch(null)).toBeNull();
  });

  it('reads the current weather code and wind', () => {
    expect(currentFromForecast({ current: { time: '2026-10-04T10:00', weather_code: 63, wind_speed_10m: 21.4 } })).toEqual({ code: 63, wind: 21.4 });
    expect(currentFromForecast({ current: { weather_code: 0 } })).toEqual({ code: 0, wind: 0 });
    expect(() => currentFromForecast({ hourly: {} })).toThrow();
  });
});

describe('polling and the cache', () => {
  it('polls straight away without a reading, then 15 minutes after the last one', () => {
    expect(pollDelay(null, 1000)).toBe(0);
    const r = readingFrom(61, 10, 1_000_000);
    expect(pollDelay(r, 1_000_000)).toBe(POLL_MS);
    expect(pollDelay(r, 1_000_000 + POLL_MS - 5)).toBe(5);
    expect(pollDelay(r, 1_000_000 + 2 * POLL_MS)).toBe(0);
    expect(pollDelay(r, 0)).toBe(0); // a clock that went backwards
  });

  it('keeps a valid cache and drops anything malformed', () => {
    const place = { name: 'Oslo, Norge', lat: 59.91, lon: 10.75 };
    const reading = readingFrom(71, 4, 5000);
    expect(parseCache({ city: 'Oslo', place, reading })).toEqual({ city: 'Oslo', place, reading });
    expect(parseCache({ city: 'Oslo', place: { name: 'x', lat: 200, lon: 0 }, reading })).toEqual({ city: 'Oslo', place: null, reading: null });
    expect(parseCache({ place, reading: { code: 'rain' } }).reading).toBeNull();
    expect(parseCache('garbage')).toEqual({ city: '', place: null, reading: null });
  });
});

describe('WeatherService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true, maxRetries: 3 });
  });

  async function setup(api: WeatherApi, settings: WeatherSettings) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-weather-'));
    dirs.push(dir);
    const file = path.join(dir, 'weather.json');
    const views: WeatherView[] = [];
    const make = () => new WeatherService({ api, file, settings: () => settings, changed: (v) => views.push(v), log: () => undefined });
    return { file, views, make, settings };
  }

  const fakeApi = (over: Partial<WeatherApi> = {}): WeatherApi & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      geocode: async (city) => (calls.push(`geocode ${city}`), /nowhere/i.test(city) ? null : { name: `${city}, Testland`, lat: 10.12, lon: 20.34 }),
      current: async (lat, lon) => (calls.push(`current ${lat},${lon}`), { code: 65, wind: 30 }),
      ...over,
    };
  };

  it('finds the city, reads its weather and survives a restart from the cache', async () => {
    const api = fakeApi();
    const { make, file } = await setup(api, { mode: 'real', city: 'Cape Town' });
    const w = make();
    await w.init();
    await vi.waitFor(() => expect(w.current().reading?.kind).toBe('heavy-rain'));
    w.stop();
    expect(w.current().place).toEqual({ name: 'Cape Town, Testland', lat: 10.12, lon: 20.34 });
    // only the coordinates are sent for the weather itself
    expect(api.calls).toEqual(['geocode Cape Town', 'current 10.12,20.34']);
    await vi.waitFor(async () => expect(parseCache(JSON.parse(await fs.readFile(file, 'utf8'))).reading?.code).toBe(65));

    const again = make();
    await again.init();
    again.stop();
    expect(again.current().reading?.code).toBe(65);
    expect(api.calls).toHaveLength(2); // the cached reading is fresh: no new lookup
  });

  it("falls back quietly when it's offline, and says why", async () => {
    const api = fakeApi({
      current: async () => {
        throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      },
    });
    const { make } = await setup(api, { mode: 'real', city: 'Lima' });
    const w = make();
    await w.init();
    await vi.waitFor(() => expect(w.current().error).toMatch(/offline/));
    w.stop();
    expect(w.current().reading).toBeNull();
  });

  it("reports a city it can't find, and does nothing outside 'real' mode", async () => {
    const api = fakeApi();
    const { make, settings } = await setup(api, { mode: 'real', city: 'Nowhere' });
    const w = make();
    await w.init();
    await vi.waitFor(() => expect(w.current().error).toMatch(/Couldn't find/));
    w.stop();
    settings.mode = 'cycle';
    settings.city = 'Paris';
    w.settingsChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls).toEqual(['geocode Nowhere']);
  });

  it('uses "lat, lon" as typed, without a lookup', async () => {
    const api = fakeApi();
    const { make } = await setup(api, { mode: 'real', city: '-33.92, 18.42' });
    const w = make();
    await w.init();
    await vi.waitFor(() => expect(w.current().reading).not.toBeNull());
    w.stop();
    expect(api.calls).toEqual(['current -33.92,18.42']);
  });
});
