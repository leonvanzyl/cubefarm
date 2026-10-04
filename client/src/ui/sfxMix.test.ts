import { describe, expect, it } from 'vitest';
import { audible, distance, distanceGain, DROP_NEW, MAX_DISTANCE, panOf, PLAY, REF_DISTANCE, voiceToDrop } from './sfxMix';

describe('distanceGain', () => {
  it('is full volume up close and falls off with distance', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(REF_DISTANCE)).toBe(1);
    expect(distanceGain(3)).toBeLessThan(1);
    expect(distanceGain(6)).toBeLessThan(distanceGain(3));
  });

  it('makes a desk 10 m away faint', () => {
    expect(distanceGain(10)).toBeLessThan(0.1);
    expect(distanceGain(10)).toBeGreaterThan(0.03);
  });
});

describe('audible', () => {
  it('culls sounds beyond the max distance', () => {
    expect(audible(10)).toBe(true);
    expect(audible(MAX_DISTANCE)).toBe(true);
    expect(audible(MAX_DISTANCE + 0.1)).toBe(false);
    expect(audible(distance({ x: 0, y: 1.6, z: 0 }, { x: 12, y: 1, z: 12 }))).toBe(false);
  });
});

describe('panOf', () => {
  const pos = { x: 0, y: 1.6, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const north = { x: 0, y: 0, z: -1 }; // the camera's default forward
  const desk = { x: 4, y: 1, z: 0 };

  it('puts a sound to your right on the right, and swaps it when you turn around', () => {
    expect(panOf(pos, north, up, desk)).toBeGreaterThan(0.9);
    expect(panOf(pos, { x: 0, y: 0, z: 1 }, up, desk)).toBeLessThan(-0.9);
    expect(Math.abs(panOf(pos, { x: 1, y: 0, z: 0 }, up, desk))).toBeLessThan(0.01);
  });

  it('is centred for a sound on top of you', () => {
    expect(panOf(pos, north, up, pos)).toBe(0);
  });
});

describe('voiceToDrop', () => {
  const voices = (...loud: number[]) => loud.map((l) => ({ loud: l }));

  it('plays anything while under the cap', () => {
    expect(voiceToDrop(voices(0.1, 0.2), 0.01, 3)).toBe(PLAY);
  });

  it('drops a new sound that is quieter than everything playing', () => {
    expect(voiceToDrop(voices(0.1, 0.2, 0.3), 0.05, 3)).toBe(DROP_NEW);
    expect(voiceToDrop(voices(0.1, 0.2, 0.3), 0.1, 3)).toBe(DROP_NEW);
  });

  it('stops the quietest (or farthest) sound for a louder new one', () => {
    expect(voiceToDrop(voices(0.2, 0.02, 0.3), 0.1, 3)).toBe(1);
  });

  it('drops everything with a cap of zero', () => {
    expect(voiceToDrop([], 1, 0)).toBe(DROP_NEW);
  });
});
