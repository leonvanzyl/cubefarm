// Phone messages read aloud by ElevenLabs: the manager's key (kept in its own secrets file, never in the state, the
// snapshot, events or agents' environments), the voice list, and spoken messages cached as mp3 under <SWARM_HOME>/voice.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SAMPLE_LINE, speechText } from '../shared/speech.ts';
import type { PhoneMessage, VoiceOption, VoiceSettings } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

/** ElevenLabs' fastest, cheapest model (~75 ms, half the price per character of Multilingual v2). */
export const DEFAULT_VOICE_MODEL = 'eleven_flash_v2_5';
export const VOICES_TTL_MS = 10 * 60_000;
export const SYNTH_TIMEOUT_MS = 20_000;
export const CACHE_MAX_FILES = 200;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const KEY_REJECTED_NOTE = "🔇 ElevenLabs rejected the key, so messages aren't read aloud until you set a new one in the voice settings.";

type Labels = VoiceOption['labels'];
const voice = (id: string, name: string, description: string, accent = ''): VoiceOption => ({
  id,
  name,
  category: 'library',
  labels: { accent, gender: '', age: '', description, use_case: 'conversational' },
  previewUrl: null,
  recommended: true,
});

/**
 * docs/voice.md's shortlist for a calm, friendly CEO: ElevenLabs' replacements for its Default voices, which expire on
 * 31 December 2026. They're in the Voice Library, usable by id without saving them (paid plans).
 */
export const RECOMMENDED_VOICES: VoiceOption[] = [
  voice('OZ0L6eISlOejga3XjDFt', 'Talia', 'warm soft guide'),
  voice('l7kNoIfnJKPg7779LI2t', 'Eddie', 'helpful and comforting'),
  voice('AaOhDHYJ1XLZk74lXhdE', 'Caleb', 'trusted guide'),
  voice('gOupLcAkjEnguROwi4oS', 'Darian', 'warm grounded storyteller'),
  voice('BFd5oBc2DDna33pSi4Gf', 'Alicia', 'polished global anchor'),
  voice('QtY3JBOUKEB5xzrRfOKc', 'Maisie', 'friendly casual neighbor'),
  voice('FrS6cKLB1wg4WYgPa9GW', 'Wyatt', 'seasoned mentor'),
  voice('6WwXjDDEMyNmFG95zycZ', 'Eldrin', 'crisp baritone', 'british'),
];

export const DEFAULT_VOICE: VoiceSettings = {
  provider: 'off',
  voiceId: RECOMMENDED_VOICES[0].id,
  voiceName: RECOMMENDED_VOICES[0].name,
  model: DEFAULT_VOICE_MODEL,
  speakOffice: false,
};

const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_ID = /^[a-z0-9_.-]{1,64}$/;

/** Voice settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function voiceSettings(base: VoiceSettings, patch: unknown): VoiceSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof VoiceSettings, unknown>>;
  const out = { ...base };
  if (p.provider === 'off' || p.provider === 'browser' || p.provider === 'elevenlabs') out.provider = p.provider;
  // The browser's voices are named rather than numbered ("Google UK English Female"), so any short name goes.
  if (typeof p.voiceId === 'string' && p.voiceId.trim() && p.voiceId.length <= 200) out.voiceId = p.voiceId.trim();
  if (typeof p.voiceName === 'string') out.voiceName = p.voiceName.trim().slice(0, 80);
  if (typeof p.model === 'string' && MODEL_ID.test(p.model.trim())) out.model = p.model.trim();
  if (typeof p.speakOffice === 'boolean') out.speakOffice = p.speakOffice;
  return out;
}

/** Which cached clips to delete: anything older than `maxAgeMs`, then the oldest beyond `max`. */
export function cacheToPrune(files: { name: string; mtimeMs: number }[], now: number, max = CACHE_MAX_FILES, maxAgeMs = CACHE_MAX_AGE_MS): string[] {
  const fresh = files.filter((f) => now - f.mtimeMs <= maxAgeMs).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(fresh.slice(0, max).map((f) => f.name));
  return files.filter((f) => !keep.has(f.name)).map((f) => f.name);
}

/** The phone messages that are spoken: the CEO's, and the office's own notes when the manager asked for them. */
export function speaks(m: PhoneMessage, s: VoiceSettings): boolean {
  return m.from === 'ceo' || (m.from === 'office' && s.speakOffice);
}

/** An ElevenLabs call that failed; status 0 when it never answered. */
export class VoiceApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** ElevenLabs (server/elevenlabs.ts), or demo.ts's fake. */
export interface VoiceApi {
  checkKey(key: string): Promise<void>;
  listVoices(key: string): Promise<Omit<VoiceOption, 'recommended'>[]>;
  synthesize(key: string, req: { voiceId: string; model: string; text: string }, signal: AbortSignal): Promise<Buffer>;
}

export interface VoiceKeyView {
  voiceKeySet: boolean;
  voiceKeyHint: string;
}

export interface VoiceDeps {
  api: VoiceApi;
  secretsFile: string;
  cacheDir: string;
  settings(): VoiceSettings;
  message(id: number): PhoneMessage | undefined;
  /** Posts an office message on the manager's phone. */
  officeNote(text: string): void;
  keyChanged(view: VoiceKeyView): void;
  now?(): number;
}

interface Secrets {
  elevenlabsKey?: string;
  elevenlabsKeyRejected?: boolean;
}

export class Voice {
  private key = '';
  private rejected = false; // ElevenLabs said 401: no more calls until the key changes
  private voicesCache: { at: number; list: VoiceOption[] } | null = null;
  private making = new Map<string, Promise<Buffer>>();
  private queue: Promise<unknown> = Promise.resolve();
  private writing: Promise<unknown> = Promise.resolve(); // secrets-file writes, one after another

  constructor(private deps: VoiceDeps) {}

  async init() {
    const s = await this.readSecrets();
    this.key = typeof s.elevenlabsKey === 'string' ? s.elevenlabsKey : '';
    this.rejected = !!this.key && s.elevenlabsKeyRejected === true;
    await this.prune().catch(() => undefined);
  }

  keyView(): VoiceKeyView {
    return { voiceKeySet: !!this.key, voiceKeyHint: this.key.slice(-4) };
  }

  /** PUT /api/voice/key: '' removes the key; anything else must pass one cheap ElevenLabs call first. */
  async setKey(raw: string): Promise<VoiceKeyView> {
    const key = raw.trim();
    if (key) {
      if (key.length > 200 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an ElevenLabs API key.");
      try {
        await this.deps.api.checkKey(key);
      } catch (err) {
        if (err instanceof VoiceApiError && err.status === 401) throw new HttpError(400, 'ElevenLabs rejected that key. Copy it again from elevenlabs.io → Developers → API Keys.');
        if (err instanceof VoiceApiError && err.status === 403) throw new HttpError(400, 'That key may not read voices. Give it the Voices (read) and Text to Speech permissions on elevenlabs.io.');
        throw new HttpError(502, `Couldn't check the key with ElevenLabs: ${(err as Error).message}`);
      }
    }
    this.key = key;
    this.rejected = false;
    this.voicesCache = null;
    await this.writeSecrets({ elevenlabsKey: key || undefined, elevenlabsKeyRejected: undefined });
    const view = this.keyView();
    this.deps.keyChanged(view);
    return view;
  }

  /** GET /api/voice/voices: the account's voices plus the shortlist, shortlist first. Cached for 10 minutes. */
  async voices(): Promise<VoiceOption[]> {
    this.requireKey();
    const now = this.now();
    if (this.voicesCache && now - this.voicesCache.at < VOICES_TTL_MS) return this.voicesCache.list;
    const key = this.key;
    const mine = await this.deps.api.listVoices(key).catch((err) => this.failed(err, key, 'list the voices'));
    const recommended = new Map(RECOMMENDED_VOICES.map((v) => [v.id, v]));
    const list: VoiceOption[] = [
      ...RECOMMENDED_VOICES.map((r) => {
        const own = mine.find((v) => v.id === r.id);
        return own ? { ...own, labels: fill(own.labels, r.labels), recommended: true } : r;
      }),
      ...mine.filter((v) => !recommended.has(v.id)).map((v) => ({ ...v, recommended: false })).sort((a, b) => a.name.localeCompare(b.name)),
    ];
    if (this.key === key) this.voicesCache = { at: now, list };
    return list;
  }

  /** GET /api/voice/messages/:id: a phone message as mp3, made once and cached. */
  async messageAudio(id: number): Promise<Buffer> {
    const s = this.deps.settings();
    if (s.provider !== 'elevenlabs') throw new HttpError(404, "Messages aren't read by ElevenLabs right now.");
    const m = this.deps.message(id);
    if (!m || !speaks(m, s)) throw new HttpError(404, `No spoken message ${id}`);
    const text = speechText(m.text);
    if (!text) throw new HttpError(404, `Message ${id} has nothing to say aloud`);
    return this.audio(String(m.id), s.voiceId, s.model, text);
  }

  /** GET /api/voice/sample: the settings' Test button, in `voiceId` (default: the chosen voice). */
  async sampleAudio(voiceId?: string): Promise<Buffer> {
    const s = this.deps.settings();
    return this.audio('sample', voiceId || s.voiceId, s.model, SAMPLE_LINE);
  }

  private async audio(name: string, voiceId: string, model: string, text: string): Promise<Buffer> {
    if (!VOICE_ID.test(voiceId)) throw new HttpError(400, 'Pick an ElevenLabs voice first.');
    // The voice, model and words are in the file name, so a new voice or a reused message id never plays stale audio.
    const hash = crypto.createHash('sha256').update(`${voiceId}\n${model}\n${text}`).digest('hex').slice(0, 12);
    const file = path.join(this.deps.cacheDir, `${name}-${hash}.mp3`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return cached;
    this.requireKey();
    const busy = this.making.get(file);
    if (busy) return busy;
    const made = this.oneAtATime(() => this.synthesize(file, { voiceId, model, text })).finally(() => this.making.delete(file));
    this.making.set(file, made);
    return made;
  }

  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async synthesize(file: string, req: { voiceId: string; model: string; text: string }): Promise<Buffer> {
    this.requireKey(); // the key may have been rejected or removed while this waited its turn
    const key = this.key;
    const audio = await this.deps.api.synthesize(key, req, AbortSignal.timeout(SYNTH_TIMEOUT_MS)).catch((err) => this.failed(err, key, 'speak the message'));
    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, audio);
    await fs.rename(tmp, file);
    await this.prune().catch(() => undefined);
    return audio;
  }

  /** An ElevenLabs failure as a short 502. A 401 also stops every call until the key changes, and says so once. */
  private async failed(err: unknown, key: string, what: string): Promise<never> {
    if (err instanceof VoiceApiError && err.status === 401 && key === this.key && !this.rejected) {
      this.rejected = true;
      this.deps.officeNote(KEY_REJECTED_NOTE);
      await this.writeSecrets({ elevenlabsKeyRejected: true }).catch(() => undefined);
    }
    if (err instanceof VoiceApiError && err.status === 401) throw new HttpError(502, 'ElevenLabs rejected the key.');
    throw new HttpError(502, `ElevenLabs couldn't ${what}: ${(err as Error).message}`.slice(0, 240));
  }

  private requireKey() {
    if (!this.key) throw new HttpError(409, 'Add an ElevenLabs API key first.');
    if (this.rejected) throw new HttpError(502, 'ElevenLabs rejected the key. Set a new one in the voice settings.');
  }

  private async prune() {
    const names = (await fs.readdir(this.deps.cacheDir).catch(() => [] as string[])).filter((n) => n.endsWith('.mp3'));
    const files = await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await fs.stat(path.join(this.deps.cacheDir, name)).catch(() => null))?.mtimeMs ?? 0 })));
    for (const name of cacheToPrune(files, this.now())) await fs.rm(path.join(this.deps.cacheDir, name), { force: true, maxRetries: 3 });
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private async readSecrets(): Promise<Secrets & Record<string, unknown>> {
    try {
      const s = JSON.parse(await fs.readFile(this.deps.secretsFile, 'utf8')) as unknown;
      return s && typeof s === 'object' ? (s as Secrets & Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Merge into the secrets file (other secrets stay), owner-only where the OS has file modes. */
  private writeSecrets(patch: Secrets): Promise<void> {
    const write = this.writing.then(() => this.mergeSecrets(patch));
    this.writing = write.catch(() => undefined);
    return write;
  }

  private async mergeSecrets(patch: Secrets) {
    const next: Record<string, unknown> = { ...(await this.readSecrets()), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    await fs.mkdir(path.dirname(this.deps.secretsFile), { recursive: true });
    const tmp = `${this.deps.secretsFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.deps.secretsFile);
    await fs.chmod(this.deps.secretsFile, 0o600).catch(() => undefined);
  }
}

/** The account's labels, with the shortlist's description where ElevenLabs has none. */
function fill(own: Labels, ours: Labels): Labels {
  return { ...own, description: own.description || ours.description };
}
