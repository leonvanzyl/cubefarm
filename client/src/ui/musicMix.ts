// The jukebox's volume levels and the music's ducking, as pure numbers and curves (no WebAudio, so they're unit
// tested): how loud each level is up close, how gently it falls off across the floor, and how far the music dips
// under the office's alerts and how it comes back.

/** One step of the jukebox's volume knob. */
export interface MusicLevel {
  /** The band's gain at this level, relative to the old fixed level (1). */
  gain: number;
  /** Full volume up to this distance (metres), then the inverse distance model with `rolloff`. */
  ref: number;
  rolloff: number;
  /** Not played beyond this many metres; it fades out over the last EDGE metres before it. */
  reach: number;
}

/** Quiet background (1) up to music that fills the whole floor (6). The old fixed level sits between 1 and 2. */
export const MUSIC_LEVELS: readonly MusicLevel[] = [
  { gain: 0.7, ref: 1.5, rolloff: 2, reach: 14 },
  { gain: 1.2, ref: 1.5, rolloff: 1.6, reach: 16 },
  { gain: 1.8, ref: 2, rolloff: 1.1, reach: 20 },
  { gain: 2.4, ref: 2.5, rolloff: 0.7, reach: 26 },
  { gain: 3, ref: 3, rolloff: 0.45, reach: 34 },
  { gain: 3.6, ref: 4, rolloff: 0.25, reach: 46 },
];

export const MAX_MUSIC_LEVEL = MUSIC_LEVELS.length;
export const DEFAULT_MUSIC_LEVEL = 3;
/** Metres over which the music fades out before its reach. */
export const EDGE = 3;

/** Any value as a level from 1 to MAX_MUSIC_LEVEL (the default when it isn't a number). */
export function clampMusicLevel(n: unknown): number {
  const v = typeof n === 'number' ? n : typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN;
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_MUSIC_LEVEL, Math.round(v))) : DEFAULT_MUSIC_LEVEL;
}

export const musicLevel = (level: number) => MUSIC_LEVELS[clampMusicLevel(level) - 1];

/** The inverse distance model at this level (what its PannerNode does), 1 up close. */
export function musicFalloff(level: number, d: number) {
  const { ref, rolloff, reach } = musicLevel(level);
  return ref / (ref + rolloff * (Math.min(Math.max(d, ref), reach) - ref));
}

/** The fade over the last EDGE metres before the level's reach: 1 well inside it, 0 beyond. */
export function musicEdge(level: number, d: number) {
  return Math.max(0, Math.min(1, (musicLevel(level).reach - d) / EDGE));
}

/** The music's loudness `d` metres from the jukebox at this level, relative to the old fixed level up close. */
export const musicGainAt = (level: number, d: number) => musicLevel(level).gain * musicFalloff(level, d) * musicEdge(level, d);

// ---------- ducking ----------

/** How far the music dips under an alert (dB) and as a gain. */
export const DUCK_DB = -10;
export const DUCK_GAIN = 10 ** (DUCK_DB / 20);
/** Time constants (setTargetAtTime) of the dip and of the way back. */
export const DUCK_ATTACK = 0.03;
export const DUCK_RELEASE = 0.4;
/** The longest a single sound holds the music down: a gong's long tail is quiet by then. */
export const DUCK_HOLD_MAX = 2.5;

/** How long a sound `dur` seconds long holds the music down. */
export const duckHold = (dur: number) => Math.min(Math.max(0, dur), DUCK_HOLD_MAX);

/** The duck's gain `t` seconds after a sound that holds it for `hold` seconds starts: the curves music.ts schedules. */
export function duckGainAt(t: number, hold: number) {
  if (t < 0) return 1;
  const down = (x: number) => DUCK_GAIN + (1 - DUCK_GAIN) * Math.exp(-x / DUCK_ATTACK);
  if (t < hold) return down(t);
  return 1 + (down(hold) - 1) * Math.exp(-(t - hold) / DUCK_RELEASE);
}
