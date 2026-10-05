import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, cleanStyle } from './looks.ts';

describe('cleanStyle', () => {
  it('keeps valid picks', () => {
    const s = { hair: 'bob', hairColor: '#AA00ff', skin: '#5c3a21', facialHair: 'beard', glasses: 'round', headwear: 'cap', outfit: 'cardigan', accent: 3, build: 'broad' };
    expect(cleanStyle(s)).toEqual({ ...s, hairColor: '#aa00ff' });
  });

  it('drops unknown keys and values that are not options, so those parts stay seeded', () => {
    expect(cleanStyle({ hair: 'mullet', outfit: 'tee', accent: ACCENT_COLORS.length, build: 'huge', skin: 'red', extra: 1 })).toEqual({ outfit: 'tee' });
    expect(cleanStyle({ accent: 1.5, hairColor: '#12345' })).toBeNull();
    expect(cleanStyle({ accent: 0 })).toEqual({ accent: 0 });
  });

  it('treats anything that is not a plain object as no picks', () => {
    for (const raw of [null, undefined, 'bob', 3, [], ['hair']]) expect(cleanStyle(raw)).toBeNull();
    expect(cleanStyle({})).toBeNull();
  });
});
