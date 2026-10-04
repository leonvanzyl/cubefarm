import { describe, expect, it } from 'vitest';
import { SPEECH_MAX_CHARS, speechText } from './speech.ts';

describe('speechText', () => {
  it('strips markdown', () => {
    expect(speechText('## Plan\n\n**Bold** move, *quietly* and __firmly__. Use `npm test`, ~~not~~ that.')).toBe('Plan. Bold move, quietly and firmly. Use npm test, not that.');
    expect(speechText('> quoted\n- one\n- two\n* three\n1. first')).toBe('quoted. one. two. three. 1. first.');
    expect(speechText('[the PR](https://github.com/a/b/pull/3) and ![shot](x.png)')).toBe('the PR and shot.');
    expect(speechText('Before\n```ts\nconst x = 1;\n```\nAfter')).toBe('Before. After.');
    expect(speechText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a, b. 1, 2.');
    expect(speechText('<b>hi</b> there\n\n---\nbye')).toBe('hi there. bye.');
  });

  it('keeps snake_case and maths alone', () => {
    expect(speechText('Set max_retries to 2*3 now.')).toBe('Set max_retries to 2*3 now.');
  });

  it('drops emoji', () => {
    expect(speechText('✅ Merged 🎉🎉 by 👩🏽‍💻 today 🇿🇦!')).toBe('Merged by today!');
    expect(speechText('⚠️ Careful')).toBe('Careful.');
  });

  it('says issue numbers and links the way a person would', () => {
    expect(speechText('PR #42 closes #7.')).toBe('PR number 42 closes number 7.');
    expect(speechText('See https://github.com/acme/shop/pull/42, then www.example.com.')).toBe('See a link, then a link.');
    expect(speechText('Docs: <https://example.com/x?y=1>')).toBe('Docs: a link.');
  });

  it('cuts at a sentence end after about 1500 characters', () => {
    const sentence = 'The floor shipped another feature today. ';
    const long = sentence.repeat(60);
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    expect(out.length).toBeGreaterThan(SPEECH_MAX_CHARS - sentence.length);
    expect(out.endsWith('today.')).toBe(true);
  });

  it('cuts at a word, with an ellipsis, when there is no sentence end to cut at', () => {
    const out = speechText('word '.repeat(400), 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('word…')).toBe(true);
  });

  it('leaves short text whole', () => {
    expect(speechText('Hello.')).toBe('Hello.');
    expect(speechText('')).toBe('');
  });
});
