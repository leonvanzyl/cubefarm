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
  /** QA reviews done (testers, and developers covering QA). */
  reviews: number;
  /** Merged issues by swarm:<specialty> label ('' for unlabelled ones). */
  bySpecialty: Record<string, number>;
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
  return { since, opened: 0, merged: 0, firstPass: 0, qaPass: 0, qaFail: 0, fixRounds: 0, run: 0, best: 0, reviews: 0, bySpecialty: {}, costUsd: 0, turns: 0, recent: [], week: [] };
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

/** A fun rank from merges (developers) or reviews (QA). */
export function rank(c: CareerView, role: string): string {
  const n = role === 'qa' ? c.reviews : c.merged;
  return n >= 40 ? 'Legend' : n >= 15 ? 'Veteran' : n >= 5 ? 'Regular' : 'Rookie';
}

/** Their favourite specialty: the one with the most merged issues ('' counts as none). */
export function topSpecialty(c: CareerView): { slug: string; n: number } | null {
  let best: { slug: string; n: number } | null = null;
  for (const [slug, n] of Object.entries(c.bySpecialty)) if (slug && n > (best?.n ?? 0)) best = { slug, n };
  return best;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The career card's one-liner: what they're best known for, picked from the stats. */
export function knownFor(c: CareerView, role: string): string {
  if (role === 'qa' || (c.reviews > c.merged && c.reviews >= 3)) {
    if (c.reviews === 0) return 'Fresh in the lab: first review coming up';
    return `QA reviews: ${c.reviews} and counting`;
  }
  if (c.best >= 3) return `First-time QA passes: ${c.best} in a row`;
  const rate = passRate(c);
  if (rate === 1 && c.qaPass >= 3) return `Never failed QA: ${plural(c.qaPass, 'round')} passed`;
  const top = topSpecialty(c);
  if (top && top.n >= 2) return `Go-to for ${top.slug}: ${plural(top.n, 'issue')} merged`;
  if (c.merged >= 1 && avgFixRounds(c) === 0) return `Clean shipper: ${plural(c.merged, 'PR')} merged without a fix round`;
  if (c.merged >= 1) return `Shipped ${plural(c.merged, 'PR')} so far`;
  if (c.opened >= 1) return 'First PR in review, fingers crossed';
  return 'Fresh on the team: first PR coming up';
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

/** What their desk shows: plaques for merged PRs, the gold star, stickers and the personal items tenure brings. */
export interface DeskItems {
  /** PR numbers on the plaques, newest first (up to PLAQUES). */
  plaques: number[];
  /** Merged PRs beyond the plaques shown, for the "+N" plaque. */
  more: number;
  /** Ten first-time QA passes. */
  star: boolean;
  /** Specialty slugs for the stickers on the monitor bezel. */
  stickers: string[];
  /** How tall the desk plant has grown (1: as it arrived). */
  plant: number;
  /** A framed photo, after a day on the team. */
  photo: boolean;
  /** A desk toy matching their specialty, after three days. */
  toy: DeskToy | null;
}

export const PLAQUES = 8;
export const STAR_PASSES = 10;
export const PHOTO_DAYS = 1;
export const TOY_DAYS = 3;
const STICKERS = 3;

/** The desk toy for a specialty (QA testers always get the magnifying glass; the rubber duck is everyone else's). */
export function deskToy(specialty: string, role: string): DeskToy {
  if (role === 'qa' || /test|qa/.test(specialty)) return 'magnifier';
  if (/audio|sound|music|voice/.test(specialty)) return 'speaker';
  if (/physic|simulat|game/.test(specialty)) return 'cradle';
  return 'duck';
}

/** The plant grows from 0.7 to 1.6 times its size over its owner's first week. */
export const plantGrowth = (days: number) => Math.min(1.6, 0.7 + 0.13 * Math.max(0, days));

export function deskItems(c: CareerView, agent: { specialty: string; role: string }, now: number): DeskItems {
  const days = tenureDays(c, now);
  const plaques = c.recent.slice(0, PLAQUES).map((r) => r.n);
  const fromWork = Object.entries(c.bySpecialty)
    .filter(([slug, n]) => slug && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
  const stickers = [...new Set([...(agent.specialty ? [agent.specialty] : []), ...fromWork])].slice(0, STICKERS);
  return {
    plaques,
    more: Math.max(0, c.merged - plaques.length),
    star: c.firstPass >= STAR_PASSES,
    stickers,
    plant: plantGrowth(days),
    photo: days >= PHOTO_DAYS,
    toy: days >= TOY_DAYS ? deskToy(agent.specialty, agent.role) : null,
  };
}

/** A sticker's look: an emoji for the specialties people use most, else its first two letters. */
export function stickerFor(slug: string): { text: string; color: string } {
  const known: Record<string, string> = {
    frontend: '🎨', ui: '🎨', ux: '🎨', design: '🎨', backend: '🗄️', api: '🔌', a11y: '♿', accessibility: '♿', audio: '🔊', sound: '🔊',
    music: '🎵', physics: '⚛️', gameplay: '🎮', game: '🎮', fx: '✨', graphics: '🖼️', '3d': '🧊', devex: '🦆', dx: '🦆', tooling: '🛠️',
    testing: '🔍', qa: '🔍', docs: '📚', perf: '⚡', performance: '⚡', security: '🔒', reliability: '🛡️', infra: '☁️', devops: '☁️',
    data: '📊', mobile: '📱', fullstack: '🥞', ai: '🤖', ml: '🤖', db: '🗃️', database: '🗃️',
  };
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#9b5de5', '#f15bb5', '#00bbf9', '#fb5607'][h % 8];
  return { text: known[slug] ?? slug.slice(0, 2).toUpperCase(), color };
}
