// Phone messages read aloud by ElevenLabs: the manager's key (kept in its own secrets file, never in the state, the
// snapshot, events or agents' environments), the voice list, and spoken messages cached as mp3 under <SWARM_HOME>/voice,
// with clips.json recording which clips belong to which message so the phone can replay them without a new synthesis.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SAMPLE_LINE, speechText, standupLine, type DayPart } from '../shared/speech.ts';
import { clampKeepDays, KEEP_DAYS_DEFAULT } from '../shared/voiceClips.ts';
import type { PhoneMessage, VoiceCacheView, VoiceOption, VoiceSettings } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';

/** ElevenLabs' fastest, cheapest model (~75 ms, half the price per character of Multilingual v2). */
export const DEFAULT_VOICE_MODEL = 'eleven_flash_v2_5';
export const VOICES_TTL_MS = 10 * 60_000;
export const SYNTH_TIMEOUT_MS = 20_000;
export const CACHE_MAX_FILES = 200;
const DAY_MS = 24 * 60 * 60_000;
export const CACHE_MAX_AGE_MS = KEEP_DAYS_DEFAULT * DAY_MS;
/** The clips of this many of the newest CEO messages stay whatever their age. */
export const KEEP_NEWEST_MESSAGES = 20;
const MANIFEST = 'clips.json';
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
  keepDays: KEEP_DAYS_DEFAULT,
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
  out.keepDays = clampKeepDays(p.keepDays ?? out.keepDays);
  return out;
}

/**
 * Which cached clips to delete: anything older than `maxAgeMs`, then the oldest beyond `max`. Clips in `keep` (the
 * newest messages') always stay and count towards `max`.
 */
export function cacheToPrune(files: { name: string; mtimeMs: number }[], now: number, max = CACHE_MAX_FILES, maxAgeMs = CACHE_MAX_AGE_MS, keep: ReadonlySet<string> = new Set()): string[] {
  const pinned = files.filter((f) => keep.has(f.name)).length;
  const fresh = files.filter((f) => !keep.has(f.name) && now - f.mtimeMs <= maxAgeMs).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Set([...keep, ...fresh.slice(0, Math.max(0, max - pinned)).map((f) => f.name)]);
  return files.filter((f) => !kept.has(f.name)).map((f) => f.name);
}

// ---------- which clips belong to which message ----------

/** A message's clips (in the order they're spoken) and the message's time, which tells a reused id apart. */
export interface ClipEntry {
  at: number;
  files: string[];
}
/** clips.json: message id → its clips, recorded when they're first made, so a later voice or model change still replays them. */
export type ClipManifest = Record<string, ClipEntry>;

/** The clips recorded for `m`, or null: none, or recorded for an older message that had the same id. */
export function clipsFor(manifest: ClipManifest, m: Pick<PhoneMessage, 'id' | 'at'>): string[] | null {
  const e = manifest[m.id];
  return e && e.at === m.at && e.files.length ? e.files : null;
}

/** The manifest with `files` recorded as `m`'s clips. */
export function withClips(manifest: ClipManifest, m: Pick<PhoneMessage, 'id' | 'at'>, files: string[]): ClipManifest {
  return { ...manifest, [m.id]: { at: m.at, files } };
}

/** The manifest without the messages that lost any of their clips (a partial message can't be replayed). */
export function withoutMissing(manifest: ClipManifest, onDisk: ReadonlySet<string>): ClipManifest {
  return Object.fromEntries(Object.entries(manifest).filter(([, e]) => e.files.every((f) => onDisk.has(f))));
}

/** The clips that stay whatever their age: those of the newest `n` CEO messages. */
export function newestClips(manifest: ClipManifest, messages: readonly PhoneMessage[], n = KEEP_NEWEST_MESSAGES): Set<string> {
  const ceo = messages.filter((m) => m.from === 'ceo').slice(-n);
  return new Set(ceo.flatMap((m) => clipsFor(manifest, m) ?? []));
}

/** The messages that can be replayed from the cache, oldest first. */
export function savedMessages(manifest: ClipManifest, messages: readonly PhoneMessage[]): number[] {
  return messages.filter((m) => clipsFor(manifest, m)).map((m) => m.id);
}

/** A manifest read from disk, entry by entry; anything malformed (or naming a file outside the cache) is dropped. */
export function parseManifest(raw: unknown): ClipManifest {
  const out: ClipManifest = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    const { at, files } = (e ?? {}) as { at?: unknown; files?: unknown };
    if (!/^\d+$/.test(id) || typeof at !== 'number' || !Array.isArray(files) || !files.length) continue;
    if (files.every((f) => typeof f === 'string' && /^[\w-]+\.mp3$/.test(f))) out[id] = { at, files: files as string[] };
  }
  return out;
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
  /** The phone messages the office still has, oldest first. */
  messages(): readonly PhoneMessage[];
  /** Posts an office message on the manager's phone. */
  officeNote(text: string): void;
  keyChanged(view: VoiceKeyView): void;
  cacheChanged(view: VoiceCacheView): void;
  /** Server log lines (a new clip made), never the key. */
  log?(line: string): void;
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
  private clips: ClipManifest = {};
  private cacheView: VoiceCacheView = { clips: 0, bytes: 0, saved: [] };
  private cacheWork: Promise<unknown> = Promise.resolve(); // manifest changes, prunes and clears, one after another

  constructor(private deps: VoiceDeps) {}

  async init() {
    const s = await this.readSecrets();
    this.key = typeof s.elevenlabsKey === 'string' ? s.elevenlabsKey : '';
    this.rejected = !!this.key && s.elevenlabsKeyRejected === true;
    const raw = await fs.readFile(this.manifestFile(), 'utf8').catch(() => '');
    try {
      this.clips = parseManifest(raw ? JSON.parse(raw) : {});
    } catch {
      this.clips = {};
    }
    await this.prune();
  }

  /** The snapshot's voiceCache: the clips on disk and the messages they replay. */
  cacheInfo(): VoiceCacheView {
    return this.cacheView;
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
    const m = this.message(id);
    if (!m || !speaks(m, s)) throw new HttpError(404, `No spoken message ${id}`);
    const saved = clipsFor(this.clips, m);
    const first = saved && (await fs.readFile(path.join(this.deps.cacheDir, saved[0])).catch(() => null));
    if (first) return first; // made before, perhaps in another voice: a message keeps the clip it was first read with
    const text = speechText(m.text);
    if (!text) throw new HttpError(404, `Message ${id} has nothing to say aloud`);
    return this.audio(String(m.id), s.voiceId, s.model, text, m);
  }

  /**
   * GET /api/voice/messages/:id?cached=1&part=N: the phone's ▶. Only clips already on disk, never ElevenLabs: a 404
   * means there's nothing saved to replay. `parts` is how many clips the message has, played in order.
   */
  async cachedAudio(id: number, part = 0): Promise<{ audio: Buffer; parts: number }> {
    const m = this.message(id);
    const files = m && clipsFor(this.clips, m);
    const file = files?.[part];
    const audio = file && (await fs.readFile(path.join(this.deps.cacheDir, file)).catch(() => null));
    if (!files || !audio) throw new HttpError(404, `Audio for message ${id} is no longer saved.`);
    return { audio, parts: files.length };
  }

  /** DELETE /api/voice/cache: Settings → Voice's "Clear saved clips". */
  clearCache(): Promise<VoiceCacheView> {
    return this.cacheOp(async () => {
      const names = await fs.readdir(this.deps.cacheDir).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith('.mp3'))) await fs.rm(path.join(this.deps.cacheDir, name), { force: true, maxRetries: 3 });
      this.clips = {};
      await this.saveManifest();
      return this.measure([]);
    });
  }

  /**
   * Deletes clips older than the voice settings' keepDays, then the oldest beyond 200, never the newest 20 CEO
   * messages' clips. Runs at start, on the office's housekeeping timer and after every new clip; never throws.
   */
  prune(): Promise<VoiceCacheView> {
    return this.cacheOp(async () => {
      const dir = this.deps.cacheDir;
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.mp3'));
      const stats = await Promise.all(names.map(async (name) => ({ name, st: await fs.stat(path.join(dir, name)).catch(() => null) })));
      const files = stats.flatMap(({ name, st }) => (st ? [{ name, mtimeMs: st.mtimeMs, size: st.size }] : []));
      const keep = newestClips(this.clips, this.deps.messages());
      const gone = new Set(cacheToPrune(files, this.now(), CACHE_MAX_FILES, this.deps.settings().keepDays * DAY_MS, keep));
      for (const name of [...gone]) await fs.rm(path.join(dir, name), { force: true, maxRetries: 3 }).catch(() => gone.delete(name));
      const left = files.filter((f) => !gone.has(f.name));
      const clips = withoutMissing(this.clips, new Set(left.map((f) => f.name)));
      if (Object.keys(clips).length !== Object.keys(this.clips).length) {
        this.clips = clips;
        await this.saveManifest();
      }
      return this.measure(left);
    }).catch(() => this.cacheView);
  }

  /** GET /api/voice/sample: the settings' Test button, in `voiceId` (default: the chosen voice). */
  async sampleAudio(voiceId?: string): Promise<Buffer> {
    const s = this.deps.settings();
    return this.audio('sample', voiceId || s.voiceId, s.model, SAMPLE_LINE);
  }

  /** GET /api/voice/standup: the CEO's line at a stand-up in the 3D office, made once per wording and cached. */
  async standupAudio(count: number, part: DayPart): Promise<Buffer> {
    const s = this.deps.settings();
    if (s.provider !== 'elevenlabs') throw new HttpError(404, "The CEO isn't voiced by ElevenLabs right now.");
    return this.audio('standup', s.voiceId, s.model, standupLine(count, part));
  }

  private async audio(name: string, voiceId: string, model: string, text: string, m?: PhoneMessage): Promise<Buffer> {
    if (!VOICE_ID.test(voiceId)) throw new HttpError(400, 'Pick an ElevenLabs voice first.');
    // The voice, model and words are in the file name, so a new voice or a reused message id never plays stale audio.
    const hash = crypto.createHash('sha256').update(`${voiceId}\n${model}\n${text}`).digest('hex').slice(0, 12);
    const file = path.join(this.deps.cacheDir, `${name}-${hash}.mp3`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) {
      if (m) await this.record(m, [path.basename(file)]);
      return cached;
    }
    this.requireKey();
    const busy = this.making.get(file);
    if (busy) return busy;
    const made = this.oneAtATime(() => this.synthesize(file, { voiceId, model, text }, m)).finally(() => this.making.delete(file));
    this.making.set(file, made);
    return made;
  }

  private oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async synthesize(file: string, req: { voiceId: string; model: string; text: string }, m?: PhoneMessage): Promise<Buffer> {
    this.requireKey(); // the key may have been rejected or removed while this waited its turn
    const key = this.key;
    const audio = await this.deps.api.synthesize(key, req, AbortSignal.timeout(SYNTH_TIMEOUT_MS)).catch((err) => this.failed(err, key, 'speak the message'));
    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, audio);
    await fs.rename(tmp, file);
    this.deps.log?.(`voice: made a new clip ${path.basename(file)} (${req.text.length} characters)`);
    if (m) await this.record(m, [path.basename(file)]);
    else await this.prune();
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

  // ---------- the clip manifest ----------

  private message(id: number) {
    return this.deps.messages().find((m) => m.id === id);
  }

  private cacheOp<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.cacheWork.then(fn, fn);
    this.cacheWork = run.catch(() => undefined);
    return run;
  }

  /** Records `files` as message `m`'s clips, then prunes and re-measures (the phone's ▶ follows `saved`). */
  private async record(m: PhoneMessage, files: string[]) {
    await this.cacheOp(async () => {
      this.clips = withClips(this.clips, m, files);
      await this.saveManifest();
    }).catch(() => undefined);
    await this.prune();
  }

  private manifestFile() {
    return path.join(this.deps.cacheDir, MANIFEST);
  }

  private async saveManifest() {
    await fs.mkdir(this.deps.cacheDir, { recursive: true });
    const tmp = `${this.manifestFile()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.clips));
    await fs.rename(tmp, this.manifestFile());
  }

  /** The cache view for `files` (what's on disk), told to the clients when it changed. */
  private measure(files: { size: number }[]): VoiceCacheView {
    const view: VoiceCacheView = { clips: files.length, bytes: files.reduce((n, f) => n + f.size, 0), saved: savedMessages(this.clips, this.deps.messages()) };
    if (JSON.stringify(view) !== JSON.stringify(this.cacheView)) {
      this.cacheView = view;
      this.deps.cacheChanged(view);
    }
    return view;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private async readSecrets(): Promise<Secrets & Record<string, unknown>> {
    return readSecrets(this.deps.secretsFile);
  }

  /** Merge into the secrets file (other secrets stay), owner-only where the OS has file modes. */
  private writeSecrets(patch: Secrets): Promise<void> {
    return mergeSecrets(this.deps.secretsFile, { ...patch });
  }
}

/** The account's labels, with the shortlist's description where ElevenLabs has none. */
function fill(own: Labels, ours: Labels): Labels {
  return { ...own, description: own.description || ours.description };
}
