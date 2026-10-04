// The adaptive score's decisions as pure functions (no WebAudio, so they're unit tested): what the floor is up to, which
// mood that makes (with a little hysteresis, so it doesn't flap), when a merge's sting may play (after the gong) and
// how big, and what each mood plays bar by bar. score.ts schedules it on bar lines.

export type ScoreMood = 'calm' | 'busy' | 'tension' | 'night';
export const SCORE_MOODS: readonly ScoreMood[] = ['calm', 'busy', 'tension', 'night'];

/** What the floor is up to (every floor, from the lobby). */
export interface OfficeState {
  /** Agents working (or setting up to). */
  working: number;
  /** A red CI on an open PR, or a PR that needs the manager. */
  red: boolean;
}

/** Busy from this many agents working, and until it drops below BUSY_OFF. */
export const BUSY_ON = 3;
export const BUSY_OFF = 2;
/** Night from this much night (sky/time.ts's nightFactor, 0-1), and until it drops below NIGHT_OFF. */
export const NIGHT_ON = 0.6;
export const NIGHT_OFF = 0.4;

/** The mood for the floor's state and the night (0-1), given the mood it's in now (null at first). Tension wins. */
export function scoreMood(s: OfficeState, night: number, prev: ScoreMood | null): ScoreMood {
  if (s.red) return 'tension';
  if (s.working >= BUSY_ON || (prev === 'busy' && s.working >= BUSY_OFF)) return 'busy';
  if (night >= NIGHT_ON || (prev === 'night' && night >= NIGHT_OFF)) return 'night';
  return 'calm';
}

/** The `?mood=` override for QA: a mood, 'triumph' (the office's own mood, with a sting every four bars), or null for none. */
export function parseMoodParam(search: string): ScoreMood | 'triumph' | null {
  const m = new URLSearchParams(search).get('mood');
  return m === 'triumph' || (SCORE_MOODS as readonly string[]).includes(m ?? '') ? (m as ScoreMood | 'triumph') : null;
}

interface AgentLike {
  repoId: string;
  role: string;
  status: string;
}
interface RepoLike {
  id: string;
  pulls: readonly { state: string; checks: string }[];
}
interface QaLike {
  repoId: string;
  status: string;
}

/** The floor's state from the store's agents, repos and QA records: `repoId`'s floor, or every floor (the lobby, null). */
export function officeState(repoId: string | null, agents: Record<string, AgentLike>, repos: readonly RepoLike[], qa: Record<string, QaLike>): OfficeState {
  const here = (id: string) => repoId === null || id === repoId;
  let working = 0;
  for (const a of Object.values(agents)) if (a.role !== 'ceo' && here(a.repoId) && (a.status === 'working' || a.status === 'preparing')) working++;
  const failing = repos.some((r) => here(r.id) && r.pulls.some((p) => p.state === 'OPEN' && p.checks === 'failing'));
  const stuck = Object.values(qa).some((q) => here(q.repoId) && q.status === 'needs-human');
  return { working, red: failing || stuck };
}

// ---------- the merge sting ----------

/** Seconds after a gong strike before the sting may play: its boom has died down by then. */
export const GONG_CLEAR = 4.5;
/** This many merges inside STREAK_WINDOW seconds is a streak: a bigger sting. */
export const STREAK = 3;
export const STREAK_WINDOW = 600;

/** The merges (times in s) still inside the streak window at `now`. */
export const recentMerges = (merges: readonly number[], now: number) => merges.filter((t) => now - t <= STREAK_WINDOW);

/** Whether the merges at these times (s) make a streak at `now`. */
export const onStreak = (merges: readonly number[], now: number) => recentMerges(merges, now).length >= STREAK;

/** The bar line a sting for a strike at `strike` plays on: the first at or after the gong has cleared, bars `barSec` long from `nextBar`. */
export function stingBarAt(strike: number, nextBar: number, barSec: number): number {
  const due = strike + GONG_CLEAR;
  if (due <= nextBar) return nextBar;
  return nextBar + Math.ceil((due - nextBar) / barSec - 1e-9) * barSec;
}

// ---------- what plays ----------

/** One note of the score: its part, pitch (MIDI), when (beats into the bar), how long (beats) and how loud (0-1). */
export interface ScoreNote {
  part: 'pad' | 'keys' | 'bass' | 'ostinato';
  midi: number;
  at: number;
  len: number;
  level: number;
}

/** Each mood's bar: its tempo, minor or major, its layers, a bell note every `bell` bars (2 or 4; 0 never) and the pads' level. */
export interface MoodBar {
  bpm: number;
  minor: boolean;
  bass: boolean;
  pulse: boolean;
  ostinato: boolean;
  bell: number;
  pads: number;
}

export const MOOD_BARS: Record<ScoreMood, MoodBar> = {
  calm: { bpm: 64, minor: false, bass: true, pulse: false, ostinato: false, bell: 2, pads: 1 },
  busy: { bpm: 64, minor: false, bass: true, pulse: true, ostinato: false, bell: 4, pads: 0.9 },
  tension: { bpm: 64, minor: true, bass: false, pulse: false, ostinato: true, bell: 0, pads: 0.85 },
  night: { bpm: 52, minor: false, bass: false, pulse: false, ostinato: false, bell: 4, pads: 0.7 },
};

export const barSeconds = (mood: ScoreMood) => (4 * 60) / MOOD_BARS[mood].bpm;

// Four chords a bar each, round and round, in D: Dmaj7, Bm7, Gmaj7/D, A add9; under tension D minor's Dm9, Bbmaj7,
// Gm6 and A7. Close voicings around D3, so changing mood mid-progression only moves a note or two.
const MAJOR = [
  [50, 54, 57, 61],
  [47, 50, 54, 57],
  [50, 55, 59, 66],
  [52, 57, 59, 61],
];
const MINOR = [
  [50, 53, 57, 64],
  [46, 50, 53, 57],
  [50, 55, 58, 64],
  [49, 52, 55, 57],
];
const MAJOR_ROOTS = [38, 35, 43, 45];
const MINOR_ROOTS = [38, 34, 43, 45];
/** The low ostinato under tension, in eighths from the chord's root. */
const OSTINATO = [0, 12, 7, 12, 0, 12, 7, 10];

/** What mood `mood` plays in bar `bar` (counted from the score's start, so the progression carries across moods). */
export function scoreBar(mood: ScoreMood, bar: number): ScoreNote[] {
  const m = MOOD_BARS[mood];
  const i = ((bar % 4) + 4) % 4;
  const chord = (m.minor ? MINOR : MAJOR)[i];
  const root = (m.minor ? MINOR_ROOTS : MAJOR_ROOTS)[i];
  const notes: ScoreNote[] = chord.map((midi) => ({ part: 'pad', midi, at: 0, len: 4, level: m.pads }));
  if (m.bass) notes.push({ part: 'bass', midi: root, at: 0, len: 4, level: 0.8 });
  if (m.pulse) for (let k = 0; k < 8; k++) notes.push({ part: 'keys', midi: chord[2 + (k % 2)] + 12, at: k / 2, len: 0.4, level: k % 2 ? 0.3 : 0.45 });
  if (m.ostinato) OSTINATO.forEach((o, k) => notes.push({ part: 'ostinato', midi: root + o, at: k / 2, len: 0.42, level: k % 4 === 0 ? 0.9 : 0.6 }));
  if (m.bell && i % m.bell === m.bell - 1) notes.push({ part: 'keys', midi: chord[3] + 12, at: 1, len: 2.5, level: 0.6 });
  return notes;
}

/**
 * The triumph sting after a merge, in beats from its bar line: a rising arpeggio landing on a bright D major chord. On
 * a streak it climbs two octaves and lands on a bigger chord over the bass.
 */
export function stingNotes(big: boolean): ScoreNote[] {
  const climb = big ? [62, 66, 69, 74, 78, 81, 86] : [62, 66, 69, 74];
  const step = big ? 0.25 : 0.33;
  const notes: ScoreNote[] = climb.map((midi, k) => ({ part: 'keys', midi, at: k * step, len: 2, level: 0.55 + (0.4 * k) / climb.length }));
  const land = climb.length * step;
  for (const midi of big ? [50, 57, 62, 66, 69, 74] : [57, 62, 66, 69]) notes.push({ part: 'pad', midi, at: land, len: big ? 4 : 3, level: 1 });
  if (big) notes.push({ part: 'bass', midi: 38, at: land, len: 4, level: 0.9 });
  return notes;
}
