// The voice settings' pure parts: how a voice is described, which voices match a search, the browser's voices in a
// stable order, and how loud a preview plays under the master volume and mute.
import type { VoiceOption } from '../../../shared/types';
import { sliderGain, type AudioPrefs } from './audioPrefs';

/** A voice's labels as one short line, e.g. "american · female · middle aged · conversational". */
export function voiceLabels(v: VoiceOption): string {
  const l: Partial<VoiceOption['labels']> = v.labels ?? {};
  return [l.accent, l.gender, l.age, l.use_case]
    .map((x) => (typeof x === 'string' ? x.replace(/_/g, ' ').trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

/** The voices matching every word of `query` (name, description, labels), split into the shortlist and the rest. */
export function searchVoices(list: readonly VoiceOption[], query: string): { recommended: VoiceOption[]; others: VoiceOption[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = list.filter((v) => {
    const text = `${v.name} ${v.labels?.description ?? ''} ${voiceLabels(v)} ${v.category}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  return { recommended: hits.filter((v) => v.recommended), others: hits.filter((v) => !v.recommended) };
}

/** What the settings need of a speechSynthesis voice. */
export interface BrowserVoice {
  name: string;
  lang: string;
}

/** The browser's voices once each: those in the page's language first, then by language and name. */
export function browserVoices(voices: readonly BrowserVoice[], pageLang = 'en'): BrowserVoice[] {
  const base = (lang: string) => lang.toLowerCase().split(/[-_]/)[0];
  const mine = base(pageLang);
  const seen = new Set<string>();
  const out: BrowserVoice[] = [];
  for (const v of voices) {
    if (!v?.name || seen.has(v.name)) continue;
    seen.add(v.name);
    out.push({ name: v.name, lang: v.lang ?? '' });
  }
  return out.sort((a, b) => Number(base(b.lang) === mine) - Number(base(a.lang) === mine) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

/** How loud a preview or test plays (0-1): the master volume's gain, or nothing while muted (M). */
export const playbackVolume = (p: Pick<AudioPrefs, 'volume' | 'muted'>) => (p.muted ? 0 : sliderGain(p.volume));
