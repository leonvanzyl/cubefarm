import { describe, expect, it } from 'vitest';
import { HALF_D, HALF_W, WALL_H } from '../layout';
import {
  BUILDING,
  DOUBLE_TAP_MS,
  FACE_HALF_W,
  FACE_Z,
  OVERVIEW,
  aimAt,
  allInView,
  blendPose,
  buildingOrbit,
  clampFollowCamera,
  dampOrbit,
  ease,
  fitDistance,
  nearSides,
  nearestQuad,
  newOrbit,
  newPose,
  orbitPose,
  overviewOrbit,
  panOrbit,
  quadYaw,
  tabTarget,
  towerSpan,
} from './cameraMath';

const forward = (p: { yaw: number; pitch: number }) => [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];

describe('orbitPose', () => {
  it('puts the camera dist from the focus, looking straight at it', () => {
    const o = { ...newOrbit(), fx: 2, fy: 1, fz: -3, yaw: 0.7, el: 0.9, dist: 20, fov: 40 };
    const p = orbitPose(o, newPose());
    const d = [o.fx - p.x, o.fy - p.y, o.fz - p.z];
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(20);
    const f = forward(p);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(d[i] / 20);
  });

  it('bearing 0 is due south of the focus, looking north', () => {
    const p = orbitPose({ ...newOrbit(), yaw: 0, el: 0, dist: 5 }, newPose());
    expect(p.z).toBeCloseTo(5);
    expect(p.x).toBeCloseTo(0);
    expect(p.yaw).toBe(0);
  });
});

describe('aimAt', () => {
  it('turns a pose to face a point', () => {
    const p = aimAt({ ...newPose(), x: 3, y: 2, z: 4 }, 0, 1, 0);
    const f = forward(p);
    const d = [-3, -1, -4];
    const n = Math.hypot(...d);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(d[i] / n);
  });
});

describe('the overview', () => {
  it('fits the whole floor, walls and all, and no closer', () => {
    for (const aspect of [16 / 9, 4 / 3, 0.6]) {
      const o = overviewOrbit(0, aspect, newOrbit());
      const box = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, WALL_H].flatMap((y) => [sx * HALF_W, y, sz * HALF_D])));
      expect(allInView(orbitPose(o, newPose()), aspect, box, 0)).toBe(true);
      expect(allInView(orbitPose({ ...o, dist: o.dist * 0.9 }, newPose()), aspect, box, OVERVIEW.margin)).toBe(false);
    }
  });

  it('narrow windows pull back further', () => {
    expect(fitDistance(overviewOrbit(0, 0.6, newOrbit()), 0.6)).toBeGreaterThan(fitDistance(overviewOrbit(0, 16 / 9, newOrbit()), 16 / 9));
  });

  it('picks the corner view nearest the way you face', () => {
    expect(quadYaw(nearestQuad(0))).toBeCloseTo(Math.PI / 4); // facing north: from the south-east
    expect(quadYaw(nearestQuad(Math.PI))).toBeCloseTo((5 * Math.PI) / 4); // facing south: from the north-west
    expect(quadYaw(nearestQuad(Math.PI / 2))).toBeCloseTo((3 * Math.PI) / 4); // facing west: from the north-east
  });

  it('cuts away the walls on the camera’s side', () => {
    expect(nearSides(quadYaw(0), { x: 0, z: 0 })).toEqual({ x: 1, z: 1 }); // south-east: east and south walls
    expect(nearSides(quadYaw(2), { x: 0, z: 0 })).toEqual({ x: -1, z: -1 });
    expect(nearSides(0, { x: 0, z: 0 })).toEqual({ x: 0, z: 1 });
  });

  it('pans the focus as the camera sees the ground, and keeps it over the floor', () => {
    const o = { ...newOrbit(), yaw: 0 };
    panOrbit(o, 2, 3); // camera south looking north: right is east, forward is north
    expect(o.fx).toBeCloseTo(2);
    expect(o.fz).toBeCloseTo(-3);
    panOrbit(o, 100, -100);
    expect(o.fx).toBe(HALF_W);
    expect(o.fz).toBe(HALF_D);
  });
});

describe('the building view', () => {
  it('shows the whole south face from in front, wider for a taller tower', () => {
    const pose = newPose();
    const low = buildingOrbit(1, 2, 16 / 9, newOrbit());
    const tall = buildingOrbit(1, 6, 16 / 9, newOrbit());
    expect(tall.fov).toBeGreaterThan(low.fov);
    for (const [o, top] of [[low, 2], [tall, 6]] as const) {
      const s = towerSpan(1, top);
      const face = [-FACE_HALF_W, s.bottom, FACE_Z, FACE_HALF_W, s.bottom, FACE_Z, -FACE_HALF_W, s.top, FACE_Z, FACE_HALF_W, s.top, FACE_Z];
      expect(allInView(orbitPose(o, pose), 16 / 9, face, 0)).toBe(true);
      expect(orbitPose(o, pose).z).toBeLessThan(38); // short of the buildings across the street
    }
  });

  it('caps the field of view for a skyscraper and looks at your floor', () => {
    const o = buildingOrbit(3, 40, 16 / 9, newOrbit());
    expect(o.fov).toBe(BUILDING.maxFov);
    expect(o.fy).toBeCloseTo(WALL_H / 2);
  });

  it('measures the tower from the ground to the roof', () => {
    expect(towerSpan(0, 2).bottom).toBeCloseTo(0);
    expect(towerSpan(0, 2).top).toBeCloseTo(3 * 4.2);
    expect(towerSpan(2, 2).bottom).toBeCloseTo(-8.4);
  });
});

describe('poses in motion', () => {
  it('blends the short way round and ends exactly on the goal', () => {
    const a = { ...newPose(), yaw: 3 };
    const b = { ...newPose(), x: 4, yaw: -3, fov: 40, near: 1 };
    const mid = blendPose(a, b, 0.5, newPose());
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3); // through ±PI, not through 0
    expect(blendPose(a, b, 1, newPose())).toMatchObject({ x: 4, fov: 40, near: 1 });
    expect(blendPose(a, b, 0.5, newPose()).near).toBeLessThan(0.2); // the near plane moves out late
  });

  it('eases from 0 to 1', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(2)).toBe(1);
  });

  it('damps an orbit toward its goal', () => {
    const cur = { ...newOrbit(), yaw: 0, dist: 10 };
    const goal = { ...newOrbit(), yaw: Math.PI / 2, dist: 20 };
    dampOrbit(cur, goal, 0.1, 6);
    expect(cur.dist).toBeGreaterThan(10);
    expect(cur.dist).toBeLessThan(20);
    for (let i = 0; i < 200; i++) dampOrbit(cur, goal, 0.05, 6);
    expect(cur.yaw).toBeCloseTo(Math.PI / 2);
  });
});

describe('the follow cam', () => {
  it('stays inside the room', () => {
    const p = clampFollowCamera({ ...newPose(), x: 20, y: 9, z: -15 }, 10);
    expect(p).toMatchObject({ x: HALF_W - 0.3, z: -HALF_D + 0.3 });
    expect(p.y).toBeLessThan(WALL_H);
  });

  it('stays on the balcony with someone who is out there', () => {
    const p = clampFollowCamera({ ...newPose(), x: 10, y: 2, z: 0 }, 18);
    expect(p.x).toBeGreaterThan(HALF_W);
  });
});

describe('tabTarget', () => {
  it('toggles the overview, and a quick second tap opens the building', () => {
    expect(tabTarget('first', 1000, -Infinity, null)).toBe('overview');
    expect(tabTarget('overview', 3000, 1000, 'overview')).toBe('first');
    expect(tabTarget('overview', 1000 + DOUBLE_TAP_MS - 1, 1000, 'overview')).toBe('building');
    expect(tabTarget('first', 1100, 1000, 'first')).toBe('building'); // from the overview, two quick taps too
    expect(tabTarget('building', 1100, 1000, 'building')).toBe('first'); // not a third
    expect(tabTarget('follow', 5000, 0, null)).toBe('overview');
  });
});
