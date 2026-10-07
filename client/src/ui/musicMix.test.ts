import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, FLOOR_D, FLOOR_W, HALF_D, HALF_W, JUKEBOX, SEATS, deskPosition } from '../world/layout';
import {
  DEFAULT_MUSIC_LEVEL,
  DUCK_DB,
  DUCK_GAIN,
  DUCK_HOLD_MAX,
  MAX_MUSIC_LEVEL,
  MUSIC_LEVELS,
  clampMusicLevel,
  duckGainAt,
  duckHold,
  musicEdge,
  musicFalloff,
  musicGainAt,
} from './musicMix';
import { distanceGain, MAX_DISTANCE } from './sfxMix';

/** The old fixed level: gain 1 and the office's own distance model, faded over 3 m before 16 m. */
const before = (d: number) => (d > MAX_DISTANCE ? 0 : distanceGain(d) * Math.min(1, (MAX_DISTANCE - d) / 3));
const db = (g: number) => 20 * Math.log10(g);

// The jukebox's speaker and an ear at eye height anywhere on the floor.
const fromJukebox = (jx: number, x: number, z: number) => Math.hypot(x - jx, EYE_HEIGHT - 1, z - (HALF_D - JUKEBOX.d / 2));

describe('clampMusicLevel', () => {
  it('keeps levels between 1 and the top, and falls back to the default', () => {
    expect(clampMusicLevel(4)).toBe(4);
    expect(clampMusicLevel('2')).toBe(2);
    expect(clampMusicLevel(0)).toBe(1);
    expect(clampMusicLevel(99)).toBe(MAX_MUSIC_LEVEL);
    expect(clampMusicLevel(2.6)).toBe(3);
    for (const bad of [null, undefined, '', 'loud', NaN, {}]) expect(clampMusicLevel(bad)).toBe(DEFAULT_MUSIC_LEVEL);
  });
});

describe('music levels', () => {
  it('get louder, and carry farther, at every step', () => {
    for (let lv = 2; lv <= MAX_MUSIC_LEVEL; lv++) {
      for (const d of [0, 1.5, 3, 6, 10, 15, 25]) expect(musicGainAt(lv, d), `level ${lv} at ${d} m`).toBeGreaterThanOrEqual(musicGainAt(lv - 1, d));
      expect(MUSIC_LEVELS[lv - 1].reach).toBeGreaterThan(MUSIC_LEVELS[lv - 2].reach);
    }
  });

  it('starts at quiet background', () => {
    expect(musicGainAt(1, 1.5)).toBeLessThan(before(1.5));
    expect(musicGainAt(1, 6)).toBeLessThan(before(6));
  });

  it('is clearly louder than before by default, and easy to hear within about 6 m', () => {
    expect(db(musicGainAt(DEFAULT_MUSIC_LEVEL, 1.5) / before(1.5))).toBeGreaterThan(4);
    expect(db(musicGainAt(DEFAULT_MUSIC_LEVEL, 6) / before(6))).toBeGreaterThan(9);
    // as loud 6 m away as the old level was 3 m away
    expect(musicGainAt(DEFAULT_MUSIC_LEVEL, 6)).toBeGreaterThan(before(3));
  });

  it('fills the whole floor at the top level, without fading at the edge, still loudest near the jukebox', () => {
    for (const jx of [JUKEBOX.officeX, JUKEBOX.lobbyX]) {
      for (const [x, z] of [
        [-HALF_W, -HALF_D],
        [HALF_W, -HALF_D],
        [HALF_W, HALF_D],
        [-HALF_W, HALF_D],
      ]) {
        const d = fromJukebox(jx, x, z);
        expect(musicEdge(MAX_MUSIC_LEVEL, d)).toBe(1);
        // at least as loud as the old level 3 m from the jukebox
        expect(musicGainAt(MAX_MUSIC_LEVEL, d)).toBeGreaterThan(before(3));
      }
    }
    const far = Math.hypot(FLOOR_W, FLOOR_D);
    expect(db(musicGainAt(MAX_MUSIC_LEVEL, 1) / musicGainAt(MAX_MUSIC_LEVEL, far))).toBeGreaterThan(6);
  });

  it('reaches the farthest desk at the top level, where the old level was silent', () => {
    const spots = Array.from({ length: SEATS }, (_, i) => deskPosition(i));
    const farthest = Math.max(...spots.map((p) => fromJukebox(JUKEBOX.officeX, p.x, p.z)));
    expect(before(farthest)).toBe(0);
    expect(musicGainAt(MAX_MUSIC_LEVEL, farthest)).toBeGreaterThan(before(2));
  });

  it("matches the panner's inverse model and fades out before its reach", () => {
    for (const lv of [1, 3, 6]) {
      const { ref, reach } = MUSIC_LEVELS[lv - 1];
      expect(musicFalloff(lv, 0)).toBe(1);
      expect(musicFalloff(lv, ref)).toBe(1);
      expect(musicFalloff(lv, ref + 5)).toBeLessThan(1);
      expect(musicEdge(lv, reach - 4)).toBe(1);
      expect(musicEdge(lv, reach - 1.5)).toBeCloseTo(0.5);
      expect(musicGainAt(lv, reach + 1)).toBe(0);
    }
  });

  it('keeps the loudest level well under clipping before the master', () => {
    // music.ts PEAK: the band's loudest moment at the old level, about 0.075
    expect(0.075 * musicGainAt(MAX_MUSIC_LEVEL, 0)).toBeLessThan(0.3);
  });
});

describe('ducking', () => {
  it('dips by about 8-12 dB', () => {
    expect(DUCK_DB).toBeLessThanOrEqual(-8);
    expect(DUCK_DB).toBeGreaterThanOrEqual(-12);
    expect(db(DUCK_GAIN)).toBeCloseTo(DUCK_DB);
  });

  it('dips quickly, holds while the sound plays, and comes back smoothly', () => {
    const hold = 1.2;
    expect(duckGainAt(-0.1, hold)).toBe(1);
    expect(duckGainAt(0, hold)).toBe(1);
    expect(db(duckGainAt(0.1, hold))).toBeLessThan(DUCK_DB + 1);
    expect(db(duckGainAt(hold - 0.01, hold))).toBeCloseTo(DUCK_DB, 1);
    // no jump on the way back, and back to full within about 1.5 s
    expect(Math.abs(duckGainAt(hold + 0.001, hold) - duckGainAt(hold, hold))).toBeLessThan(0.01);
    expect(duckGainAt(hold + 0.2, hold)).toBeLessThan(0.9);
    expect(duckGainAt(hold + 1.5, hold)).toBeGreaterThan(0.95);
    let last = duckGainAt(hold, hold);
    for (let t = hold; t < hold + 3; t += 0.05) {
      const g = duckGainAt(t, hold);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it("holds for the sound's length, at most a few seconds", () => {
    expect(duckHold(0.3)).toBe(0.3);
    expect(duckHold(6.5)).toBe(DUCK_HOLD_MAX);
    expect(duckHold(-1)).toBe(0);
  });
});
