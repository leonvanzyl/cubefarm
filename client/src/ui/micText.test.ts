import { describe, expect, it } from 'vitest';
import { cantListen, cleanTranscript, micErrorLine, phrasesText, withTranscript } from './micText';

describe('cleanTranscript', () => {
  it('tidies spaces and starts with a capital', () => {
    expect(cleanTranscript("  what's   everyone\nworking on ")).toBe("What's everyone working on");
  });

  it('drops sound tags', () => {
    expect(cleanTranscript('(laughter) ship it [music] today')).toBe('Ship it today');
  });

  it('can leave the first letter alone', () => {
    expect(cleanTranscript('and the login page', false)).toBe('and the login page');
  });
});

describe('withTranscript', () => {
  it('fills an empty box', () => {
    expect(withTranscript('', 'hello there')).toBe('Hello there');
  });

  it('adds to what was typed, mid-sentence without a capital', () => {
    expect(withTranscript('Please fix ', 'the login page')).toBe('Please fix the login page');
    expect(withTranscript('Done.', 'next one')).toBe('Done. Next one');
  });

  it('leaves the box alone when nothing was heard', () => {
    expect(withTranscript('draft ', '  ')).toBe('draft ');
  });
});

describe('phrasesText', () => {
  it('joins settled phrases and the one still being heard', () => {
    expect(
      phrasesText([
        { transcript: 'hire a designer', final: true },
        { transcript: ' for floor two', final: false },
      ]),
    ).toEqual({ text: 'hire a designer for floor two', speaking: true });
  });

  it('is not speaking once every phrase has settled', () => {
    expect(phrasesText([{ transcript: 'ok', final: true }])).toEqual({ text: 'ok', speaking: false });
    expect(phrasesText([])).toEqual({ text: '', speaking: false });
  });

  it("collapses Safari's overlapping results", () => {
    const f = (...t: string[]) => t.map((transcript) => ({ transcript, final: true }));
    expect(phrasesText(f('hello', 'hello world')).text).toBe('hello world');
    expect(phrasesText(f('start issue three', 'start issue three')).text).toBe('start issue three');
    expect(phrasesText(f('Hello world.', 'hello')).text).toBe('Hello world.');
    expect(phrasesText(f('hello', 'Hello, world')).text).toBe('Hello, world');
  });

  it('keeps distinct phrases, even ones sharing letters', () => {
    const f = (...t: string[]) => t.map((transcript) => ({ transcript, final: true }));
    expect(phrasesText(f('add a test', ' for mulch')).text).toBe('add a test for mulch');
    expect(phrasesText(f('go', 'good morning')).text).toBe('go good morning');
  });

  it('is still speaking while the extending phrase is unsettled', () => {
    expect(
      phrasesText([
        { transcript: 'hello', final: true },
        { transcript: 'hello world', final: false },
      ]),
    ).toEqual({ text: 'hello world', speaking: true });
  });
});

describe('micErrorLine', () => {
  it('explains a refusal in one friendly line', () => {
    expect(micErrorLine('not-allowed')).toMatch(/blocked.*Allow it/);
    expect(micErrorLine('NotAllowedError')).toBe(micErrorLine('not-allowed'));
    expect(micErrorLine('not-allowed')).not.toContain('\n');
  });

  it('says nothing when listening simply stopped or nobody spoke', () => {
    expect(micErrorLine('aborted')).toBeNull();
    expect(micErrorLine('no-speech')).toBeNull();
  });

  it('covers a missing mic, the network and anything else', () => {
    expect(micErrorLine('audio-capture')).toMatch(/No microphone/);
    expect(micErrorLine('NotFoundError')).toMatch(/No microphone/);
    expect(micErrorLine('network')).toMatch(/ElevenLabs/);
    expect(micErrorLine('weird')).toBe('🎙️ Listening stopped (weird).');
  });
});

describe('cantListen', () => {
  const all = { recognition: true, recorder: true };
  it('is happy where the provider works', () => {
    expect(cantListen('browser', all, false)).toBe('');
    expect(cantListen('elevenlabs', all, true)).toBe('');
  });

  it("says plainly when the browser can't recognise speech", () => {
    expect(cantListen('browser', { recognition: false, recorder: true }, true)).toMatch(/can't turn speech into text/);
  });

  it('ElevenLabs needs a recorder and a key', () => {
    expect(cantListen('elevenlabs', { recognition: true, recorder: false }, true)).toMatch(/can't record/);
    expect(cantListen('elevenlabs', all, false)).toMatch(/Add your ElevenLabs API key/);
  });
});
