import { describe, expect, it } from 'vitest';
import { seeded } from '../world/weather/weatherRules';
import { cutoffHz, outsideHearing } from './outsideMix';
import { patterSamples, rainHeard, RAIN_INDOORS, thunderHeard, weatherSoundLayers } from './weatherMix';

const shut = { west: 0, east: 0 };

describe('where the weather is heard from', () => {
  it('hears the rain on the glass all through the office, muffled, and full out on a balcony', () => {
    const deep = rainHeard(outsideHearing('office', 0, 0, shut));
    expect(deep.level).toBe(RAIN_INDOORS.level);
    expect(deep.cutoff).toBeLessThan(3000);
    const balcony = rainHeard(outsideHearing('office', 18, 0, shut));
    expect(balcony.level).toBe(1);
    expect(balcony.cutoff).toBeCloseTo(cutoffHz(1));
  });

  it('feels the thunder through the walls', () => {
    const deep = thunderHeard(outsideHearing('office', 0, 0, shut));
    expect(deep.level).toBeGreaterThan(0.5);
    expect(deep.cutoff).toBeLessThan(1000);
  });
});

describe('weatherSoundLayers', () => {
  it('is silent in a clear sky and has each layer in its weather', () => {
    expect(weatherSoundLayers({ rain: 0, snow: 0, storm: 0, wind: 0, cloud: 0 })).toEqual({ rain: 0, patter: 0, gust: 0, hush: 0 });
    expect(weatherSoundLayers({ rain: 1, snow: 0, storm: 1, wind: 1, cloud: 1 }).gust).toBe(1);
    expect(weatherSoundLayers({ rain: 0, snow: 1, storm: 0, wind: 0.25, cloud: 0.85 }).hush).toBe(1);
    const light = weatherSoundLayers({ rain: 0.35, snow: 0, storm: 0, wind: 0.35, cloud: 0.8 });
    expect(light.patter).toBeGreaterThan(light.rain);
  });
});

describe('patterSamples', () => {
  it('fills the buffer with separate drops, never clipping', () => {
    const out = patterSamples(new Float32Array(48_000), 48_000, 40, seeded(3));
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThanOrEqual(1);
    // mostly silence between the drops
    expect(out.filter((v) => Math.abs(v) < 0.01).length).toBeGreaterThan(out.length * 0.4);
  });
});
