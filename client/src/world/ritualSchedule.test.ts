import { describe, expect, it } from 'vitest';
import {
  AISLES,
  CEO_WALK,
  COURIER_DROP,
  EVENING,
  IDLE_BEFORE_WINDDOWN,
  KITCHEN_SPOTS,
  PARKED,
  PRESENTER,
  STANDUP,
  STANDUP_SPOTS,
  TABLE_SPOTS,
  freeSpot,
  freshIssues,
  isLate,
  isLunch,
  isNight,
  lunchOf,
  mergeTimes,
  mergesSince,
  newRitualState,
  nextWalkGap,
  officeClock,
  parseRitualParam,
  pizzaDue,
  schedule,
  semicircle,
  standupDue,
  stepEvening,
  streakMerge,
  type Decision,
  type Facts,
  type OfficeClock,
  type RitualState,
} from './ritualSchedule';
import { CABIN } from './socials';
import { CYCLE_MS } from './sky/time';
import { BOARD, ELEVATOR, HALF_D } from './layout';
import { findPath, spot, standable, walkways } from './walkways';

const office = walkways('office');
const MIN = 60_000;
const at = (hour: number, weekday = 3, day = 'd1'): OfficeClock => ({ hour, weekday, day, dayStart: 0 });

/** The facts of a quiet afternoon, with `over` changed. */
const facts = (over: Partial<Facts> = {}): Facts => ({
  now: 1000,
  wall: 10 * 60 * MIN,
  clock: at(14),
  idleFor: 0,
  ceoFree: true,
  ceoOn: null,
  merged: [],
  rand: () => 0.5,
  ...over,
});

const kinds = (ds: Decision[]) => ds.map((d) => d.do);

describe('the ritual param', () => {
  it('forces one of the rituals by name, nothing else', () => {
    expect(parseRitualParam('?ritual=standup')).toBe('standup');
    expect(parseRitualParam('?stats&ritual=ceo-walk')).toBe('ceo-walk');
    expect(parseRitualParam('?ritual=party')).toBeNull();
    expect(parseRitualParam('')).toBeNull();
  });
});

describe('the office clock', () => {
  it('takes the hour from the sky and the weekday from the calendar', () => {
    const fri = new Date(2026, 9, 2, 10, 30).getTime(); // a Friday
    const c = officeClock(fri, 0.5, 'clock');
    expect(c.hour).toBe(12);
    expect(c.weekday).toBe(5);
    expect(c.day).toBe('2026-10-02');
    expect(c.dayStart).toBe(new Date(2026, 9, 2).getTime());
  });

  it('makes every 30-minute cycle a day of its own', () => {
    const a = officeClock(5 * CYCLE_MS + 1000, 0.3, 'cycle');
    const b = officeClock(6 * CYCLE_MS + 1000, 0.3, 'cycle');
    expect(a.day).not.toBe(b.day);
    expect(a.dayStart).toBe(5 * CYCLE_MS);
    expect(a.hour).toBeCloseTo(7.2);
  });
});

describe('times of day', () => {
  it('lunch is noon to one', () => {
    expect([11.9, 12, 12.5, 12.99, 13].map(isLunch)).toEqual([false, true, true, true, false]);
  });

  it('the evening runs from 7 pm, home time from 10 pm, both until 8 am', () => {
    expect([18.9, 19, 23, 3, 7.99, 8].map(isNight)).toEqual([false, true, true, true, true, false]);
    expect([21.9, 22, 2, 8].map(isLate)).toEqual([false, true, true, false]);
  });

  it('Friday pizza: 4 pm or the fifth merge of the day, whichever is first, never at night or on other days', () => {
    expect(pizzaDue(at(15.9, 5), 4)).toBe(false);
    expect(pizzaDue(at(16, 5), 0)).toBe(true);
    expect(pizzaDue(at(10, 5), 5)).toBe(true);
    expect(pizzaDue(at(16, 4), 9)).toBe(false);
    expect(pizzaDue(at(23, 5), 9)).toBe(false);
  });

  it('counts merges since the start of the day', () => {
    const pulls = [
      { state: 'MERGED' as const, mergedAt: new Date(5000).toISOString() },
      { state: 'MERGED' as const, mergedAt: new Date(9000).toISOString() },
      { state: 'OPEN' as const, mergedAt: null },
    ];
    expect(mergeTimes(pulls)).toEqual([5000, 9000]);
    expect(mergesSince(mergeTimes(pulls), 6000)).toBe(1);
  });
});

describe('the evening', () => {
  it('winds down once the floor has been idle a while after 7, goes home after 10, and comes back at 8', () => {
    expect(stepEvening('day', 19.5, IDLE_BEFORE_WINDDOWN - 1)).toEqual({ phase: 'day', event: null });
    expect(stepEvening('day', 19.5, IDLE_BEFORE_WINDDOWN)).toEqual({ phase: 'winddown', event: 'winddown' });
    expect(stepEvening('winddown', 21, 0)).toEqual({ phase: 'winddown', event: null });
    expect(stepEvening('winddown', 22.5, 0)).toEqual({ phase: 'home', event: 'home' });
    expect(stepEvening('home', 3, 0)).toEqual({ phase: 'home', event: null });
    expect(stepEvening('home', EVENING.morning, 0)).toEqual({ phase: 'day', event: 'morning' });
    expect(stepEvening('winddown', 9, 0)).toEqual({ phase: 'day', event: 'morning' });
  });

  it('a floor still busy at night winds down when it goes idle, and goes home straight after', () => {
    expect(stepEvening('day', 23, 5).event).toBeNull();
    const a = stepEvening('day', 23, 60);
    expect(a.event).toBe('winddown');
    expect(stepEvening(a.phase, 23, 60).event).toBe('home');
  });

  it('nothing happens by day, however idle', () => {
    expect(stepEvening('day', 14, 1e6)).toEqual({ phase: 'day', event: null });
  });
});

describe('the stand-up', () => {
  it('only issues new since the last look are fresh', () => {
    const seen = new Set<number>();
    expect(freshIssues(seen, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(freshIssues(seen, [1, 2, 3, 7, 8])).toEqual([7, 8]);
    expect(freshIssues(seen, [2, 8])).toEqual([]);
  });

  it('needs a burst: at least two new issues, the last a few seconds old, and not straight after another', () => {
    const one = [{ n: 7, at: 100 }];
    const two = [...one, { n: 8, at: 102 }];
    expect(standupDue(one, 200, -Infinity)).toBe(false);
    expect(standupDue(two, 102 + STANDUP.settle - 1, -Infinity)).toBe(false); // the CEO may still be filing
    expect(standupDue(two, 102 + STANDUP.settle, -Infinity)).toBe(true);
    expect(standupDue(two, 110, 110 - STANDUP.gap + 1)).toBe(false);
    expect(standupDue(two, 100 + STANDUP.window + 1, -Infinity)).toBe(false); // too long ago to be a burst
  });

  it('three issues filed in a burst start one, with their stickies in order', () => {
    const s = newRitualState(1e9);
    s.fresh = [
      { n: 14, at: 990 },
      { n: 12, at: 990 },
      { n: 13, at: 991 },
    ];
    const d = schedule(s, facts());
    expect(d).toEqual([{ do: 'standup', issues: [12, 13, 14] }]);
    expect(s.fresh).toEqual([]);
    expect(s.standupAt).toBe(1000);
  });

  it('cuts a CEO walk short, but waits for a stand-up already under way', () => {
    const burst = () => [
      { n: 1, at: 990 },
      { n: 2, at: 990 },
    ];
    const s = newRitualState(1e9);
    s.fresh = burst();
    expect(kinds(schedule(s, facts({ ceoOn: 'standup' })))).toEqual([]);
    expect(s.fresh).toHaveLength(2);
    expect(kinds(schedule(s, facts({ ceoOn: 'walk' })))).toEqual(['standup']);
  });

  it('puts up at most a handful of stickies', () => {
    const s = newRitualState(1e9);
    s.fresh = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, at: 990 }));
    const d = schedule(s, facts())[0] as Extract<Decision, { do: 'standup' }>;
    expect(d.issues).toHaveLength(STANDUP.stickies);
  });
});

describe('the CEO walk', () => {
  it('comes every so often while the CEO is free, in office hours', () => {
    const s = newRitualState(500);
    expect(kinds(schedule(s, facts({ ceoFree: false })))).toEqual([]);
    expect(kinds(schedule(s, facts({ clock: at(22) })))).toEqual([]);
    expect(schedule(s, facts())).toEqual([{ do: 'ceo-walk', gong: false }]);
    expect(s.walkAt).toBe(1000 + nextWalkGap(0.5));
    expect(kinds(schedule(s, facts({ now: 1001 })))).toEqual([]);
  });

  it('never while the CEO is already busy with a stand-up or a walk here', () => {
    expect(kinds(schedule(newRitualState(0), facts({ ceoOn: 'walk' })))).toEqual([]);
    expect(kinds(schedule(newRitualState(0), facts({ ceoOn: 'standup' })))).toEqual([]);
  });

  it('comes soon after a merge streak (once per streak), and takes in the gong after a merge', () => {
    const wall = 100 * MIN;
    const merged = [wall - 5 * MIN, wall - CEO_WALK.soon * 1000 - 500];
    expect(streakMerge(merged, wall)).toBe(merged[1]);
    expect(streakMerge(merged.slice(0, 1), wall)).toBeNull();
    const s = newRitualState(1e9);
    expect(schedule(s, facts({ wall, merged }))).toEqual([{ do: 'ceo-walk', gong: true }]);
    expect(kinds(schedule(s, facts({ wall: wall + 1000, merged, now: 1001 })))).toEqual([]);
  });

  it("a streak that was over before you arrived doesn't count", () => {
    const wall = 100 * MIN;
    const merged = [wall - 5 * MIN, wall - 2 * MIN];
    expect(kinds(schedule(newRitualState(1e9, Math.max(...merged)), facts({ wall, merged })))).toEqual([]);
  });

  it('the first walk comes sooner than the rest', () => {
    expect(nextWalkGap(1, true)).toBeLessThan(nextWalkGap(0));
  });
});

describe('the scheduler over a day', () => {
  /** Runs the scheduler through `hours` (office hours, a look a minute), the floor idle and the CEO busy. */
  function day(s: RitualState, hours: number[], weekday = 3, merged: number[] = []) {
    const out: [number, Decision][] = [];
    for (const hour of hours) for (const d of schedule(s, facts({ clock: at(hour, weekday, hour >= 8 ? 'd1' : 'd2'), idleFor: 1e6, ceoFree: false, merged }))) out.push([hour, d]);
    return out;
  }
  const hours = Array.from({ length: 29 * 4 }, (_, i) => (8 + i / 4) % 24); // 8 am to 1 pm the next day

  it('a weekday: lunch on and off, the wind-down, home time and the morning', () => {
    const events = day(newRitualState(1e9), hours).map(([h, d]) => `${h}:${d.do}${'on' in d ? (d.on ? '+' : '-') : ''}`);
    expect(events).toEqual(['12:lunch+', '13:lunch-', '19:winddown', '22:home', '8:morning', '12:lunch+']);
  });

  it('Friday brings pizza at 4, once', () => {
    const events = day(newRitualState(1e9), hours, 5).filter(([, d]) => d.do === 'pizza');
    expect(events.map(([h]) => h)).toEqual([16]);
  });

  it("an idle floor starts the day as the night left it: the first look at 8 is the morning's", () => {
    const s = newRitualState(1e9);
    s.evening = 'home';
    expect(kinds(schedule(s, facts({ clock: at(8.1) })))).toEqual(['morning']);
  });
});

describe('where everyone stands', () => {
  it('the stand-up: the CEO by the Backlog column, the team in an arc facing them, all on the floor and reachable', () => {
    const backlog = spot(office, 'board-backlog')!;
    expect(Math.abs(PRESENTER.x - backlog.x)).toBeLessThan(2);
    expect(PRESENTER.z).toBeGreaterThan(BOARD.z + 0.5);
    expect(standable(office, PRESENTER.x, PRESENTER.z)).toBe(true);
    const arc = semicircle(PRESENTER, STANDUP_SPOTS);
    expect(new Set(arc.map((s) => s.id)).size).toBe(STANDUP_SPOTS);
    for (const s of arc) {
      expect(standable(office, s.x, s.z), s.id).toBe(true);
      expect(s.z).toBeGreaterThan(PRESENTER.z); // out from the board
      expect(Math.hypot(s.x - PRESENTER.x, s.z - PRESENTER.z)).toBeCloseTo(2.3);
      // facing the presenter (walkways.ts facings: along (cos, sin))
      const fx = Math.cos(s.facing);
      const fz = Math.sin(s.facing);
      expect(fx * (PRESENTER.x - s.x) + fz * (PRESENTER.z - s.z)).toBeGreaterThan(2.2);
      expect(findPath(office, spot(office, 'desk-0')!, s), s.id).not.toBeNull();
    }
    // nobody stands too close to the next
    for (let i = 1; i < arc.length; i++) expect(Math.hypot(arc[i].x - arc[i - 1].x, arc[i].z - arc[i - 1].z)).toBeGreaterThan(0.75);
    expect(findPath(office, spot(office, 'elevator')!, PRESENTER)).not.toBeNull();
  });

  it('lunch and pizza spots, the courier and the aisles are all clear and reachable from the desks', () => {
    for (const s of [...TABLE_SPOTS, ...KITCHEN_SPOTS, COURIER_DROP, ...AISLES.map((p, i) => ({ id: `aisle-${i}`, ...p }))]) {
      expect(standable(office, s.x, s.z), s.id).toBe(true);
      expect(findPath(office, spot(office, 'desk-5')!, s), s.id).not.toBeNull();
    }
  });

  it('someone gone home waits at the back of the cabin, beyond where the doors open for people', () => {
    expect(PARKED.z).toBeGreaterThan(CABIN.z);
    expect(PARKED.z).toBeLessThan(HALF_D + ELEVATOR.depth - 0.25);
    expect(PARKED.z - (HALF_D + 0.15)).toBeGreaterThan(2); // Elevator.tsx opens for bodies within 2 m of its doors
  });

  it('the nearest free spot', () => {
    const taken = new Set([TABLE_SPOTS[0].id]);
    expect(freeSpot(TABLE_SPOTS, taken, TABLE_SPOTS[0])?.id).toBe(TABLE_SPOTS[1].id);
    expect(freeSpot(TABLE_SPOTS, new Set(TABLE_SPOTS.map((s) => s.id)), { x: 0, z: 0 })).toBeNull();
  });
});

describe('lunch', () => {
  it('everyone has their own, the same every day', () => {
    expect(lunchOf('ada')).toBe(lunchOf('ada'));
    const kinds = new Set(['ada', 'linus', 'grace', 'alan', 'margaret', 'ken', 'barbara'].map(lunchOf));
    expect(kinds.size).toBeGreaterThan(1);
    expect([...kinds].every((k) => ['lunchbox', 'sandwich', 'noodles'].includes(k))).toBe(true);
  });
});
