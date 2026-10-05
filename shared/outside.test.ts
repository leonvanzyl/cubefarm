import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER,
  DEFAULT_WORLD_EVENTS,
  liveReading,
  parseCoordinates,
  READING_STALE_MS,
  WEATHER_KINDS,
  weatherFromCode,
  weatherSettings,
  worldEventSettings,
} from './outside.ts';

describe('weatherFromCode', () => {
  it("maps Open-Meteo's WMO codes onto the office's kinds", () => {
    expect(weatherFromCode(0).kind).toBe('clear');
    expect(weatherFromCode(1).kind).toBe('clear');
    expect(weatherFromCode(2).kind).toBe('cloudy');
    expect(weatherFromCode(3)).toEqual({ kind: 'cloudy', intensity: 1 });
    expect(weatherFromCode(45).kind).toBe('fog');
    expect(weatherFromCode(48).kind).toBe('fog');
    for (const c of [51, 53, 55, 56, 57, 61, 66, 80]) expect(weatherFromCode(c).kind).toBe('light-rain');
    for (const c of [63, 65, 67, 81, 82]) expect(weatherFromCode(c).kind).toBe('heavy-rain');
    for (const c of [71, 73, 75, 77, 85, 86]) expect(weatherFromCode(c).kind).toBe('snow');
    for (const c of [95, 96, 99]) expect(weatherFromCode(c).kind).toBe('storm');
  });

  it('grades how hard it comes down, and treats unknown codes as clear', () => {
    expect(weatherFromCode(61).intensity).toBeLessThan(weatherFromCode(55).intensity);
    expect(weatherFromCode(63).intensity).toBeLessThan(weatherFromCode(65).intensity);
    expect(weatherFromCode(71).intensity).toBeLessThan(weatherFromCode(75).intensity);
    expect(weatherFromCode(42)).toEqual({ kind: 'clear', intensity: 0 });
    expect(weatherFromCode(Number.NaN)).toEqual({ kind: 'clear', intensity: 0 });
    for (let c = 0; c < 100; c++) {
      const w = weatherFromCode(c);
      expect(WEATHER_KINDS).toContain(w.kind);
      expect(w.intensity).toBeGreaterThanOrEqual(0);
      expect(w.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe('settings', () => {
  it('keeps valid weather fields and drops the rest', () => {
    expect(weatherSettings(DEFAULT_WEATHER, { mode: 'real', city: '  Cape   Town ' })).toEqual({ mode: 'real', city: 'Cape Town' });
    expect(weatherSettings(DEFAULT_WEATHER, { mode: 'tornado', city: 42 })).toEqual(DEFAULT_WEATHER);
    expect(weatherSettings({ mode: 'off', city: 'Oslo' }, null)).toEqual({ mode: 'off', city: 'Oslo' });
    expect(weatherSettings(DEFAULT_WEATHER, { city: 'x'.repeat(200) }).city).toHaveLength(80);
  });

  it('keeps valid world event fields and drops the rest', () => {
    expect(worldEventSettings(DEFAULT_WORLD_EVENTS, { frequency: 'chaos', calm: true })).toEqual({ frequency: 'chaos', calm: true });
    expect(worldEventSettings(DEFAULT_WORLD_EVENTS, { frequency: 'always', calm: 'yes' })).toEqual(DEFAULT_WORLD_EVENTS);
    expect(worldEventSettings({ frequency: 'off', calm: true }, undefined)).toEqual({ frequency: 'off', calm: true });
  });
});

describe('parseCoordinates', () => {
  it('reads "lat, lon" typed as the city, rounded to about a kilometre', () => {
    expect(parseCoordinates('52.52437, 13.41053')).toEqual({ lat: 52.52, lon: 13.41 });
    expect(parseCoordinates('-33.92 18.42')).toEqual({ lat: -33.92, lon: 18.42 });
    expect(parseCoordinates('Berlin')).toBeNull();
    expect(parseCoordinates('91, 0')).toBeNull();
    expect(parseCoordinates('0, 181')).toBeNull();
  });
});

describe('liveReading', () => {
  const reading = { kind: 'snow' as const, intensity: 1, code: 75, wind: 5, at: 1_000_000 };
  it('uses a recent reading and lets a stale one go', () => {
    expect(liveReading({ reading }, reading.at + 60_000)).toBe(reading);
    expect(liveReading({ reading }, reading.at + READING_STALE_MS + 1)).toBeNull();
    expect(liveReading({ reading: null }, reading.at)).toBeNull();
    expect(liveReading(null, reading.at)).toBeNull();
  });
});
