import { describe, expect, it } from 'vitest';
import { WEATHER_KINDS } from '../../../../shared/outside';
import { skyAt } from '../sky/time';
import {
  BLEND_SECONDS,
  blendMix,
  calmDay,
  calmSpell,
  flashLevel,
  hazeRange,
  isClear,
  KIND_MIX,
  kindMix,
  MIX_KEYS,
  newMix,
  nextFlashIn,
  parseWeatherKind,
  parseWeatherParam,
  snowMonth,
  snowStep,
  thunderDelay,
  weatherLayers,
  weatherSky,
  wetStep,
} from './weatherRules';

const lum = (c: number) => ((c >> 16) & 0xff) * 0.299 + ((c >> 8) & 0xff) * 0.587 + (c & 0xff) * 0.114;
const sat = (c: number) => {
  const ch = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  return Math.max(...ch) - Math.min(...ch);
};

describe('mixes', () => {
  it('makes clear the sky as it always was, and each other kind something to see', () => {
    expect(isClear(KIND_MIX.clear)).toBe(true);
    for (const k of WEATHER_KINDS.filter((x) => x !== 'clear')) expect(isClear(KIND_MIX[k])).toBe(false);
    expect(KIND_MIX.storm.storm).toBe(1);
    expect(KIND_MIX.snow.snow).toBe(1);
    expect(KIND_MIX.fog.fog).toBe(1);
    expect(KIND_MIX['heavy-rain'].rain).toBeGreaterThan(KIND_MIX['light-rain'].rain);
  });

  it('scales what falls with intensity, keeps the clouds, and lets real wind blow harder', () => {
    const light = kindMix('snow', 0.2);
    const heavy = kindMix('snow', 1);
    expect(light.snow).toBeLessThan(heavy.snow);
    expect(light.snow).toBeGreaterThan(0.3);
    expect(light.cloud).toBeGreaterThan(heavy.cloud * 0.8);
    expect(kindMix('cloudy', 1, 0.9).wind).toBe(0.9);
    const out = newMix();
    expect(kindMix('fog', 1, 0, out)).toBe(out);
  });
});

describe('blendMix', () => {
  it('turns one weather into another in about 20 s, without a jump', () => {
    const cur = { ...KIND_MIX.clear };
    const target = KIND_MIX.storm;
    let t = 0;
    let prev = { ...cur };
    while (blendMix(cur, target, 1 / 60)) {
      t += 1 / 60;
      for (const k of MIX_KEYS) expect(Math.abs(cur[k] - prev[k])).toBeLessThanOrEqual(1 / 60 / BLEND_SECONDS + 1e-9);
      prev = { ...cur };
      expect(t).toBeLessThan(BLEND_SECONDS + 1);
    }
    expect(t).toBeGreaterThan(BLEND_SECONDS * 0.9);
    expect(cur).toEqual(target);
    expect(blendMix(cur, target, 1)).toBe(false);
  });
});

describe('the calm cycle', () => {
  const day = (y: number, m: number, d: number) => {
    const midnight = new Date(y, m, d).getTime();
    return calmDay(y, m, d, midnight);
  };

  it('is the same day for the same date, and another for another', () => {
    expect(day(2026, 9, 4)).toEqual(day(2026, 9, 4));
    expect(day(2026, 9, 5)).not.toEqual(day(2026, 9, 4));
  });

  it('covers the whole day in spells back to back', () => {
    const spells = day(2026, 9, 4);
    const midnight = new Date(2026, 9, 4).getTime();
    expect(spells[0].from).toBe(midnight);
    for (let i = 1; i < spells.length; i++) expect(spells[i].from).toBe(spells[i - 1].until);
    expect(spells[spells.length - 1].until).toBeGreaterThanOrEqual(midnight + 86_400_000);
  });

  it('is mostly fair, with rain and storms now and then, over a year of days', () => {
    const minutes: Record<string, number> = {};
    for (let d = 0; d < 365; d++) {
      const date = new Date(2026, 0, 1 + d);
      for (const s of calmDay(date.getFullYear(), date.getMonth(), date.getDate(), date.getTime())) minutes[s.kind] = (minutes[s.kind] ?? 0) + (s.until - s.from) / 60_000;
    }
    const total = Object.values(minutes).reduce((a, b) => a + b, 0);
    const share = (k: string) => (minutes[k] ?? 0) / total;
    expect(share('clear') + share('cloudy')).toBeGreaterThan(0.6);
    expect(share('clear')).toBeGreaterThan(share('cloudy'));
    expect(share('light-rain')).toBeGreaterThan(0.03);
    expect(share('storm')).toBeGreaterThan(0.002);
    expect(share('storm')).toBeLessThan(0.05);
  });

  it('only snows in winter', () => {
    for (let d = 0; d < 365; d++) {
      const date = new Date(2026, 0, 1 + d);
      const kinds = calmDay(date.getFullYear(), date.getMonth(), date.getDate(), date.getTime()).map((s) => s.kind);
      if (!snowMonth(date.getMonth())) expect(kinds).not.toContain('snow');
    }
    expect(snowMonth(0)).toBe(true);
    expect(snowMonth(6)).toBe(false);
  });

  it('finds the spell for any moment', () => {
    const now = new Date(2026, 9, 4, 14, 30).getTime();
    const s = calmSpell(now);
    expect(s.from).toBeLessThanOrEqual(now);
    expect(s.until).toBeGreaterThan(now);
  });
});

describe('overrides', () => {
  it('reads ?weather= and its aliases', () => {
    expect(parseWeatherParam('?weather=rain')).toBe('heavy-rain');
    expect(parseWeatherParam('?weather=storm')).toBe('storm');
    expect(parseWeatherParam('?weather=fog')).toBe('fog');
    expect(parseWeatherParam('?weather=snow')).toBe('snow');
    expect(parseWeatherParam('?weather=clear')).toBe('clear');
    expect(parseWeatherParam('?weather=light_rain')).toBe('light-rain');
    expect(parseWeatherParam('?weather=hail')).toBeNull();
    expect(parseWeatherParam('')).toBeNull();
    expect(parseWeatherKind(42)).toBeNull();
  });
});

describe('the sky under the weather', () => {
  it('leaves a clear sky exactly as it was', () => {
    for (const t of [0, 0.3, 0.5, 0.75, 0.9]) expect(weatherSky(skyAt(t), KIND_MIX.clear)).toEqual(skyAt(t));
  });

  it('greys and darkens the day under rain, darker still in a storm, and dims the sun', () => {
    const noon = skyAt(0.5);
    const rain = weatherSky(skyAt(0.5), KIND_MIX['heavy-rain']);
    const storm = weatherSky(skyAt(0.5), KIND_MIX.storm);
    expect(sat(rain.zenith)).toBeLessThan(sat(noon.zenith));
    expect(lum(rain.zenith)).toBeLessThan(lum(noon.zenith));
    expect(lum(storm.zenith)).toBeLessThan(lum(rain.zenith));
    expect(rain.sunIntensity).toBeLessThan(noon.sunIntensity * 0.6);
  });

  it('hides the stars under cloud, and keeps night dark', () => {
    const night = skyAt(0);
    const cloudy = weatherSky(skyAt(0), KIND_MIX.cloudy);
    expect(cloudy.starsOpacity).toBeLessThan(night.starsOpacity * 0.5);
    expect(lum(cloudy.zenith)).toBeLessThanOrEqual(lum(night.zenith) + 4);
  });

  it('pulls the haze in close in fog', () => {
    const [near, far] = hazeRange(KIND_MIX.fog);
    expect(near).toBeLessThan(15);
    expect(far).toBeLessThan(200);
    expect(hazeRange(KIND_MIX.clear)).toEqual([40, 500]);
  });
});

describe('the outside sounds under the weather', () => {
  const layers = () => ({ wind: 1, city: 0.7, birds: 1, crickets: 0.8, carsPerMin: 2 });
  it('changes nothing in a clear sky', () => {
    expect(weatherLayers(layers(), KIND_MIX.clear)).toEqual(layers());
  });
  it('quiets the birds in rain, blows harder in a storm and hushes the city in snow', () => {
    expect(weatherLayers(layers(), KIND_MIX['light-rain']).birds).toBeLessThan(0.05);
    expect(weatherLayers(layers(), KIND_MIX.storm).wind).toBeGreaterThan(2);
    const snow = weatherLayers(layers(), KIND_MIX.snow);
    expect(snow.city).toBeLessThan(0.4);
    expect(snow.carsPerMin).toBeLessThan(2);
  });
});

describe('puddles and snow', () => {
  it('soaks in within a minute or two of heavy rain and dries over a few minutes', () => {
    let wet = 0;
    for (let s = 0; s < 60; s++) wet = wetStep(wet, 1, 1);
    expect(wet).toBeGreaterThan(0.9);
    for (let s = 0; s < 120; s++) wet = wetStep(wet, 0, 1);
    expect(wet).toBeGreaterThan(0.2);
    for (let s = 0; s < 240; s++) wet = wetStep(wet, 0, 1);
    expect(wet).toBe(0);
  });
  it('settles snow over a minute or two and melts it after', () => {
    let cover = 0;
    for (let s = 0; s < 90; s++) cover = snowStep(cover, 1, 0, 1);
    expect(cover).toBe(1);
    for (let s = 0; s < 400; s++) cover = snowStep(cover, 0, 0, 1);
    expect(cover).toBe(0);
  });
});

describe('lightning', () => {
  it('only strikes in storms, every several seconds', () => {
    expect(nextFlashIn(0.1, 0.5)).toBe(Infinity);
    for (const roll of [0, 0.5, 0.999]) {
      const s = nextFlashIn(1, roll);
      expect(s).toBeGreaterThanOrEqual(8);
      expect(s).toBeLessThanOrEqual(30);
    }
  });
  it('flashes bright, flickers and is gone within a second', () => {
    expect(flashLevel(-0.1)).toBe(0);
    expect(Math.max(...Array.from({ length: 10 }, (_, i) => flashLevel(i / 100)))).toBeGreaterThan(0.8);
    expect(flashLevel(0.18)).toBeGreaterThan(flashLevel(0.12));
    expect(flashLevel(1)).toBe(0);
  });
  it('rolls the thunder in 1-4 s after', () => {
    expect(thunderDelay(0)).toBe(1);
    expect(thunderDelay(1)).toBe(4);
  });
});
