// The saved sound settings (localStorage `cubefarm:audio`): master volume, mute, one level per sound group and how
// much the agents chat. Pure, so loading old or corrupt values is tested without a browser.

/**
 * Each group has its own gain between its sounds and the master volume. 'score' is the adaptive soundtrack, 'babble'
 * the agents' chatter voices.
 */
export const SOUND_GROUPS = ['steps', 'typing', 'babble', 'toys', 'alerts', 'music', 'voice', 'outside', 'score'] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

/** How much the agents say out loud (speech bubbles about their work): nothing, now and then, or a lot. */
export const CHATTER_LEVELS = ['off', 'quiet', 'lively'] as const;
export type ChatterLevel = (typeof CHATTER_LEVELS)[number];

export interface AudioPrefs extends Record<SoundGroup, number> {
  volume: number; // 0-100
  muted: boolean;
  soundtrack: boolean; // the adaptive score on or off
  chatter: ChatterLevel;
  silentBubbles: boolean; // chatter shows its bubbles without the babble voices
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  volume: 70,
  muted: false,
  soundtrack: true,
  chatter: 'quiet',
  silentBubbles: false,
  steps: 100,
  typing: 100,
  babble: 100,
  toys: 100,
  alerts: 100,
  music: 100,
  voice: 100,
  outside: 100,
  score: 30,
};

/** A 0-100 percentage, or the fallback when it's missing, not a number or out of range. */
function percent(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : fallback;
}

/** Any saved value (older `{ volume, muted }` included) as complete, in-range prefs. */
export function normalizeAudioPrefs(raw: unknown): AudioPrefs {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefs: AudioPrefs = {
    ...DEFAULT_AUDIO_PREFS,
    volume: percent(p.volume, DEFAULT_AUDIO_PREFS.volume),
    muted: p.muted === true,
    soundtrack: p.soundtrack !== false,
    chatter: CHATTER_LEVELS.includes(p.chatter as ChatterLevel) ? (p.chatter as ChatterLevel) : DEFAULT_AUDIO_PREFS.chatter,
    silentBubbles: p.silentBubbles === true,
  };
  for (const g of SOUND_GROUPS) prefs[g] = percent(p[g], DEFAULT_AUDIO_PREFS[g]);
  return prefs;
}

/** The prefs saved as JSON text (null when nothing is saved). */
export function parseAudioPrefs(text: string | null): AudioPrefs {
  try {
    return normalizeAudioPrefs(JSON.parse(text ?? 'null'));
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

/** Perceived loudness is roughly logarithmic, so a 0-100 slider maps to a squared 0-1 gain. */
export const sliderGain = (pct: number) => (pct / 100) ** 2;
