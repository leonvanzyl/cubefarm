import { describe, expect, it } from 'vitest';
import {
  HOLD,
  HOLIDAY_SONGS,
  REST,
  SONGS,
  STEPS_PER_BAR,
  beatAt,
  beatPulse,
  compileSong,
  degreeMidi,
  firstSongFor,
  holidayTrack,
  isFocusSong,
  midiHz,
  moodOf,
  nextSong,
  noteAge,
  parseLine,
  parseStation,
  passMix,
  stationOrder,
  stationSongs,
  stepAt,
  stepTime,
  trackFor,
  type Song,
} from './jukeboxSongs';
import { THEMES } from './themes/themes';

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

  it('voices ninths without the root, which the bass has', () => {
    const chords = compileSong(song({ ninths: true })).events[0].filter((n) => n.voice === 'chord');
    expect(chords.map((n) => n.midi)).toEqual([52, 55, 59, 62]); // E G B D over C
  });

  it('works out what every pass plays', () => {
    expect(compileSong(song({ passes: 3 })).mixes.map((m) => m.lead)).toEqual([true, false, true]);
    expect(compileSong(song({ passes: 3, arrangement: 'build' })).mixes.map((m) => m.snare)).toEqual([false, false, true]);
  });
});

describe('sections', () => {
  // A is the song's own two bars; B is one bar on the IV with its own drums and the song's bass and comp.
  const b = { chords: [4], lead: "3' - - - . . . .", drums: { kick: 'x x x x x x x x', snare: '. . . . . . . .', hat: '. . . . . . . .' } };
  const t = compileSong(song({ sections: { B: b }, form: 'ABA' }));

  it('plays the sections in the order of the form', () => {
    expect(t.stepsPerPass).toBe(5 * STEPS_PER_BAR);
    expect(t.totalSteps).toBe(10 * STEPS_PER_BAR);
    expect(t.events[0]).toEqual(compileSong(song()).events[0]); // A as before
    const bStart = t.events[2 * STEPS_PER_BAR];
    expect(bStart.find((n) => n.voice === 'lead')).toEqual({ voice: 'lead', midi: 76, steps: 4 });
    expect(bStart.find((n) => n.voice === 'bass')!.midi).toBe(41); // F, the IV's root, on the song's bass line
    expect(bStart.filter((n) => n.voice === 'chord').map((n) => n.midi)).toEqual([53, 57, 60]); // F A C, on the song's comp
    expect(t.events.slice(2 * STEPS_PER_BAR, 3 * STEPS_PER_BAR).every((at) => at.some((n) => n.voice === 'kick'))).toBe(true);
    expect(t.events[2 * STEPS_PER_BAR].some((n) => n.voice === 'hat')).toBe(false);
    expect(t.events[3 * STEPS_PER_BAR]).toEqual(t.events[0]); // and A again
  });

  it('defaults to the song on its own', () => {
    expect(compileSong(song({ sections: { B: b } })).stepsPerPass).toBe(2 * STEPS_PER_BAR);
  });

  it('catches a missing section, a bad form or a section pattern of the wrong length', () => {
    expect(() => compileSong(song({ form: 'AC' }))).toThrow(/no section C/);
    expect(() => compileSong(song({ form: 'a-b' }))).toThrow(/form/);
    expect(() => compileSong(song({ sections: { B: { ...b, lead: '1 - -' } }, form: 'AB' }))).toThrow(/lead in section B/);
    expect(() => compileSong(song({ sections: { B: { ...b, comp: 'x' } }, form: 'AB' }))).toThrow(/comp in section B/);
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
    expect(passMix(2, 5)).toMatchObject({ kick: true, hat: true, lift: false });
  });

  it('builds: drums come in pass by pass, and the last pass lifts the melody', () => {
    const mixes = [0, 1, 2, 3].map((p) => passMix(p, 4, 'build'));
    expect(mixes.map((m) => [m.kick, m.hat, m.snare])).toEqual([
      [false, false, false],
      [true, true, false],
      [true, true, true],
      [true, true, true],
    ]);
    expect(mixes.map((m) => m.lift)).toEqual([false, false, false, true]);
    expect(mixes.every((m) => m.lead)).toBe(true);
  });

  it('keeps it sparse: pads alone first, then the melody', () => {
    expect([0, 1, 2].map((p) => passMix(p, 3, 'sparse').lead)).toEqual([false, true, true]);
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

// The playlist before the lo-fi set: these stay exactly as they were.
const ORIGINAL = ['coffee-break-bossa', 'green-checks-groove', 'merge-conflict-mambo', 'stand-up-shuffle', 'lo-fi-linting', 'deploy-on-a-friday', 'going-up', 'rubber-duck-polka', 'ship-it'];
const added = SONGS.filter((s) => !ORIGINAL.includes(s.id));

describe('the playlist', () => {
  it('has a bunch of songs with unique ids that all compile', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(19);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    for (const s of SONGS) expect(() => compileSong(s), s.id).not.toThrow();
  });

  it('keeps the first nine songs as they were: same place, one plain section, plain waveforms, no texture', () => {
    expect(SONGS.slice(0, ORIGINAL.length).map((s) => s.id)).toEqual(ORIGINAL);
    for (const s of SONGS.slice(0, ORIGINAL.length)) {
      expect(s.sections ?? s.form ?? s.arrangement ?? s.texture ?? s.ninths, s.id).toBeUndefined();
      for (const part of [s.sound.lead, s.sound.chord]) expect(['keys', 'pad'], s.id).not.toContain(part);
    }
  });

  it.each([...SONGS, ...HOLIDAY_SONGS].map((s) => [s.id, s] as const))('%s is a sensible length, tempo and range', (_, s) => {
    const t = compileSong(s);
    expect(t.duration, 'seconds').toBeGreaterThan(40);
    expect(t.duration, 'seconds').toBeLessThan(200);
    expect(s.bpm).toBeGreaterThanOrEqual(60);
    expect(s.bpm).toBeLessThanOrEqual(160);
    expect(s.swing).toBeGreaterThanOrEqual(0);
    expect(s.swing).toBeLessThan(0.5);
    const notes = t.events.flat();
    const range = (v: string) => notes.filter((n) => n.voice === v).map((n) => n.midi);
    // a real tune, not a few blips (ambient melodies are sparse on purpose)
    expect(range('lead').length).toBeGreaterThan(t.stepsPerPass / (moodOf(s) === 'ambient' ? 16 : 4));
    for (const m of range('lead')) expect(m).toBeGreaterThanOrEqual(52), expect(m).toBeLessThanOrEqual(90);
    for (const m of range('bass')) expect(m).toBeGreaterThanOrEqual(28), expect(m).toBeLessThanOrEqual(67);
    for (const m of range('chord')) expect(m).toBeGreaterThanOrEqual(36), expect(m).toBeLessThanOrEqual(84);
    expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    if (s.texture?.warmth !== undefined) expect(s.texture.warmth).toBeGreaterThanOrEqual(1200), expect(s.texture.warmth).toBeLessThanOrEqual(5200);
  });

  it('adds at least ten songs for focus: lo-fi beats, ambient tracks and a few uplifting ones', () => {
    expect(added.length).toBeGreaterThanOrEqual(10);
    const count = (m: string) => added.filter((s) => moodOf(s) === m).length;
    expect(count('lofi')).toBeGreaterThanOrEqual(5);
    expect(count('ambient')).toBeGreaterThanOrEqual(2);
    expect(count('uplifting')).toBeGreaterThanOrEqual(2);
    expect(count('lively')).toBe(0);
  });

  it.each(added.map((s) => [s.id, s] as const))('%s runs two to three minutes, with sections, and fits its mood', (_, s) => {
    const t = compileSong(s);
    expect(t.duration, 'seconds').toBeGreaterThanOrEqual(120);
    expect(t.duration, 'seconds').toBeLessThanOrEqual(185);
    expect(new Set(s.form).size, 'an A and a B at least').toBeGreaterThanOrEqual(2);
    const perBar = (v: string) => t.events.flat().filter((n) => n.voice === v).length / (t.stepsPerPass / STEPS_PER_BAR);
    if (moodOf(s) === 'lofi') {
      expect(s.bpm).toBeGreaterThanOrEqual(70), expect(s.bpm).toBeLessThanOrEqual(90);
      expect(s.swing).toBeGreaterThan(0.1);
      expect(s.sevenths || s.ninths).toBe(true);
      expect(s.sound.lead).toBe('keys');
      expect(s.texture).toMatchObject({ crackle: true, wobble: true, softDrums: true });
      expect(s.texture!.warmth).toBeLessThan(3200);
      expect(perBar('kick'), 'a soft boom-bap groove').toBeGreaterThan(0);
    }
    if (moodOf(s) === 'ambient') {
      expect(s.bpm).toBeGreaterThanOrEqual(60), expect(s.bpm).toBeLessThanOrEqual(75);
      expect(s.sound.chord).toBe('pad');
      expect(perBar('kick') + perBar('snare') + perBar('hat'), 'few or no drums').toBeLessThanOrEqual(1);
      expect(s.arrangement).toBe('sparse');
      expect(s.texture?.crackle).toBeFalsy();
    }
    if (moodOf(s) === 'uplifting') {
      expect(s.bpm).toBeGreaterThanOrEqual(95), expect(s.bpm).toBeLessThanOrEqual(110);
      expect(s.scale).toBe('major');
      expect(s.arrangement).toBe('build');
      expect(s.passes).toBeGreaterThanOrEqual(3);
      expect(s.texture).toBeUndefined();
    }
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

describe('stations', () => {
  const focus = stationSongs('focus');
  const all = stationSongs('all');

  it('reads a saved station, anything else being All', () => {
    expect(parseStation('focus')).toBe('focus');
    for (const raw of ['all', null, undefined, '', 'FOCUS', '1', 42, '{"station":"focus"}']) expect(parseStation(raw)).toBe('all');
  });

  it('Focus is the lo-fi and ambient songs, in playlist order', () => {
    expect(focus.length).toBeGreaterThanOrEqual(8);
    expect(focus.every((i) => isFocusSong(SONGS[i]))).toBe(true);
    expect(focus).toEqual(SONGS.flatMap((s, i) => (isFocusSong(s) ? [i] : [])));
    expect(focus.map((i) => SONGS[i].id)).toContain('lo-fi-linting');
  });

  it('All plays every song once, from the first, with lo-fi and lively ones mixed rather than clumped', () => {
    expect([...all].sort((a, b) => a - b)).toEqual(SONGS.map((_, i) => i));
    expect(all[0]).toBe(0);
    const kinds = all.map((i) => (isFocusSong(SONGS[i]) ? 'C' : 'L')).join('');
    // round the loop too: never three of a kind in a row
    expect(kinds + kinds.slice(0, 2)).not.toMatch(/CCC|LLL/);
    expect(kinds.slice(0, 4)).toMatch(/C/);
  });

  it('spreads any two kinds evenly', () => {
    const fake = (moods: string) => [...moods].map((m, i) => song({ id: `s${i}`, mood: m === 'c' ? 'lofi' : 'lively' }));
    const kinds = (moods: string) => stationOrder(fake(moods), 'all').map((i) => moods[i]).join('');
    expect(kinds('lllccc')).toBe('lclclc');
    expect(kinds('ccll')).toBe('clcl');
    expect(kinds('llllcc')).toMatch(/^l/);
    expect(kinds('llllcc') + 'l').not.toMatch(/cc|llll/);
    expect(stationOrder(fake('llcc'), 'focus')).toEqual([2, 3]);
    expect(stationOrder([], 'all')).toEqual([]);
  });

  it('next stays on the station and goes through all of it', () => {
    for (const station of ['all', 'focus'] as const) {
      const list = stationSongs(station);
      let at = list[0];
      const seen = new Set<number>();
      for (let k = 0; k < list.length; k++) {
        seen.add(at);
        at = nextSong(at, station);
        expect(list).toContain(at);
      }
      expect(seen.size).toBe(list.length);
      expect(at).toBe(list[0]); // round again
    }
  });

  it('switching to Focus during a lively song moves on to the next focus song in the All order', () => {
    const lively = all.find((i) => !isFocusSong(SONGS[i]))!;
    const next = nextSong(lively, 'focus');
    expect(isFocusSong(SONGS[next])).toBe(true);
    const between = all.slice(all.indexOf(lively) + 1, all.indexOf(next));
    expect(between.every((i) => !isFocusSong(SONGS[i]))).toBe(true);
  });

  it('starts each floor on its own focus song', () => {
    expect(isFocusSong(SONGS[firstSongFor(0, 'focus')])).toBe(true);
    expect(firstSongFor(1, 'focus')).not.toBe(firstSongFor(0, 'focus'));
    expect(firstSongFor(focus.length, 'focus')).toBe(firstSongFor(0, 'focus'));
  });
});

describe('holiday songs', () => {
  it('all compile, with ids of their own', () => {
    const ids = [...SONGS, ...HOLIDAY_SONGS].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HOLIDAY_SONGS) expect(() => compileSong(s), s.id).not.toThrow();
  });

  it("every theme's playlist names real songs, and each holiday song belongs to a theme", () => {
    const named = Object.values(THEMES).flatMap((t) => t.playlist);
    for (const id of named) expect(HOLIDAY_SONGS.some((s) => s.id === id), id).toBe(true);
    for (const s of HOLIDAY_SONGS) expect(named, s.id).toContain(s.id);
  });

  it("goes round a theme's songs, compiled once, and has nothing for an empty or unknown list", () => {
    const ids = THEMES.halloween.playlist;
    expect(holidayTrack(ids, 0)!.song.id).toBe('haunted-hotfix');
    expect(holidayTrack(ids, 1)!.song.id).toBe('monster-merge');
    expect(holidayTrack(ids, 2)).toBe(holidayTrack(ids, 0));
    expect(holidayTrack(ids, -1)!.song.id).toBe('monster-merge');
    expect(holidayTrack([], 0)).toBe(null);
    expect(holidayTrack(['nope'], 0)).toBe(null);
  });
});
