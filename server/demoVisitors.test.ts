import { describe, expect, it } from 'vitest';
import { collide, lobbyColliders, officeColliders, type Rect } from '../client/src/world/layout.ts';
import { LIFT, ROUTES, fakeProfile, newWalker, poseOf, stepWalker } from './demoVisitors.ts';

/** Every 10 cm along a closed route, someone standing there isn't pushed out of anything. */
function blocked(route: { x: number; z: number }[], rects: Rect[]) {
  const bad: string[] = [];
  route.forEach((a, i) => {
    const b = route[(i + 1) % route.length];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      const p = collide(x, z, rects);
      if (Math.hypot(p.x - x, p.z - z) > 1e-6) bad.push(`${x.toFixed(1)},${z.toFixed(1)}`);
    }
  });
  return bad;
}

describe('demo visitors', () => {
  it('walk only through open floor, in the office and the lobby', () => {
    expect(blocked(ROUTES.office, officeColliders())).toEqual([]);
    expect(blocked(ROUTES.lobby, lobbyColliders())).toEqual([]);
    expect(blocked([ROUTES.office[0], LIFT.door], officeColliders())).toEqual([]);
  });

  it('stay out of sight until a real visitor is somewhere, then turn up on their floor', () => {
    const w = newWalker(0);
    expect(stepWalker(w, 0.1, null, () => 0.5).moved).toBe(false);
    expect(w.floor).toBeNull();
    expect(stepWalker(w, 0.1, 2, () => 0.5).moved).toBe(true);
    expect(w.floor).toBe(2);
    expect(poseOf(w).f).toBe(2);
  });

  it('take the elevator to follow you to another floor, and walk out of it there', () => {
    const w = newWalker(1);
    stepWalker(w, 0.1, 1, () => 0.9);
    const floors = new Set<number>();
    let arrivedAt: { x: number; z: number } | null = null;
    for (let i = 0; i < 600 && !arrivedAt; i++) {
      stepWalker(w, 0.1, 3, () => 0.9);
      floors.add(w.floor!);
      if (w.floor === 3) arrivedAt = { x: w.x, z: w.z };
    }
    expect(arrivedAt).toEqual({ x: LIFT.cabin.x, z: LIFT.cabin.z });
    expect([...floors]).toEqual([1, 3]);
    for (let i = 0; i < 40; i++) stepWalker(w, 0.1, 3, () => 0.9);
    expect(w.z).toBeLessThan(LIFT.cabin.z); // stepped out
  });

  it('emote and ping now and then, and stop to emote', () => {
    const w = newWalker(0);
    stepWalker(w, 0.1, 1, () => 0.2);
    const emotes: string[] = [];
    const pings: string[] = [];
    for (let i = 0; i < 600; i++) {
      const s = stepWalker(w, 0.1, 1, () => 0.2);
      if (s.emote) emotes.push(s.emote);
      if (s.ping) pings.push(s.ping.label);
    }
    expect(emotes.length).toBeGreaterThan(3);
    expect(pings).toContain('the whiteboard');
  });

  it('have names that say they are fake, and one carries a mug', () => {
    expect(fakeProfile(0).name).toBe('Robin (demo)');
    expect(newWalker(0).held).toMatchObject({ k: 'mug' });
  });
});
