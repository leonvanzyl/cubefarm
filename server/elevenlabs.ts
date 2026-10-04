// ElevenLabs' REST API through Node's fetch: checking a key, listing the account's voices, speaking a message.
// The key travels only in the xi-api-key header; error messages are ElevenLabs' own words, never the key.
import type { VoiceOption } from '../shared/types.ts';
import { VoiceApiError, type VoiceApi } from './voice.ts';

const API = 'https://api.elevenlabs.io';
const CHECK_TIMEOUT_MS = 10_000;
const MAX_VOICE_PAGES = 5; // 100 voices a page

async function call(key: string, pathname: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${pathname}`, { ...init, signal, headers: { ...init.headers, 'xi-api-key': key } });
  } catch (err) {
    throw new VoiceApiError(0, signal.aborted ? 'it took too long to answer' : `it couldn't be reached (${(err as Error).message})`);
  }
  if (!res.ok) throw new VoiceApiError(res.status, await reason(res));
  return res;
}

/** ElevenLabs' errors carry `detail` as a string, as { message, status }, or as a list of validation errors. */
async function reason(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let text = '';
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof d === 'string') text = d;
    else if (Array.isArray(d)) text = d.map((x) => (x as { msg?: unknown })?.msg).filter(Boolean).join('; ');
    else if (d && typeof d === 'object') text = String((d as { message?: unknown }).message ?? (d as { status?: unknown }).status ?? '');
  } catch {
    // not JSON
  }
  return `${res.status}${text ? `: ${text}` : ''}`.slice(0, 200);
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');

interface ApiVoice {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  labels?: Record<string, unknown> | null;
  preview_url?: unknown;
}

function voiceOption(v: ApiVoice): Omit<VoiceOption, 'recommended'> {
  const l = v.labels ?? {};
  return {
    id: s(v.voice_id),
    name: s(v.name),
    category: s(v.category),
    labels: { accent: s(l.accent), gender: s(l.gender), age: s(l.age), description: s(l.description) || s(l.descriptive), use_case: s(l.use_case) || s(l['use case']) },
    previewUrl: s(v.preview_url) || null,
  };
}

export const elevenLabs: VoiceApi = {
  // The cheapest call a voices-reading key can make: one voice.
  async checkKey(key) {
    await call(key, '/v2/voices?page_size=1&include_total_count=false', {}, AbortSignal.timeout(CHECK_TIMEOUT_MS));
  },

  async listVoices(key) {
    const out: Omit<VoiceOption, 'recommended'>[] = [];
    let token = '';
    for (let page = 0; page < MAX_VOICE_PAGES; page++) {
      const q = new URLSearchParams({ page_size: '100', include_total_count: 'false', ...(token ? { next_page_token: token } : {}) });
      const res = await call(key, `/v2/voices?${q}`, {}, AbortSignal.timeout(CHECK_TIMEOUT_MS));
      const body = (await res.json()) as { voices?: ApiVoice[]; has_more?: boolean; next_page_token?: string | null };
      for (const v of body.voices ?? []) if (s(v.voice_id)) out.push(voiceOption(v));
      token = s(body.next_page_token);
      if (!body.has_more || !token) break;
    }
    return out;
  },

  async synthesize(key, { voiceId, model, text }, signal) {
    const res = await call(
      key,
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: model }) },
      signal,
    );
    return Buffer.from(await res.arrayBuffer());
  },
};
