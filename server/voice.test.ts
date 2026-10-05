import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIP_MAX_BYTES, CLIP_MAX_MS } from '../shared/clipLimits.ts';
import type { ListenSettings, PhoneMessage, VoiceCacheView, VoiceSettings } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import {
  cacheToPrune,
  clipsFor,
  DEFAULT_LISTEN,
  DEFAULT_VOICE,
  KEY_REJECTED_NOTE,
  listenSettings,
  newestClips,
  parseManifest,
  RECOMMENDED_VOICES,
  savedMessages,
  speaks,
  Voice,
  VoiceApiError,
  voiceSettings,
  withClips,
  withoutMissing,
  type ClipManifest,
  type VoiceApi,
} from './voice.ts';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

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

  it('never drops the kept clips, whatever their age, and counts them towards the 200', () => {
    const files = [{ name: 'old.mp3', mtimeMs: now - 60 * DAY }, ...Array.from({ length: 200 }, (_, i) => ({ name: `${i}.mp3`, mtimeMs: now - i * 1000 }))];
    expect(cacheToPrune(files, now, 200, 7 * DAY, new Set(['old.mp3']))).toEqual(['199.mp3']);
    expect(cacheToPrune(files, now, 200, 7 * DAY)).toEqual(['old.mp3']);
  });

  it('follows the age it is given', () => {
    const files = [
      { name: 'a.mp3', mtimeMs: now - 2 * DAY },
      { name: 'b.mp3', mtimeMs: now - 12 * HOUR },
    ];
    expect(cacheToPrune(files, now, 200, 1 * DAY)).toEqual(['a.mp3']);
    expect(cacheToPrune(files, now, 200, 30 * DAY)).toEqual([]);
  });
});

describe('keepDays', () => {
  it('is part of the voice settings: clamped on save, kept through a restart, 7 for older offices', () => {
    expect(DEFAULT_VOICE.keepDays).toBe(7);
    const saved = voiceSettings(DEFAULT_VOICE, { keepDays: 500 });
    expect(saved.keepDays).toBe(90);
    expect(voiceSettings(DEFAULT_VOICE, JSON.parse(JSON.stringify(saved))).keepDays).toBe(90);
    const before: Partial<VoiceSettings> = { ...DEFAULT_VOICE };
    delete before.keepDays;
    expect(voiceSettings(DEFAULT_VOICE, before).keepDays).toBe(7);
    expect(voiceSettings({ ...DEFAULT_VOICE, keepDays: 30 }, { provider: 'browser' }).keepDays).toBe(30);
  });
});

describe('the message to clip manifest', () => {
  const m = (id: number, at = id * 1000, from: PhoneMessage['from'] = 'ceo'): PhoneMessage => ({ id, from, text: `m${id}`, at });

  it('finds the clips recorded for a message, not for an older one that had the same id', () => {
    const man = withClips({}, m(4), ['4-aaa.mp3']);
    expect(clipsFor(man, m(4))).toEqual(['4-aaa.mp3']);
    expect(clipsFor(man, m(4, 99))).toBeNull();
    expect(clipsFor(man, m(5))).toBeNull();
    expect(clipsFor(withClips(man, m(4), ['4-a.mp3', '4-b.mp3']), m(4))).toEqual(['4-a.mp3', '4-b.mp3']);
  });

  it('forgets a message once any of its clips is gone', () => {
    const man = withClips(withClips({}, m(1), ['1-a.mp3', '1-b.mp3']), m(2), ['2-a.mp3']);
    expect(Object.keys(withoutMissing(man, new Set(['1-a.mp3', '2-a.mp3'])))).toEqual(['2']);
  });

  it("keeps the newest CEO messages' clips", () => {
    const messages = Array.from({ length: 30 }, (_, i) => m(i + 1, (i + 1) * 1000, i % 2 ? 'ceo' : 'manager'));
    let man: ClipManifest = {};
    for (const x of messages) man = withClips(man, x, [`${x.id}.mp3`]);
    expect(newestClips(man, messages).size).toBe(15); // only 15 CEO messages so far
    expect([...newestClips(man, messages, 5)]).toEqual(['22.mp3', '24.mp3', '26.mp3', '28.mp3', '30.mp3']);
    // 20 newer CEO messages that were never spoken push them all out.
    expect(newestClips(man, [...messages, ...Array.from({ length: 20 }, (_, i) => m(100 + i))]).size).toBe(0);
    expect(savedMessages(man, messages.slice(0, 3))).toEqual([1, 2, 3]);
  });

  it('reads clips.json defensively', () => {
    expect(parseManifest({ '3': { at: 5, files: ['3-abc.mp3'] } })).toEqual({ '3': { at: 5, files: ['3-abc.mp3'] } });
    expect(parseManifest({ '3': { at: 5, files: ['../secrets.json'] }, x: { at: 1, files: ['a.mp3'] }, '4': { files: ['a.mp3'] }, '5': { at: 1, files: [] } })).toEqual({});
    expect(parseManifest(null)).toEqual({});
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

describe('listenSettings', () => {
  it('takes valid fields and keeps the rest', () => {
    expect(listenSettings(DEFAULT_LISTEN, { provider: 'elevenlabs', autoSend: true })).toEqual({ provider: 'elevenlabs', autoSend: true, handsFree: false });
    expect(listenSettings(DEFAULT_LISTEN, { provider: 'whisper', autoSend: 'yes', handsFree: 1 })).toEqual(DEFAULT_LISTEN);
    expect(listenSettings(DEFAULT_LISTEN, null)).toEqual(DEFAULT_LISTEN);
  });

  it('starts on the free browser recognition, sending only when asked and never hands-free', () => {
    expect(DEFAULT_LISTEN).toEqual({ provider: 'browser', autoSend: false, handsFree: false });
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
  let listen: ListenSettings;
  let notes: string[];
  let logs: string[];
  let heard: { key: string; type: string; bytes: number }[];
  let calls: { synth: number; list: number };
  let failWith: number | null;
  let release: (() => void) | null;
  let views: VoiceCacheView[];
  let clock: number;
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
    transcribe: async (key, { audio, type }) => {
      heard.push({ key, type, bytes: audio.length });
      if (failWith) throw new VoiceApiError(failWith, `${failWith}: nope`);
      return '  Ship the login page today.  ';
    },
  };

  const make = () =>
    new Voice({
      api,
      secretsFile: path.join(dir, 'secrets.json'),
      cacheDir: path.join(dir, 'voice'),
      settings: () => settings,
      listen: () => listen,
      messages: () => messages,
      officeNote: (t) => notes.push(t),
      keyChanged: () => undefined,
      cacheChanged: (v) => views.push(v),
      log: (line) => logs.push(line),
      now: () => clock,
    });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-voice-'));
    settings = { ...DEFAULT_VOICE, provider: 'elevenlabs' };
    listen = { ...DEFAULT_LISTEN, provider: 'elevenlabs' };
    notes = [];
    logs = [];
    heard = [];
    calls = { synth: 0, list: 0 };
    failWith = null;
    release = null;
    views = [];
    clock = Date.now();
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

  it('replays saved clips without ever calling ElevenLabs', async () => {
    const v = make();
    await v.init();
    expect(await status(v.cachedAudio(1))).toBe(404); // never spoken
    await v.setKey('sk_good');
    expect(await status(v.cachedAudio(1))).toBe(404); // a key alone doesn't make a clip
    expect(calls.synth).toBe(0);
    const spoken = await v.messageAudio(1);
    expect(calls.synth).toBe(1);
    expect(await v.cachedAudio(1)).toEqual({ audio: spoken, parts: 1 });
    expect(v.cacheInfo()).toMatchObject({ clips: 1, saved: [1] });
    expect(views.at(-1)?.saved).toEqual([1]);

    // A new voice, or ElevenLabs refusing: message 1 still replays its first clip, with no new call.
    settings = { ...settings, voiceId: 'otherVoice', model: 'eleven_v4' };
    failWith = 500;
    expect(await v.cachedAudio(1)).toEqual({ audio: spoken, parts: 1 });
    expect(await v.messageAudio(1)).toEqual(spoken);
    settings = { ...settings, provider: 'off' };
    expect((await v.cachedAudio(1)).audio).toEqual(spoken);
    expect(await status(v.cachedAudio(3))).toBe(404);
    expect(await status(v.cachedAudio(1, 1))).toBe(404);
    expect(calls.synth).toBe(1);

    // The manifest survives a restart.
    const after = make();
    await after.init();
    expect((await after.cachedAudio(1)).audio).toEqual(spoken);
    expect(after.cacheInfo()).toMatchObject({ clips: 1, saved: [1] });

    // Cleared: nothing to replay, and still no call.
    expect(await after.clearCache()).toEqual({ clips: 0, bytes: 0, saved: [] });
    expect(await status(after.cachedAudio(1))).toBe(404);
    expect(calls.synth).toBe(1);
  });

  it("prunes by the age setting, keeping the newest CEO messages' clips", async () => {
    const v = make();
    await v.init();
    await v.setKey('sk_good');
    await v.messageAudio(1);
    await v.sampleAudio();
    expect(v.cacheInfo().clips).toBe(2);
    clock += 3 * DAY;
    settings = { ...settings, keepDays: 2 };
    expect(await v.prune()).toMatchObject({ clips: 1, saved: [1] }); // the sample goes; message 1 is one of the newest 20
    settings = { ...settings, keepDays: 7 };
    await v.sampleAudio();
    expect(await v.prune()).toMatchObject({ clips: 2 });
  });

  it("voices the stand-up's line once per wording, then plays it from the cache", async () => {
    const v = make();
    await v.setKey('sk_good');
    const first = await v.standupAudio(3, 'morning');
    expect(first.toString()).toBe('mp3:Morning team, three new features today!');
    expect(await v.standupAudio(3, 'morning')).toEqual(first);
    expect(calls.synth).toBe(1);
    await v.standupAudio(2, 'morning');
    expect(calls.synth).toBe(2);
    settings = { ...settings, provider: 'browser' };
    expect(await status(v.standupAudio(3, 'morning'))).toBe(404);
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

  describe('transcribe', () => {
    const clip = Buffer.alloc(30_000, 1);
    const webm = 'audio/webm;codecs=opus';

    it('sends the clip with the key and gives back the words, logging neither', async () => {
      const v = make();
      await v.setKey('sk_secret_stt_1234');
      expect(await v.transcribe(clip, webm, 2400)).toBe('Ship the login page today.');
      expect(heard).toEqual([{ key: 'sk_secret_stt_1234', type: 'audio/webm', bytes: 30_000 }]);
      expect(logs).toEqual(['voice: transcribed a 2.4 s clip (30 KB)']);
      expect(logs.join(' ')).not.toContain('sk_secret');
      expect(logs.join(' ')).not.toContain('login page');
    });

    it('needs a key, and says where to add it', async () => {
      const err = await make().transcribe(clip, webm, 2400).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({ status: 409, message: expect.stringContaining('Add your ElevenLabs API key in Settings → Voice') });
      expect(heard).toEqual([]);
    });

    it('works only while ElevenLabs is the provider', async () => {
      const v = make();
      await v.setKey('sk_good');
      listen = { ...listen, provider: 'browser' };
      expect(await status(v.transcribe(clip, webm, 2400))).toBe(409);
      expect(heard).toEqual([]);
    });

    it('refuses clips over 60 s or 5 MB, empty ones and other types before calling ElevenLabs', async () => {
      const v = make();
      await v.setKey('sk_good');
      expect(await status(v.transcribe(Buffer.alloc(CLIP_MAX_BYTES + 1), webm, 2400))).toBe(413);
      expect(await status(v.transcribe(clip, webm, CLIP_MAX_MS + 10_000))).toBe(413);
      expect(await status(v.transcribe(Buffer.alloc(0), webm, 0))).toBe(400);
      expect(await status(v.transcribe(clip, 'text/html', 2400))).toBe(415);
      expect(heard).toEqual([]);
    });

    it("explains a key that may not use Speech to Text, and a 401 stops calls like the voice's", async () => {
      const v = make();
      await v.setKey('sk_good');
      failWith = 403;
      expect(await v.transcribe(clip, webm, 2400).catch((e: unknown) => e)).toMatchObject({ status: 502, message: expect.stringContaining('may not use Speech to Text') });
      failWith = 401;
      expect(await status(v.transcribe(clip, webm, 2400))).toBe(502);
      expect(notes).toEqual([KEY_REJECTED_NOTE]);
      failWith = null;
      expect(await status(v.transcribe(clip, webm, 2400))).toBe(502);
      expect(heard).toHaveLength(2);
    });
  });
});
