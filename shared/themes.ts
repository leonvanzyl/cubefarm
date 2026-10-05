// Holiday themes, the pure side both ends share: which holidays there are and when (by the local date), the manager's
// Settings → Themes (auto, off or a forced theme, holidays switched off one by one, their birthday), which theme is on
// for a date, and the team's phone greeting for the day. The client dresses the office from this (world/themes/); the
// server sends the greeting.

export const THEME_IDS = ['halloween', 'christmas', 'newyear', 'valentines', 'easter', 'birthday'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);

/** auto: by the date · off: never · a theme: that one, whatever the date. */
export type ThemeMode = 'auto' | 'off' | ThemeId;

export interface Birthday {
  month: number; // 1-12
  day: number; // 1-31
}

export interface ThemeSettings {
  mode: ThemeMode;
  /** Holidays the office doesn't celebrate in auto mode. */
  disabled: ThemeId[];
  /** The manager's birthday (no year), or null. */
  birthday: Birthday | null;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = { mode: 'auto', disabled: [], birthday: null };

/** For Settings → Themes: each theme's name, emoji and when it's on. */
export const THEME_INFO: Record<ThemeId, { name: string; emoji: string; when: string }> = {
  halloween: { name: 'Halloween', emoji: '🎃', when: '24–31 Oct' },
  christmas: { name: 'Christmas', emoji: '🎄', when: '1–26 Dec' },
  newyear: { name: "New Year's Eve", emoji: '🎆', when: '31 Dec–1 Jan' },
  valentines: { name: "Valentine's Day", emoji: '💘', when: '12–14 Feb' },
  easter: { name: 'Easter', emoji: '🐣', when: 'Good Friday to Easter Monday' },
  birthday: { name: 'Your birthday', emoji: '🎂', when: 'on the day you set' },
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A valid birthday from anything (Feb 29 allowed), or null. */
export function birthdayOf(v: unknown): Birthday | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const month = Math.round(Number(b.month));
  const day = Math.round(Number(b.day));
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= DAYS_IN_MONTH[month - 1])) return null;
  return { month, day };
}

/** Theme settings from a saved state or a PATCH /api/settings, field by field; anything invalid keeps `base`. */
export function themeSettings(base: ThemeSettings, patch: unknown): ThemeSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof ThemeSettings, unknown>>;
  const out: ThemeSettings = { mode: base.mode, disabled: [...base.disabled], birthday: base.birthday ? { ...base.birthday } : null };
  if (p.mode === 'auto' || p.mode === 'off' || isThemeId(p.mode)) out.mode = p.mode;
  if (Array.isArray(p.disabled)) out.disabled = THEME_IDS.filter((id) => (p.disabled as unknown[]).includes(id));
  if (p.birthday === null) out.birthday = null;
  else if (p.birthday !== undefined) out.birthday = birthdayOf(p.birthday) ?? out.birthday;
  return out;
}

// ---------- dates ----------

/** The local calendar day as YYYY-MM-DD (the egg hunt, presents and greetings reset on it). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Easter Sunday of `year` (Gregorian; the anonymous algorithm), as month 1-12 and day. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { month: Math.floor(n / 31), day: (n % 31) + 1 };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days since an arbitrary epoch for a local calendar date, for windows that cross a month (Easter). */
const dayNumber = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

/** Whether holiday `id` is on for the local date `date` (the birthday needs `birthday`). */
export function holidayOn(id: ThemeId, date: Date, birthday: Birthday | null = null): boolean {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const md = m * 100 + d;
  switch (id) {
    case 'halloween':
      return md >= 1024 && md <= 1031;
    case 'christmas':
      return md >= 1201 && md <= 1226;
    case 'newyear':
      return md === 1231 || md === 101;
    case 'valentines':
      return md >= 212 && md <= 214;
    case 'easter': {
      const e = easterSunday(y);
      const off = dayNumber(y, m, d) - dayNumber(y, e.month, e.day);
      return off >= -2 && off <= 1; // Good Friday to Easter Monday
    }
    case 'birthday': {
      if (!birthday) return false;
      // a 29 February birthday is kept on the 28th in other years
      const day = birthday.month === 2 && birthday.day === 29 && !isLeap(y) ? 28 : birthday.day;
      return m === birthday.month && d === day;
    }
  }
}

/** The theme auto mode picks for `date`: the birthday outranks everything, then the first holiday that's on. */
export function autoTheme(date: Date, s: ThemeSettings): ThemeId | null {
  const on = (id: ThemeId) => !s.disabled.includes(id) && holidayOn(id, date, s.birthday);
  if (on('birthday')) return 'birthday';
  return THEME_IDS.find((id) => id !== 'birthday' && on(id)) ?? null;
}

/** Where the theme on screen came from: the date, a forced theme, nothing (off), or the URL (?theme=, for QA). */
export type ThemeSource = 'auto' | 'forced' | 'off' | 'url';

/** `?theme=` in the URL: a theme, auto or off; null when absent or unknown. */
export function parseThemeParam(search: string): ThemeMode | null {
  const v = new URLSearchParams(search).get('theme')?.trim().toLowerCase();
  return v === 'auto' || v === 'off' || isThemeId(v) ? v : null;
}

/**
 * `?date=` in the URL (QA): a local date (2026-12-24) or date and time (2026-12-31T23:59:50) to pretend it is, as
 * epoch ms; null when absent or not a date.
 */
export function parseDateParam(search: string): number | null {
  const v = new URLSearchParams(search).get('date')?.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h = '12', mi = '0', s = '0'] = m.slice(1);
  const t = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return t.getMonth() === Number(mo) - 1 && t.getDate() === Number(d) ? t.getTime() : null;
}

/** The theme on for `date`: the URL's override (QA) beats the settings' mode, which is auto, off or a forced theme. */
export function resolveTheme(date: Date, s: ThemeSettings, override: ThemeMode | null = null): { id: ThemeId | null; source: ThemeSource } {
  const mode = override ?? s.mode;
  const source: ThemeSource = override && override !== 'auto' ? 'url' : mode === 'off' ? 'off' : mode === 'auto' ? 'auto' : 'forced';
  if (mode === 'off') return { id: null, source };
  if (mode !== 'auto') return { id: mode, source };
  return { id: autoTheme(date, s), source: 'auto' };
}

// ---------- the phone greeting ----------

/** The team's greeting lines, one a day while the theme's on (`{name}` is the manager's name). */
export const GREETINGS: Record<ThemeId, string[]> = {
  halloween: [
    '🎃 Happy Halloween from the team! There’s a candy bowl at reception, and someone carved the pumpkins on every desk.',
    '🎃 Happy Halloween from the team! Mind the bats on the balcony, and the gravestone in the lobby (RIP flaky e2e).',
  ],
  christmas: [
    '🎄 Happy holidays from the team! There are presents under the tree in the lobby with your name on them.',
    '🎄 Happy holidays from the team! The coffee machine is serving hot chocolate until Boxing Day.',
  ],
  newyear: ['🎆 Happy New Year’s Eve from the team! Fireworks over the city at midnight, see you at the windows.', '🎆 Happy New Year from the team! Here’s to a year of green builds.'],
  valentines: ['💘 Happy Valentine’s Day from the team! We love shipping with you.', '💘 Happy Valentine’s Day from the team! Check the monitors for little hearts.'],
  easter: ['🐣 Happy Easter from the team! 12 eggs are hidden around the office today. Can you find them all?', '🐣 Happy Easter from the team! The egg hunt is on: 12 eggs, one golden trophy.'],
  birthday: ['🎂 Happy birthday{name}! The whole team is waiting for you in the lobby, and there’s cake on your desk.', '🎂 Happy birthday{name}! Come down to the lobby: the team has something for you.'],
};

/** Every line `id` may greet with today, with the manager's name filled in. */
export const greetingLines = (id: ThemeId, name: string) => GREETINGS[id].map((l) => l.replace('{name}', name ? `, ${name}` : ''));

const dayHash = (key: string) => [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * The greeting due now, or null: the line for the theme on today (from the settings; a birthday's comes from the
 * CEO), unless one of the theme's lines already went out today.
 */
export function dueGreeting(now: Date, s: ThemeSettings, name: string, sent: readonly { at: number; text: string }[]): string | null {
  const { id } = resolveTheme(now, s);
  if (!id) return null;
  const lines = greetingLines(id, name);
  const today = dayKey(now);
  if (sent.some((m) => lines.includes(m.text) && dayKey(new Date(m.at)) === today)) return null;
  return lines[dayHash(today) % lines.length];
}
