// What a theme remembers in this browser (localStorage): presents opened and eggs found today, stickers collected,
// candles blown out. Wrapped so a private window or blocked storage just means nothing is remembered.

export function loadList<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function saveList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage may be unavailable; it just won't be remembered
  }
}

/** A list kept for one day: `key`'s list for `day` (another day's reads as empty), written when `set` is given. */
export function daily<T = number>(key: string, day: string, set?: T[]): T[] {
  if (set) {
    try {
      localStorage.setItem(key, JSON.stringify({ day, list: set }));
    } catch {
      // as above
    }
    return set;
  }
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as { day?: string; list?: unknown } | null;
    return v?.day === day && Array.isArray(v.list) ? (v.list as T[]) : [];
  } catch {
    return [];
  }
}
