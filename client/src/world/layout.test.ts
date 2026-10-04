import { describe, expect, it } from 'vitest';
import { APP_SCREEN, BOARD, CEO_DESK, CEO_ROOM, COFFEE_CORNER, coffeeCorner, collide, DESK_RUGS, ELEVATOR, GONG, GONG_SPOT, gongRect, HALF_D, LOBBY_RUG, lobbyColliders, MANAGER_DESK, officeColliders, PLAYER_RADIUS, QA_RUG, RECEPTION, rect, shellColliders, SPAWN, surfaceAt, WAITING, type Rect } from './layout.ts';

const R = 0.3;
const box: Rect = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };

/** True when a circle of radius r at (x, z) overlaps any rect (touching doesn't count). */
const overlaps = (p: { x: number; z: number }, rects: Rect[], r = R) =>
  rects.some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r);

describe('collide', () => {
  it('leaves a player who is clear of every rect alone', () => {
    expect(collide(5, 5, [box], R)).toEqual({ x: 5, z: 5 });
    expect(collide(-1, 1, [box], R)).toEqual({ x: -1, z: 1 });
  });

  it('lets the player touch a rect without being pushed', () => {
    expect(collide(-R, 1, [box], R)).toEqual({ x: -R, z: 1 });
    expect(collide(1, 2 + R, [box], R)).toEqual({ x: 1, z: 2 + R });
  });

  it('pushes out through the nearest side', () => {
    const west = collide(-0.1, 1, [box], R);
    expect(west.x).toBeCloseTo(-R);
    expect(west.z).toBe(1);

    const east = collide(2.1, 1, [box], R);
    expect(east.x).toBeCloseTo(2 + R);
    expect(east.z).toBe(1);

    const north = collide(1, -0.2, [box], R);
    expect(north.x).toBe(1);
    expect(north.z).toBeCloseTo(-R);

    const south = collide(1, 1.9, [box], R);
    expect(south.x).toBe(1);
    expect(south.z).toBeCloseTo(2 + R);
  });

  it('pushes out of a deep overlap too', () => {
    const p = collide(0.4, 1, [box], R); // inside the rect itself, closest to the west side
    expect(p.x).toBeCloseTo(-R);
    expect(p.z).toBe(1);
  });

  it('pushes a corner overlap along the shallower axis only', () => {
    const p = collide(-0.2, -0.1, [box], R); // 0.1 into the west edge, 0.2 into the north edge
    expect(p.x).toBeCloseTo(-R);
    expect(p.z).toBe(-0.1);

    const q = collide(2.05, 2.25, [box], R); // 0.25 into the east edge, 0.05 into the south edge
    expect(q.x).toBe(2.05);
    expect(q.z).toBeCloseTo(2 + R);
  });

  it('gets the player out of an inside corner between two walls', () => {
    const westWall: Rect = { minX: -1, maxX: 0, minZ: -5, maxZ: 5 };
    const northWall: Rect = { minX: -5, maxX: 5, minZ: -1, maxZ: 0 };
    const p = collide(0.1, 0.2, [westWall, northWall], R);
    expect(p.x).toBeCloseTo(R);
    expect(p.z).toBeCloseTo(R);
    expect(overlaps(p, [westWall, northWall])).toBe(false);
  });

  it('uses a second pass when one push lands inside another rect', () => {
    const desk: Rect = { minX: 0, maxX: 1, minZ: 0, maxZ: 0.5 };
    const wall: Rect = { minX: -1, maxX: 0, minZ: -5, maxZ: 5 }; // the desk stands against the wall
    const p = collide(0.25, 0.25, [desk, wall], R); // the desk pushes west into the wall, the wall pushes back
    expect(overlaps(p, [desk, wall])).toBe(false);
  });

  it('defaults to the player radius', () => {
    expect(collide(-0.1, 1, [box]).x).toBeCloseTo(-PLAYER_RADIUS);
  });

  it('builds rects around their centre', () => {
    expect(rect(1, 2, 4, 6)).toEqual({ minX: -1, maxX: 3, minZ: -1, maxZ: 5 });
  });

  it('spawns the player somewhere free on every floor', () => {
    const office = [...shellColliders(), ...officeColliders()];
    const lobby = [...shellColliders(), ...lobbyColliders()];
    expect(collide(SPAWN.x, SPAWN.z, office)).toEqual({ x: SPAWN.x, z: SPAWN.z });
    expect(collide(SPAWN.x, SPAWN.z, lobby)).toEqual({ x: SPAWN.x, z: SPAWN.z });
  });

  it('mounts the app monitor on the north wall, clear of the whiteboard and everything else', () => {
    const a = APP_SCREEN;
    const shell = shellColliders();
    const monitor = rect(a.x, -HALF_D + a.depth / 2, a.w + a.bezel * 2, a.depth, a.y + a.h / 2 + a.bezel);
    const office = officeColliders();
    expect(office).toContainEqual(monitor);
    expect(monitor.maxX).toBeLessThan(-BOARD.w / 2 - 0.5);
    const same = (b: Rect, c: Rect) => b.minX === c.minX && b.maxX === c.maxX && b.minZ === c.minZ && b.maxZ === c.maxZ;
    const touches = (b: Rect, c: Rect) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ;
    const furniture = office.filter((b) => !same(b, monitor) && !shell.some((w) => same(w, b)));
    expect(furniture.filter((b) => touches(b, monitor))).toEqual([]);
    // the player can stand right in front of it to read it and press E
    const front = { x: a.x, z: monitor.maxZ + 1 };
    expect(collide(front.x, front.z, office)).toEqual(front);
  });

  it("puts the lobby's coffee corner against the south wall, clear of everything else in the lobby", () => {
    const corner = coffeeCorner();
    const shell = shellColliders();
    const lobby = lobbyColliders();
    expect(lobby).toContainEqual(corner);
    expect(corner.maxZ).toBe(HALF_D);
    const same = (b: Rect, c: Rect) => b.minX === c.minX && b.maxX === c.maxX && b.minZ === c.minZ && b.maxZ === c.maxZ;
    const touches = (b: Rect, c: Rect) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ;
    const furniture = lobby.filter((b) => !same(b, corner) && !shell.some((w) => same(w, b)));
    expect(furniture.filter((b) => touches(b, corner))).toEqual([]);
    // east of the elevator doorway (and its call button) and the directory on the south wall, west of the waiting chairs
    expect(corner.minX).toBeGreaterThan(ELEVATOR.doorHalf + 4.5);
    expect(corner.maxX).toBeLessThan(WAITING.x - 1);
    // well away from the CEO's and manager's doors and the reception desk
    expect(corner.minZ - CEO_ROOM.maxZ).toBeGreaterThan(10);
    expect(corner.minX).toBeGreaterThan(RECEPTION.x + RECEPTION.w / 2 + 2);
    // the player can walk up to the counter to use the machine, and the e2e's console spot is untouched
    const front = { x: COFFEE_CORNER.x, z: corner.minZ - PLAYER_RADIUS - 0.4 };
    expect(collide(front.x, front.z, lobby)).toEqual(front);
    const consoleSpot = { x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8 };
    expect(collide(consoleSpot.x, consoleSpot.z, lobby)).toEqual(consoleSpot);
    // and the counter blocks walking
    expect(collide(COFFEE_CORNER.x, corner.minZ + 0.1, lobby).z).toBeLessThanOrEqual(corner.minZ - PLAYER_RADIUS + 1e-9);
  });

  it('stands the gong against the north wall, clear of the whiteboard, the app monitor and the desks, with a free spot in front', () => {
    const g = gongRect();
    const office = officeColliders();
    expect(office).toContainEqual(g);
    expect(g.minZ).toBe(-HALF_D); // solid back to the wall: nothing gets stuck behind it
    expect(g.maxX).toBeLessThan(-BOARD.w / 2 - 0.5);
    expect(g.minX).toBeGreaterThan(APP_SCREEN.x + APP_SCREEN.w / 2 + 1);
    expect(GONG.h).toBeLessThan(2.75 - 0.36); // under the wall clock (y 2.75, radius 0.36)
    expect(GONG.y - GONG.r).toBeGreaterThan(0.3);
    expect(GONG.y + GONG.r).toBeLessThan(GONG.h - 0.2);
    const shell = shellColliders();
    const same = (b: Rect, c: Rect) => b.minX === c.minX && b.maxX === c.maxX && b.minZ === c.minZ && b.maxZ === c.maxZ;
    const touches = (b: Rect, c: Rect) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ;
    const furniture = office.filter((b) => !same(b, g) && !shell.some((w) => same(w, b)));
    expect(furniture.filter((b) => touches(b, g))).toEqual([]);
    // the back row of desks (and their chairs) leaves a wide aisle in front of it
    const backRow = furniture.filter((b) => b.maxZ < 0 && b.minZ > -8);
    expect(Math.min(...backRow.map((b) => b.minZ)) - g.maxZ).toBeGreaterThan(3);
    expect(collide(GONG_SPOT.x, GONG_SPOT.z, office)).toEqual(GONG_SPOT);
    expect(GONG_SPOT.z - g.maxZ).toBeLessThan(1.2); // close enough to reach the disc
  });
});

describe('surfaceAt', () => {
  const eps = 1e-6;

  it('is wood on the open office floor and lobby tiles in the open lobby', () => {
    expect(surfaceAt('office', SPAWN.x, SPAWN.z)).toBe('wood');
    expect(surfaceAt('office', -14, -10)).toBe('wood');
    expect(surfaceAt('lobby', SPAWN.x, SPAWN.z)).toBe('lobby');
    expect(surfaceAt('lobby', -3, 9)).toBe('lobby');
  });

  it('is rug on every desk row rug, up to and including its edges', () => {
    for (const r of DESK_RUGS) {
      const cz = (r.minZ + r.maxZ) / 2;
      expect(surfaceAt('office', 0, cz)).toBe('rug');
      expect(surfaceAt('office', r.minX, cz)).toBe('rug');
      expect(surfaceAt('office', r.maxX, cz)).toBe('rug');
      expect(surfaceAt('office', 0, r.minZ)).toBe('rug');
      expect(surfaceAt('office', 0, r.maxZ)).toBe('rug');
      expect(surfaceAt('office', r.minX - eps, cz)).toBe('wood');
      expect(surfaceAt('office', 0, r.minZ - eps)).toBe('wood');
      expect(surfaceAt('office', 0, r.maxZ + eps)).toBe('wood');
    }
  });

  it('is rug in the QA lab, which overlaps the east end of the desk rows', () => {
    const cx = (QA_RUG.minX + QA_RUG.maxX) / 2;
    expect(surfaceAt('office', cx, -2)).toBe('rug');
    expect(surfaceAt('office', QA_RUG.maxX, -2)).toBe('rug');
    expect(surfaceAt('office', QA_RUG.maxX + eps, -2)).toBe('wood');
    expect(surfaceAt('office', cx, QA_RUG.minZ - eps)).toBe('wood');
    expect(surfaceAt('office', QA_RUG.minX - eps, 1)).toBe('wood'); // between two desk rows
    expect(surfaceAt('office', DESK_RUGS[0].maxX + eps, DESK_RUGS[0].maxZ)).toBe('rug'); // still on the QA rug
  });

  it('is rug on the lobby rug and in the carpeted offices, but office rugs are not in the lobby', () => {
    expect(surfaceAt('lobby', 3, 3)).toBe('rug');
    expect(surfaceAt('lobby', LOBBY_RUG.maxX, LOBBY_RUG.maxZ)).toBe('rug');
    expect(surfaceAt('lobby', LOBBY_RUG.maxX + eps, 3)).toBe('lobby');
    expect(surfaceAt('lobby', MANAGER_DESK.x, MANAGER_DESK.z + 2)).toBe('rug');
    expect(surfaceAt('lobby', CEO_DESK.x, CEO_DESK.z + 2)).toBe('rug');
    expect(surfaceAt('lobby', 0, DESK_RUGS[0].minZ + 0.1)).toBe('lobby');
    expect(surfaceAt('office', 3, 3)).toBe('rug'); // a desk row rug, not the lobby's
    expect(surfaceAt('office', -4, 6)).toBe('wood'); // between the front desk row and the elevator
  });

  it('is the cabin once past the elevator doorway, on every floor', () => {
    const inCabin = HALF_D + ELEVATOR.depth / 2;
    for (const floor of ['office', 'lobby'] as const) {
      expect(surfaceAt(floor, 0, inCabin)).toBe('cabin');
      expect(surfaceAt(floor, ELEVATOR.cabinHalf, inCabin)).toBe('cabin');
      expect(surfaceAt(floor, 0, HALF_D + eps)).toBe('cabin');
      expect(surfaceAt(floor, 0, HALF_D)).toBe(floor === 'lobby' ? 'lobby' : 'wood');
    }
  });
});
