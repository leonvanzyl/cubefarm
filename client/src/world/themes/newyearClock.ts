// New Year's Eve, the pure side: where the local clock stands against midnight. Waiting (with how long to go), the
// last ten seconds' countdown, the show at midnight (fireworks, cheering at the windows), then the new year.

/** Seconds of countdown shown on the app monitors and in the lobby before midnight. */
export const COUNTDOWN_S = 10;
/** How long after midnight the show goes on. */
export const SHOW_S = 90;

export type NewYearPhase = 'waiting' | 'countdown' | 'show' | 'newyear';

export interface NewYearState {
  phase: NewYearPhase;
  /** Seconds to the next local midnight of 1 January (counting down), or since the last one (after it). */
  seconds: number;
  /** The year that's coming (waiting, countdown) or has just begun (show, newyear). */
  year: number;
}

/** Where `now` (epoch ms, read in local time) stands against New Year's midnight. */
export function newYearState(now: number): NewYearState {
  const d = new Date(now);
  const y = d.getFullYear();
  const lastMidnight = new Date(y, 0, 1).getTime();
  const since = (now - lastMidnight) / 1000;
  // the first day of the year: the show, then the new year
  if (since < 86_400) return { phase: since < SHOW_S ? 'show' : 'newyear', seconds: since, year: y };
  const left = (new Date(y + 1, 0, 1).getTime() - now) / 1000;
  return { phase: left <= COUNTDOWN_S ? 'countdown' : 'waiting', seconds: left, year: y + 1 };
}

/** The number on the countdown (10 … 1) in its last seconds. */
export const countdownNumber = (s: NewYearState) => Math.max(1, Math.ceil(s.seconds));

/** "3:12:05", or "4 days" when it's further off. */
export function timeToGo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86_400 * 2) return `${Math.floor(s / 86_400)} days`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
