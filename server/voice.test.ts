import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PhoneMessage, VoiceSettings } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { cacheToPrune, DEFAULT_VOICE, KEY_REJECTED_NOTE, RECOMMENDED_VOICES, speaks, Voice, VoiceApiError, voiceSettings, type VoiceApi } from './voice.ts';

const DAY = 24 * 60 * 60_000;

describe('cacheToPrune', () => {
  const now = 100 * DAY;
  it('drops clips older than 7 days', () => {
    const files = [
      { name: 'a.mp3', mtimeMs: now - 8 * DAY },
      { name: 'b.mp3', mtimeMs: now - 6 * DAY },
    ];
    expect(cacheToPrune(files, now)).toEqual(['a.mp3']);
  });

  it('keeps the newest 200', () => {
    const files = Array.from({ length: 203 }, (_, i) => ({ name: `${i}.mp3`, mtimeMs: now - i * 1000 }));
    expect(cacheToPrune(files, now).sort()).toEqual(['200.mp3', '201.mp3', '202.mp3']);
    expect(cacheToPrune(files.slice(0, 200), now)).toEqual([]);
  });
});

describe('voiceSettings', () => {
  it('takes valid fields and keeps the rest', () => {
    expect(voiceSettings(DEFAULT_VOICE, { provider: 'elevenlabs', speakOffice: true, model: 'eleven_v4_turbo' })).toEqual({ ...DEFAULT_VOICE, provider: 'elevenlabs', speakOffice: true, model: 'eleven_v4_turbo' });
    expect(voiceSettings(DEFAULT_VOICE, { provider: 'loud', model: 'Bad Model!', speakOffice: 'yes' })).toEqual(DEFAULT_VOICE);
    expect(voiceSettings(DEFAULT_VOICE, undefined)).toEqual(DEFAULT_VOICE);
  });

  it('starts off, with the office quiet', () => {
    expect(DEFAULT_VOICE.provider).toBe('off');
    expect(DEFAULT_VOICE.speakOffice).toBe(false);
  });
});

describe('speaks', () => {
  const msg = (from: PhoneMessage['from']): PhoneMessage => ({ id: 1, from, text: 'hi', at: 0 });
  it("reads the CEO's messages, and the office's only when asked", () => {
    expect(speaks(msg('ceo'), DEFAULT_VOICE)).toBe(true);
    expect(speaks(msg('office'), DEFAULT_VOICE)).toBe(false);
    expect(speaks(msg('office'), { ...DEFAULT_VOICE, speakOffice: true })).toBe(true);
    expect(speaks(msg('manager'), { ...DEFAULT_VOICE, speakOffice: true })).toBe(false);
  });
});

describe('Voice', () => {
  let dir: string;
  let settings: VoiceSettings;
  let notes: string[];
  let calls: { synth: number; list: number };
  let failWith: number | null;
  let release: (() => void) | null;
  const messages: PhoneMessage[] = [
    { id: 1, from: 'ceo', text: 'Floor 2 shipped #12 🎉', at: 0 },
    { id: 2, from: 'manager', text: 'thanks', at: 0 },
    { id: 3, from: 'ceo', text: 'Another one.', at: 0 },
  ];

  const api: VoiceApi = {
    checkKey: async (key) => {
      if (key.includes('bad')) throw new VoiceApiError(401, '401: invalid_api_key');
    },
    listVoices: async () => {
      calls.list++;
      if (failWith) throw new VoiceApiError(failWith, `${failWith}`);
      return [{ id: 'own1', name: 'Mine', category: 'cloned', labels: { accent: '', gender: '', age: '', description: '', use_case: '' }, previewUrl: 'https://x/p.mp3' }];
    },
    synthesize: async (_key, { text }) => {
      calls.synth++;
      if (release) await new Promise<void>((r) => (release = r));
      if (failWith) throw new VoiceApiError(failWith, `${failWith}: nope`);
      return Buffer.from(`mp3:${text}`);
    },
  };

  const make = () =>
    new Voice({
      api,
      secretsFile: path.join(dir, 'secrets.json'),
      cacheDir: path.join(dir, 'voice'),
      settings: () => settings,
      message: (id) => messages.find((m) => m.id === id),
      officeNote: (t) => notes.push(t),
      keyChanged: () => undefined,
    });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-voice-'));
    settings = { ...DEFAULT_VOICE, provider: 'elevenlabs' };
    notes = [];
    calls = { synth: 0, list: 0 };
    failWith = null;
    release = null;
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }));

  const status = (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e instanceof HttpError ? e.status : 500));

  it('keeps the key in its own file and shows only the last 4 characters', async () => {
    const v = make();
    expect(await v.setKey('  sk_live_abcdef1234  ')).toEqual({ voiceKeySet: true, voiceKeyHint: '1234' });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({ elevenlabsKey: 'sk_live_abcdef1234' });
    const again = make();
    await again.init();
    expect(again.keyView()).toEqual({ voiceKeySet: true, voiceKeyHint: '1234' });
    expect(await again.setKey('')).toEqual({ voiceKeySet: false, voiceKeyHint: '' });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({});
  });

  it('refuses a key ElevenLabs rejects with a 400', async () => {
    const v = make();
    expect(await status(v.setKey('sk_bad'))).toBe(400);
    expect(v.keyView().voiceKeySet).toBe(false);
  });

  it('needs a key: 409 for voices and new clips', async () => {
    const v = make();
    expect(await status(v.voices())).toBe(409);
    expect(await status(v.messageAudio(1))).toBe(409);
  });

  it('lists the shortlist first and caches the list', async () => {
    const v = make();
    await v.setKey('sk_good');
    const list = await v.voices();
    expect(list.slice(0, RECOMMENDED_VOICES.length).every((x) => x.recommended)).toBe(true);
    expect(list.at(-1)).toMatchObject({ id: 'own1', recommended: false });
    await v.voices();
    expect(calls.list).toBe(1);
  });

  it('speaks CEO messages once, cached, and 404s for the rest', async () => {
    const v = make();
    await v.setKey('sk_good');
    expect((await v.messageAudio(1)).toString()).toBe('mp3:Floor 2 shipped number 12.');
    await v.messageAudio(1);
    expect(calls.synth).toBe(1);
    expect(await status(v.messageAudio(2))).toBe(404);
    expect(await status(v.messageAudio(99))).toBe(404);
    settings = { ...settings, provider: 'browser' };
    expect(await status(v.messageAudio(1))).toBe(404);
  });

  it('shares one call between requests for the same message, and makes one clip at a time', async () => {
    const v = make();
    await v.setKey('sk_good');
    release = () => undefined;
    const a = v.messageAudio(1);
    const b = v.messageAudio(1);
    const c = v.messageAudio(3);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.synth).toBe(1); // #3 waits for #1
    const go = () => {
      const r = release!;
      release = () => undefined;
      r();
    };
    go();
    await a;
    await new Promise((r) => setTimeout(r, 20));
    go();
    expect((await b).toString()).toBe((await a).toString());
    await c;
    expect(calls.synth).toBe(2);
  });

  it('a 401 tells the manager once and stops calling until the key changes', async () => {
    const v = make();
    await v.setKey('sk_revoked');
    failWith = 401;
    expect(await status(v.messageAudio(1))).toBe(502);
    expect(await status(v.messageAudio(3))).toBe(502);
    expect(await status(v.voices())).toBe(502);
    expect(await status(v.sampleAudio())).toBe(502);
    expect(calls.synth).toBe(1);
    expect(calls.list).toBe(0);
    expect(notes).toEqual([KEY_REJECTED_NOTE]);

    // It survives a restart…
    const after = make();
    await after.init();
    expect(await status(after.messageAudio(1))).toBe(502);
    expect(calls.synth).toBe(1);

    // …until a new key goes in.
    failWith = null;
    await after.setKey('sk_new');
    expect(await status(after.messageAudio(1))).toBe(200);
    expect(calls.synth).toBe(2);
  });

  it('other ElevenLabs failures are a 502 and keep trying', async () => {
    const v = make();
    await v.setKey('sk_good');
    failWith = 500;
    expect(await status(v.messageAudio(1))).toBe(502);
    failWith = null;
    expect(await status(v.messageAudio(1))).toBe(200);
    expect(notes).toEqual([]);
  });
});
