import { describe, expect, it } from 'vitest';
import { aimAt, BOUNDS, flyStep, FOV_MAX, FOV_MIN, look, newFreeCam, orbitFrom, orbitStep, ROLL_MAX, zoom, type FlyInput } from './flight';

const still: FlyInput = { forward: 0, right: 0, up: 0, roll: 0, fast: false };
const run = (input: Partial<FlyInput>, seconds: number, cam = newFreeCam(0, 1.65, 0, 0, 0, 72)) => {
  for (let t = 0; t < seconds; t += 1 / 60) flyStep(cam, { ...still, ...input }, 1 / 60);
  return cam;
};

describe('free camera', () => {
  it('flies where it looks: forward is -z at yaw 0, and up when pitched up', () => {
    const c = run({ forward: 1 }, 2);
    expect(c.z).toBeLessThan(-3);
    expect(Math.abs(c.x)).toBeLessThan(1e-9);
    const up = run({ forward: 1 }, 2, newFreeCam(0, 1.65, 0, 0, 0.6, 72));
    expect(up.y).toBeGreaterThan(3);
  });

  it('strafes level and rises straight up', () => {
    const c = run({ right: 1, up: 1 }, 1, newFreeCam(0, 1.65, 0, Math.PI / 2, 0.8, 72));
    // facing -x (yaw 90°), right is -z
    expect(c.z).toBeLessThan(-1);
    expect(Math.abs(c.x)).toBeLessThan(1e-9);
    expect(c.y).toBeGreaterThan(2.5);
  });

  it('eases in and out instead of jumping, and Shift is faster', () => {
    const c = newFreeCam(0, 1.65, 0, 0, 0, 72);
    flyStep(c, { ...still, forward: 1 }, 1 / 60);
    expect(c.z).toBeGreaterThan(-0.01);
    const slow = run({ forward: 1 }, 1);
    const fast = run({ forward: 1, fast: true }, 1);
    expect(fast.z).toBeLessThan(slow.z * 2.5);
    const glide = run({}, 0.1, run({ forward: 1 }, 1));
    expect(glide.vz).toBeLessThan(0); // still drifting a moment after the key comes up
    expect(run({}, 2, glide).vz).toBeGreaterThan(-0.01);
  });

  it('stays inside the bounds, rolls within limits and keeps pitch off the poles', () => {
    const c = run({ forward: 1, fast: true }, 120);
    expect(c.z).toBeGreaterThanOrEqual(-BOUNDS.z);
    expect(run({ roll: 1 }, 5).roll).toBeCloseTo(ROLL_MAX);
    const l = newFreeCam(0, 0, 0, 0, 0, 72);
    look(l, 0, -10);
    expect(l.pitch).toBeLessThan(Math.PI / 2);
  });

  it('zooms within 15–110°', () => {
    expect(zoom(72, -100000)).toBe(FOV_MIN);
    expect(zoom(72, 100000)).toBe(FOV_MAX);
    expect(zoom(72, -100)).toBeLessThan(72);
  });
});

describe('cinematic orbit', () => {
  it('starts where the camera is and keeps looking at the target', () => {
    const c = newFreeCam(0, 2.5, 4, 0, 0, 50);
    const o = orbitFrom(c, 0, 1.3, 0);
    expect(o.radius).toBeCloseTo(4);
    orbitStep(o, c, 0);
    expect(c.x).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(4);
    for (let i = 0; i < 600; i++) orbitStep(o, c, 1 / 60);
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(4);
    expect(c.y).toBeCloseTo(2.5);
    // aimed: the view direction points from the camera to the target
    const dir = [-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)];
    const to = [0 - c.x, 1.3 - c.y, 0 - c.z];
    const len = Math.hypot(to[0], to[1], to[2]);
    expect(dir[0]).toBeCloseTo(to[0] / len);
    expect(dir[1]).toBeCloseTo(to[1] / len);
    expect(dir[2]).toBeCloseTo(to[2] / len);
  });

  it('turns slowly: a lap takes most of a minute', () => {
    const c = newFreeCam(3, 2, 0, 0, 0, 50);
    const o = orbitFrom(c, 0, 1, 0);
    const a0 = o.angle;
    orbitStep(o, c, 10);
    expect(o.angle - a0).toBeLessThan(Math.PI / 2);
  });

  it('aimAt looks straight at a point', () => {
    const c = newFreeCam(0, 0, 0, 0, 0, 50);
    aimAt(c, 1, 0, 0);
    expect(c.yaw).toBeCloseTo(-Math.PI / 2);
    expect(c.pitch).toBeCloseTo(0);
  });
});
