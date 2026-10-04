// Freeing disk space on idle desks (#109). A desk keeps its own node_modules and build output between tasks, which
// adds up to gigabytes on a busy floor. A desk that has sat idle longer than settings.trimIdleDesksMin loses them
// (workspace.trimDesk); its next task installs again from the warm npm cache. These are the sweep's pure decisions.

/** How often the office looks for idle desks to trim. */
export const TRIM_SWEEP_MS = 15 * 60_000;
export const DEFAULT_TRIM_IDLE_MIN = 120;
const MAX_TRIM_IDLE_MIN = 7 * 24 * 60;

/** A desk as the sweep sees it. */
export interface DeskIdle {
  key: string;
  /** Working, preparing, testing or fixing, a live CLI in its terminal, or (the preview desk) a preview running. */
  busy: boolean;
  /** When its current idle stretch began. */
  idleSince: number;
  /** When it was last trimmed; null: not since the office started. */
  trimmedAt: number | null;
}

/**
 * When a desk's idle stretch began: its last session's end or the last time a sweep saw it busy, whichever is later.
 * With neither (it hasn't worked since the office started), the office's start.
 */
export const idleSince = (endedAt: number | null, busyAt: number | null, bootAt: number) => Math.max(endedAt ?? bootAt, busyAt ?? 0);

/** The desks to trim now: idle for longer than `thresholdMin` minutes and not trimmed yet in this idle stretch. 0 = never. */
export function desksToTrim(desks: DeskIdle[], thresholdMin: number, now: number): string[] {
  if (!(thresholdMin > 0)) return [];
  return desks
    .filter((d) => !d.busy && now - d.idleSince > thresholdMin * 60_000 && (d.trimmedAt === null || d.trimmedAt < d.idleSince))
    .map((d) => d.key);
}

/** Clamp the idle time from the settings: whole minutes, 0 (never) to a week; default 120. */
export function clampTrimIdleMin(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_TRIM_IDLE_MIN, n)) : DEFAULT_TRIM_IDLE_MIN;
}

/** "512 bytes", "850 MB", "4.2 GB". */
export function formatBytes(n: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(n)} bytes`;
  return `${v < 9.95 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** The phone message after a sweep that freed something. */
export const freedMessage = (bytes: number, desks: number) => `🧹 Freed ${formatBytes(bytes)} from ${desks} idle desk${desks === 1 ? '' : 's'}`;
