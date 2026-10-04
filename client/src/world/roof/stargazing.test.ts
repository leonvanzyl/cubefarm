import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { starField } from '../sky/skyLayout.ts';
import { sunDirection } from '../sky/time.ts';
import { constellations, moonDirection, NAMES, SPAN, STARS, starAt, starAxis, skyTurn } from './stargazing.ts';

const field = starField(STARS);
const dir = (i: number): [number, number, number] => [field.positions[i * 3], field.positions[i * 3 + 1], field.positions[i * 3 + 2]];
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

describe('the turning sky', () => {
  it('turns about the same axis, by the same angle, as Sky.tsx turns its stars', () => {
    const sun = new THREE.Vector3(...sunDirection(0.5));
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), sun).normalize();
    expect(starAxis()[0]).toBeCloseTo(axis.x);
    expect(starAxis()[1]).toBeCloseTo(axis.y);
    expect(starAxis()[2]).toBeCloseTo(axis.z);
    for (const t of [0, 0.1, 0.5, 0.85]) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, skyTurn(t));
      for (const i of [0, 17, 401]) {
        const want = new THREE.Vector3(...dir(i)).applyQuaternion(q);
        const got = starAt(dir(i), t);
        expect(got[0]).toBeCloseTo(want.x, 5);
        expect(got[1]).toBeCloseTo(want.y, 5);
        expect(got[2]).toBeCloseTo(want.z, 5);
      }
    }
  });

  it('puts the moon opposite the sun', () => {
    for (const t of [0, 0.3, 0.9]) {
      const s = sunDirection(t);
      const m = moonDirection(t);
      expect(m[0] + s[0]).toBeCloseTo(0);
      expect(m[1] + s[1]).toBeCloseTo(0);
      expect(m[2] + s[2]).toBeCloseTo(0);
    }
    expect(moonDirection(0)[1]).toBeGreaterThan(0.5); // high in the sky at midnight
  });
});

describe('constellations', () => {
  const found = constellations();

  it('finds several, named, the same every night', () => {
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found.length).toBeLessThanOrEqual(6);
    expect(new Set(found.map((c) => c.name)).size).toBe(found.length);
    for (const c of found) expect(NAMES).toContain(c.name);
    expect(constellations()).toEqual(found);
  });

  it("are four to six of the sky's own stars, close enough to fit the telescope, none shared", () => {
    const seen = new Set<number>();
    for (const c of found) {
      expect(c.stars.length).toBeGreaterThanOrEqual(4);
      expect(c.stars.length).toBeLessThanOrEqual(6);
      for (const i of c.stars) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(STARS);
        expect(seen.has(i)).toBe(false);
        seen.add(i);
      }
      const brightest = Math.max(...c.stars.map((i) => field.sizes[i]));
      expect(field.sizes[c.stars[0]]).toBe(brightest);
      for (const i of c.stars) expect(angle(dir(i), dir(c.stars[0]))).toBeLessThan(SPAN * 2);
    }
  });

  it('are joined into one figure each, by a line fewer than they have stars', () => {
    for (const c of found) {
      expect(c.lines).toHaveLength(c.stars.length - 1);
      const reached = new Set([c.stars[0]]);
      for (let k = 0; k < c.lines.length; k++)
        for (const [a, b] of c.lines) {
          if (reached.has(a)) reached.add(b);
          if (reached.has(b)) reached.add(a);
        }
      expect([...reached].sort()).toEqual([...c.stars].sort());
    }
  });

  it('are up in the sky in the middle of the night', () => {
    for (const c of found) expect(starAt(c.centre, 0)[1]).toBeGreaterThan(0.15);
  });
});
