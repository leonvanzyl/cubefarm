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
  hire: 'proposals wait for you',
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

/** The note as plain text, e.g. for Telegram, the demo's log and the push body. */
export function noteText(n: Note, officeUrl = ''): string {
  return `${n.title}\n${n.body}${link(officeUrl)}`.trim();
}

export function discordPayload(n: Note, officeUrl = '') {
  // <url> stops Discord unfurling a preview card for the link.
  return { username: 'cubefarm', content: `**${n.title}**\n${n.body}${officeUrl ? `\n<${officeUrl}>` : ''}`.slice(0, 2000), allowed_mentions: { parse: [] } };
}

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slackPayload(n: Note, officeUrl = '') {
  return { text: `*${slackEscape(n.title)}*\n${slackEscape(n.body)}${officeUrl ? `\n<${officeUrl}|Open the office>` : ''}`, unfurl_links: false };
}

export function telegramPayload(n: Note, chatId: string, officeUrl = '') {
  return { chat_id: chatId, text: noteText(n, officeUrl).slice(0, 4000), disable_web_page_preview: true };
}

/** ntfy's JSON publishing: POSTed to the server's root with the topic in the body. */
export function ntfyPayload(n: Note, topic: string, officeUrl = '') {
  const urgent = n.event === 'needsHuman' || n.event === 'agentError' || n.event === 'usage';
  return { topic, title: n.title, message: n.body, priority: urgent ? 4 : 3, ...(officeUrl ? { click: officeUrl } : {}) };
}

// ---------- the chat apps' settings ----------

export interface WebhookSecrets {
  discord?: { url: string };
  slack?: { url: string };
  telegram?: { token: string; chatId: string };
  ntfy?: { url: string; token?: string };
}

const httpsUrl = (raw: unknown, what: string, host?: RegExp): URL => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `That isn't a ${what} URL.`);
  }
  if (s.length > 500 || (u.protocol !== 'https:' && !(host === undefined && u.protocol === 'http:')) || (host && !host.test(u.hostname))) throw new HttpError(400, `That isn't a ${what} URL.`);
  return u;
};

/**
 * A chat app's settings from PUT /api/notify/webhooks/:channel, checked. null removes them (an empty url or token).
 * Discord and Slack take their webhook URL, Telegram a bot token and chat id, ntfy a topic URL and an optional token.
 */
export function parseWebhook(channel: NotifyWebhook, body: unknown): WebhookSecrets[NotifyWebhook] | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
  if (channel === 'telegram') {
    if (!s('token')) return null;
    if (!/^\d{3,20}:[\w-]{20,80}$/.test(s('token'))) throw new HttpError(400, "That doesn't look like a Telegram bot token (123456:ABC…, from @BotFather).");
    if (!/^(-?\d{1,20}|@\w{4,64})$/.test(s('chatId'))) throw new HttpError(400, 'The chat id is a number (e.g. 123456789, or -100… for a group) or @channelname.');
    return { token: s('token'), chatId: s('chatId') };
  }
  if (!s('url')) return null;
  if (channel === 'discord') {
    const u = httpsUrl(s('url'), 'Discord webhook', /^(discord|discordapp|ptb\.discord|canary\.discord)\.com$/);
    if (!u.pathname.startsWith('/api/webhooks/')) throw new HttpError(400, "That isn't a Discord webhook URL (https://discord.com/api/webhooks/…).");
    return { url: u.toString() };
  }
  if (channel === 'slack') {
    const u = httpsUrl(s('url'), 'Slack webhook', /^hooks\.slack\.com$/);
    if (!u.pathname.startsWith('/services/') && !u.pathname.startsWith('/triggers/')) throw new HttpError(400, "That isn't a Slack incoming webhook URL (https://hooks.slack.com/services/…).");
    return { url: u.toString() };
  }
  const u = httpsUrl(s('url'), 'ntfy topic');
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
  if ('chatId' in w) return `bot …${last4(w.token)} · chat …${last4(w.chatId)}`;
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
