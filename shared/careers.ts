// Careers (#226): an agent's record as the ledger (server/ledger.ts) keeps it, and what the office reads from it: pass
// rates, a rank, a "known for" line, the MVP of the week and the things that pile up on their desk. Pure.

/** One agent's career, kept compactly on their record. */
export interface CareerView {
  /** When they joined the team (ms). */
  since: number;
  /** PRs opened. */
  opened: number;
  /** PRs merged. */
  merged: number;
  /** PRs that passed QA on their first round. */
  firstPass: number;
  /** QA rounds on their PRs that passed, and that failed. */
  qaPass: number;
  qaFail: number;
  /** Fix rounds their merged PRs needed, all told. */
  fixRounds: number;
  /** PRs in a row that passed QA first time: now, and the longest run. */
  run: number;
  best: number;
  /** QA reviews done (pull requests they tested). */
  reviews: number;
  /** The coding agents' own estimate, over every session. */
  costUsd: number;
  turns: number;
  /** The last few merged PRs, newest first. */
  recent: { n: number; title: string; at: number }[];
  /** When their merges of the last week landed. */
  week: number[];
}

export const RECENT_KEEP = 8;
export const WEEK_MS = 7 * 24 * 3_600_000;
export const DAY_MS = 24 * 3_600_000;

export function newCareer(since: number): CareerView {
  return { since, opened: 0, merged: 0, firstPass: 0, qaPass: 0, qaFail: 0, fixRounds: 0, run: 0, best: 0, reviews: 0, costUsd: 0, turns: 0, recent: [], week: [] };
}

/** QA rounds passed as a share of all QA rounds on their PRs (0-1), or null before any. */
export function passRate(c: CareerView): number | null {
  const n = c.qaPass + c.qaFail;
  return n ? c.qaPass / n : null;
}

/** Fix rounds per merged PR, or null before the first merge. */
export const avgFixRounds = (c: CareerView): number | null => (c.merged ? c.fixRounds / c.merged : null);

export const tenureDays = (c: CareerView, now: number) => Math.max(0, (now - c.since) / DAY_MS);

/** Merges in the 7 days before `now`. */
export const mergesThisWeek = (c: CareerView, now: number) => c.week.filter((t) => t > now - WEEK_MS && t <= now).length;

/** A fun rank from their work: merges and QA reviews together. */
export function rank(c: CareerView): string {
  const n = c.merged + c.reviews;
  return n >= 40 ? 'Legend' : n >= 15 ? 'Veteran' : n >= 5 ? 'Regular' : 'Rookie';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Mostly reviews other people's work: more QA reviews than merges, and a few of them. */
const mostlyReviews = (c: CareerView) => c.reviews > c.merged && c.reviews >= 3;

/** The career card's one-liner: what they're best known for, picked from the stats. */
export function knownFor(c: CareerView): string {
  if (mostlyReviews(c)) return `QA reviews: ${c.reviews} and counting`;
  if (c.best >= 3) return `First-time QA passes: ${c.best} in a row`;
  const rate = passRate(c);
  if (rate === 1 && c.qaPass >= 3) return `Never failed QA: ${plural(c.qaPass, 'round')} passed`;
  if (c.merged >= 1 && avgFixRounds(c) === 0) return `Clean shipper: ${plural(c.merged, 'PR')} merged without a fix round`;
  if (c.merged >= 1) return `Shipped ${plural(c.merged, 'PR')} so far`;
  if (c.opened >= 1) return 'First PR in review, fingers crossed';
  return 'Fresh on the team: first task coming up';
}

/** The MVP of the week among `people`: most merges in the last 7 days (ties: most merged overall). Null without any. */
export function mvpOfWeek<T extends { career: CareerView | null }>(people: T[], now: number): { who: T; merges: number } | null {
  let best: { who: T; merges: number } | null = null;
  for (const p of people) {
    if (!p.career) continue;
    const merges = mergesThisWeek(p.career, now);
    if (merges === 0) continue;
    if (!best || merges > best.merges || (merges === best.merges && p.career.merged > (best.who.career?.merged ?? 0))) best = { who: p, merges };
  }
  return best;
}

// ---------- the desk ----------

export type DeskToy = 'duck' | 'speaker' | 'cradle' | 'magnifier';

/** What their desk shows: plaques for merged PRs, the gold star and the personal items tenure brings. */
export interface DeskItems {
  /** PR numbers on the plaques, newest first (up to PLAQUES). */
  plaques: number[];
  /** Merged PRs beyond the plaques shown, for the "+N" plaque. */
  more: number;
  /** Ten first-time QA passes. */
  star: boolean;
  /** How tall the desk plant has grown (1: as it arrived). */
  plant: number;
  /** A framed photo, after a day on the team. */
  photo: boolean;
  /** A desk toy of their own, after three days. */
  toy: DeskToy | null;
}

export const PLAQUES = 8;
export const STAR_PASSES = 10;
export const PHOTO_DAYS = 1;
export const TOY_DAYS = 3;

const TOYS: DeskToy[] = ['duck', 'speaker', 'cradle'];

/** Their desk toy: the magnifying glass for someone who mostly reviews, else one picked from their id (the same every time). */
export function deskToy(agentId: string, c: CareerView | null = null): DeskToy {
  if (c && mostlyReviews(c)) return 'magnifier';
  let h = 0;
  for (const ch of agentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TOYS[h % TOYS.length];
}

/** The plant grows from 0.7 to 1.6 times its size over its owner's first week. */
export const plantGrowth = (days: number) => Math.min(1.6, 0.7 + 0.13 * Math.max(0, days));

export function deskItems(c: CareerView, agentId: string, now: number): DeskItems {
  const days = tenureDays(c, now);
  const plaques = c.recent.slice(0, PLAQUES).map((r) => r.n);
  return {
    plaques,
    more: Math.max(0, c.merged - plaques.length),
    star: c.firstPass >= STAR_PASSES,
    plant: plantGrowth(days),
    photo: days >= PHOTO_DAYS,
    toy: days >= TOY_DAYS ? deskToy(agentId, c) : null,
  };
}
