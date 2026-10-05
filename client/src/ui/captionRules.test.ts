import { describe, expect, it } from 'vitest';
import { admitCaption, arrowFor, arrowForPan, captionFor, captionTail, estimateSpeechMs, GATE, newCaptionGate, spokenChars, withArrow, wordEnd } from './captionRules';

describe('captionFor', () => {
  it('captions the important sounds, short and in brackets', () => {
    expect(captionFor('gong')?.text).toBe('[gong]');
    expect(captionFor('cheer:crowd')?.text).toBe('[merge cheer]');
    expect(captionFor('cheer:woo')?.text).toBe('[merge cheer]');
    expect(captionFor('thunder')?.text).toBe('[thunder]');
    expect(captionFor('weather:thunder')?.text).toBe('[thunder]');
    expect(captionFor('event:roar')?.text).toBe('[kaiju roars]');
    expect(captionFor('alarm', 'PR #212 needs you')?.text).toBe('[alarm: PR #212 needs you]');
    expect(captionFor('alarm')?.text).toBe('[alarm]');
    expect(captionFor('jukebox:refactor-rain', 'Refactor Rain')?.text).toBe('[jukebox: Refactor Rain]');
    expect(captionFor('cue:merged')?.text).toBe('[merge chime]');
  });

  it('leaves constant and small sounds alone', () => {
    for (const name of ['step', 'typing', 'tone', 'noise', 'boop', 'roomba:chirp', 'jukebox-button', 'jukebox-volume', 'mug-sip', 'room:office', 'door:open', 'score:calm', 'chair:roll'])
      expect(captionFor(name)).toBeNull();
  });

  it('shares a key between the parts of one sound, and keeps songs apart', () => {
    expect(captionFor('cheer:woo')?.key).toBe(captionFor('cheer:crowd')?.key);
    expect(captionFor('jukebox:a')?.key).not.toBe(captionFor('jukebox:b')?.key);
  });

  it('ranks alarms above events above ambience', () => {
    expect(captionFor('alarm')?.priority).toBe(3);
    expect(captionFor('cue:error')?.priority).toBe(3);
    expect(captionFor('gong')?.priority).toBe(2);
    expect(captionFor('jukebox:x')?.priority).toBe(1);
    expect(captionFor('thunder')?.priority).toBe(1);
  });
});

describe('admitCaption', () => {
  it('shows a sound made of many parts once', () => {
    const g = newCaptionGate();
    const gong = captionFor('gong')!;
    const shown = Array.from({ length: 12 }, () => admitCaption(g, gong, 1000)).filter(Boolean);
    expect(shown).toHaveLength(1);
  });

  it('repeats a sound only after its cooldown', () => {
    const g = newCaptionGate();
    const gong = captionFor('gong')!;
    expect(admitCaption(g, gong, 0)).toBe(true);
    expect(admitCaption(g, gong, gong.cooldownMs - 1)).toBe(false);
    expect(admitCaption(g, gong, gong.cooldownMs)).toBe(true);
  });

  it('never gets spammy: a burst of ten merges shows a handful of captions', () => {
    const g = newCaptionGate();
    let shown = 0;
    for (let i = 0; i < 10; i++) {
      const t = i * 500;
      for (const name of ['gong', 'cheer:crowd', 'cue:merged']) if (admitCaption(g, captionFor(name)!, t)) shown++;
    }
    expect(shown).toBeLessThanOrEqual(GATE.max);
  });

  it('keeps ambient captions to a trickle, but always lets an alarm through', () => {
    const g = newCaptionGate();
    expect(admitCaption(g, captionFor('gong')!, 0)).toBe(true);
    expect(admitCaption(g, captionFor('cheer:crowd')!, 10)).toBe(true);
    expect(admitCaption(g, captionFor('jukebox:a', 'A')!, 20)).toBe(false);
    for (let i = 0; i < GATE.max; i++) admitCaption(g, { key: `e${i}`, text: 'x', priority: 2, cooldownMs: 0 }, 30);
    expect(admitCaption(g, captionFor('alarm', 'PR #1 needs you')!, 40)).toBe(true);
  });

  it('frees up the cap once the window has passed', () => {
    const g = newCaptionGate();
    for (let i = 0; i < GATE.max; i++) expect(admitCaption(g, { key: `e${i}`, text: 'x', priority: 2, cooldownMs: 0 }, 0)).toBe(true);
    expect(admitCaption(g, captionFor('gong')!, 100)).toBe(false);
    expect(admitCaption(g, captionFor('gong')!, GATE.windowMs)).toBe(true);
  });
});

describe('arrowFor', () => {
  it('points where the sound is from the listener', () => {
    expect(arrowFor(0, 5)).toBe('↑');
    expect(arrowFor(5, 0)).toBe('→');
    expect(arrowFor(0, -5)).toBe('↓');
    expect(arrowFor(-5, 0)).toBe('←');
    expect(arrowFor(3, 3)).toBe('↗');
    expect(arrowFor(-3, -3)).toBe('↙');
    expect(arrowFor(3, -3)).toBe('↘');
    expect(arrowFor(-3, 3)).toBe('↖');
  });

  it('points left or right for a sound that is only panned (thunder)', () => {
    expect(arrowForPan(-0.4)).toBe('←');
    expect(arrowForPan(0.4)).toBe('→');
    expect(arrowForPan(0.1)).toBe('');
  });

  it('has no arrow for a sound right beside you', () => {
    expect(arrowFor(0.3, 0.2)).toBe('');
  });

  it('puts the arrow on the side the sound is on', () => {
    expect(withArrow('[gong]', '←')).toBe('← [gong]');
    expect(withArrow('[gong]', '↗')).toBe('[gong] ↗');
    expect(withArrow('[gong]', '')).toBe('[gong]');
  });
});

describe('spoken captions', () => {
  const text = 'Hi boss, PR number 12 is ready to merge.';

  it('shows whole words as they are said, and everything by the end', () => {
    expect(spokenChars(text, 0, 4000)).toBe(2); // "Hi"
    const half = spokenChars(text, 2000, 4000);
    expect(text.slice(0, half)).toBe('Hi boss, PR number 12');
    expect(spokenChars(text, 4000, 4000)).toBe(text.length);
    expect(spokenChars(text, 9000, 4000)).toBe(text.length);
  });

  it('follows the clip length: a longer clip reveals more slowly', () => {
    expect(spokenChars(text, 1000, 8000)).toBeLessThan(spokenChars(text, 1000, 4000));
  });

  it('reveals to the end of the word a browser voice says it is on', () => {
    expect(text.slice(0, wordEnd(text, text.indexOf('number')))).toBe('Hi boss, PR number');
    expect(wordEnd(text, text.indexOf(' 12'))).toBe(text.indexOf(' is'));
    expect(wordEnd('', 3)).toBe(0);
  });

  it('keeps the caption to its last couple of lines', () => {
    const long = 'one two three four five six seven eight nine ten';
    expect(captionTail(long, long.length, 100)).toBe(long);
    const tail = captionTail(long, long.length, 16);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(17);
    expect(long.endsWith(tail.slice(1))).toBe(true);
    expect(captionTail(long, 7, 100)).toBe('one two');
  });

  it('estimates a browser voice from the length of the text', () => {
    expect(estimateSpeechMs('x'.repeat(140))).toBeGreaterThan(estimateSpeechMs('x'.repeat(14)));
  });
});
