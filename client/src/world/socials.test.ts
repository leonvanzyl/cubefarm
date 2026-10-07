import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../shared/types';
import { MAX_WALKERS, choose, errandNamed, errands, spotChoices, wanted, type ErrandPeer, type ErrandState } from './errands';
import {
  ARRIVE,
  CABIN,
  CHAT,
  CHAT_GAP,
  CHAT_MIN_SEATED,
  CHAT_VENUES,
  LEAVE,
  NEWS_SECONDS,
  arrivalPath,
  busyNeighbour,
  chatTopics,
  exitPath,
  floorNews,
  headingTo,
  huddle,
  nearest,
  pickTopic,
  planChat,
  shoulderSpot,
  topicPr,
  type ChatCandidate,
} from './socials';
import { findPath, spot, standable, walkways } from './walkways';

const office = walkways('office');
const lobby = walkways('lobby');
const peer = (id: string, status: AgentStatus, desk: string, role = 'agent'): ErrandPeer => ({ id, status, role, home: spot(office, desk)! });
const state = (over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 60, restless: 30, ...over });
/** A fixed sequence of "random" numbers. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('arriving and leaving by the elevator', () => {
  const lift = spot(office, 'elevator')!;

  it('every desk can be reached from the elevator, and the elevator from them', () => {
    for (const home of office.homes) {
      const inPath = arrivalPath(office, lift, home);
      expect(inPath, home.id).not.toBeNull();
      expect(inPath![0]).toEqual({ x: lift.x, z: lift.z });
      expect(inPath!.at(-1)).toEqual({ x: home.x, z: home.z });
      const outPath = exitPath(office, lift, home);
      expect(outPath, home.id).not.toBeNull();
      expect(outPath!.at(-1)).toEqual(CABIN);
    }
  });

  it('the cabin is behind the doors, straight out from the elevator spot', () => {
    expect(CABIN.z).toBeGreaterThan(lift.z);
    expect(CABIN.x).toBe(lift.x);
  });

  it('a new hire looks around and waves; someone let go picks up a box and carries it', () => {
    expect(ARRIVE.work).toBe(true);
    expect(ARRIVE.steps.some((s) => s.turn)).toBe(true);
    expect(ARRIVE.steps.some((s) => s.gesture === 'wave' && s.face === 'peer')).toBe(true);
    expect(LEAVE.carry).toBe('hold');
    expect(LEAVE.steps.map((s) => s.gesture)).toEqual(['reach', 'hold']);
    // neither is ever started by the registry
    for (const e of [ARRIVE, LEAVE, CHAT]) expect(e.when({ id: 'a', status: 'idle', role: 'agent' }, state())).toBe(false);
  });

  it('waves at the nearest other person, and faces them', () => {
    const me = { id: 'me', x: 0, z: 0 };
    expect(nearest(me, [me, { id: 'far', x: 5, z: 0 }, { id: 'near', x: 0, z: 2 }])!.id).toBe('near');
    expect(nearest(me, [me])).toBeNull();
    expect(headingTo({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0); // -Z
    expect(headingTo({ x: 0, z: 0 }, { x: -1, z: 0 })).toBeCloseTo(Math.PI / 2);
  });
});

describe('visiting a busy teammate', () => {
  it('goes to the nearest working teammate in range, never the CEO or someone idle', () => {
    const me = peer('me', 'idle', 'desk-0');
    const others = [me, peer('idle', 'idle', 'desk-1'), peer('ceo', 'working', 'desk-1', 'ceo'), peer('busy', 'working', 'desk-1'), peer('far', 'working', 'desk-11')];
    expect(busyNeighbour(me, others)!.id).toBe('busy');
    expect(busyNeighbour(me, [me, peer('far', 'working', 'desk-11')])).toBeNull();
    expect(busyNeighbour(me, [me])).toBeNull();
  });

  it("stands behind every desk's chair, and can walk there from every other desk", () => {
    const desks = office.homes.filter((h) => h.id.startsWith('desk-'));
    for (const d of desks) {
      const s = shoulderSpot({ id: d.id, status: 'working', role: 'agent', home: d });
      expect(standable(office, s.x, s.z), d.id).toBe(true);
      expect(s.facing, d.id).toBeCloseTo(d.facing); // looking at the screen the way the desk faces
      for (const from of desks) if (from !== d) expect(findPath(office, from, s), `${from.id} → ${d.id}`).not.toBeNull();
    }
  });

  it('idle agents want it when restless and someone nearby works', () => {
    const others = [peer('me', 'idle', 'desk-0'), peer('busy', 'working', 'desk-1')];
    const me = { id: 'me', status: 'idle' as const, role: 'agent' };
    const s = state({ home: spot(office, 'desk-0'), others });
    expect(wanted(errands(), me, s).map((e) => e.name)).toContain('visit');
    expect(wanted(errands(), me, { ...s, others: [others[0]] }).map((e) => e.name)).not.toContain('visit');
    expect(wanted(errands(), me, { ...s, seatedFor: 5 })).toEqual([]);
    expect(errandNamed('visit')!.place!(me, s)!.id).toBe('visit-busy');
  });
});

describe('the CEO in the lobby', () => {
  it('strolls to the reception desk or a window, and only the CEO, only in the lobby', () => {
    const ceo = { id: 'ceo', status: 'idle' as const, role: 'ceo' };
    expect(wanted(errands(), ceo, state({ floor: 'lobby' })).map((e) => e.name)).toContain('stroll');
    expect(wanted(errands(), ceo, state({ floor: 'lobby', seatedFor: 1 }))).toEqual([]);
    expect(wanted(errands(), { ...ceo, role: 'agent' }, state()).map((e) => e.name)).not.toContain('stroll');
    const ids = spotChoices(errandNamed('stroll')!.spot, lobby.spots.map((s) => s.id), new Set());
    expect(ids).toContain('reception');
    const home = spot(lobby, 'ceo')!;
    for (const id of ids) expect(findPath(lobby, home, spot(lobby, id)!), id).not.toBeNull();
  });

  it('picks among wanted errands by weight, work ones first', () => {
    const stretch = errandNamed('stretch')!;
    const stroll = errandNamed('stroll')!;
    const picks = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((r) => choose([stretch, stroll], r)!.name);
    expect(picks).toContain('stretch');
    expect(picks.filter((n) => n === 'stroll').length).toBeGreaterThan(picks.filter((n) => n === 'stretch').length);
    expect(choose([stretch, { ...stretch, name: 'board', work: true }], 0)!.name).toBe('board');
    expect(choose([], 0.5)).toBeNull();
  });
});

describe('chats', () => {
  const cand = (id: string, x: number, seatedFor: number, restless = 30): ChatCandidate => ({ id, home: { x, z: 0 }, seatedFor, restless });
  const opts = { away: 0, cap: MAX_WALKERS, sinceLast: CHAT_GAP, venues: ['cooler', 'couch'] };

  it('someone restless and their nearest neighbours who have sat a while', () => {
    const people = [cand('a', 0, 40), cand('b', 1, 10), cand('c', 9, 20), cand('d', 2, 3)];
    // chance passes, first starter, three people, first venue
    const plan = planChat(people, { ...opts, rand: seq(0, 0, 0.9, 0) })!;
    expect(plan.ids).toEqual(['a', 'b', 'c']);
    expect(plan.venue).toBe('cooler');
    expect(planChat(people, { ...opts, rand: seq(0, 0, 0.1, 0.9) })!.ids).toEqual(['a', 'b']);
  });

  it('not too often, not without room under the walker cap, and never alone', () => {
    const people = [cand('a', 0, 40), cand('b', 1, 10)];
    const rand = seq(0);
    expect(planChat(people, { ...opts, rand, sinceLast: CHAT_GAP - 1 })).toBeNull();
    expect(planChat(people, { ...opts, rand, away: MAX_WALKERS - 1 })).toBeNull();
    expect(planChat(people, { ...opts, rand: seq(0.99) })).toBeNull();
    expect(planChat([cand('a', 0, 40)], { ...opts, rand })).toBeNull();
    expect(planChat([cand('a', 0, 40), cand('b', 1, CHAT_MIN_SEATED - 1)], { ...opts, rand })).toBeNull();
    expect(planChat([cand('a', 0, 10), cand('b', 1, 10)], { ...opts, rand })).toBeNull(); // nobody restless
    expect(planChat(people, { ...opts, rand, venues: [] })).toBeNull();
    // three wanted but room for two
    const three = [...people, cand('c', 2, 20)];
    expect(planChat(three, { ...opts, rand: seq(0, 0, 0.9, 0), away: MAX_WALKERS - 2 })!.ids).toHaveLength(2);
  });

  it.each(Object.keys(CHAT_VENUES))('two or three fit round the %s, facing each other, and everyone can get there', (venue) => {
    const open = (x: number, z: number) => standable(office, x, z);
    for (const n of [2, 3]) {
      const spots = huddle(CHAT_VENUES[venue], n, open);
      expect(spots, `${venue} × ${n}`).not.toBeNull();
      for (const s of spots!) {
        // facing the middle
        const c = CHAT_VENUES[venue];
        expect(Math.cos(s.facing) * (c.x - s.x) + Math.sin(s.facing) * (c.z - s.z)).toBeGreaterThan(0.5);
        for (const home of office.homes) expect(findPath(office, home, s), `${home.id} → ${venue}`).not.toBeNull();
      }
    }
  });

  it('a huddle that cannot fit anywhere is refused', () => {
    expect(huddle({ x: 0, z: 0 }, 3, () => false)).toBeNull();
  });

  it('chats last tens of seconds, with a few bubbles', () => {
    const total = CHAT.steps.reduce((t, s) => t + s.seconds, 0);
    expect(total).toBeGreaterThanOrEqual(15);
    expect(total).toBeLessThanOrEqual(60);
    expect(CHAT.steps.filter((s) => s.say).length).toBeGreaterThanOrEqual(3);
  });
});

describe('what they talk about', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const pull = (mergedAt: string | null) => ({ mergedAt }) as never;

  it("reads the floor's latest merge and failed QA", () => {
    const repo = { pulls: [pull(null), pull('2026-10-04T11:58:00Z'), pull('2026-10-04T10:00:00Z')] };
    const qa = [
      { status: 'passed' as const, updatedAt: now - 1000 },
      { status: 'failed' as const, updatedAt: now - 30_000 },
      { status: 'needs-human' as const, updatedAt: now - 90_000 },
    ];
    expect(floorNews(repo, qa, 2, now)).toEqual({ mergedAgo: 120, failedAgo: 30, working: 2 });
    expect(floorNews(undefined, [], 0, now)).toEqual({ mergedAgo: null, failedAgo: null, working: 0 });
  });

  const weight = (topics: [string, number][], e: string) => topics.find(([x]) => x === e)![1];

  it('a fresh merge brings 🎉 and a failed QA 🐛; old news fades', () => {
    const quiet = chatTopics({ mergedAgo: null, failedAgo: null, working: 0 });
    const merged = chatTopics({ mergedAgo: 60, failedAgo: null, working: 0 });
    const failed = chatTopics({ mergedAgo: null, failedAgo: 60, working: 0 });
    const old = chatTopics({ mergedAgo: NEWS_SECONDS + 1, failedAgo: NEWS_SECONDS + 1, working: 0 });
    expect(weight(merged, '🎉')).toBeGreaterThan(weight(quiet, '🎉'));
    expect(weight(failed, '🐛')).toBeGreaterThan(weight(quiet, '🐛'));
    expect(old).toEqual(quiet);
    // the news is the most likely thing they talk about
    const top = (t: [string, number][]) => [...t].sort((a, b) => b[1] - a[1])[0][0];
    expect(top(merged)).toBe('🎉');
    expect(top(failed)).toBe('🐛');
  });

  it('every bubble is one of the five, by weight', () => {
    const news = { mergedAgo: 10, failedAgo: null, working: 1 };
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pickTopic(news, i / 100));
    expect([...seen].sort()).toEqual(['☕', '🎉', '🐛', '😂', '🚀'].sort());
    expect(pickTopic(news, 0)).toBe('☕');
  });

  it('a 🎉 chat is about the latest merge, a 🐛 one about the latest failed QA', () => {
    const repo = { pulls: [{ number: 3, mergedAt: '2026-10-04T11:00:00Z' }, { number: 5, mergedAt: '2026-10-04T11:50:00Z' }, { number: 6, mergedAt: null }] } as never;
    const qa = [
      { prNumber: 7, status: 'failed' as const, updatedAt: now - 90_000 },
      { prNumber: 8, status: 'needs-human' as const, updatedAt: now - 10_000 },
      { prNumber: 9, status: 'passed' as const, updatedAt: now },
    ];
    expect(topicPr('🎉', repo, qa)).toBe(5);
    expect(topicPr('🐛', repo, qa)).toBe(8);
    expect(topicPr('☕', repo, qa)).toBeNull();
    expect(topicPr('🎉', undefined, [])).toBeNull();
    expect(topicPr('🐛', repo, [])).toBeNull();
  });
});
