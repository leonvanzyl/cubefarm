import { describe, expect, it } from 'vitest';
import { DESK_COLS, DESK_ROWS, HALF_D, HALF_W, deskPosition } from '../layout';
import { findPath, walkways, type FloorKind } from '../walkways';
import { DOG_R, byDoors, dogPlaces, lapSpot, randomSpot, standNear } from './dogPlaces';
import { clear } from './roombaBrain';

const FLOORS: FloorKind[] = ['office', 'lobby'];

describe("the dog's places", () => {
  it.each(FLOORS)('every %s sniff and nap spot is clear, away from the doors and reachable from the elevator', (floor) => {
    const p = dogPlaces(floor);
    const w = walkways(floor);
    expect(p.sniffs.length).toBeGreaterThanOrEqual(8);
    expect(p.naps.some((n) => n.id === 'couch')).toBe(true);
    expect(p.naps.filter((n) => n.y === 0).length).toBeGreaterThanOrEqual(3);
    expect(new Set([...p.sniffs, ...p.naps].map((s) => s.id)).size).toBe(p.sniffs.length + p.naps.length);
    for (const s of [...p.sniffs, ...p.naps.map((n) => n.from ?? n)]) {
      expect(clear(p.rects, s.x, s.z, DOG_R), `${floor} ${'id' in s ? s.id : 'approach'}`).toBe(true);
      expect(byDoors(s.x, s.z)).toBe(false);
      expect(findPath(w, p.door, s)).not.toBeNull();
    }
  });

  it.each(FLOORS)('the %s couch nap is up on the seat, a short hop from its clear approach', (floor) => {
    const n = dogPlaces(floor).naps.find((x) => x.id === 'couch')!;
    expect(n.y).toBeGreaterThan(0.3);
    expect(Math.hypot(n.x - n.from!.x, n.z - n.from!.z)).toBeLessThan(1.3);
    // the seat itself is furniture: only a hop gets it there
    expect(clear(dogPlaces(floor).rects, n.x, n.z, DOG_R)).toBe(false);
  });

  it('the elevator door and cabin are in front of and behind the doorway', () => {
    const p = dogPlaces('office');
    expect(p.door.z).toBeLessThan(HALF_D);
    expect(p.cabin.z).toBeGreaterThan(HALF_D);
    expect(byDoors(p.door.x, p.door.z)).toBe(true);
    expect(byDoors(0, 0)).toBe(false);
  });

  it('random spots are open floor away from the doors', () => {
    const p = dogPlaces('office');
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const s = randomSpot(p, rand);
      if (!s) continue;
      expect(clear(p.rects, s.x, s.z, DOG_R)).toBe(true);
      expect(byDoors(s.x, s.z)).toBe(false);
      expect(Math.abs(s.x)).toBeLessThan(HALF_W);
    }
  });

  it('standNear finds a clear spot on the asked side when it can, and writes into out', () => {
    const p = dogPlaces('office');
    const out = { x: 0, z: 0 };
    const s = standNear(p.rects, 0, 0, 1.5, { x: 5, z: 0 }, out);
    expect(s).toBe(out);
    expect(out.x).toBeCloseTo(1.5);
    expect(out.z).toBeCloseTo(0);
    // up against a desk: it goes round to a free side
    const { x, z } = deskPosition(0);
    const t = standNear(p.rects, x, z + 1.5, 1.2, { x, z })!;
    expect(clear(p.rects, t.x, t.z, DOG_R)).toBe(true);
  });

  it("a visit sits on the person's left, beside the chair, facing them", () => {
    // at a desk in the grid they face -Z (seat heading 0): their left is -X
    const s = lapSpot(3.5, 3.8, 0);
    expect(s.x).toBeCloseTo(3.5 - 0.62);
    expect(s.z).toBeLessThan(3.8);
    expect(s.heading).toBeCloseTo(0); // facing +X, towards them
    // at the east wall they face +X (seat heading -π/2): their left is -Z
    const q = lapSpot(13.2, -2, -Math.PI / 2);
    expect(q.z).toBeCloseTo(-2 - 0.62);
    expect(Math.abs(q.heading - Math.PI / 2)).toBeLessThan(1e-9);
    // beside every desk, the spot can be reached from the elevator
    const w = walkways('office');
    for (const zc of DESK_ROWS) for (const xc of DESK_COLS) expect(findPath(w, dogPlaces('office').door, lapSpot(xc, zc + 0.8, 0))).not.toBeNull();
  });
});
