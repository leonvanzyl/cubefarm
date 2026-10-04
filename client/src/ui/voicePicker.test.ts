import { describe, expect, it } from 'vitest';
import type { VoiceOption } from '../../../shared/types';
import { browserVoices, playbackVolume, searchVoices, voiceLabels } from './voicePicker';

const voice = (name: string, labels: Partial<VoiceOption['labels']>, recommended = false): VoiceOption => ({
  id: `${name}Id`,
  name,
  category: 'premade',
  labels: { accent: '', gender: '', age: '', description: '', use_case: '', ...labels },
  previewUrl: null,
  recommended,
});

const talia = voice('Talia', { description: 'warm soft guide', use_case: 'conversational' }, true);
const basil = voice('Basil', { accent: 'british', gender: 'male', age: 'middle_aged', description: 'warm', use_case: 'narration' });
const cleo = voice('Cleo', { accent: 'australian', gender: 'female', age: 'young', description: 'friendly', use_case: 'conversational' });

describe('voiceLabels', () => {
  it('joins accent, gender, age and use case, skipping blanks', () => {
    expect(voiceLabels(basil)).toBe('british · male · middle aged · narration');
    expect(voiceLabels(talia)).toBe('conversational');
  });

  it('copes with missing labels', () => {
    expect(voiceLabels({ ...talia, labels: undefined as unknown as VoiceOption['labels'] })).toBe('');
  });
});

describe('searchVoices', () => {
  const list = [talia, basil, cleo];

  it('keeps the shortlist apart, in the list order', () => {
    expect(searchVoices(list, '')).toEqual({ recommended: [talia], others: [basil, cleo] });
  });

  it('matches every word against the name, description and labels, ignoring case', () => {
    expect(searchVoices(list, 'WARM').recommended).toEqual([talia]);
    expect(searchVoices(list, 'warm').others).toEqual([basil]);
    expect(searchVoices(list, 'female young').others).toEqual([cleo]);
    expect(searchVoices(list, 'middle aged').others).toEqual([basil]);
    expect(searchVoices(list, 'cleo british')).toEqual({ recommended: [], others: [] });
  });
});

describe('browserVoices', () => {
  it("lists each voice once, the page's language first", () => {
    const voices = [
      { name: 'Hortense', lang: 'fr-FR' },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Zira', lang: 'en-US' },
      { name: 'David', lang: 'en-US' },
      { name: 'Zira', lang: 'en-US' },
    ];
    expect(browserVoices(voices, 'en-US').map((v) => v.name)).toEqual(['Google UK English Female', 'David', 'Zira', 'Hortense']);
    expect(browserVoices(voices, 'fr').map((v) => v.name)[0]).toBe('Hortense');
  });

  it('skips nameless voices', () => {
    expect(browserVoices([{ name: '', lang: 'en' }])).toEqual([]);
  });
});

describe('playbackVolume', () => {
  it('follows the master volume and is silent while muted', () => {
    expect(playbackVolume({ volume: 100, muted: false })).toBe(1);
    expect(playbackVolume({ volume: 50, muted: false })).toBeCloseTo(0.25);
    expect(playbackVolume({ volume: 100, muted: true })).toBe(0);
  });
});
