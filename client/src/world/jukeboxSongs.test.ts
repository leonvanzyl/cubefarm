import { describe, expect, it } from 'vitest';
import { HOLD, REST, SONGS, STEPS_PER_BAR, beatAt, beatPulse, compileSong, degreeMidi, firstSongFor, midiHz, noteAge, parseLine, passMix, stepAt, stepTime, trackFor, type Song } from './jukeboxSongs';

const song = (over: Partial<Song> = {}): Song => ({
  id: 'test',
  title: 'Test',
  artist: 'Tester',
  bpm: 120,
  swing: 0,
  root: 60,
  scale: 'major',
  chords: [1, 5],
  lead: "1 - 3 . 5 - - . | 8 . . . 5, - . .",
  bass: '1 . 5 . 1 . 5 .',
  comp: 'x - . . x . . .',
  drums: { kick: 'x . . . x . . .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
  sound: { lead: 'square', bass: 'triangle', chord: 'triangle' },
  passes: 2,
  color: '#ffffff',
  ...over,
});

describe('parseLine', () => {
  it('reads degrees, octave marks, holds, rests and hits, skipping bar lines', () => {
    expect(parseLine("1 - . 5' 3, | 8 x")).toEqual([0, HOLD, REST, 11, -5, 7, 0]);
  });

  it('rejects anything else', () => {
    expect(() => parseLine('1 b3')).toThrow(/b3/);
  });
});

describe('degreeMidi', () => {
  it('walks the scale across octaves both ways', () => {
    expect(degreeMidi(60, 'major', 0)).toBe(60);
    expect(degreeMidi(60, 'major', 2)).toBe(64);
    expect(degreeMidi(60, 'major', 7)).toBe(72);
    expect(degreeMidi(60, 'major', -1)).toBe(59);
    expect(degreeMidi(60, 'minor', 2)).toBe(63);
    expect(degreeMidi(60, 'mixolydian', 6)).toBe(70);
  });

  it('turns MIDI into hertz', () => {
    expect(midiHz(69)).toBe(440);
    expect(midiHz(81)).toBeCloseTo(880);
  });
});

describe('compileSong', () => {
  const t = compileSong(song());

  it('lays every part out step by step', () => {
    expect(t.stepsPerPass).toBe(16);
    expect(t.totalSteps).toBe(32);
    expect(t.stepSec).toBe(0.25);
    expect(t.duration).toBe(8);
    // step 0: the melody's tonic held for 2, the bass root two octaves down, a held triad and a kick and hat
    expect(t.events[0]).toEqual([
      { voice: 'lead', midi: 60, steps: 2 },
      { voice: 'bass', midi: 36, steps: 1 },
      { voice: 'chord', midi: 48, steps: 2 },
      { voice: 'chord', midi: 52, steps: 2 },
      { voice: 'chord', midi: 55, steps: 2 },
      { voice: 'kick', midi: 0, steps: 1 },
      { voice: 'hat', midi: 0, steps: 1 },
    ]);
    // a rest plays no melody
    expect(t.events[3].some((n) => n.voice === 'lead')).toBe(false);
  });

  it('builds the bass and chords on each bar\'s chord', () => {
    const bar2 = t.events[STEPS_PER_BAR];
    expect(bar2.find((n) => n.voice === 'bass')!.midi).toBe(43); // G, the V's root
    expect(bar2.filter((n) => n.voice === 'chord').map((n) => n.midi)).toEqual([55, 59, 62]); // G B D
    expect(bar2.find((n) => n.voice === 'lead')).toEqual({ voice: 'lead', midi: 72, steps: 1 });
  });

  it('adds sevenths when asked', () => {
    const chords = compileSong(song({ sevenths: true })).events[0].filter((n) => n.voice === 'chord');
    expect(chords.map((n) => n.midi)).toEqual([48, 52, 55, 59]);
  });

  it('catches patterns of the wrong length', () => {
    expect(() => compileSong(song({ lead: '1 - - -' }))).toThrow(/lead/);
    expect(() => compileSong(song({ bass: '1 . 5 .' }))).toThrow(/bass/);
    expect(() => compileSong(song({ drums: { kick: 'x', snare: '. . x . . . x .', hat: 'x x x x x x x x' } }))).toThrow(/kick/);
  });
});

describe('timing', () => {
  const straight = compileSong(song());
  const swung = compileSong(song({ swing: 0.3 }));

  it('puts steps on an even grid, with swung off-beats landing late', () => {
    expect(stepTime(straight, 0)).toBe(0);
    expect(stepTime(straight, 1)).toBe(0.25);
    expect(stepTime(swung, 1)).toBeCloseTo(0.325);
    expect(stepTime(swung, 2)).toBe(0.5);
  });

  it('finds the next step at or after a time', () => {
    expect(stepAt(straight, 0)).toBe(0);
    expect(stepAt(straight, 0.25)).toBe(1);
    expect(stepAt(straight, 0.26)).toBe(2);
    expect(stepAt(swung, 0.3)).toBe(1); // the swung off-beat hasn't come yet
    expect(stepAt(swung, 0.33)).toBe(2);
    expect(stepAt(straight, -1)).toBe(0);
  });

  it('counts quarter-note beats', () => {
    expect(beatAt(straight, 0)).toBe(0);
    expect(beatAt(straight, 0.5)).toBe(1);
    expect(beatAt(straight, 2.25)).toBe(4.5);
  });

  it('kicks on the beat and settles before the next', () => {
    expect(beatPulse(3)).toBe(1);
    expect(beatPulse(3.1)).toBeGreaterThan(beatPulse(3.2));
    expect(beatPulse(3.5)).toBe(0);
    expect(beatPulse(3.99)).toBe(0);
  });
});

describe('passMix', () => {
  it('drops the melody and snare for the middle pass of a long song', () => {
    expect([0, 1, 2, 3, 4].map((p) => passMix(p, 5).lead)).toEqual([true, true, false, true, true]);
    expect(passMix(2, 5).snare).toBe(false);
    expect([0, 1].map((p) => passMix(p, 2).lead)).toEqual([true, true]);
  });
});

describe('noteAge', () => {
  it('sends one note up per beat, taking turns, each rising for `life` beats', () => {
    expect(noteAge(0, 0, 4, 3)).toBe(0);
    expect(noteAge(1.5, 0, 4, 3)).toBeCloseTo(0.5);
    expect(noteAge(3.2, 0, 4, 3)).toBe(-1); // done rising, waiting for its next turn
    expect(noteAge(4, 0, 4, 3)).toBe(0);
    expect(noteAge(0.5, 1, 4, 3)).toBe(-1); // not born yet
    expect(noteAge(1.5, 1, 4, 3)).toBeCloseTo(0.5 / 3);
    expect(noteAge(6.75, 2, 4, 3)).toBeCloseTo(0.25);
  });
});

describe('the playlist', () => {
  it('has a bunch of songs with unique ids that all compile', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    for (const s of SONGS) expect(() => compileSong(s), s.id).not.toThrow();
  });

  it.each(SONGS.map((s) => [s.id, s] as const))('%s is a sensible length, tempo and range', (_, s) => {
    const t = compileSong(s);
    expect(t.duration, 'seconds').toBeGreaterThan(40);
    expect(t.duration, 'seconds').toBeLessThan(120);
    expect(s.bpm).toBeGreaterThanOrEqual(60);
    expect(s.bpm).toBeLessThanOrEqual(160);
    expect(s.swing).toBeGreaterThanOrEqual(0);
    expect(s.swing).toBeLessThan(0.5);
    const notes = t.events.flat();
    const range = (v: string) => notes.filter((n) => n.voice === v).map((n) => n.midi);
    expect(range('lead').length).toBeGreaterThan(t.stepsPerPass / 4); // a real tune, not a few blips
    for (const m of range('lead')) expect(m).toBeGreaterThanOrEqual(52), expect(m).toBeLessThanOrEqual(90);
    for (const m of range('bass')) expect(m).toBeGreaterThanOrEqual(28), expect(m).toBeLessThanOrEqual(67);
    expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('wraps round, compiles each song once and starts each floor on its own song', () => {
    expect(trackFor(SONGS.length).song).toBe(SONGS[0]);
    expect(trackFor(-1).song).toBe(SONGS[SONGS.length - 1]);
    expect(trackFor(2)).toBe(trackFor(2));
    expect(firstSongFor(0)).toBe(0);
    expect(firstSongFor(3)).toBe(3);
    expect(firstSongFor(SONGS.length + 1)).toBe(1);
  });
});
