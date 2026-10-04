// The voice's saved clips, as both sides see them: how long they're kept (Settings → Voice) and how the cache is described.

export const KEEP_DAYS_DEFAULT = 7;
export const KEEP_DAYS_MIN = 1;
export const KEEP_DAYS_MAX = 90;

/** "Keep voice clips for N days": a whole number of days, 1–90; anything unreadable is the default 7. */
export function clampKeepDays(v: unknown): number {
  const n = (typeof v === 'number' || typeof v === 'string') && String(v).trim() ? Math.round(Number(v)) : NaN;
  return Number.isFinite(n) ? Math.min(KEEP_DAYS_MAX, Math.max(KEEP_DAYS_MIN, n)) : KEEP_DAYS_DEFAULT;
}

/** "12 clips · 3.4 MB" for Settings → Voice. */
export function cacheLabel(clips: number, bytes: number): string {
  const size = bytes < 1024 * 1024 ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${clips} clip${clips === 1 ? '' : 's'} · ${size}`;
}
