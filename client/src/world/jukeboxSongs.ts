// The jukebox's songs and their timing, as pure data and helpers: the music player (ui/music.ts) schedules the
// notes from here and Jukebox.tsx bounces, glows and puffs music notes on the same beats, so they never drift apart.
// Songs are written as short patterns in scale degrees (no audio files): 8 steps (eighth notes) to a bar of 4/4.
// Longer songs add sections (an A and a B, played in a form like AABA) and change from pass to pass. The playlist
// has two stations: All, and Focus (the lo-fi and ambient songs only).

export const STEPS_PER_BAR = 8;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;
export type Scale = keyof typeof SCALES;

export type Voice = 'lead' | 'bass' | 'chord' | 'kick' | 'snare' | 'hat';

/** What a song is for: the Focus station plays the lo-fi and ambient ones. */
export type Mood = 'lively' | 'lofi' | 'ambient' | 'uplifting';

/** A part's sound: a plain waveform, or music.ts's mellow electric piano ('keys') or slow-attack pad. */
export type Instrument = OscillatorType | 'keys' | 'pad';

/**
 * How the passes differ: 'breakdown' drops the melody and snare in the middle pass (of three or more); 'build' starts
 * without drums, brings in the kick and hat, then the snare, and doubles the melody an octave up on the last pass;
 * 'sparse' (ambient) leaves the first pass to the pads.
 */
export type Arrangement = 'breakdown' | 'build' | 'sparse';

/** The lo-fi sound (music.ts), only for songs that ask for it. */
export interface Texture {
  /** A quiet vinyl crackle and hiss bed under the song. */
  crackle?: boolean;
  /** Warmth: the whole song through a lowpass this low (Hz) instead of the jukebox speaker's. */
  warmth?: number;
  /** A slow tape wobble on the keys and pads. */
  wobble?: boolean;
  /** Softer drums: a rounder kick, a brushed rimshot for the snare and a darker hat. */
  softDrums?: boolean;
}

/** Another section of a song besides its own chords and melody (section A): any parts it leaves out are the song's. */
export interface Section {
  chords: number[];
  lead: string;
  bass?: string;
  comp?: string;
  drums?: { kick: string; snare: string; hat: string };
}

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
  /** Jazzier still: every chord as its third, fifth, seventh and ninth (the bass has the root). */
  ninths?: boolean;
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
  /** Each part's sound. */
  sound: { lead: Instrument; bass: OscillatorType; chord: Instrument };
  /** Times through the whole pattern (every section of the form). */
  passes: number;
  /** The jukebox's lights and display while it plays. */
  color: string;
  /** Default 'lively'. */
  mood?: Mood;
  texture?: Texture;
  /** Sections besides A (the song's own chords and melody), by letter. */
  sections?: Record<string, Section>;
  /** The sections in the order one pass plays them, e.g. 'AABA'. Default 'A'. */
  form?: string;
  /** Default 'breakdown'. */
  arrangement?: Arrangement;
}

/** What plays in one pass. */
export interface PassMix {
  lead: boolean;
  kick: boolean;
  snare: boolean;
  hat: boolean;
  /** The melody doubled an octave up, softly. */
  lift: boolean;
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
  /** What plays in each pass (passMix), worked out once. */
  mixes: PassMix[];
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

/** A song's sections in the order one pass plays them: its form's letters, A being the song's own. */
export function formOf(song: Song): string[] {
  const form = song.form ?? 'A';
  if (!/^[A-Z]+$/.test(form)) throw new Error(`${song.id}: bad form "${form}"`);
  return [...form];
}

/** The degrees of each chord's notes above its root: a triad, a seventh chord, or a rootless ninth. */
export const chordTones = (song: Song) => (song.ninths ? [2, 4, 6, 8] : song.sevenths ? [0, 2, 4, 6] : [0, 2, 4]);

/** One section's patterns, parsed and checked: its own lead and chords, and its parts or else the song's. */
function parseSection(song: Song, name: string) {
  const s: Section | undefined = name === 'A' ? song : song.sections?.[name];
  if (!s) throw new Error(`${song.id}: no section ${name}`);
  const where = name === 'A' ? '' : ` in section ${name}`;
  const steps = s.chords.length * STEPS_PER_BAR;
  const lead = parseLine(s.lead);
  if (lead.length !== steps) throw new Error(`${song.id}: lead${where} has ${lead.length} steps, not ${steps}`);
  const drums = s.drums ?? song.drums;
  const bars = { bass: parseLine(s.bass ?? song.bass), comp: parseLine(s.comp ?? song.comp), kick: parseLine(drums.kick), snare: parseLine(drums.snare), hat: parseLine(drums.hat) };
  for (const [part, line] of Object.entries(bars)) {
    if (line.length !== STEPS_PER_BAR) throw new Error(`${song.id}: ${part}${where} has ${line.length} steps, not ${STEPS_PER_BAR}`);
  }
  return { chords: s.chords, lead, ...bars };
}

/** Lays a song out step by step. Throws if a pattern is the wrong length, so a typo shows up in the tests. */
export function compileSong(song: Song): Track {
  const form = formOf(song);
  const sections = new Map(form.map((name) => [name, parseSection(song, name)]));
  const tones = chordTones(song);
  const events: Note[][] = [];
  for (const name of form) {
    const { chords, lead, bass, comp, kick, snare, hat } = sections.get(name)!;
    const drums = { kick, snare, hat };
    for (let s = 0; s < lead.length; s++) {
      const bar = Math.floor(s / STEPS_PER_BAR);
      const b = s % STEPS_PER_BAR;
      const chord = chords[bar] - 1;
      const at: Note[] = [];
      if (lead[s] > REST) at.push({ voice: 'lead', midi: degreeMidi(song.root, song.scale, lead[s]), steps: lengthAt(lead, s) });
      if (bass[b] > REST) at.push({ voice: 'bass', midi: degreeMidi(song.root - 24, song.scale, chord + bass[b]), steps: lengthAt(bass, b) });
      if (comp[b] > REST) {
        const len = lengthAt(comp, b);
        for (const d of tones) at.push({ voice: 'chord', midi: degreeMidi(song.root - 12, song.scale, chord + d), steps: len });
      }
      for (const v of ['kick', 'snare', 'hat'] as const) if (drums[v][b] === 0) at.push({ voice: v, midi: 0, steps: 1 });
      events.push(at);
    }
  }
  const stepsPerPass = events.length;
  const stepSec = 60 / song.bpm / 2;
  const totalSteps = stepsPerPass * song.passes;
  const mixes = Array.from({ length: song.passes }, (_, p) => passMix(p, song.passes, song.arrangement));
  return { song, stepsPerPass, totalSteps, stepSec, duration: totalSteps * stepSec, events, mixes };
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

/**
 * What plays in each pass. A breakdown (the default): the middle pass of three or more drops the melody and the snare.
 * A build: drums come in over the passes and the last of three or more lifts the melody. Sparse: pads first, then the
 * melody.
 */
export function passMix(pass: number, passes: number, arrangement: Arrangement = 'breakdown'): PassMix {
  if (arrangement === 'build') return { lead: true, kick: pass >= 1, hat: pass >= 1, snare: pass >= 2, lift: passes >= 3 && pass === passes - 1 };
  if (arrangement === 'sparse') return { lead: pass >= 1, kick: true, snare: true, hat: true, lift: false };
  const breakdown = passes >= 3 && pass === Math.floor(passes / 2);
  return { lead: !breakdown, kick: true, snare: !breakdown, hat: true, lift: false };
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
    mood: 'lofi',
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
  // ---------- the lo-fi and focus set: keys, soft drums, vinyl and tape ----------
  {
    id: 'refactor-rain',
    title: 'Refactor Rain',
    artist: 'Null & Void',
    bpm: 80,
    swing: 0.18,
    root: 65,
    scale: 'dorian',
    chords: [1, 4, 1, 4],
    ninths: true,
    lead: ". . 5 - - 4 3 - | 4 - - - . . . . | . . 3 - 5 - 7 - | 6 - - 5 4 - . .",
    bass: '1 - - . . 1 5, -',
    comp: 'x - - . . x - .',
    drums: { kick: 'x . . . . x x .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#7aa2c9',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2600, wobble: true, softDrums: true },
    sections: { B: { chords: [3, 7, 5, 4], lead: ". 3 - 5 - 7 - . | 2' - - 1' 7 - . . | . . 5 - 7 - 2' - | 1' - - 7 6 - 4 -" } },
    form: 'AABA',
  },
  {
    id: 'hello-world-sunrise',
    title: 'Hello, World (Sunrise)',
    artist: 'The First Commit',
    bpm: 98,
    swing: 0,
    root: 67,
    scale: 'major',
    chords: [1, 4, 6, 5],
    lead: "1 - 3 - 5 - 1' - | 6 - - - 4 - . . | 5 - 3 - 1 - 3 - | 2 - - - - - . .",
    bass: '1 - 1 - 5, - 1 -',
    comp: 'x - x - x - x -',
    drums: { kick: 'x . . . x . . .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'triangle', bass: 'triangle', chord: 'keys' },
    passes: 4,
    color: '#ffb703',
    mood: 'uplifting',
    sections: { B: { chords: [4, 5, 6, 5], lead: "4 - 6 - 1' - 6 - | 5 - 7 - 2' - 7 - | 1' - - 7 6 - 5 - | 5 - - - - - . ." } },
    form: 'AABB',
    arrangement: 'build',
  },
  {
    id: 'stack-trace-study-session',
    title: 'Stack Trace Study Session',
    artist: 'The Breakpoints',
    bpm: 72,
    swing: 0.22,
    root: 69,
    scale: 'minor',
    chords: [1, 6, 4, 7],
    ninths: true,
    lead: "5 - - - 3 - 1 - | . . 3 - 5 - 6 - | 4 - - - . . 2 3 | 5 - - - . . . .",
    bass: '1 - . 5, 1 - . .',
    comp: 'x - - - . x - -',
    drums: { kick: 'x . . x . . x .', snare: '. . x . . . x .', hat: '. x . x . x . x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#c9a27a',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2400, wobble: true, softDrums: true },
    sections: { B: { chords: [4, 7, 3, 6], lead: ". 6 - 5 4 - 3 - | 2 - - - 7, - . . | . . 3 - 5 - 1' - | 7 - - 6 5 - - ." } },
    form: 'AABA',
  },
  {
    id: 'deep-work',
    title: 'Deep Work (Do Not Disturb)',
    artist: 'Focus Mode',
    bpm: 64,
    swing: 0,
    root: 64,
    scale: 'major',
    chords: [1, 4, 6, 4],
    sevenths: true,
    lead: ". . 5 - - - - - | 6 - - - . . . . | . . 3 - - - 1 - | 2 - - - - - . .",
    bass: '1 - - - - - - -',
    comp: 'x - - - - - - -',
    drums: { kick: '. . . . . . . .', snare: '. . . . . . . .', hat: '. . . . . . . .' },
    sound: { lead: 'keys', bass: 'sine', chord: 'pad' },
    passes: 3,
    color: '#94d2bd',
    mood: 'ambient',
    texture: { warmth: 2200, wobble: true },
    sections: { B: { chords: [2, 5, 1, 1], lead: ". . 4 - - - 6 - | 5 - - - - - . . | . . 3 - - 2 1 - | 1 - - - - - - -" } },
    form: 'AABA',
    arrangement: 'sparse',
  },
  {
    id: 'async-afternoon',
    title: 'Async Afternoon',
    artist: 'The Promises',
    bpm: 84,
    swing: 0.15,
    root: 70,
    scale: 'major',
    chords: [2, 5, 1, 1],
    sevenths: true,
    lead: ". . 4 - 6 - 1' - | 7 - - 6 - - 4 - | 3 - - - . . . . | . . 5 - 3 - 2 -",
    bass: '1 - - 5, . 1 - .',
    comp: '. . x - . . x -',
    drums: { kick: 'x . . . x x . .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#e5989b',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2900, wobble: true, softDrums: true },
    sections: { B: { chords: [4, 3, 2, 5], lead: "1' - - - 6 - 4 - | 5 - - - . 3 5 - | 6 - - 5 4 - . . | 2 - - - 5, - . ." } },
    form: 'AABA',
  },
  {
    id: 'it-compiles',
    title: 'It Compiles!',
    artist: 'Zero Warnings',
    bpm: 104,
    swing: 0,
    root: 65,
    scale: 'major',
    chords: [1, 6, 2, 5],
    lead: "3 - 5 - 1' - - 7 | 6 - - - . . 5 6 | 4 - - 2 - 4 6 - | 5 - - - . . . .",
    bass: '1 . 1 1 5, . 1 .',
    comp: 'x - . x - . x -',
    drums: { kick: 'x . . x x . . .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'triangle', bass: 'triangle', chord: 'keys' },
    passes: 4,
    color: '#90be6d',
    mood: 'uplifting',
    sections: {
      B: {
        chords: [4, 4, 1, 1, 4, 4, 5, 5],
        lead: "4 . 6 . 1' . 6 . | 1' - - - 2' - 1' - | 3' - - - 2' - 1' - | 5 - - - . . . . | 4 . 6 . 1' . 2' . | 3' - - 2' - - 1' - | 2' - - - 7 - 5 - | 2' - - - - - . .",
      },
    },
    form: 'AAB',
    arrangement: 'build',
  },
  {
    id: 'tabs-and-spaces',
    title: 'Tabs & Spaces',
    artist: 'Whitespace Club',
    bpm: 86,
    swing: 0.25,
    root: 62,
    scale: 'dorian',
    chords: [1, 4, 1, 4],
    ninths: true,
    lead: "1' . 7 . 5 - . . | . . 4 - 5 - 6 - | 5 - - - 3 - 1 - | 2 - - - . . . .",
    bass: '1 - . 5, - . 1 .',
    comp: 'x - . . x - . .',
    drums: { kick: 'x . . x . . x .', snare: '. . x . . . x .', hat: 'x . x x x . x x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#83c5be',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2800, wobble: true, softDrums: true },
    sections: { B: { chords: [3, 4, 5, 4], lead: ". . 3 - 5 - 7 - | 6 - - - 4 - 2 - | 5 - - 7 - 1' - . | 4 - - - . . 7, -" } },
    form: 'AABA',
  },
  {
    id: 'background-process',
    title: 'Background Process',
    artist: 'Daemon & the Threads',
    bpm: 70,
    swing: 0,
    root: 62,
    scale: 'dorian',
    chords: [1, 4, 1, 4],
    sevenths: true,
    lead: "5 - - - - - . . | . . . . 6 - 5 - | 3 - - - - - . . | . . 1 - 2 - - -",
    bass: '1 - - - - - 5, -',
    comp: 'x - - - - - - -',
    drums: { kick: 'x . . . . . . .', snare: '. . . . . . . .', hat: '. . . . . . . .' },
    sound: { lead: 'keys', bass: 'sine', chord: 'pad' },
    passes: 3,
    color: '#a2d2ff',
    mood: 'ambient',
    texture: { warmth: 2000, wobble: true, softDrums: true },
    sections: { B: { chords: [3, 7, 5, 4], lead: ". . 3 - 5 - - - | 7 - - - - - . . | . . 1' - 7 - 5 - | 4 - - - - - - -" } },
    form: 'AABA',
    arrangement: 'sparse',
  },
  {
    id: 'pair-programming-by-the-window',
    title: 'Pair Programming by the Window',
    artist: 'Two Keyboards',
    bpm: 76,
    swing: 0.2,
    root: 65,
    scale: 'major',
    chords: [4, 3, 2, 1],
    sevenths: true,
    lead: ". . 6 - 5 - 4 - | 3 - - - . . 5 - | 4 - - 3 2 - . . | 1 - - - . . . .",
    bass: '1 - - - 5, - - .',
    comp: 'x - - - x - . .',
    drums: { kick: 'x . . . . . x .', snare: '. . x . . . x .', hat: 'x x x x x x x x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#b5838d',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2500, wobble: true, softDrums: true },
    sections: { B: { chords: [6, 2, 5, 1], lead: ". 1' - 7 6 - 5 - | 4 - - - 6 - 1' - | 7 - - - 5 - 2 - | 3 - - - . . . ." } },
    form: 'AABA',
  },
  {
    id: 'full-coverage',
    title: '100% Coverage',
    artist: 'The Test Suite',
    bpm: 108,
    swing: 0,
    root: 64,
    scale: 'major',
    chords: [4, 5, 3, 6],
    lead: "4 - 6 - 1' - 6 - | 5 - 7 - 2' - - . | 3 - 5 - 7 - 5 - | 6 - - - 1' - 3' -",
    bass: '1 . 1 . 1 . 5, .',
    comp: 'x - - x - - x -',
    drums: { kick: 'x . . . x . . .', snare: '. . x . . . x .', hat: '. x . x . x . x' },
    sound: { lead: 'triangle', bass: 'triangle', chord: 'keys' },
    passes: 4,
    color: '#f9c74f',
    mood: 'uplifting',
    sections: { B: { chords: [2, 5, 1, 1], lead: "2' - - 1' 6 - 4 - | 5 - - - 7 - 2' - | 3' - - - 2' - 1' - | 1' - - - - - . ." } },
    form: 'AABA',
    arrangement: 'build',
  },
  {
    id: 'late-night-code-review',
    title: 'Late Night Code Review',
    artist: 'LGTM',
    bpm: 70,
    swing: 0.2,
    root: 67,
    scale: 'minor',
    chords: [1, 4, 7, 3],
    ninths: true,
    lead: "5 - - - . 4 3 - | 4 - - - . . . . | . . 2 - 4 - 6 - | 5 - - - 3 - . .",
    bass: '1 - - - 1 . 5, .',
    comp: 'x - - - - - x -',
    drums: { kick: 'x . . . . x . .', snare: '. . x . . . x .', hat: 'x . x . x . x x' },
    sound: { lead: 'keys', bass: 'triangle', chord: 'keys' },
    passes: 3,
    color: '#8d86c9',
    mood: 'lofi',
    texture: { crackle: true, warmth: 2400, wobble: true, softDrums: true },
    sections: { B: { chords: [6, 4, 2, 7], lead: ". . 3 - 5 - 7 - | 1' - - 7 6 - . . | . . 4 - 6 - 1' - | 6 - - - 4 - 2 -" } },
    form: 'AABA',
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

// ---------- stations ----------

/** All: every song, lo-fi and lively mixed. Focus: the lo-fi and ambient songs only. */
export type Station = 'all' | 'focus';

export const moodOf = (s: Song): Mood => s.mood ?? 'lively';
export const isFocusSong = (s: Song) => moodOf(s) === 'lofi' || moodOf(s) === 'ambient';

/** A saved station: anything but 'focus' (missing, old or corrupt) is All. */
export const parseStation = (raw: unknown): Station => (raw === 'focus' ? 'focus' : 'all');

/**
 * A station's running order, as indices into `songs`. Focus keeps the playlist's order. All spreads the calm songs
 * (lo-fi and ambient) evenly through the lively ones, starting from the first song, so neither kind comes in a clump.
 */
export function stationOrder(songs: readonly Song[], station: Station): number[] {
  const calm: number[] = [];
  const lively: number[] = [];
  songs.forEach((s, i) => (isFocusSong(s) ? calm : lively).push(i));
  if (station === 'focus') return calm;
  const out: number[] = [];
  let c = 0;
  let l = 0;
  while (c < calm.length || l < lively.length) {
    // Whichever kind is furthest behind its fair share goes next.
    const cAt = c < calm.length ? (c + 0.5) / calm.length : Infinity;
    const lAt = l < lively.length ? (l + 0.5) / lively.length : Infinity;
    if (cAt < lAt) out.push(calm[c++]);
    else out.push(lively[l++]);
  }
  // It's a loop, so turn it round to start on the first song.
  const start = Math.max(0, out.indexOf(0));
  return [...out.slice(start), ...out.slice(0, start)];
}

const ORDERS: Record<Station, number[]> = { all: stationOrder(SONGS, 'all'), focus: stationOrder(SONGS, 'focus') };

/** The station's songs in the order they play, as indices into SONGS. */
export const stationSongs = (station: Station): readonly number[] => ORDERS[station];

/**
 * The song after `current` (an index into SONGS) on `station`: the next in its order, or, when `current` isn't on that
 * station (Focus switched on during a lively song), the next song going round the All order that is.
 */
export function nextSong(current: number, station: Station): number {
  const list = ORDERS[station];
  if (list.length === 0) return current;
  const i = list.indexOf(current);
  if (i >= 0) return list[(i + 1) % list.length];
  const all = ORDERS.all;
  const from = Math.max(0, all.indexOf(current));
  for (let k = 1; k <= all.length; k++) {
    const s = all[(from + k) % all.length];
    if (list.includes(s)) return s;
  }
  return list[0];
}

/** Each floor starts on a different song (the lobby is floor 0): on All, song `floor` of the playlist; on Focus, of the focus songs. */
export function firstSongFor(floor: number, station: Station = 'all'): number {
  if (station === 'all') return ((floor % SONGS.length) + SONGS.length) % SONGS.length;
  const list = ORDERS.focus;
  return list[((floor % list.length) + list.length) % list.length];
}
