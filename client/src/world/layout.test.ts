import { describe, expect, it } from 'vitest';
import { APP_SCREEN, BOARD, collide, HALF_D, lobbyColliders, officeColliders, PLAYER_RADIUS, rect, shellColliders, SPAWN, type Rect } from './layout.ts';

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
});
