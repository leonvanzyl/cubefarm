import { describe, expect, it } from 'vitest';
import { CLIP_MAX_MS } from '../../../shared/clipLimits';
import { FLOOR_SAMPLES, freshEars, heardLevel, heardWords, listenRules, MIN_SPEECH_LEVEL, NO_SPEECH_MS, noiseFloor, sendsWhenDone, SILENCE_MS, verdict, WARMUP_SAMPLES, type Ears } from './micSilence';

/** Feeds a level every 50 ms from `from` to `to` and returns the ears. */
function feed(e: Ears, level: (t: number) => number, from: number, to: number): Ears {
  for (let t = from; t < to; t += 50) e = heardLevel(e, level(t), t);
  return e;
}

describe('the silence detector', () => {
  const tap = listenRules('tap', false);

  it('waits while nobody has spoken, then gives up after 8 s', () => {
    const e = freshEars(0);
    expect(verdict(e, NO_SPEECH_MS - 1, tap)).toBe('listening');
    expect(verdict(e, NO_SPEECH_MS, tap)).toBe('no-speech');
  });

  it("ends 1.2 s after the last words, not before", () => {
    let e = heardWords(freshEars(0), 2000);
    e = heardWords(e, 3000);
    expect(verdict(e, 3000 + SILENCE_MS - 1, tap)).toBe('listening');
    expect(verdict(e, 3000 + SILENCE_MS, tap)).toBe('done');
  });

  it('once speech started, the 8 s no-speech limit no longer applies', () => {
    const e = heardWords(freshEars(0), 7000);
    expect(verdict(e, 8000, tap)).toBe('listening');
    expect(verdict(e, 7000 + SILENCE_MS, tap)).toBe('done');
  });

  it('never listens past a clip', () => {
    const e = heardWords(freshEars(0), CLIP_MAX_MS - 10);
    expect(verdict(e, CLIP_MAX_MS, tap)).toBe('too-long');
  });

  it('hears speech in levels well above a quiet room, and silence after it', () => {
    // A quiet room (0.004), then two seconds of words (0.08-0.12) with short gaps between them, then quiet again.
    const talk = (t: number) => (t >= 1000 && t < 3000 ? (t % 400 < 300 ? 0.08 + 0.04 * Math.abs(Math.sin(t / 90)) : 0.01) : 0.004);
    let e = feed(freshEars(0), talk, 0, 1000);
    expect(e.lastSpeech).toBeNull();
    e = feed(e, talk, 1000, 3000);
    expect(e.lastSpeech).toBe(2950);
    e = feed(e, talk, 3000, 3000 + SILENCE_MS + 100);
    expect(verdict(e, 3000 + SILENCE_MS + 100, tap)).toBe('done');
  });

  it("a noisy room raises the bar, so its hum never counts as speech but a voice over it does", () => {
    const hum = (t: number) => 0.03 + 0.005 * Math.sin(t); // louder than MIN_SPEECH_LEVEL, but steady
    expect(hum(0)).toBeGreaterThan(MIN_SPEECH_LEVEL);
    const e = feed(freshEars(0), hum, 0, 5000);
    expect(e.lastSpeech).toBeNull();
    expect(noiseFloor(e)).toBeGreaterThan(0.024);
    expect(heardLevel(e, 0.2, 5000).lastSpeech).toBe(5000);
  });

  it('the first levels only learn the room, so a mic that opens on noise is not speech', () => {
    let e = freshEars(0);
    for (let i = 0; i < WARMUP_SAMPLES; i++) e = heardLevel(e, 0.5, i * 50);
    expect(e.lastSpeech).toBeNull();
    expect(heardLevel(e, 0.5, 400).lastSpeech).toBeNull(); // the "noise" is the room's level now
  });

  it('keeps a short memory of levels', () => {
    const e = feed(freshEars(0), () => 0.01, 0, 10_000);
    expect(e.levels).toHaveLength(FLOOR_SAMPLES);
    expect(e.heard).toBe(200);
  });

  it('ignores nonsense levels', () => {
    const e = freshEars(0);
    expect(heardLevel(e, Number.NaN, 10)).toBe(e);
    expect(heardLevel(e, -1, 10)).toBe(e);
  });
});

describe('listenRules', () => {
  it('a held 🎙 follows the hold, unless auto-send ends it when you stop talking', () => {
    expect(listenRules('hold', false)).toEqual({ silenceMs: null, noSpeechMs: null, maxMs: CLIP_MAX_MS });
    expect(listenRules('hold', true).silenceMs).toBe(SILENCE_MS);
    expect(listenRules('hold', true).noSpeechMs).toBeNull();
  });

  it('a tap and the hands-free phone end on quiet and give up on nothing', () => {
    for (const mode of ['tap', 'handsfree'] as const) expect(listenRules(mode, false)).toEqual({ silenceMs: SILENCE_MS, noSpeechMs: NO_SPEECH_MS, maxMs: CLIP_MAX_MS });
  });

  it('sends by itself hands-free, or with auto-send on', () => {
    expect(sendsWhenDone('handsfree', false)).toBe(true);
    expect(sendsWhenDone('tap', false)).toBe(false);
    expect(sendsWhenDone('hold', false)).toBe(false);
    expect(sendsWhenDone('hold', true)).toBe(true);
    expect(sendsWhenDone('tap', true)).toBe(true);
  });
});
