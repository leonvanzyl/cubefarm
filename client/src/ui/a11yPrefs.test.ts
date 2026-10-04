import { describe, expect, it } from 'vitest';
import { DEFAULT_A11Y, LIMITS, normalizeA11yPrefs, parseA11yPrefs, reducesMotion, showsShapes } from './a11yPrefs';

describe('parseA11yPrefs', () => {
  it('uses the defaults when nothing is saved, and the defaults change nothing', () => {
    expect(parseA11yPrefs(null)).toEqual(DEFAULT_A11Y);
    expect(DEFAULT_A11Y).toMatchObject({ captions: false, palette: 'standard', statusShapes: false, fov: 72, headBob: true, cameraShake: true, centerDot: false, uiScale: 100, readableFont: false, highContrast: false });
  });

  it('round-trips every setting', () => {
    const saved = {
      captions: true,
      captionSize: 150,
      captionBg: 40,
      palette: 'tritanopia',
      statusShapes: true,
      fov: 90,
      headBob: false,
      cameraShake: false,
      reduceMotion: 'on',
      centerDot: true,
      uiScale: 135,
      readableFont: true,
      highContrast: true,
    };
    expect(parseA11yPrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it('falls back to the defaults for corrupt JSON or a non-object', () => {
    for (const text of ['{oops', 'undefined', '42', '"big"', '[1,2]', 'null', '']) expect(parseA11yPrefs(text)).toEqual(DEFAULT_A11Y);
  });

  it('fills in settings missing from an older save', () => {
    expect(parseA11yPrefs('{"captions":true}')).toEqual({ ...DEFAULT_A11Y, captions: true });
  });
});

describe('normalizeA11yPrefs', () => {
  it('replaces each bad value with its own default, keeping the good ones', () => {
    expect(
      normalizeA11yPrefs({ captions: 'yes', captionSize: 500, captionBg: -1, palette: 'sepia', statusShapes: 1, fov: 30, headBob: null, cameraShake: false, reduceMotion: 'sometimes', centerDot: true, uiScale: NaN, readableFont: {}, highContrast: true }),
    ).toEqual({ ...DEFAULT_A11Y, cameraShake: false, centerDot: true, highContrast: true });
    expect(normalizeA11yPrefs({ fov: Infinity, uiScale: '120', captionSize: [] })).toEqual(DEFAULT_A11Y);
  });

  it('keeps the ends of each range and snaps to its step', () => {
    expect(normalizeA11yPrefs({ fov: LIMITS.fov.min, uiScale: LIMITS.uiScale.max, captionSize: LIMITS.captionSize.min, captionBg: 0 })).toMatchObject({ fov: 60, uiScale: 150, captionSize: 75, captionBg: 0 });
    expect(normalizeA11yPrefs({ fov: 84.6, uiScale: 117, captionSize: 128, captionBg: 52 })).toMatchObject({ fov: 85, uiScale: 115, captionSize: 130, captionBg: 50 });
  });

  it('ignores unknown keys', () => {
    expect(normalizeA11yPrefs({ subtitles: true, fov: 80 })).toEqual({ ...DEFAULT_A11Y, fov: 80 });
  });
});

describe('reducesMotion', () => {
  it('follows the system by default, and the setting when one is chosen', () => {
    expect(reducesMotion('system', false)).toBe(false);
    expect(reducesMotion('system', true)).toBe(true);
    expect(reducesMotion('on', false)).toBe(true);
    expect(reducesMotion('off', true)).toBe(false);
  });
});

describe('showsShapes', () => {
  it('shows status shapes when asked, and always with a colour-blind palette', () => {
    expect(showsShapes({ statusShapes: false, palette: 'standard' })).toBe(false);
    expect(showsShapes({ statusShapes: true, palette: 'standard' })).toBe(true);
    expect(showsShapes({ statusShapes: false, palette: 'protanopia' })).toBe(true);
  });
});
