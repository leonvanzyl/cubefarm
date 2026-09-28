import type { UsageView } from '../shared/types.ts';

// Pacing new work on Claude's usage warnings (#40). Every agent shares one subscription. When Claude warns that
// usage is getting high, the office slows down instead of running into the hard limit: finishing beats starting.
// QA, QA fixes and CEO jobs start as normal; new issues only while fewer than settings.pacingSessions sessions run.

/** How long pacing lasts when Claude doesn't say when the window resets. */
export const PACING_MS = 60 * 60_000;
export const DEFAULT_PACING_SESSIONS = 3;

/** What a session is started for. Only new issues are held back while pacing. */
export type WorkKind = 'issue' | 'qa' | 'fix' | 'ceo';

export interface UsageClock {
  now: number;
  pausedUntil: number; // Claude rejected a session for the usage limit: nothing new starts before this
  pacingUntil: number; // Claude warned about usage: new issues are paced until this
}

/** May work of this kind start now? A rejection pauses everything; pacing caps new issues at `pacingSessions` running. */
export function mayStart(kind: WorkKind, c: UsageClock & { running: number; pacingSessions: number }): boolean {
  if (c.now < c.pausedUntil) return false;
  if (kind === 'issue' && c.now < c.pacingUntil) return c.running < c.pacingSessions;
  return true;
}

/** The usage state for the snapshot. */
export function usageView(c: UsageClock): UsageView {
  if (c.now < c.pausedUntil) return { state: 'paused', until: c.pausedUntil };
  if (c.now < c.pacingUntil) return { state: 'pacing', until: c.pacingUntil };
  return { state: 'normal', until: null };
}

/** "14:30", with the weekday when it isn't today. */
export function clock(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`;
}

/** company.usage for the CEO: "normal", "pacing until 14:30" or "paused until 14:30". */
export function usageLabel(u: UsageView, now: number): string {
  return u.state === 'normal' || u.until === null ? 'normal' : `${u.state} until ${clock(u.until, now)}`;
}

/** Clamp the pacing cap from the settings (1-32, default 3). */
export function clampPacingSessions(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(32, n) : DEFAULT_PACING_SESSIONS;
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'weekly Opus limit',
  seven_day_sonnet: 'weekly Sonnet limit',
};

/** A usage warning as the SDK reports it. utilization may be a fraction (0.82) or a percentage (82). */
export interface UsageWarning {
  resetsAt: number | null; // epoch ms
  rateLimitType: string | null;
  utilization: number | null;
}

/** The phone message when pacing starts. */
export function pacingMessage(w: UsageWarning, until: number, sessions: number, now: number): string {
  const pct = w.utilization === null ? null : Math.round(w.utilization <= 1 ? w.utilization * 100 : w.utilization);
  const what = [w.rateLimitType ? (LIMIT_NAMES[w.rateLimitType] ?? w.rateLimitType.replace(/_/g, ' ')) : null, pct === null ? null : `${pct}%`].filter(Boolean).join(', ');
  return `🐢 Claude's usage is getting high${what ? ` (${what})` : ''}. Until ${clock(until, now)} the office finishes open work first and starts at most ${sessions} session${sessions === 1 ? '' : 's'} at a time.`;
}
