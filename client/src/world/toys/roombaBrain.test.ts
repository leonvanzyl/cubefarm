import { describe, expect, it } from 'vitest';
import { HALF_D, PLAYER_RADIUS, coffeeCorner, type Rect } from '../layout';
import { BALCONY_OUT, HALF_W, SIDE_OPENINGS, SIDES, sideSign } from '../layout';
import type { ToyFloor } from './balls';
import { FULL, NAV_R, ROOMBA, ROOMBA_EVENT, clear, createRoomba, dockFor, makeNav, planPath, roombaRects, roombaStatus, segmentClear, sendOut, spinRoomba, stepRoomba, type Dock, type Pt, type Roomba, type RoombaEnv, type RoombaState } from './roombaBrain';

const DT = 1 / 60;
const FLOORS: ToyFloor[] = ['office', 'lobby'];

function env(floor: ToyFloor, player: Pt | null = null): RoombaEnv {
  return { nav: makeNav(roombaRects(floor)), dock: dockFor(floor), player };
}

/** A roomba already out cleaning at (x, z), heading h. */
function cleaning(dock: Dock, x: number, z: number, h: number, seed = 7): Roomba {
  const r = createRoomba(dock, seed);
  Object.assign(r, { x, z, heading: h, state: 'cleaning' as RoombaState, stateTime: 0, cleanFor: 1e9, move: 'drive', battery: 1, mark: { x, z } });
  return r;
}

describe('roomba docks', () => {
  it.each(FLOORS)('the %s dock is against a wall, clear, and reachable from across the floor', (floor) => {
    const e = env(floor);
    const d = e.dock;
    expect(clear(e.nav.rects, d.x, d.z)).toBe(true);
    const approach = { x: d.x - Math.cos(d.heading) * 0.6, z: d.z - Math.sin(d.heading) * 0.6 };
    expect(segmentClear(e.nav.rects, approach, d, NAV_R)).toBe(true);
    // from near the elevator, the far side of the floor
    for (const from of [{ x: 0, z: 10 }, { x: -12, z: 9 }, { x: 13, z: 10.5 }]) {
      const path = planPath(e.nav, from, approach);
      expect(path).not.toBeNull();
      let at = from;
      for (const p of path!) {
        expect(segmentClear(e.nav.rects, at, p, NAV_R)).toBe(true);
        at = p;
      }
      expect(at).toEqual(approach);
    }
  });
});

describe('the balconies', () => {
  it.each(FLOORS)('are off-limits to the %s roomba: it never drives into a side doorway or out of one', (floor) => {
    const e = env(floor);
    for (const side of SIDES) {
      const s = sideSign(side);
      const door = SIDE_OPENINGS[floor][side].door;
      for (const x of [HALF_W, HALF_W + 0.2, HALF_W + 1.5, BALCONY_OUT - 0.5]) expect(clear(e.nav.rects, s * x, door), `${side} ${x}`).toBe(false);
      // right in front of the doorway it stays a wall's distance off, like anywhere else along the wall
      expect(clear(e.nav.rects, s * (HALF_W - NAV_R + 0.01), door)).toBe(false);
      expect(clear(e.nav.rects, s * (HALF_W - NAV_R - 0.01), door)).toBe(true);
      // asked to go out there, the nearest it gets is inside
      const path = planPath(e.nav, { x: s * (HALF_W - 3), z: door }, { x: s * (HALF_W + 1.5), z: door });
      expect(path).not.toBeNull();
      for (const p of path!) expect(Math.abs(p.x)).toBeLessThanOrEqual(HALF_W + 1.5); // the goal itself is passed back as asked
      for (const p of path!.slice(0, -1)) expect(Math.abs(p.x)).toBeLessThan(HALF_W);
    }
  });
});

describe('planPath', () => {
  const walls: Rect[] = [{ minX: -2, maxX: 2, minZ: -0.2, maxZ: 0.2 }];
  it('goes round an obstacle instead of through it', () => {
    const nav = makeNav(walls);
    const path = planPath(nav, { x: 0, z: 2 }, { x: 0, z: -2 })!;
    expect(path.length).toBeGreaterThan(1);
    let at = { x: 0, z: 2 };
    for (const p of path) {
      expect(segmentClear(walls, at, p, NAV_R)).toBe(true);
      at = p;
    }
  });

  it("steers round the lobby's coffee corner", () => {
    const e = env('lobby');
    const c = coffeeCorner();
    expect(clear(e.nav.rects, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2)).toBe(false);
    const from = { x: c.minX - 0.6, z: HALF_D - 0.4 };
    const to = { x: c.maxX + 0.6, z: HALF_D - 0.4 };
    const path = planPath(e.nav, from, to);
    expect(path).not.toBeNull();
    let at = from;
    for (const p of path!) {
      expect(segmentClear(e.nav.rects, at, p, NAV_R)).toBe(true);
      at = p;
    }
  });

  it('returns null when the goal is walled off', () => {
    const box: Rect[] = [
      { minX: -3, maxX: 3, minZ: -3, maxZ: -2.8 },
      { minX: -3, maxX: 3, minZ: 2.8, maxZ: 3 },
      { minX: -3, maxX: -2.8, minZ: -3, maxZ: 3 },
      { minX: 2.8, maxX: 3, minZ: -3, maxZ: 3 },
    ];
    expect(planPath(makeNav(box), { x: 10, z: 0 }, { x: 0, z: 0 })).toBeNull();
  });
});

describe('cleaning', () => {
  it('bumps into a wall without clipping it, then turns or follows the wall', () => {
    const e = env('office');
    // open floor south of the desks, driving straight at the west wall
    const r = cleaning(e.dock, -12, 9.6, Math.PI);
    let turned = false;
    for (let i = 0; i < 60 * 30 && !turned; i++) {
      stepRoomba(r, DT, e);
      expect(clear(e.nav.rects, r.x, r.z)).toBe(true);
      turned = r.move === 'turn' || r.move === 'follow';
    }
    expect(turned).toBe(true);
    expect(r.x).toBeLessThan(-15);
  });

  it('backs up and turns when it has made no progress for 5 s', () => {
    // a pocket barely bigger than the roomba: it can turn but never get anywhere
    const s = NAV_R + 0.01;
    const box: Rect[] = [
      { minX: -1, maxX: 1, minZ: -1, maxZ: -s },
      { minX: -1, maxX: 1, minZ: s, maxZ: 1 },
      { minX: -1, maxX: -s, minZ: -1, maxZ: 1 },
      { minX: s, maxX: 1, minZ: -1, maxZ: 1 },
    ];
    const e: RoombaEnv = { nav: makeNav(box), dock: dockFor('office'), player: null };
    const r = cleaning(e.dock, 0, 0, 0);
    r.move = 'turn';
    r.turnLeft = 1000; // spinning in place forever
    let backedAt = -1;
    for (let i = 0; i < 60 * 6 && backedAt < 0; i++) {
      stepRoomba(r, DT, e);
      if ((r.move as string) === 'back') backedAt = i * DT;
    }
    expect(backedAt).toBeGreaterThanOrEqual(ROOMBA.stuckAfter - 0.1);
    expect(backedAt).toBeLessThan(ROOMBA.stuckAfter + 0.2);
  });

  it('stops for the player in front of it and never gets closer', () => {
    const e = env('office');
    const r = cleaning(e.dock, -12, 9.6, 0);
    e.player = { x: -11, z: 9.6 };
    let waited = false;
    for (let i = 0; i < 60 * 20; i++) {
      stepRoomba(r, DT, e);
      if (r.move === 'wait') waited = true;
      expect(Math.hypot(r.x - e.player.x, r.z - e.player.z)).toBeGreaterThan(ROOMBA.r + PLAYER_RADIUS);
    }
    expect(waited).toBe(true);
  });

  it('backs away when the player steps onto it', () => {
    const e = env('office');
    const r = cleaning(e.dock, -12, 9.6, 0);
    e.player = { x: -12.2, z: 9.6 };
    for (let i = 0; i < 60 * 3; i++) stepRoomba(r, DT, e);
    expect(Math.hypot(r.x - e.player.x, r.z - e.player.z)).toBeGreaterThan(ROOMBA.r + PLAYER_RADIUS);
  });

  it('spins happily on E and picks up where it left off', () => {
    const e = env('office');
    const r = cleaning(e.dock, -12, 9.6, 0.4);
    spinRoomba(r);
    expect(r.move).toBe('spin');
    for (let i = 0; i < 60 * ROOMBA.spin + 2; i++) stepRoomba(r, DT, e);
    expect(r.move).toBe('drive');
    expect(r.heading).toBeCloseTo(0.4, 5);
  });
});

describe('a whole cycle', () => {
  it.each(FLOORS)('on the %s floor it leaves the dock, cleans, comes home, charges and goes out again', (floor) => {
    const e = env(floor);
    const r = createRoomba(e.dock, 42);
    expect(roombaStatus(r)).toBe('charging');
    const seen = new Set<string>();
    const cells = new Set<string>();
    let chargedAgainAt = -1;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      stepRoomba(r, DT, e);
      expect(clear(e.nav.rects, r.x, r.z)).toBe(true);
      seen.add(r.state);
      cells.add(`${Math.floor(r.x)},${Math.floor(r.z)}`);
      if (chargedAgainAt < 0 && seen.has('cleaning') && r.state === 'charging') {
        chargedAgainAt = i * DT;
        expect(r.x).toBeCloseTo(e.dock.x, 3);
        expect(r.z).toBeCloseTo(e.dock.z, 3);
        expect(r.battery).toBeGreaterThan(0.1);
        expect(r.battery).toBeLessThan(0.7);
      }
    }
    expect([...seen].sort()).toEqual(['charging', 'cleaning', 'docking', 'leaving', 'returning']);
    // home within a few minutes, having covered a good part of the floor
    expect(chargedAgainAt).toBeGreaterThan(ROOMBA.cleanMin);
    expect(chargedAgainAt).toBeLessThan(ROOMBA.cleanMax + 90);
    expect(cells.size).toBeGreaterThan(25);
    // and after its 30 s charge it went out again
    expect(r.state).not.toBe('charging');
  });

  it('the evening round sends it off the dock straight away, but not once it is out', () => {
    const e = env('office');
    const r = createRoomba(e.dock, 3);
    expect(sendOut(r)).toBe(true);
    stepRoomba(r, DT, e);
    expect(r.state).toBe('leaving');
    expect(sendOut(r)).toBe(false);
  });

  it('flags leaving, heading home, docking, a full charge and bumps as they happen', () => {
    const e = env('office');
    const r = createRoomba(e.dock, 42);
    const order: string[] = [];
    let bumps = 0;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      const state = r.state;
      stepRoomba(r, DT, e);
      for (const [name, bit] of Object.entries(ROOMBA_EVENT)) {
        if (!(r.events & bit)) continue;
        if (name === 'bump') bumps++;
        else if (name !== 'stuck') order.push(name);
      }
      if (r.events & ROOMBA_EVENT.leave) expect([state, r.state]).toEqual(['charging', 'leaving']);
      if (r.events & ROOMBA_EVENT.home) expect([state, r.state]).toEqual(['cleaning', 'returning']);
      if (r.events & ROOMBA_EVENT.dock) expect([state, r.state]).toEqual(['docking', 'charging']);
      if (r.events & ROOMBA_EVENT.full) expect(r.battery).toBeGreaterThanOrEqual(FULL);
      r.events = 0;
    }
    expect(order.slice(0, 6)).toEqual(['full', 'leave', 'home', 'dock', 'full', 'leave']);
    expect(bumps).toBeGreaterThan(3);
  });

  it('flags getting stuck', () => {
    const s = NAV_R + 0.01;
    const box: Rect[] = [
      { minX: -1, maxX: 1, minZ: -1, maxZ: -s },
      { minX: -1, maxX: 1, minZ: s, maxZ: 1 },
      { minX: -1, maxX: -s, minZ: -1, maxZ: 1 },
      { minX: s, maxX: 1, minZ: -1, maxZ: 1 },
    ];
    const e: RoombaEnv = { nav: makeNav(box), dock: dockFor('office'), player: null };
    const r = cleaning(e.dock, 0, 0, 0);
    r.move = 'turn';
    r.turnLeft = 1000;
    for (let i = 0; i < 60 * 6; i++) stepRoomba(r, DT, e);
    expect(r.events & ROOMBA_EVENT.stuck).toBeTruthy();
  });
});
