// Notification settings shared by the server (validation, defaults) and the settings UI (labels): which events the
// office tells the manager about, on which channels, and the office URL messages link back to (docs/pocket.md).
import type { NotifyChannel, NotifyEvent, NotifySettings, NotifyWebhook } from './types.ts';

/** In the order the settings list them. */
export const NOTIFY_EVENTS: { id: NotifyEvent; label: string }[] = [
  { id: 'needsHuman', label: 'A pull request needs me' },
  { id: 'ceoMessage', label: 'A message from the CEO' },
  { id: 'hire', label: 'A hire or let-go waits for my decision' },
  { id: 'agentError', label: 'Someone is stuck in an error for over 10 minutes' },
  { id: 'usage', label: "Claude's usage limit pauses or paces the office" },
  { id: 'merge', label: 'Every merge' },
];

export const NOTIFY_WEBHOOKS: NotifyWebhook[] = ['ntfy'];
export const NOTIFY_CHANNELS: NotifyChannel[] = ['desktop', 'push', ...NOTIFY_WEBHOOKS];

/** Merges are optional: on a busy office they're the noisiest event. */
export const DEFAULT_NOTIFY: NotifySettings = {
  events: { needsHuman: true, ceoMessage: true, hire: true, agentError: true, usage: true, merge: false },
  channels: { desktop: true, push: true, ntfy: true },
  officeUrl: '',
};

/** An http(s) address the manager's devices can open, or null. */
export function officeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return '';
  if (s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Notification settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function notifySettings(base: NotifySettings, patch: unknown): NotifySettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as { events?: unknown; channels?: unknown; officeUrl?: unknown };
  const pick = <K extends string>(keys: readonly K[], from: Record<K, boolean>, raw: unknown): Record<K, boolean> => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return Object.fromEntries(keys.map((k) => [k, typeof r[k] === 'boolean' ? r[k] : from[k] ?? false])) as Record<K, boolean>;
  };
  const url = officeUrl(p.officeUrl);
  return {
    events: pick(
      NOTIFY_EVENTS.map((e) => e.id),
      { ...DEFAULT_NOTIFY.events, ...base.events },
      p.events,
    ),
    channels: pick(NOTIFY_CHANNELS, { ...DEFAULT_NOTIFY.channels, ...base.channels }, p.channels),
    officeUrl: url ?? base.officeUrl ?? '',
  };
}

/** The pocket tab a notification about `event` opens. */
export function noteTab(event: NotifyEvent | 'test'): string {
  if (event === 'needsHuman' || event === 'hire') return 'approvals';
  if (event === 'ceoMessage') return 'chat';
  if (event === 'agentError') return 'team';
  return 'company';
}
