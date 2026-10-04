import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_PREFS, normalizeAudioPrefs, parseAudioPrefs, sliderGain } from './audioPrefs';

describe('parseAudioPrefs', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(DEFAULT_AUDIO_PREFS).toMatchObject({ steps: 100, typing: 100, toys: 100, alerts: 100, music: 100, voice: 100, outside: 100 });
  });

  it('keeps old { volume, muted } settings and fills in the groups', () => {
    expect(parseAudioPrefs('{"volume":40,"muted":true}')).toEqual({ volume: 40, muted: true, steps: 100, typing: 100, toys: 100, alerts: 100, music: 100, voice: 100, outside: 100 });
  });

  it('round-trips saved group levels', () => {
    const saved = { volume: 55, muted: false, steps: 0, typing: 35, toys: 80, alerts: 100, music: 45, voice: 60, outside: 60 };
    expect(parseAudioPrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it('fills in the Outside level for settings saved before it existed', () => {
    expect(parseAudioPrefs('{"volume":55,"muted":false,"steps":0,"typing":35,"toys":80,"alerts":100,"music":45}')).toMatchObject({ music: 45, outside: 100 });
  });

  it('falls back to the defaults for corrupt JSON or a non-object', () => {
    for (const text of ['{oops', 'undefined', '42', '"loud"', '[1,2]', 'null']) expect(parseAudioPrefs(text)).toEqual(DEFAULT_AUDIO_PREFS);
  });
});

describe('normalizeAudioPrefs', () => {
  it('replaces out-of-range or non-numeric values with their default, one by one', () => {
    expect(normalizeAudioPrefs({ volume: 140, muted: 'yes', steps: -5, typing: '50', toys: NaN, alerts: 20 })).toEqual({ ...DEFAULT_AUDIO_PREFS, alerts: 20 });
    expect(normalizeAudioPrefs({ volume: null, steps: Infinity, typing: {}, toys: [] })).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('keeps the ends of the range and rounds to whole percent', () => {
    expect(normalizeAudioPrefs({ volume: 0, steps: 100, typing: 33.6, toys: 0, alerts: 99.4 })).toMatchObject({ volume: 0, steps: 100, typing: 34, toys: 0, alerts: 99 });
  });

  it('ignores unknown keys', () => {
    expect(normalizeAudioPrefs({ volume: 10, radio: 50 })).toEqual({ ...DEFAULT_AUDIO_PREFS, volume: 10 });
  });
});

describe('sliderGain', () => {
  it('maps 0-100 to a squared 0-1 gain', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(50)).toBe(0.25);
    expect(sliderGain(100)).toBe(1);
  });
});
