import { describe, expect, it } from 'vitest';
import { KANBAN_KEYS } from './draw';
import { BOARD, PLAYER_RADIUS, coffeeCorner, elevatorDoorway, lobbyColliders, officeColliders } from './layout';
import { segmentClear, type Pt } from './toys/roombaBrain';
import { WALK_R, WALK_SPEED, findPath, spot, standable, steer, walkways, type Body, type FloorKind, type Mover, type Walkways } from './walkways';

const FLOORS: FloorKind[] = ['office', 'lobby'];
const DT = 1 / 60;

const length = (from: Pt, path: Pt[]) => {
  let at = from;
  let d = 0;
  for (const p of path) {
    d += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return d;
};

describe('named spots', () => {
  it.each(FLOORS)('every %s spot (and seat) is somewhere a person can stand, with unique ids', (floor) => {
    const w = walkways(floor);
    const all = [...new Set([...w.homes, ...w.spots])];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(standable(w, s.x, s.z), s.id).toBe(true);
      expect(Number.isFinite(s.facing)).toBe(true);
      // a seat is a short step from where you stand
      if (s.sit) expect(Math.hypot(s.sit.x - s.x, s.sit.z - s.z), s.id).toBeLessThan(1.5);
    }
  });

  it('office floors have every desk, QA station, board column and break-area spot', () => {
    const w = walkways('office');
    expect(w.homes.map((s) => s.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `desk-${i}`), 'qa-0', 'qa-1', 'qa-2']);
    for (const id of ['coffee', 'mugs', 'cooler', 'gong', 'couch', 'hoop', 'balls', 'elevator', ...KANBAN_KEYS.map((k) => `board-${k}`)]) expect(spot(w, id), id).toBeDefined();
    expect(spot(w, 'couch')!.sit).toBeDefined();
  });

  it('the board spots stand in front of their columns, left to right across the board', () => {
    const xs = KANBAN_KEYS.map((k) => spot(walkways('office'), `board-${k}`)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[0]).toBeGreaterThan(-BOARD.w / 2);
    expect(xs[xs.length - 1]).toBeLessThan(BOARD.w / 2);
    expect(xs[2]).toBeCloseTo(0); // the middle column
  });

  it('the lobby has the CEO, the couch, the toys and the elevator', () => {
    const w = walkways('lobby');
    expect(w.homes.map((s) => s.id)).toEqual(['ceo']);
    for (const id of ['manager', 'reception', 'couch', 'coffee', 'mugs', 'hoop', 'balls', 'elevator']) expect(spot(w, id), id).toBeDefined();
  });

  it("the lobby's coffee spots stand in front of the coffee corner, facing it, and you can walk there", () => {
    const w = walkways('lobby');
    const counter = coffeeCorner();
    for (const id of ['coffee', 'mugs']) {
      const s = spot(w, id)!;
      expect(standable(w, s.x, s.z), id).toBe(true);
      // just north of the counter and within its width, so a person reaches it without being inside it
      expect(s.x, id).toBeGreaterThan(counter.minX);
      expect(s.x, id).toBeLessThan(counter.maxX);
      expect(counter.minZ - s.z, id).toBeGreaterThan(WALK_R);
      expect(counter.minZ - s.z, id).toBeLessThan(0.8);
      expect(Math.cos(s.facing), id).toBeCloseTo(0); // facing south, at the counter
      expect(Math.sin(s.facing), id).toBeCloseTo(1);
      for (const from of [spot(w, 'ceo')!, spot(w, 'elevator')!, spot(w, 'reception')!]) {
        const path = findPath(w, from, s);
        expect(path, `${from.id} → ${id}`).not.toBeNull();
        let at: Pt = from;
        for (const p of path!) {
          expect(segmentClear([counter], at, p, WALK_R), `${from.id} → ${id}`).toBe(true);
          at = p;
        }
      }
    }
  });
});

describe('findPath', () => {
  it.each(FLOORS)('on the %s floor, every spot is reachable from every desk and station, round the furniture', (floor) => {
    const w = walkways(floor);
    // the colliders people bump into, plus the elevator doorway: no leg may cross any of them
    const solid = [...(floor === 'office' ? officeColliders() : lobbyColliders()), elevatorDoorway()];
    for (const home of w.homes) {
      for (const to of [...w.homes, ...w.spots]) {
        if (to === home) continue;
        const path = findPath(w, home, to);
        expect(path, `${home.id} → ${to.id}`).not.toBeNull();
        let at: Pt = home;
        for (const p of path!) {
          expect(segmentClear(solid, at, p, WALK_R), `${home.id} → ${to.id}`).toBe(true);
          at = p;
        }
        expect(at).toEqual({ x: to.x, z: to.z });
        // short and smooth: a few straight legs, not much longer than as the crow flies
        expect(path!.length, `${home.id} → ${to.id}`).toBeLessThanOrEqual(7);
        expect(length(home, path!), `${home.id} → ${to.id}`).toBeLessThan(Math.hypot(to.x - home.x, to.z - home.z) * 1.5 + 3);
      }
    }
  });

  it('plans a whole floor (15 walks) in well under a frame', () => {
    const w = walkways('office');
    const pairs = w.homes.map((h, i) => [h, w.spots[(i * 7) % w.spots.length]] as const);
    expect(pairs).toHaveLength(15);
    for (const [a, b] of pairs) findPath(w, a, b); // warm up
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t = performance.now();
      for (const [a, b] of pairs) findPath(w, a, b);
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    expect(runs[2]).toBeLessThan(8); // the median; a frame is 16.7 ms
  });
});

// ---------- getting along ----------

interface Sim {
  w: Walkways;
  walkers: (Body & { goal: Pt })[];
  player: Pt | null;
}

/** Step every walker towards its goal with steer(), not moving into furniture. */
function step(s: Sim) {
  const open = (x: number, z: number) => standable(s.w, x, z);
  const moves = s.walkers.map((m) => {
    const gx = m.goal.x - m.x;
    const gz = m.goal.z - m.z;
    const d = Math.hypot(gx, gz);
    if (d < 0.05) return { x: m.x, z: m.z };
    const me: Mover = { ...m, dx: gx / d, dz: gz / d };
    const st = steer(me, s.walkers, s.player, open);
    const v = WALK_SPEED * DT;
    const x = m.x + (me.dx * st.speed - me.dz * st.side) * Math.min(v, d);
    const z = m.z + (me.dz * st.speed + me.dx * st.side) * Math.min(v, d);
    return open(x, z) ? { x, z } : { x: m.x, z: m.z };
  });
  moves.forEach((p, i) => Object.assign(s.walkers[i], p));
}

describe('steer', () => {
  it('walks on at full speed with nobody ahead', () => {
    const me: Mover = { id: 'a', x: 0, z: 0, dx: 1, dz: 0 };
    expect(steer(me, [{ id: 'b', x: -1, z: 0 }, { id: 'c', x: 0.3, z: 2 }], { x: 5, z: 0 })).toEqual({ speed: 1, side: 0, wait: false });
  });

  it('two people walking at each other down an aisle pass without touching', () => {
    const w = walkways('office');
    // the aisle between the back two rows of desks
    const s: Sim = { w, player: null, walkers: [
      { id: 'a', x: -8, z: -3.6, goal: { x: 8, z: -3.6 } },
      { id: 'b', x: 8, z: -3.6, goal: { x: -8, z: -3.6 } },
    ] };
    let closest = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      step(s);
      const [a, b] = s.walkers;
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    }
    expect(closest).toBeGreaterThan(2 * WALK_R);
    for (const m of s.walkers) expect(Math.hypot(m.x - m.goal.x, m.z - m.goal.z), m.id).toBeLessThan(0.1);
  });

  it('a slightly offset meeting resolves too', () => {
    const w = walkways('office');
    const s: Sim = { w, player: null, walkers: [
      { id: 'a', x: -6, z: -3.5, goal: { x: 6, z: -3.5 } },
      { id: 'b', x: 6, z: -3.65, goal: { x: -6, z: -3.65 } },
    ] };
    let closest = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      step(s);
      closest = Math.min(closest, Math.hypot(s.walkers[0].x - s.walkers[1].x, s.walkers[0].z - s.walkers[1].z));
    }
    expect(closest).toBeGreaterThan(2 * WALK_R);
    for (const m of s.walkers) expect(Math.hypot(m.x - m.goal.x, m.z - m.goal.z), m.id).toBeLessThan(0.1);
  });

  it('never closes in on the player standing in the way, and steps round them', () => {
    const w = walkways('office');
    const player = { x: 0, z: -3.6 };
    const s: Sim = { w, player, walkers: [{ id: 'a', x: -5, z: -3.6, goal: { x: 5, z: -3.6 } }] };
    for (let i = 0; i < 60 * 20; i++) {
      step(s);
      expect(Math.hypot(s.walkers[0].x - player.x, s.walkers[0].z - player.z)).toBeGreaterThan(WALK_R + PLAYER_RADIUS);
    }
    expect(s.walkers[0].x).toBeCloseTo(5, 1);
  });

  it('stops short of the player when there is no room to step round', () => {
    const me: Mover = { id: 'a', x: 0, z: 0, dx: 1, dz: 0 };
    const st = steer(me, [], { x: WALK_R + PLAYER_RADIUS + 0.1, z: 0 }, () => false);
    expect(st).toEqual({ speed: 0, side: 0, wait: true });
  });
});
