// Notifications, the pure part (docs/pocket.md): what a note says on each channel, the per-event rate limit that
// batches bursts into one summary, the chat apps' webhook settings (checked, and hinted at without the secret), and
// which agents have been stuck in an error long enough to mention. notifier.ts does the sending.
import type { NotifyEvent, NotifyWebhook } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

/** Never more than one notification per event type in this long; what arrives meanwhile goes out as one summary. */
export const NOTE_WINDOW_MS = 60_000;
/** An agent in an error this long is worth a notification (once per error). */
export const STUCK_ERROR_MS = 10 * 60_000;
const BODY_MAX = 300;
const SUMMARY_LINES = 5;
const HELD_MAX = 50;

/** One thing to tell the manager. `line` is its one-line form, used when a summary lists several. */
export interface Note {
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  line: string;
}

const PLURAL: Record<NotifyEvent, string> = {
  needsHuman: 'PRs need you',
  ceoMessage: 'messages from the CEO',
  hire: 'team changes wait for you',
  agentError: 'agents need help',
  usage: 'usage changes',
  merge: 'merges',
};
const ICON: Record<NotifyEvent | 'test', string> = { needsHuman: '⚠️', ceoMessage: '💬', hire: '📄', agentError: '🛑', usage: '⏸', merge: '🔀', test: '🔔' };

export const clip = (s: string, max = BODY_MAX) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A phone message's markdown as one plain line: no emphasis, code ticks, headings or link targets. */
export function plainText(md: string, max = BODY_MAX): string {
  const s = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?!\s)([^*_\n]+?)[*_](?!\w)/g, '$1$2')
    .replace(/^\s*(#{1,6}|>|[-*+•])\s+/gm, '')
    .replace(/\|/g, ' ');
  return clip(s, max);
}

/** A note with its event's icon in front of the title. */
export function note(event: NotifyEvent | 'test', title: string, body: string, line = title): Note {
  return { event, title: `${ICON[event]} ${clip(title, 120)}`, body: clip(body), line: clip(line, 120) };
}

/** Several held notes of one event as a single summary (one note stays itself). `dropped`: more that weren't kept. */
export function summarize(held: Note[], dropped = 0): Note {
  if (held.length === 1 && !dropped) return held[0];
  const event = held[0].event;
  const total = held.length + dropped;
  const shown = held.slice(0, SUMMARY_LINES);
  const lines = shown.map((n) => `• ${n.line}`);
  if (total > shown.length) lines.push(`…and ${total - shown.length} more`);
  const label = event === 'test' ? 'tests' : PLURAL[event];
  return { event, title: `${ICON[event]} ${total} more ${label}`, body: lines.join('\n'), line: `${total} more ${label}` };
}

// ---------- rate limit ----------

/** Per event type: when its last notification went out, and what arrived since. */
export type Gates = Partial<Record<string, { last: number; held: Note[]; dropped: number }>>;

/** A new note: out at once if its event had nothing in the last minute, otherwise held for the summary. */
export function offer(gates: Gates, n: Note, now: number): { gates: Gates; send: Note | null } {
  const g = gates[n.event];
  if (!g || (now - g.last >= NOTE_WINDOW_MS && g.held.length === 0)) return { gates: { ...gates, [n.event]: { last: now, held: [], dropped: 0 } }, send: n };
  const full = g.held.length >= HELD_MAX;
  return { gates: { ...gates, [n.event]: { ...g, held: full ? g.held : [...g.held, n], dropped: g.dropped + (full ? 1 : 0) } }, send: null };
}

/** The summaries whose minute is up. */
export function due(gates: Gates, now: number): { gates: Gates; send: Note[] } {
  const send: Note[] = [];
  const next: Gates = { ...gates };
  for (const [event, g] of Object.entries(gates)) {
    if (!g || g.held.length === 0 || now - g.last < NOTE_WINDOW_MS) continue;
    send.push(summarize(g.held, g.dropped));
    next[event] = { last: now, held: [], dropped: 0 };
  }
  return { gates: next, send };
}

/** When the next summary is due, or null when nothing is held. */
export function nextDue(gates: Gates): number | null {
  const times = Object.values(gates).flatMap((g) => (g && g.held.length ? [g.last + NOTE_WINDOW_MS] : []));
  return times.length ? Math.min(...times) : null;
}

// ---------- what each channel is sent ----------

/** The office's link, or nothing. */
const link = (officeUrl: string) => (officeUrl ? `\n${officeUrl}` : '');

/** The note as plain text, e.g. for the demo's log and the push body. */
export function noteText(n: Note, officeUrl = ''): string {
  return `${n.title}\n${n.body}${link(officeUrl)}`.trim();
}

/** ntfy's JSON publishing: POSTed to the server's root with the topic in the body. */
export function ntfyPayload(n: Note, topic: string, officeUrl = '') {
  const urgent = n.event === 'needsHuman' || n.event === 'agentError' || n.event === 'usage';
  return { topic, title: n.title, message: n.body, priority: urgent ? 4 : 3, ...(officeUrl ? { click: officeUrl } : {}) };
}

// ---------- the chat apps' settings ----------

export interface WebhookSecrets {
  ntfy?: { url: string; token?: string };
}

const httpUrl = (raw: unknown, what: string): URL => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `That isn't a ${what} URL.`);
  }
  if (s.length > 500 || !/^https?:$/.test(u.protocol)) throw new HttpError(400, `That isn't a ${what} URL.`);
  return u;
};

/**
 * A chat app's settings from PUT /api/notify/webhooks/:channel, checked. null removes them (an empty url or token).
 * ntfy takes a topic URL and an optional token.
 */
export function parseWebhook(_channel: NotifyWebhook, body: unknown): WebhookSecrets[NotifyWebhook] | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  if (!s('url')) return null;
  const u = httpUrl(s('url'), 'ntfy topic');
  if (!/^\/[\w-]{1,64}\/?$/.test(u.pathname)) throw new HttpError(400, 'Give the topic URL, e.g. https://ntfy.sh/my-office-a8f3 (a long, hard-to-guess topic name).');
  const token = s('token');
  if (token && !/^[\w.-]{8,200}$/.test(token)) throw new HttpError(400, "That doesn't look like an ntfy access token (tk_…).");
  return { url: u.toString().replace(/\/$/, ''), ...(token ? { token } : {}) };
}

/** Where an ntfy topic URL publishes as JSON: the server's root, with the topic in the body. */
export function ntfyTarget(topicUrl: string): { root: string; topic: string } {
  const u = new URL(topicUrl);
  return { root: `${u.origin}/`, topic: u.pathname.replace(/^\/|\/$/g, '') };
}

const last4 = (s: string) => s.slice(-4);

/** What the settings show of a saved webhook: enough to recognise it, never enough to use it. */
export function webhookHint(channel: NotifyWebhook, w: WebhookSecrets[NotifyWebhook] | undefined): string {
  if (!w) return '';
  const host = new URL(w.url).host;
  return `${host}/…${last4(w.url)}${channel === 'ntfy' && 'token' in w && w.token ? ' · with a token' : ''}`;
}

/** The secret strings in `w`, for redacting anything that might echo them. */
export function secretValues(w: WebhookSecrets): string[] {
  return Object.values(w).flatMap((v) => Object.values(v ?? {}).filter((x): x is string => typeof x === 'string' && x.length >= 6));
}

/** `text` with every secret (and any URL path, which is where webhook secrets live) blanked out. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('••••');
  return out.replace(/(https?:\/\/[^/\s]+)\/[^\s]*/g, '$1/••••');
}

// ---------- stuck agents ----------

/** Agents stuck in an error for STUCK_ERROR_MS that haven't been mentioned for this error yet (keyed by id and endedAt). */
export function stuckAgents<A extends { id: string; status: string; endedAt: number | null }>(agents: readonly A[], now: number, told: ReadonlySet<string>): { agent: A; key: string }[] {
  return agents.flatMap((a) => {
    const key = `${a.id}:${a.endedAt ?? 0}`;
    return a.status === 'error' && a.endedAt != null && now - a.endedAt >= STUCK_ERROR_MS && !told.has(key) ? [{ agent: a, key }] : [];
  });
}
