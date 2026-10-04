// The saved sound settings (localStorage `cubefarm:audio`): master volume, mute and one level per
// sound group. Pure, so loading old or corrupt values is tested without a browser.

/** Each group has its own gain between its sounds and the master volume. */
export const SOUND_GROUPS = ['steps', 'typing', 'toys', 'alerts', 'music', 'voice'] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

export interface AudioPrefs extends Record<SoundGroup, number> {
  volume: number; // 0-100
  muted: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { volume: 70, muted: false, steps: 100, typing: 100, toys: 100, alerts: 100, music: 100, voice: 100 };

/** A 0-100 percentage, or the fallback when it's missing, not a number or out of range. */
function percent(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : fallback;
}

/** Any saved value (older `{ volume, muted }` included) as complete, in-range prefs. */
export function normalizeAudioPrefs(raw: unknown): AudioPrefs {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefs: AudioPrefs = { ...DEFAULT_AUDIO_PREFS, volume: percent(p.volume, DEFAULT_AUDIO_PREFS.volume), muted: p.muted === true };
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
