import { describe, expect, it } from 'vitest';
import { AFTERNOON_T, CYCLE_MS, dayPhase, nightFactor, parseDaytimeParam, parseDayMode, skyAt, sunDirection, SUNRISE_T, SUNSET_T, type SkyPalette } from './time';

const MIN = 60_000;
/** Real minutes of the 30-minute cycle spent with t inside [from, to). */
function cycleMinutes(pred: (t: number) => boolean): number {
  let n = 0;
  const steps = 18_000; // one sample every 0.1 s
  for (let i = 0; i < steps; i++) if (pred(dayPhase((i / steps) * CYCLE_MS, 'cycle'))) n++;
  return (n / steps) * 30;
}

describe('dayPhase', () => {
  it("runs a whole day every 30 minutes in 'cycle' mode, always forward", () => {
    expect(dayPhase(0, 'cycle')).toBe(0);
    expect(dayPhase(CYCLE_MS, 'cycle')).toBe(0);
    expect(dayPhase(5 * CYCLE_MS + 10 * MIN, 'cycle')).toBeCloseTo(dayPhase(10 * MIN, 'cycle'), 9);
    let prev = -1;
    for (let ms = 0; ms < CYCLE_MS; ms += 1000) {
      const t = dayPhase(ms, 'cycle');
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('keeps night to about a quarter of the cycle and golden hour to about 2 minutes', () => {
    expect(cycleMinutes((t) => nightFactor(t) >= 0.5)).toBeLessThanOrEqual(7.5);
    expect(cycleMinutes((t) => t >= 0.7 && t < 0.76)).toBeCloseTo(2, 1);
  });

  it("follows the viewer's local time in 'clock' mode", () => {
    expect(dayPhase(new Date(2026, 5, 10, 0, 0, 0).getTime(), 'clock')).toBe(0);
    expect(dayPhase(new Date(2026, 5, 10, 6, 0, 0).getTime(), 'clock')).toBeCloseTo(SUNRISE_T, 9);
    expect(dayPhase(new Date(2026, 5, 10, 12, 0, 0).getTime(), 'clock')).toBeCloseTo(0.5, 9);
    expect(dayPhase(new Date(2026, 5, 10, 18, 0, 0).getTime(), 'clock')).toBeCloseTo(SUNSET_T, 9);
    expect(dayPhase(new Date(2026, 5, 10, 23, 59, 59).getTime(), 'clock')).toBeLessThan(1);
  });

  it("is always mid-afternoon in 'day' mode", () => {
    for (const now of [0, 123_456, Date.now()]) expect(dayPhase(now, 'day')).toBe(AFTERNOON_T);
  });
});

describe('sunDirection', () => {
  const len = ([x, y, z]: number[]) => Math.hypot(x, y, z);

  it('is a unit vector', () => {
    for (let t = 0; t < 1; t += 0.05) expect(len(sunDirection(t))).toBeCloseTo(1, 9);
  });

  it('rises in the east at sunrise, is high and to the south at noon and sets in the west at sunset', () => {
    const [rx, ry] = sunDirection(SUNRISE_T);
    expect(rx).toBeCloseTo(1, 9);
    expect(ry).toBeCloseTo(0, 9);
    const [nx, ny, nz] = sunDirection(0.5);
    expect(nx).toBeCloseTo(0, 9);
    expect(ny).toBeGreaterThan(0.8);
    expect(nz).toBeGreaterThan(0);
    const [sx, sy] = sunDirection(SUNSET_T);
    expect(sx).toBeCloseTo(-1, 9);
    expect(sy).toBeCloseTo(0, 9);
  });

  it('is above the horizon by day and below it at night', () => {
    for (const t of [0.3, 0.5, AFTERNOON_T, 0.7]) expect(sunDirection(t)[1]).toBeGreaterThan(0);
    for (const t of [0, 0.1, 0.2, 0.8, 0.9, 0.99]) expect(sunDirection(t)[1]).toBeLessThan(0);
  });
});

describe('nightFactor', () => {
  it('is 0 by day and 1 at night', () => {
    for (const t of [0.3, 0.5, AFTERNOON_T, 0.72]) expect(nightFactor(t)).toBe(0);
    for (const t of [0, 0.1, 0.19, 0.81, 0.95]) expect(nightFactor(t)).toBe(1);
  });

  it('rises steadily through dusk and falls steadily through dawn', () => {
    let prev = nightFactor(0.7);
    for (let t = 0.7; t <= 0.85; t += 0.001) {
      const n = nightFactor(t);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBe(1);
    for (let t = 0.15; t <= 0.3; t += 0.001) {
      const n = nightFactor(t);
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBe(0);
  });
});

describe('skyAt', () => {
  const channels = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const COLORS = ['zenith', 'horizon', 'fog', 'sunColor', 'hemiSky', 'hemiGround'] as const;
  const NUMBERS = ['sunIntensity', 'ambient', 'exposure', 'starsOpacity', 'cityLights'] as const;

  /** The biggest change of any colour channel (0-255) or number between two palettes. */
  function jump(a: SkyPalette, b: SkyPalette): { color: number; value: number } {
    let color = 0;
    let value = 0;
    for (const k of COLORS) {
      const [x, y] = [channels(a[k]), channels(b[k])];
      for (let i = 0; i < 3; i++) color = Math.max(color, Math.abs(x[i] - y[i]));
    }
    for (const k of NUMBERS) value = Math.max(value, Math.abs(a[k] - b[k]));
    return { color, value };
  }

  it('changes smoothly through the whole day, midnight included (no jumps between key moments)', () => {
    const step = 0.0001;
    for (let t = 0; t < 1; t += step) {
      const j = jump(skyAt(t), skyAt(t + step));
      expect(j.color, `colour jump at t=${t}`).toBeLessThanOrEqual(3);
      expect(j.value, `value jump at t=${t}`).toBeLessThan(0.02);
    }
  });

  it('matches the office as it looked before the clock in the afternoon', () => {
    const p = skyAt(AFTERNOON_T);
    expect(p.horizon).toBe(0xbfe3ff);
    expect(p.fog).toBe(0xf3ece2);
    expect(p.sunIntensity).toBe(1.55);
    expect(p.exposure).toBe(1);
  });

  it('lights the city and the stars at night, never pitch black', () => {
    const night = skyAt(0);
    expect(night.starsOpacity).toBe(1);
    expect(night.cityLights).toBe(1);
    expect(Math.max(...channels(night.zenith))).toBeGreaterThan(0x20);
    expect(night.ambient).toBeGreaterThan(0.1);
    const noon = skyAt(0.5);
    expect(noon.starsOpacity).toBe(0);
    expect(noon.cityLights).toBe(0);
  });

  it('glows warm at golden hour', () => {
    const [r, , b] = channels(skyAt(0.73).horizon);
    expect(r).toBeGreaterThan(b + 60);
  });

  it('keeps every number in range', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const p = skyAt(t);
      for (const k of ['starsOpacity', 'cityLights'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
      expect(p.sunIntensity).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
    }
  });
});

describe('parseDaytimeParam', () => {
  it('reads ?daytime as a frozen phase', () => {
    expect(parseDaytimeParam('?daytime=0.73')).toBe(0.73);
    expect(parseDaytimeParam('?floor=2&daytime=0')).toBe(0);
    expect(parseDaytimeParam('daytime=.5')).toBe(0.5);
    expect(parseDaytimeParam('?daytime=1')).toBe(0);
  });

  it('ignores a missing, empty or nonsense value', () => {
    for (const s of ['', '?', '?floor=2', '?daytime=', '?daytime=noon', '?daytime=-0.1', '?daytime=1.5', '?daytime=NaN', '?daytime=Infinity'])
      expect(parseDaytimeParam(s), s).toBeNull();
  });
});

describe('parseDayMode', () => {
  it('keeps a known mode and falls back to the 30-minute day', () => {
    expect(parseDayMode('clock')).toBe('clock');
    expect(parseDayMode('day')).toBe('day');
    expect(parseDayMode('cycle')).toBe('cycle');
    for (const raw of [null, undefined, '', 'night', 3]) expect(parseDayMode(raw)).toBe('cycle');
  });
});
