// The office's ledger (#210, #226): one record of what the work earned, derived from what the office already sees
// (PRs opened, QA verdicts, fixes, checks, merges, sessions) and kept in the state file. Floors earn coins and buy
// decorations with them, the office unlocks achievements, and every agent builds a career. Pure, and idempotent: an
// event seen twice changes nothing, so the swarm can report what it notices on every sync.
import { DAY_MS, newCareer, RECENT_KEEP, WEEK_MS, type CareerView } from '../shared/careers.ts';
import {
  ACHIEVEMENTS,
  catalogueItem,
  COFFEE_ADDICT,
  COINS,
  DECOR_SLOTS,
  isDecorItem,
  priceOf,
  slotKind,
  slotsOfKind,
  STREAK_MERGES,
  STREAK_WINDOW_MS,
  stored,
  type AchievementId,
  type AchievementView,
  type DecorItem,
  type FloorProgressView,
  type ProgressView,
  type RewardView,
} from '../shared/progress.ts';
import type { PullInfo } from '../shared/types.ts';

/** An open PR the ledger is following, until it merges or goes away. */
export interface PrTrack {
  author: string | null;
  title: string;
  specialty: string;
  qaPass: number;
  qaFail: number;
  /** Its first QA round's verdict (a PR first seen after round 1 counts as 'fail': no first-time bonus). */
  first: 'pass' | 'fail' | null;
  /** GitHub's checks: none seen yet, only ever pending or green, or red at some point. */
  ci: 'none' | 'green' | 'failed';
  fixRounds: number;
  needsHuman: boolean;
  /** When the ledger started following it. */
  since: number;
}

export interface FloorLedger extends FloorProgressView {
  /** This floor's merge times within the streak window. */
  streak: number[];
}

export interface LedgerState {
  /** Keys of events already counted (newest last, capped): the same event twice counts once. */
  seen: string[];
  /** `${repoId}#${pr}` -> its track, while it's open. */
  prs: Record<string, PrTrack>;
  floors: Record<string, FloorLedger>;
  careers: Record<string, CareerView>;
  achievements: AchievementView[];
  coffees: number;
  merges: number;
  /** Merges in a row without a failed QA round or check. */
  clean: number;
  /** Today (local), for the per-day achievements. */
  day: { date: string; merges: number; qaFails: number };
}

export type LedgerEvent =
  | { kind: 'hired'; agentId: string; at: number }
  | { kind: 'let-go'; agentId: string }
  /** An open PR on GitHub, as a sync sees it. */
  | { kind: 'pr-open'; repoId: string; pr: number; title: string; author: string | null; checks: PullInfo['checks']; at: number }
  /** A developer's session ended with this PR open. */
  | { kind: 'opened'; repoId: string; pr: number; title: string; author: string; specialty: string; at: number }
  | { kind: 'qa'; repoId: string; pr: number; round: number; pass: boolean; tester: string | null; author: string | null; at: number }
  /** A fix round started; `key` tells rounds apart. */
  | { kind: 'fix'; repoId: string; pr: number; key: string; at: number }
  | { kind: 'checks-failed'; repoId: string; pr: number }
  | { kind: 'needs-human'; repoId: string; pr: number }
  | { kind: 'merged'; repoId: string; repoName: string; pr: number; title: string; author: string | null; at: number }
  /** A sync's PR lists: tracks of PRs in neither went away (closed), once they're old enough not to be brand new. */
  | { kind: 'listed'; repoId: string; numbers: number[]; at: number }
  | { kind: 'session'; agentId: string; key: string; costUsd: number; turns: number }
  | { kind: 'coffee'; id: string; at: number }
  | { kind: 'full-house'; repoName: string; people: number; at: number }
  | { kind: 'tick'; at: number };

/** What an event changed, for the swarm to send on. */
export interface Effects {
  changed: boolean;
  /** A merge's coins (the burst and the pling). */
  reward: RewardView | null;
  /** Agents whose careers changed. */
  careers: string[];
  unlocked: AchievementView[];
  /** The progress view changed (coins, decorations, achievements, counters). */
  progress: boolean;
}

const SEEN_KEEP = 600;
/** A track this new isn't dropped for missing from a sync's lists: that sync may have started before the PR existed. */
const LISTED_GRACE_MS = 10 * 60_000;
const SPOTLESS_MERGES = 5;
const PERFECT_RUN = 5;

export function emptyLedger(): LedgerState {
  return { seen: [], prs: {}, floors: {}, careers: {}, achievements: [], coffees: 0, merges: 0, clean: 0, day: { date: '', merges: 0, qaFails: 0 } };
}

const fx = (): Effects => ({ changed: false, reward: null, careers: [], unlocked: [], progress: false });
const prKey = (repoId: string, pr: number) => `${repoId}#${pr}`;
const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of `at`, e.g. 2026-10-04. */
export function dayKey(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function markSeen(s: LedgerState, key: string) {
  if (s.seen.includes(key)) return false;
  s.seen.push(key);
  if (s.seen.length > SEEN_KEEP) s.seen.splice(0, s.seen.length - SEEN_KEEP);
  return true;
}

function floorOf(s: LedgerState, repoId: string): FloorLedger {
  return (s.floors[repoId] ??= { coins: 0, earned: 0, merges: 0, owned: {}, placed: {}, firstPr: null, streak: [] });
}

/** Someone's career, noted as changed; null for anyone not on the team (let go, or never hired). */
function careerOf(s: LedgerState, agentId: string, out: Effects): CareerView | null {
  const c = s.careers[agentId];
  if (c && !out.careers.includes(agentId)) out.careers.push(agentId);
  return c ?? null;
}

function track(s: LedgerState, repoId: string, pr: number, at: number): PrTrack {
  return (s.prs[prKey(repoId, pr)] ??= { author: null, title: '', specialty: '', qaPass: 0, qaFail: 0, first: null, ci: 'none', fixRounds: 0, needsHuman: false, since: at });
}

function unlock(s: LedgerState, out: Effects, id: AchievementId, detail: string, at: number) {
  if (s.achievements.some((a) => a.id === id)) return;
  const a: AchievementView = { id, at, detail };
  s.achievements.push(a);
  out.unlocked.push(a);
  out.progress = true;
}

/**
 * A new local day: judge yesterday for the spotless day, then start counting again. Returns whether `at` falls on the
 * day being counted (an older merge a sync only sees now counts for nothing per day).
 */
function rollDay(s: LedgerState, at: number, out: Effects) {
  const date = dayKey(at);
  if (s.day.date === date) return true;
  if (s.day.date > date) return false;
  if (s.day.date && s.day.merges >= SPOTLESS_MERGES && s.day.qaFails === 0) unlock(s, out, 'clean-day', `${s.day.merges} merges on ${s.day.date}, no failed QA`, at);
  s.day = { date, merges: 0, qaFails: 0 };
  out.changed = true;
  return true;
}

/** Apply one thing the office saw. Mutates `s`; the effects say what changed. */
export function apply(s: LedgerState, ev: LedgerEvent): Effects {
  const out = fx();
  switch (ev.kind) {
    case 'hired': {
      if (s.careers[ev.agentId]) break;
      s.careers[ev.agentId] = newCareer(ev.at);
      out.careers.push(ev.agentId);
      out.changed = true;
      break;
    }
    case 'let-go': {
      if (!s.careers[ev.agentId]) break;
      delete s.careers[ev.agentId];
      out.changed = true;
      break;
    }
    case 'pr-open': {
      const key = prKey(ev.repoId, ev.pr);
      const before = JSON.stringify(s.prs[key] ?? null);
      const t = track(s, ev.repoId, ev.pr, ev.at);
      if (ev.title) t.title = ev.title.slice(0, 80);
      t.author ??= ev.author;
      if (ev.checks === 'failing') t.ci = 'failed';
      else if ((ev.checks === 'passing' || ev.checks === 'pending') && t.ci === 'none') t.ci = 'green';
      out.changed = JSON.stringify(t) !== before;
      break;
    }
    case 'opened': {
      const t = track(s, ev.repoId, ev.pr, ev.at);
      t.author = ev.author;
      t.title = ev.title.slice(0, 80) || t.title;
      t.specialty = ev.specialty;
      out.changed = true;
      const c = markSeen(s, `open:${prKey(ev.repoId, ev.pr)}`) ? careerOf(s, ev.author, out) : null;
      if (c) c.opened++;
      break;
    }
    case 'qa': {
      if (!markSeen(s, `qa:${prKey(ev.repoId, ev.pr)}:${ev.round}`)) break;
      out.changed = true;
      const today = rollDay(s, ev.at, out);
      const t = track(s, ev.repoId, ev.pr, ev.at);
      t.author ??= ev.author;
      if (ev.pass) t.qaPass++;
      else {
        t.qaFail++;
        if (today) s.day.qaFails++;
      }
      const first = t.first === null;
      if (first) t.first = ev.pass && ev.round === 1 ? 'pass' : 'fail';
      const c = t.author ? careerOf(s, t.author, out) : null;
      if (c) {
        if (ev.pass) c.qaPass++;
        else c.qaFail++;
        if (first && ev.round === 1) {
          if (ev.pass) {
            c.firstPass++;
            c.run++;
            c.best = Math.max(c.best, c.run);
          } else c.run = 0;
        }
      }
      const tester = ev.tester ? careerOf(s, ev.tester, out) : null;
      if (tester) tester.reviews++;
      break;
    }
    case 'fix': {
      if (!markSeen(s, `fix:${prKey(ev.repoId, ev.pr)}:${ev.key}`)) break;
      track(s, ev.repoId, ev.pr, ev.at).fixRounds++;
      out.changed = true;
      break;
    }
    case 'checks-failed': {
      const t = s.prs[prKey(ev.repoId, ev.pr)];
      if (!t || t.ci === 'failed') break;
      t.ci = 'failed';
      out.changed = true;
      break;
    }
    case 'needs-human': {
      const t = s.prs[prKey(ev.repoId, ev.pr)];
      if (!t || t.needsHuman) break;
      t.needsHuman = true;
      out.changed = true;
      break;
    }
    case 'merged':
      merged(s, ev, out);
      break;
    case 'listed': {
      const keep = new Set(ev.numbers);
      for (const [key, t] of Object.entries(s.prs)) {
        if (!key.startsWith(`${ev.repoId}#`) || keep.has(Number(key.slice(ev.repoId.length + 1)))) continue;
        if (t.since > ev.at - LISTED_GRACE_MS) continue;
        delete s.prs[key];
        out.changed = true;
      }
      break;
    }
    case 'session': {
      const c = markSeen(s, `session:${ev.key}`) ? careerOf(s, ev.agentId, out) : null;
      if (!c) break;
      c.costUsd = Math.round((c.costUsd + Math.max(0, ev.costUsd)) * 1e4) / 1e4;
      c.turns += Math.max(0, Math.round(ev.turns));
      out.changed = true;
      break;
    }
    case 'coffee': {
      if (!markSeen(s, `coffee:${ev.id}`)) break;
      s.coffees++;
      out.changed = out.progress = true;
      if (s.coffees >= COFFEE_ADDICT) unlock(s, out, 'coffee-addict', `${s.coffees} coffees`, ev.at);
      break;
    }
    case 'full-house':
      unlock(s, out, 'full-house', `${ev.people} people busy on ${ev.repoName}`, ev.at);
      out.changed ||= out.unlocked.length > 0;
      break;
    case 'tick':
      rollDay(s, ev.at, out);
      break;
  }
  return out;
}

function merged(s: LedgerState, ev: Extract<LedgerEvent, { kind: 'merged' }>, out: Effects) {
  const key = prKey(ev.repoId, ev.pr);
  const t = s.prs[key];
  // Only PRs the ledger watched while they were open: a merge seen again, or one from before, counts for nothing.
  if (!t || !markSeen(s, `merge:${key}`)) return;
  delete s.prs[key];
  out.changed = out.progress = true;
  const today = rollDay(s, ev.at, out);
  const floor = floorOf(s, ev.repoId);
  floor.streak = floor.streak.filter((x) => x > ev.at - STREAK_WINDOW_MS && x <= ev.at);
  const streak = floor.streak.length + 1 >= STREAK_MERGES;
  const reasons = ['merge'];
  let coins: number = COINS.merge;
  if (t.first === 'pass') {
    coins += COINS.firstQa;
    reasons.push('first-time QA');
  }
  if (t.ci === 'green') {
    coins += COINS.greenCi;
    reasons.push('green CI');
  }
  if (streak) {
    coins += COINS.streak;
    reasons.push('streak');
  }
  floor.streak.push(ev.at);
  floor.coins += coins;
  floor.earned += coins;
  floor.merges++;
  const title = (ev.title || t.title).slice(0, 80);
  floor.firstPr ??= { n: ev.pr, title };
  s.merges++;
  if (today) s.day.merges++;
  s.clean = t.qaFail === 0 && t.ci !== 'failed' && !t.needsHuman ? s.clean + 1 : 0;

  const author = t.author ?? ev.author;
  const c = author ? careerOf(s, author, out) : null;
  if (c) {
    c.merged++;
    c.fixRounds += t.fixRounds;
    c.bySpecialty[t.specialty] = (c.bySpecialty[t.specialty] ?? 0) + 1;
    c.recent = [{ n: ev.pr, title, at: ev.at }, ...c.recent].slice(0, RECENT_KEEP);
    c.week = [...c.week.filter((x) => x > ev.at - WEEK_MS), ev.at].slice(-100);
  }
  out.reward = { repoId: ev.repoId, prNumber: ev.pr, agentId: author, coins, reasons };

  const where = `PR #${ev.pr} on ${ev.repoName}`;
  unlock(s, out, 'first-merge', where, ev.at);
  if (streak) unlock(s, out, 'hat-trick', `${where}: ${floor.streak.length} merges within an hour`, ev.at);
  if (today && s.day.merges >= 10) unlock(s, out, 'ten-a-day', `${s.day.merges} merges on ${s.day.date}`, ev.at);
  if (new Date(ev.at).getHours() < 5) unlock(s, out, 'night-owl', `${where} at ${pad(new Date(ev.at).getHours())}:${pad(new Date(ev.at).getMinutes())}`, ev.at);
  if (t.needsHuman) unlock(s, out, 'comeback', where, ev.at);
  if (s.clean >= PERFECT_RUN) unlock(s, out, 'perfect-five', `${s.clean} clean merges in a row, the last ${where}`, ev.at);
  if (s.merges >= 25) unlock(s, out, 'quarter-century', where, ev.at);
  if (s.merges >= 100) unlock(s, out, 'century', where, ev.at);
}

// ---------- the manager's commands ----------

export type CommandResult = { error: string } | { effects: Effects; price?: number };

/** Buy `item` for a floor: refused without the coins, or when every slot it could go in is already spoken for. */
export function buy(s: LedgerState, repoId: string, item: unknown): CommandResult {
  if (!isDecorItem(item)) return { error: `There's no "${String(item)}" in the catalogue` };
  const def = catalogueItem(item)!;
  const floor = floorOf(s, repoId);
  const ofKind = Object.entries(floor.owned).reduce((n, [id, k]) => n + (catalogueItem(id)?.kind === def.kind ? (k ?? 0) : 0), 0);
  if (ofKind >= slotsOfKind(def.kind)) return { error: `This floor has no room for another ${def.kind === 'wall' ? 'wall decoration' : def.kind === 'rug' ? 'rug' : `${def.kind} decoration`}` };
  const price = priceOf(item, floor.owned[item] ?? 0);
  if (floor.coins < price) return { error: `${def.name} costs ${price} coins; this floor has ${floor.coins}` };
  floor.coins -= price;
  floor.owned[item] = (floor.owned[item] ?? 0) + 1;
  return { effects: { ...fx(), changed: true, progress: true }, price };
}

/**
 * Put a decoration in a slot, from the floor's decor box (`from` null) or from another slot (moving it). With `slot`
 * null it goes back in the box.
 */
export function place(s: LedgerState, repoId: string, repoName: string, x: { item: unknown; slot: string | null; from: string | null }, at: number): CommandResult {
  if (!isDecorItem(x.item)) return { error: `There's no "${String(x.item)}" in the catalogue` };
  const item: DecorItem = x.item;
  const floor = floorOf(s, repoId);
  if (x.from !== null && floor.placed[x.from] !== item) return { error: `The ${catalogueItem(item)!.name.toLowerCase()} isn't there any more` };
  if (x.slot === null) {
    if (x.from === null) return { error: 'Nothing to put away' };
    delete floor.placed[x.from];
    return { effects: { ...fx(), changed: true, progress: true } };
  }
  const kind = slotKind(x.slot);
  if (!kind) return { error: `There's no decoration spot "${x.slot}"` };
  if (kind !== catalogueItem(item)!.kind) return { error: `The ${catalogueItem(item)!.name.toLowerCase()} doesn't go there` };
  if (floor.placed[x.slot] && x.slot !== x.from) return { error: 'Something already stands there' };
  if (x.from === null && stored(floor, item) < 1) return { error: `This floor's decor box has no ${catalogueItem(item)!.name.toLowerCase()}` };
  if (x.from !== null) delete floor.placed[x.from];
  floor.placed[x.slot] = item;
  const out: Effects = { ...fx(), changed: true, progress: true };
  unlock(s, out, 'interior-designer', `${catalogueItem(item)!.name} on ${repoName}`, at);
  if (DECOR_SLOTS.every((d) => floor.placed[d.id])) unlock(s, out, 'fully-furnished', repoName, at);
  return { effects: out };
}

/** Demo only: coins for QA to spend. */
export function grant(s: LedgerState, repoId: string, coins: number): CommandResult {
  if (!Number.isFinite(coins) || coins === 0) return { error: 'Grant a number of coins' };
  const floor = floorOf(s, repoId);
  floor.coins = Math.max(0, Math.round(floor.coins + coins)); // a gift, not earnings: `earned` stays what merges paid
  return { effects: { ...fx(), changed: true, progress: true } };
}

/** Demo only: wind the clock back `days` on someone's tenure (everyone's without an agent id). */
export function addTenure(s: LedgerState, days: number, agentId?: string): CommandResult {
  if (!Number.isFinite(days)) return { error: 'Give a number of days' };
  const ids = agentId ? [agentId] : Object.keys(s.careers);
  if (agentId && !s.careers[agentId]) return { error: `No career for ${agentId}` };
  const out = fx();
  for (const id of ids) careerOf(s, id, out)!.since -= days * DAY_MS;
  out.changed = true;
  return { effects: out };
}

// ---------- reading it ----------

export function progressView(s: LedgerState, repoIds: string[]): ProgressView {
  const floors: Record<string, FloorProgressView> = {};
  for (const id of repoIds) {
    const f = s.floors[id];
    floors[id] = f ? { coins: f.coins, earned: f.earned, merges: f.merges, owned: f.owned, placed: f.placed, firstPr: f.firstPr } : { coins: 0, earned: 0, merges: 0, owned: {}, placed: {}, firstPr: null };
  }
  return { floors, achievements: s.achievements, coffees: s.coffees, merges: s.merges };
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The ledger from the state file: anything missing or malformed starts empty, and unknown items and slots are dropped. */
export function loadLedger(raw: unknown): LedgerState {
  const r = obj(raw);
  const s = emptyLedger();
  s.seen = Array.isArray(r.seen) ? r.seen.filter((k): k is string => typeof k === 'string').slice(-SEEN_KEEP) : [];
  for (const [key, t] of Object.entries(obj(r.prs))) {
    const x = obj(t);
    s.prs[key] = {
      author: typeof x.author === 'string' ? x.author : null,
      title: typeof x.title === 'string' ? x.title : '',
      specialty: typeof x.specialty === 'string' ? x.specialty : '',
      qaPass: num(x.qaPass),
      qaFail: num(x.qaFail),
      first: x.first === 'pass' || x.first === 'fail' ? x.first : null,
      ci: x.ci === 'green' || x.ci === 'failed' ? x.ci : 'none',
      fixRounds: num(x.fixRounds),
      needsHuman: x.needsHuman === true,
      since: num(x.since, Date.now()),
    };
  }
  for (const [id, f] of Object.entries(obj(r.floors))) {
    const x = obj(f);
    const owned: FloorLedger['owned'] = {};
    for (const [item, n] of Object.entries(obj(x.owned))) if (isDecorItem(item) && num(n) > 0) owned[item] = num(n);
    const placed: FloorLedger['placed'] = {};
    for (const [slot, item] of Object.entries(obj(x.placed))) if (slotKind(slot) && isDecorItem(item) && slotKind(slot) === catalogueItem(item)!.kind) placed[slot] = item;
    const first = obj(x.firstPr);
    s.floors[id] = {
      coins: num(x.coins),
      earned: num(x.earned),
      merges: num(x.merges),
      owned,
      placed,
      firstPr: typeof first.n === 'number' ? { n: first.n, title: typeof first.title === 'string' ? first.title : '' } : null,
      streak: Array.isArray(x.streak) ? x.streak.filter((t): t is number => typeof t === 'number') : [],
    };
  }
  for (const [id, c] of Object.entries(obj(r.careers))) {
    const x = obj(c);
    const by: Record<string, number> = {};
    for (const [k, n] of Object.entries(obj(x.bySpecialty))) if (num(n) > 0) by[k] = num(n);
    s.careers[id] = {
      ...newCareer(num(x.since, Date.now())),
      opened: num(x.opened),
      merged: num(x.merged),
      firstPass: num(x.firstPass),
      qaPass: num(x.qaPass),
      qaFail: num(x.qaFail),
      fixRounds: num(x.fixRounds),
      run: num(x.run),
      best: num(x.best),
      reviews: num(x.reviews),
      bySpecialty: by,
      costUsd: num(x.costUsd),
      turns: num(x.turns),
      recent: (Array.isArray(x.recent) ? x.recent : [])
        .map(obj)
        .filter((m) => typeof m.n === 'number')
        .map((m) => ({ n: m.n as number, title: typeof m.title === 'string' ? m.title : '', at: num(m.at) }))
        .slice(0, RECENT_KEEP),
      week: Array.isArray(x.week) ? x.week.filter((t): t is number => typeof t === 'number') : [],
    };
  }
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  s.achievements = (Array.isArray(r.achievements) ? r.achievements : [])
    .map(obj)
    .filter((a) => known.has(a.id as AchievementId))
    .map((a) => ({ id: a.id as AchievementId, at: num(a.at), detail: typeof a.detail === 'string' ? a.detail : '' }));
  s.coffees = num(r.coffees);
  s.merges = num(r.merges);
  s.clean = num(r.clean);
  const day = obj(r.day);
  s.day = { date: typeof day.date === 'string' ? day.date : '', merges: num(day.merges), qaFails: num(day.qaFails) };
  return s;
}
