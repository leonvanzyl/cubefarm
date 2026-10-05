import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_SETTINGS,
  autoTheme,
  birthdayOf,
  dayKey,
  dueGreeting,
  easterSunday,
  greetingLines,
  holidayOn,
  parseDateParam,
  parseThemeParam,
  resolveTheme,
  themeSettings,
  type ThemeSettings,
} from './themes.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const settings = (over: Partial<ThemeSettings> = {}): ThemeSettings => ({ ...DEFAULT_THEME_SETTINGS, ...over });

describe('easterSunday', () => {
  it('matches the published dates', () => {
    const known: [number, number, number][] = [
      [2008, 3, 23],
      [2019, 4, 21],
      [2024, 3, 31],
      [2025, 4, 20],
      [2026, 4, 5],
      [2027, 3, 28],
      [2028, 4, 16],
      [2038, 4, 25],
      [2285, 3, 22],
    ];
    for (const [y, month, day] of known) expect(easterSunday(y), String(y)).toEqual({ month, day });
  });
});

describe('holiday windows', () => {
  it('Halloween runs 24–31 October', () => {
    expect(holidayOn('halloween', at(2026, 10, 23))).toBe(false);
    expect(holidayOn('halloween', at(2026, 10, 24, 0))).toBe(true);
    expect(holidayOn('halloween', at(2026, 10, 31, 23))).toBe(true);
    expect(holidayOn('halloween', at(2026, 11, 1, 0))).toBe(false);
  });

  it('Christmas runs 1–26 December', () => {
    expect(holidayOn('christmas', at(2026, 11, 30))).toBe(false);
    expect(holidayOn('christmas', at(2026, 12, 1))).toBe(true);
    expect(holidayOn('christmas', at(2026, 12, 26))).toBe(true);
    expect(holidayOn('christmas', at(2026, 12, 27))).toBe(false);
  });

  it("New Year's crosses the year boundary", () => {
    expect(holidayOn('newyear', at(2026, 12, 30))).toBe(false);
    expect(holidayOn('newyear', at(2026, 12, 31, 23))).toBe(true);
    expect(holidayOn('newyear', at(2027, 1, 1, 0))).toBe(true);
    expect(holidayOn('newyear', at(2027, 1, 2))).toBe(false);
  });

  it("Valentine's runs 12–14 February", () => {
    expect(holidayOn('valentines', at(2027, 2, 11))).toBe(false);
    expect(holidayOn('valentines', at(2027, 2, 12))).toBe(true);
    expect(holidayOn('valentines', at(2027, 2, 14))).toBe(true);
    expect(holidayOn('valentines', at(2027, 2, 15))).toBe(false);
  });

  it('Easter runs Good Friday to Easter Monday, across a month end', () => {
    // 2024: Easter Sunday 31 March, so Good Friday 29 March and Easter Monday 1 April
    expect(holidayOn('easter', at(2024, 3, 28))).toBe(false);
    expect(holidayOn('easter', at(2024, 3, 29))).toBe(true);
    expect(holidayOn('easter', at(2024, 4, 1))).toBe(true);
    expect(holidayOn('easter', at(2024, 4, 2))).toBe(false);
    // 2026: Easter 5 April
    expect(holidayOn('easter', at(2026, 4, 3))).toBe(true);
    expect(holidayOn('easter', at(2026, 4, 7))).toBe(false);
  });

  it('the birthday is its day only, and 29 February falls on the 28th in other years', () => {
    expect(holidayOn('birthday', at(2026, 6, 15), null)).toBe(false);
    expect(holidayOn('birthday', at(2026, 6, 15), { month: 6, day: 15 })).toBe(true);
    expect(holidayOn('birthday', at(2026, 6, 16), { month: 6, day: 15 })).toBe(false);
    expect(holidayOn('birthday', at(2027, 2, 28), { month: 2, day: 29 })).toBe(true);
    expect(holidayOn('birthday', at(2028, 2, 28), { month: 2, day: 29 })).toBe(false);
    expect(holidayOn('birthday', at(2028, 2, 29), { month: 2, day: 29 })).toBe(true);
  });
});

describe('autoTheme', () => {
  it('turns Halloween on for 24–31 October and off otherwise', () => {
    expect(autoTheme(at(2026, 10, 4), settings())).toBe(null);
    expect(autoTheme(at(2026, 10, 24), settings())).toBe('halloween');
    expect(autoTheme(at(2026, 10, 31), settings())).toBe('halloween');
    expect(autoTheme(at(2026, 11, 1), settings())).toBe(null);
  });

  it('picks each holiday on its dates', () => {
    expect(autoTheme(at(2026, 12, 20), settings())).toBe('christmas');
    expect(autoTheme(at(2026, 12, 31), settings())).toBe('newyear');
    expect(autoTheme(at(2027, 1, 1), settings())).toBe('newyear');
    expect(autoTheme(at(2027, 2, 14), settings())).toBe('valentines');
    expect(autoTheme(at(2027, 3, 28), settings())).toBe('easter');
  });

  it('the birthday wins on its day', () => {
    expect(autoTheme(at(2026, 10, 30), settings({ birthday: { month: 10, day: 30 } }))).toBe('birthday');
    expect(autoTheme(at(2026, 10, 29), settings({ birthday: { month: 10, day: 30 } }))).toBe('halloween');
    expect(autoTheme(at(2026, 12, 25), settings({ birthday: { month: 12, day: 25 } }))).toBe('birthday');
  });

  it('skips the holidays switched off', () => {
    expect(autoTheme(at(2026, 10, 30), settings({ disabled: ['halloween'] }))).toBe(null);
    expect(autoTheme(at(2026, 10, 30), settings({ disabled: ['birthday'], birthday: { month: 10, day: 30 } }))).toBe('halloween');
  });
});

describe('resolveTheme', () => {
  const oct = at(2026, 10, 4);
  it('auto follows the date, off shows nothing, a forced theme shows whatever the date', () => {
    expect(resolveTheme(at(2026, 10, 25), settings())).toEqual({ id: 'halloween', source: 'auto' });
    expect(resolveTheme(at(2026, 10, 25), settings({ mode: 'off' }))).toEqual({ id: null, source: 'off' });
    expect(resolveTheme(oct, settings({ mode: 'christmas' }))).toEqual({ id: 'christmas', source: 'forced' });
  });

  it('the URL override beats the settings', () => {
    expect(resolveTheme(oct, settings({ mode: 'off' }), 'halloween')).toEqual({ id: 'halloween', source: 'url' });
    expect(resolveTheme(at(2026, 10, 25), settings({ mode: 'christmas' }), 'off')).toEqual({ id: null, source: 'url' });
    expect(resolveTheme(at(2026, 10, 25), settings({ mode: 'christmas' }), 'auto')).toEqual({ id: 'halloween', source: 'auto' });
  });
});

describe('themeSettings', () => {
  it('normalises field by field, keeping the base for anything invalid', () => {
    const base = settings({ mode: 'auto', disabled: ['easter'], birthday: { month: 3, day: 4 } });
    expect(themeSettings(base, undefined)).toEqual(base);
    expect(themeSettings(base, { mode: 'christmas' }).mode).toBe('christmas');
    expect(themeSettings(base, { mode: 'diwali' }).mode).toBe('auto');
    expect(themeSettings(base, { disabled: ['valentines', 'nope', 'valentines', 3] }).disabled).toEqual(['valentines']);
    expect(themeSettings(base, { birthday: null }).birthday).toBe(null);
    expect(themeSettings(base, { birthday: { month: 2, day: 30 } }).birthday).toEqual({ month: 3, day: 4 });
    expect(themeSettings(base, { birthday: { month: '12', day: 25 } }).birthday).toEqual({ month: 12, day: 25 });
  });

  it("doesn't share arrays with the base", () => {
    const base = settings({ disabled: ['easter'] });
    const out = themeSettings(base, {});
    out.disabled.push('halloween');
    expect(base.disabled).toEqual(['easter']);
  });

  it('reads birthdays', () => {
    expect(birthdayOf({ month: 2, day: 29 })).toEqual({ month: 2, day: 29 });
    expect(birthdayOf({ month: 4, day: 31 })).toBe(null);
    expect(birthdayOf({ month: 13, day: 1 })).toBe(null);
    expect(birthdayOf('soon')).toBe(null);
  });
});

describe('URL overrides', () => {
  it('reads ?theme=', () => {
    expect(parseThemeParam('?theme=halloween')).toBe('halloween');
    expect(parseThemeParam('?theme=OFF')).toBe('off');
    expect(parseThemeParam('?theme=auto&stats')).toBe('auto');
    expect(parseThemeParam('?theme=diwali')).toBe(null);
    expect(parseThemeParam('')).toBe(null);
  });

  it('reads ?date= as a local date or date and time', () => {
    expect(parseDateParam('?date=2026-12-24')).toBe(new Date(2026, 11, 24, 12).getTime());
    expect(parseDateParam('?date=2026-12-31T23:59:50')).toBe(new Date(2026, 11, 31, 23, 59, 50).getTime());
    expect(parseDateParam('?date=2026-02-30')).toBe(null);
    expect(parseDateParam('?date=tomorrow')).toBe(null);
    expect(parseDateParam('?x=1')).toBe(null);
  });

  it('keys days locally', () => {
    expect(dayKey(at(2026, 3, 7, 0))).toBe('2026-03-07');
    expect(dayKey(at(2026, 12, 31, 23))).toBe('2026-12-31');
  });
});

describe('dueGreeting', () => {
  const halloween = at(2026, 10, 30, 9);
  it('greets once a day while a theme is on', () => {
    const text = dueGreeting(halloween, settings(), 'Leon', []);
    expect(text).toMatch(/^🎃 Happy Halloween from the team/);
    expect(dueGreeting(halloween, settings(), 'Leon', [{ at: at(2026, 10, 30, 8).getTime(), text: text! }])).toBe(null);
    // yesterday's greeting doesn't count for today
    expect(dueGreeting(halloween, settings(), 'Leon', [{ at: at(2026, 10, 29, 8).getTime(), text: text! }])).not.toBe(null);
  });

  it('says nothing without a theme, and wishes the manager happy birthday by name', () => {
    expect(dueGreeting(at(2026, 10, 4), settings(), 'Leon', [])).toBe(null);
    expect(dueGreeting(halloween, settings({ mode: 'off' }), 'Leon', [])).toBe(null);
    expect(dueGreeting(halloween, settings({ birthday: { month: 10, day: 30 } }), 'Leon', [])).toMatch(/^🎂 Happy birthday, Leon!/);
    expect(greetingLines('birthday', '')[0]).toMatch(/^🎂 Happy birthday!/);
  });
});
