// Comings and goings (errands.ts, run by ErrandDirector.tsx): new hires stepping out of the elevator, people who
// were let go leaving with a box, idle people chatting at the water cooler or the couch, visiting a busy
// teammate's desk, and the CEO strolling about the lobby. Pure: the decisions and the errands, no three.js.

import type { QaView, RepoView } from '../../../shared/types';
import { isFree, registerErrand, type Errand, type ErrandPeer, type ErrandState } from './errands';
import { HALF_D } from './layout';
import type { Pt } from './toys/roombaBrain';
import { findPath, type Spot, type Walkways } from './walkways';

const NORTH = -Math.PI / 2;
const restless = (s: ErrandState) => s.seatedFor >= s.restless;

// ---------- arriving and leaving by the elevator ----------

/** Where someone stands inside the elevator cabin, out of sight until the doors open. */
export const CABIN: Pt = { x: 0, z: HALF_D + 0.9 };
/** Seconds a new hire waits in the cabin while the doors open. */
export const DOORS_SECONDS = 1.2;

/** A new hire: out of the elevator to their desk, a look around and a wave to the nearest teammate, then sit. */
export const ARRIVE: Errand = {
  name: 'arrive',
  work: true, // never sent back: they're on their way to their desk anyway
  when: () => false, // the director starts it when someone joins the floor
  spot: [],
  steps: [
    { gesture: 'none', seconds: 1.1, turn: 0.8 },
    { gesture: 'none', seconds: 1.1, turn: -0.8 },
    { gesture: 'wave', seconds: 1.8, face: 'peer' },
    { gesture: 'none', seconds: 0.4, face: 'peer' },
  ],
};

/** Let go: up from the desk, pick up a box, and out by the elevator. */
export const LEAVE: Errand = {
  name: 'leave',
  work: true,
  when: () => false,
  spot: [],
  steps: [
    { gesture: 'reach', seconds: 1.1 },
    { gesture: 'hold', seconds: 0.6 },
  ],
  carry: 'hold',
};

/** From the cabin to someone's desk: out past the doors, then round the furniture. Null when there's no way. */
export function arrivalPath(w: Walkways, elevator: Spot, home: Pt): Pt[] | null {
  const path = findPath(w, elevator, home);
  return path && [{ x: elevator.x, z: elevator.z }, ...path];
}

/** From someone's desk into the cabin. Null when there's no way. */
export function exitPath(w: Walkways, elevator: Spot, home: Pt): Pt[] | null {
  const path = findPath(w, home, elevator);
  return path && [{ x: home.x, z: home.z }, ...path, CABIN];
}

/** Who on the floor someone arriving should wave at: the nearest other person, or null on an empty floor. */
export function nearest<T extends Pt & { id: string }>(me: Pt & { id: string }, others: Iterable<T>): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const o of others) {
    if (o.id === me.id) continue;
    const d = Math.hypot(o.x - me.x, o.z - me.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Heading (body.ts: 0 faces -Z) from one point to look at another. */
export const headingTo = (from: Pt, to: Pt) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

// ---------- visiting a busy teammate ----------

/** How far (m) an idle developer will walk to look over a busy teammate's shoulder. */
export const VISIT_RANGE = 9;

/** The busy developer nearest someone's desk, within VISIT_RANGE; null when nobody nearby is working. */
export function busyNeighbour(me: ErrandPeer | { id: string; home: Pt }, others: readonly ErrandPeer[]): ErrandPeer | null {
  const busy = others.filter((o) => o.id !== me.id && o.role === 'dev' && o.status === 'working');
  const close = busy.filter((o) => Math.hypot(o.home.x - me.home.x, o.home.z - me.home.z) <= VISIT_RANGE);
  return nearest({ id: me.id, ...me.home }, close.map((o) => ({ ...o, x: o.home.x, z: o.home.z })));
}

/** Just behind a seated developer's shoulder, looking at their screen. */
export function shoulderSpot(host: ErrandPeer): Spot {
  return { id: `visit-${host.id}`, x: host.home.x + 0.45, z: host.home.z, facing: NORTH };
}

const visit: Errand = {
  name: 'visit',
  when: (a, s) => a.role === 'dev' && s.floor === 'office' && isFree(a.status) && restless(s) && !!s.home && !!s.others && !!busyNeighbour({ id: a.id, home: s.home }, s.others),
  spot: [],
  place: (a, s) => {
    const host = s.home && s.others ? busyNeighbour({ id: a.id, home: s.home }, s.others) : null;
    return host && shoulderSpot(host);
  },
  steps: [
    { gesture: 'none', seconds: 2.5 },
    { gesture: 'none', seconds: 2, turn: 0.15 },
    { gesture: 'talk', seconds: 1.6 },
    { gesture: 'none', seconds: 1 },
  ],
  weight: 0.7,
};

// ---------- the CEO in the lobby ----------

const stroll: Errand = {
  name: 'stroll',
  when: (a, s) => a.role === 'ceo' && s.floor === 'lobby' && isFree(a.status) && restless(s),
  spot: ['reception', 'window-*'],
  steps: [
    { gesture: 'none', seconds: 3 },
    { gesture: 'none', seconds: 2, turn: 0.6 },
    { gesture: 'none', seconds: 2, turn: -0.5 },
  ],
  weight: 2,
};

registerErrand(visit);
registerErrand(stroll);

// ---------- chats ----------

/** Seconds between chats on a floor, at the least. */
export const CHAT_GAP = 40;
/** The chance a restless moment turns into a chat instead of a walk on their own. */
export const CHAT_CHANCE = 0.6;
/** A partner must have sat at least this long since their last walk. */
export const CHAT_MIN_SEATED = 8;

/** Where chats happen on office floors: by the water cooler and by the couch. */
export const CHAT_VENUES: Record<string, Pt> = {
  cooler: { x: 13.9, z: -9.4 },
  couch: { x: -12.6, z: 8.6 },
};

/** A chat: everyone stands and talks for a while, bubbles now and then. */
export const CHAT: Errand = {
  name: 'chat',
  when: () => false, // the director gathers people for it (planChat)
  spot: [],
  steps: [
    { gesture: 'none', seconds: 1.5 },
    { gesture: 'talk', seconds: 3, say: true },
    { gesture: 'none', seconds: 3.5 },
    { gesture: 'talk', seconds: 2.5, say: true },
    { gesture: 'none', seconds: 3 },
    { gesture: 'talk', seconds: 3, say: true },
    { gesture: 'none', seconds: 3 },
    { gesture: 'talk', seconds: 2, say: true },
    { gesture: 'none', seconds: 1.5 },
  ],
};

export interface ChatCandidate {
  id: string;
  home: Pt;
  seatedFor: number;
  restless: number;
}

export interface ChatPlan {
  ids: string[];
  venue: string;
}

/**
 * Whether a chat starts now, and who joins: someone restless and their one or two nearest free neighbours who have
 * sat a while, if the walker cap has room for all of them. `candidates` are free people at their desks; `rand`
 * gives numbers in [0, 1).
 */
export function planChat(candidates: readonly ChatCandidate[], o: { away: number; cap: number; sinceLast: number; rand: () => number; venues: readonly string[] }): ChatPlan | null {
  if (o.sinceLast < CHAT_GAP || !o.venues.length) return null;
  const room = o.cap - o.away;
  if (room < 2) return null;
  const starters = candidates.filter((c) => c.seatedFor >= c.restless);
  if (!starters.length || o.rand() >= CHAT_CHANCE) return null;
  const first = starters[Math.floor(o.rand() * starters.length)];
  const d = (c: ChatCandidate) => Math.hypot(c.home.x - first.home.x, c.home.z - first.home.z);
  const partners = candidates.filter((c) => c.id !== first.id && c.seatedFor >= CHAT_MIN_SEATED).sort((a, b) => d(a) - d(b));
  const size = Math.min(o.rand() < 0.5 ? 2 : 3, room, partners.length + 1);
  if (size < 2) return null;
  return { ids: [first.id, ...partners.slice(0, size - 1).map((c) => c.id)], venue: o.venues[Math.floor(o.rand() * o.venues.length)] };
}

/**
 * Where n people stand to chat round `center`: evenly round a small circle, each facing the middle, turned until
 * everyone has room (`open`). Null when there's no way to fit them.
 */
export function huddle(center: Pt, n: number, open: (x: number, z: number) => boolean, r = 0.7): Spot[] | null {
  for (let k = 0; k < 12; k++) {
    const base = (k * Math.PI) / 6;
    const spots: Spot[] = [];
    for (let i = 0; i < n; i++) {
      const a = base + (i * Math.PI * 2) / n;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      spots.push({ id: `chat-${i}`, x, z, facing: Math.atan2(center.z - z, center.x - x) });
    }
    if (spots.every((s) => open(s.x, s.z))) return spots;
  }
  return null;
}

// ---------- what they talk about ----------

/** What happened on the floor lately, as far as chats care. Seconds ago, or null. */
export interface FloorNews {
  mergedAgo: number | null;
  failedAgo: number | null;
  working: number;
}

/** How long news stays the talk of the floor (seconds). */
export const NEWS_SECONDS = 600;

/** The floor's news from the store's state; `now` in epoch ms. */
export function floorNews(repo: Pick<RepoView, 'pulls'> | undefined, qa: readonly Pick<QaView, 'status' | 'updatedAt'>[], working: number, now: number): FloorNews {
  const merged = (repo?.pulls ?? []).map((p) => (p.mergedAt ? Date.parse(p.mergedAt) : NaN)).filter((t) => Number.isFinite(t));
  const failed = qa.filter((q) => q.status === 'failed' || q.status === 'needs-human').map((q) => q.updatedAt);
  const ago = (ts: number[]) => (ts.length ? Math.max(0, (now - Math.max(...ts)) / 1000) : null);
  return { mergedAgo: ago(merged), failedAgo: ago(failed), working };
}

/** The emoji bubbles a chat picks from, weighted: a merge brings 🎉, a failed QA 🐛, work in progress 🚀. */
export function chatTopics(news: FloorNews): [string, number][] {
  const fresh = (ago: number | null) => ago != null && ago < NEWS_SECONDS;
  return [
    ['☕', 2],
    ['😂', 2],
    ['🚀', news.working > 0 ? 2 : 0.5],
    ['🎉', fresh(news.mergedAgo) ? 5 : 0.3],
    ['🐛', fresh(news.failedAgo) ? 5 : 0.3],
  ];
}

/** One bubble's emoji (`rand` in [0, 1)). */
export function pickTopic(news: FloorNews, rand: number): string {
  const topics = chatTopics(news);
  let r = rand * topics.reduce((t, [, w]) => t + w, 0);
  for (const [emoji, w] of topics) {
    r -= w;
    if (r < 0) return emoji;
  }
  return topics[0][0];
}
