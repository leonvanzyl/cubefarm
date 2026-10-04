// The jukebox's songs and their timing, as pure data and helpers: the music player (ui/music.ts) schedules the
// notes from here and Jukebox.tsx bounces, glows and puffs music notes on the same beats, so they never drift apart.
// Songs are written as short patterns in scale degrees (no audio files): 8 steps (eighth notes) to a bar of 4/4.

export const STEPS_PER_BAR = 8;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;
export type Scale = keyof typeof SCALES;

export type Voice = 'lead' | 'bass' | 'chord' | 'kick' | 'snare' | 'hat';

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  /** How late the off-beat eighths land, as a fraction of a step (0 straight, 1/3 a full shuffle). */
  swing: number;
  /** The tonic of the lead's octave (MIDI); chords sit an octave lower, the bass two. */
  root: number;
  scale: Scale;
  /** One chord per bar: the scale degree it's built on (1 is the tonic). */
  chords: number[];
  /** Adds the seventh to every chord (lo-fi, bossa). */
  sevenths?: boolean;
  /**
   * The melody, 8 tokens a bar for every bar of `chords`: a scale degree 1-9 (`'` an octave up, `,` down),
   * `-` to hold the note before, `.` to rest. `|` between bars is ignored.
   */
  lead: string;
  /** One bar of bass, repeated: degrees counted from each bar's chord (1 its root). */
  bass: string;
  /** One bar of chord rhythm: `x` strikes the chord, `-` holds it, `.` rests. */
  comp: string;
  /** One bar of each drum: `x` hits. */
  drums: { kick: string; snare: string; hat: string };
  /** Each part's waveform. */
  sound: { lead: OscillatorType; bass: OscillatorType; chord: OscillatorType };
  /** Times through the whole pattern. */
  passes: number;
  /** The jukebox's lights and display while it plays. */
  color: string;
}

/** One note to play at a step: its voice, pitch (MIDI; 0 for drums) and length in steps. */
export interface Note {
  voice: Voice;
  midi: number;
  steps: number;
}

/** A song ready to play: the notes starting at each step of one pass, and its timing. */
export interface Track {
  song: Song;
  /** Steps in one pass, and in the whole song. */
  stepsPerPass: number;
  totalSteps: number;
  /** Seconds per step (an eighth note). */
  stepSec: number;
  /** Seconds from the first note to the end of the last bar. */
  duration: number;
  events: Note[][];
}

// ---------- parsing ----------

export const REST = -1000;
export const HOLD = -1001;

/** A pattern's tokens: 0-based scale degrees (7 an octave up), REST or HOLD; `x` counts as degree 0. */
export function parseLine(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    if (tok === '.') out.push(REST);
    else if (tok === '-') out.push(HOLD);
    else if (tok === 'x') out.push(0);
    else {
      const m = /^([1-9])([',]*)$/.exec(tok);
      if (!m) throw new Error(`bad note "${tok}"`);
      let deg = Number(m[1]) - 1;
      for (const c of m[2]) deg += c === "'" ? 7 : -7;
      out.push(deg);
    }
  }
  return out;
}

/** The MIDI note of a 0-based scale degree (negative or past 6 wraps into other octaves). */
export function degreeMidi(root: number, scale: Scale, degree: number): number {
  const steps = SCALES[scale];
  const octave = Math.floor(degree / steps.length);
  return root + octave * 12 + steps[degree - octave * steps.length];
}

export const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** How many steps a note at `i` lasts: itself plus the holds after it. */
function lengthAt(tokens: number[], i: number) {
  let n = 1;
  while (tokens[i + n] === HOLD) n++;
  return n;
}

/** Lays a song out step by step. Throws if a pattern is the wrong length, so a typo shows up in the tests. */
export function compileSong(song: Song): Track {
  const bars = song.chords.length;
  const stepsPerPass = bars * STEPS_PER_BAR;
  const lead = parseLine(song.lead);
  const bass = parseLine(song.bass);
  const comp = parseLine(song.comp);
  const drums = { kick: parseLine(song.drums.kick), snare: parseLine(song.drums.snare), hat: parseLine(song.drums.hat) };
  if (lead.length !== stepsPerPass) throw new Error(`${song.id}: lead has ${lead.length} steps, not ${stepsPerPass}`);
  for (const [name, line] of [['bass', bass], ['comp', comp], ...Object.entries(drums)] as const) {
    if (line.length !== STEPS_PER_BAR) throw new Error(`${song.id}: ${name} has ${line.length} steps, not ${STEPS_PER_BAR}`);
  }

  const events: Note[][] = Array.from({ length: stepsPerPass }, () => []);
  for (let s = 0; s < stepsPerPass; s++) {
    const bar = Math.floor(s / STEPS_PER_BAR);
    const b = s % STEPS_PER_BAR;
    const chord = song.chords[bar] - 1;
    const at = events[s];
    if (lead[s] > REST) at.push({ voice: 'lead', midi: degreeMidi(song.root, song.scale, lead[s]), steps: lengthAt(lead, s) });
    if (bass[b] > REST) at.push({ voice: 'bass', midi: degreeMidi(song.root - 24, song.scale, chord + bass[b]), steps: lengthAt(bass, b) });
    if (comp[b] > REST) {
      const len = lengthAt(comp, b);
      for (const d of song.sevenths ? [0, 2, 4, 6] : [0, 2, 4]) at.push({ voice: 'chord', midi: degreeMidi(song.root - 12, song.scale, chord + d), steps: len });
    }
    for (const v of ['kick', 'snare', 'hat'] as const) if (drums[v][b] === 0) at.push({ voice: v, midi: 0, steps: 1 });
  }
  const stepSec = 60 / song.bpm / 2;
  const totalSteps = stepsPerPass * song.passes;
  return { song, stepsPerPass, totalSteps, stepSec, duration: totalSteps * stepSec, events };
}

// ---------- timing ----------

/** Seconds from the start of the song to step `step` (off-beats land late by the song's swing). */
export function stepTime(track: Track, step: number): number {
  return (step + (step % 2 === 1 ? track.song.swing : 0)) * track.stepSec;
}

/** The first step that starts at or after `sec`. */
export function stepAt(track: Track, sec: number): number {
  let s = Math.max(0, Math.floor(sec / track.stepSec));
  while (stepTime(track, s) < sec) s++;
  return s;
}

/** Quarter-note beats since the start of the song. */
export const beatAt = (track: Track, sec: number) => Math.max(0, sec) / (track.stepSec * 2);

/** What plays in each pass: the middle one (of three or more) is a breakdown without the melody or the snare. */
export function passMix(pass: number, passes: number): { lead: boolean; snare: boolean } {
  const breakdown = passes >= 3 && pass === Math.floor(passes / 2);
  return { lead: !breakdown, snare: !breakdown };
}

/** A springy kick on every beat: 1 right on it, easing back to 0 by a third of the way to the next. */
export function beatPulse(beat: number): number {
  const f = beat - Math.floor(beat);
  const k = Math.max(0, 1 - f * 3);
  return k * k;
}

/**
 * The floating music notes: a new one leaves the jukebox every beat, taking turns between `count` of them, and
 * each rises for `life` beats (less than `count`). How far through its rise note `i` is (0-1), or -1 while it waits.
 */
export function noteAge(beat: number, i: number, count: number, life: number): number {
  const b = Math.floor(beat);
  const born = b - ((((b - i) % count) + count) % count);
  if (born < 0) return -1;
  const k = (beat - born) / life;
  return k < 1 ? k : -1;
}

// ---------- the playlist ----------

export const SONGS: Song[] = [
  {
    id: 'coffee-break-bossa',
    title: 'Coffee Break Bossa',
    artist: 'The Decaf Trio',
    bpm: 118,
    swing: 0,
    root: 65,
    scale: 'major',
    chords: [1, 6, 2, 5, 1, 6, 2, 5],
    sevenths: true,
    lead: "5 - 3 - . 5 3 - | 6 - 1' - . 6 5 - | 4 - 6 - . 4 2 - | 2 - 7, - 5, - . . | 5 - 3 - . 5 1' - | 1' - 6 - . 1' 3' - | 2' - 1' 6 - 4 6 - | 5 - - - . . . .",
    bass: '1 - - 5, 1 - - 5,',
    comp: 'x . . x . . x .',
    drums: { kick: 'x . . x x . . x', snare: '. . x . . x . .', hat: 'x x x x x x x x' },
    sound: { lead: 'triangle', bass: 'triangle', chord: 'sine' },
    passes: 5,
    color: '#ff9f68',
  },
  {
    id: 'green-checks-groove',
    title: 'Green Checks Groove',
    artist: 'CI & the Pipelines',
    bpm: 104,
    swing: 0.12,
    root: 64,
    scale: 'dorian',
    chords: [1, 1, 4, 4, 1, 1, 5, 4],
    lead: "1 . 3 4 . 5 . 3 | . 7 . 5 3 . 1 . | 4 . 6 1' . 6 . 4 | . 3' . 1' 6 . 4 . | 1 . 3 4 . 5 . 3 | 7 . 5 . 3 4 3 1 | 5 . 7 2' . 7 . 5 | 4 . 6 . 3' - 1' .",
    bass: "1 . 1' . 1 5 . 7,",
    comp: '. x . . . x . x',
    drums: { kick: 'x . . x . . x .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'square', bass: 'triangle', chord: 'triangle' },
    passes: 5,
    color: '#06d6a0',
  },
  {
    id: 'merge-conflict-mambo',
    title: 'Merge Conflict Mambo',
    artist: 'Los Rebasers',
    bpm: 124,
    swing: 0,
    root: 69,
    scale: 'minor',
    chords: [1, 4, 5, 1, 1, 4, 5, 1],
    lead: "5 . 5 . 1' - 7 6 | 4 - 6 . 4 . 3 2 | 5 . 7 . 2' - 7 5 | 1' - - . 5 . 3 . | 3' . 3' . 2' 1' 7 1' | 6 - 4 . 6 . 1' - | 7 - 5 . 7 2' - 7 | 1' - - - . . 5 .",
    bass: "1 . . 5 . . 1' .",
    comp: 'x . x x . x . x',
    drums: { kick: 'x . . x . . . .', snare: 'x . . x . . x .', hat: 'x . x . x . x .' },
    sound: { lead: 'square', bass: 'triangle', chord: 'triangle' },
    passes: 5,
    color: '#ef476f',
  },
  {
    id: 'stand-up-shuffle',
    title: 'Stand-up Shuffle',
    artist: 'Blocker & the Blockers',
    bpm: 112,
    swing: 0.3,
    root: 67,
    scale: 'mixolydian',
    chords: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5],
    lead: "5 . 5 . 6 5 3 . | 1 - - . . . . . | 5 . 5 . 6 5 7 6 | 5 - - . . 3 4 . | 4 . 4 . 6 4 3 . | 1 - - . . . . . | 5 . 5 . 6 5 3 . | 1 - - . . 3 5 . | 6 . 6 . 5 4 2 . | 5 . 5 . 4 3 1 . | 3 - 2 1 - . . . | 2 - - . 5, - . .",
    bass: '1 . 3 . 5 . 6 .',
    comp: '. . x . . . x .',
    drums: { kick: 'x . . . x . . .', snare: '. . x . . . x .', hat: 'x . x . x . x .' },
    sound: { lead: 'triangle', bass: 'triangle', chord: 'square' },
    passes: 4,
    color: '#4cc9f0',
  },
  {
    id: 'lo-fi-linting',
    title: 'Lo-fi Linting',
    artist: 'Semicolon Sleep',
    bpm: 78,
    swing: 0.2,
    root: 72,
    scale: 'major',
    chords: [2, 5, 1, 6, 2, 5, 1, 6],
    sevenths: true,
    lead: ". . 4 - 3 - 2 - | 7, - - . . . 2 4 | 3 - - - . . 5 - | 1' - 7 - 6 - . . | . . 6 - 4 - 3 - | 2 - - . 4 - 5 - | 7 - - - 5 - 3 - | 1 - - - . . . .",
    bass: '1 - - - . . 5, -',
    comp: 'x - - - - - - -',
    drums: { kick: 'x . . . . x x .', snare: '. . x . . . x .', hat: '. x . x . x . x' },
    sound: { lead: 'sine', bass: 'triangle', chord: 'triangle' },
    passes: 3,
    color: '#b8a1ff',
  },
  {
    id: 'deploy-on-a-friday',
    title: 'Deploy on a Friday',
    artist: 'The Hotfixes',
    bpm: 124,
    swing: 0,
    root: 69,
    scale: 'minor',
    chords: [1, 6, 7, 5, 1, 6, 7, 5],
    lead: "1' . 1' . 7 1' . 3' | 1' - 6 - 1' - 3' - | 2' . 2' . 1' 2' . 4' | 5' - - . 2' - 7 - | 3' . 3' . 2' 1' . 5 | 6 - 1' - 3' - 1' - | 7 - 2' - 4' - 2' - | 5' - - - . . . .",
    bass: "1 1' 1 1' 1 1' 1 1'",
    comp: '. x . x . x . x',
    drums: { kick: 'x . x . x . x .', snare: '. . x . . . x .', hat: '. x . x . x . x' },
    sound: { lead: 'square', bass: 'sawtooth', chord: 'triangle' },
    passes: 5,
    color: '#ffd166',
  },
  {
    id: 'going-up',
    title: 'Going Up (Elevator Mix)',
    artist: 'Floor Seven Strings',
    bpm: 92,
    swing: 0,
    root: 67,
    scale: 'major',
    chords: [1, 6, 4, 5, 1, 6, 2, 5],
    sevenths: true,
    lead: '3 - - 2 1 - 5, - | 6, - 1 - 3 - 5 - | 4 - 3 - 4 - 6 - | 5 - - - . . 4 3 | 3 - - 2 1 - 3 - | 5 - - 3 6 - 5 - | 4 - 3 - 2 - 1 - | 2 - - - . . . .',
    bass: '1 - - - 5, - - -',
    comp: 'x - - - x - - -',
    drums: { kick: 'x . . . x . . .', snare: '. . . . . . . .', hat: 'x . x . x . x .' },
    sound: { lead: 'sine', bass: 'triangle', chord: 'sine' },
    passes: 4,
    color: '#8ecae6',
  },
  {
    id: 'rubber-duck-polka',
    title: 'Rubber Duck Polka',
    artist: 'Quack Overflow',
    bpm: 138,
    swing: 0,
    root: 70,
    scale: 'major',
    chords: [1, 1, 5, 5, 5, 5, 1, 1],
    lead: "1 3 5 3 1' - 5 - | 3 - 5 - 1 - . . | 7, 2 5 2 7 - 5 - | 4 - 2 - 7, - . . | 5 4 2 4 5 - 7 - | 6 - 5 - 4 - 2 - | 1 3 5 1' 3' - 1' - | 1' - . 5 1' - . .",
    bass: '1 . 5, . 1 . 5, .',
    comp: '. x . x . x . x',
    drums: { kick: 'x . . . x . . .', snare: '. . x . . . x .', hat: '. . . . . . . .' },
    sound: { lead: 'square', bass: 'triangle', chord: 'triangle' },
    passes: 6,
    color: '#ffbe0b',
  },
  {
    id: 'ship-it',
    title: 'Ship It (Arena Version)',
    artist: 'Small PRs',
    bpm: 132,
    swing: 0,
    root: 64,
    scale: 'major',
    chords: [1, 5, 6, 4, 1, 5, 6, 4],
    lead: "5 - 5 - 6 - 5 - | 2' - 1' - 7 - 5 - | 6 - 1' - 3' - 1' - | 1' - - - 6 - 4 - | 5 - 5 - 3' - 2' - | 2' - 1' - 7 - 2' - | 3' - 1' - 6 - 1' - | 1' - - - - - . .",
    bass: '1 1 1 1 1 1 1 1',
    comp: 'x - - - x - - -',
    drums: { kick: 'x . . . x x . .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'square', bass: 'triangle', chord: 'sawtooth' },
    passes: 5,
    color: '#3a86ff',
  },
];

const tracks = new Map<string, Track>();

/** Song `i` of the playlist (wrapping round), compiled once. */
export function trackFor(i: number): Track {
  const song = SONGS[((i % SONGS.length) + SONGS.length) % SONGS.length];
  let t = tracks.get(song.id);
  if (!t) {
    t = compileSong(song);
    tracks.set(song.id, t);
  }
  return t;
}

/** Each floor starts on a different song (the lobby is floor 0). */
export const firstSongFor = (floor: number) => ((floor % SONGS.length) + SONGS.length) % SONGS.length;
