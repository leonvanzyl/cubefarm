import { describe, expect, it } from 'vitest';
import { BLASTER, DART_CAP, ammoLabel, fire, isBlasterId, isReloading, reload, reloadProgress, settle, sticks, toEvict, type Mag } from './darts';

const full: Mag = { ammo: BLASTER.mag, reloadAt: null };

describe('magazine', () => {
  it('fires one dart per shot and counts down', () => {
    const m = fire(full, -Infinity, 1000);
    expect(m).toEqual({ ammo: BLASTER.mag - 1, reloadAt: null });
    expect(ammoLabel(m!, 1000)).toBe(`Darts ${BLASTER.mag - 1}/${BLASTER.mag}`);
  });

  it('holds the fire rate to one shot per gap', () => {
    expect(fire(full, 1000, 1000 + BLASTER.gapMs - 1)).toBeNull();
    expect(fire(full, 1000, 1000 + BLASTER.gapMs)).not.toBeNull();
  });

  it('empties after a magazine and then refuses to fire', () => {
    let m: Mag = full;
    let t = 0;
    let shots = 0;
    for (let i = 0; i < 20; i++) {
      t += BLASTER.gapMs;
      const next = fire(m, t - BLASTER.gapMs, t);
      if (!next) break;
      m = next;
      shots++;
    }
    expect(shots).toBe(BLASTER.mag);
    expect(m.ammo).toBe(0);
    expect(fire(m, -Infinity, t + 10_000)).toBeNull();
  });

  it('reloads over reloadMs, blocking fire meanwhile', () => {
    const empty: Mag = { ammo: 0, reloadAt: null };
    const r = reload(empty, 5000)!;
    expect(r.reloadAt).toBe(5000);
    expect(isReloading(r, 5000 + BLASTER.reloadMs / 2)).toBe(true);
    expect(reloadProgress(r, 5000 + BLASTER.reloadMs / 2)).toBeCloseTo(0.5);
    expect(fire(r, -Infinity, 5000 + BLASTER.reloadMs / 2)).toBeNull();
    expect(reload(r, 5100)).toBeNull(); // already reloading
    expect(settle(r, 5000 + BLASTER.reloadMs)).toEqual(full);
    expect(reloadProgress(r, 5000 + BLASTER.reloadMs)).toBeNull();
    expect(fire(r, -Infinity, 5000 + BLASTER.reloadMs)).toEqual({ ammo: BLASTER.mag - 1, reloadAt: null });
  });

  it("doesn't reload a full magazine", () => {
    expect(reload(full, 0)).toBeNull();
    expect(reload({ ammo: 11, reloadAt: null }, 0)).toEqual({ ammo: 11, reloadAt: 0 });
  });

  it('knows its blasters', () => {
    expect(isBlasterId('blaster-orange')).toBe(true);
    expect(isBlasterId('beach-ball')).toBe(false);
  });
});

describe('sticks', () => {
  const wall = { x: 0, y: 0, z: 1 }; // facing +z; darts come in along -z

  it('sticks on a square-on hit', () => {
    expect(sticks({ x: 0, y: 0, z: -18 }, wall)).toBe(true);
    expect(sticks({ x: 3, y: -2, z: -18 }, wall)).toBe(true); // a little off square
  });

  it('bounces off a glancing hit', () => {
    expect(sticks({ x: 12, y: 0, z: -8 }, wall)).toBe(false);
    expect(sticks({ x: 0, y: -18, z: -1 }, wall)).toBe(false);
  });

  it('bounces when the dart is too slow', () => {
    expect(sticks({ x: 0, y: 0, z: -2 }, wall)).toBe(false);
  });

  it('never sticks moving away from the surface', () => {
    expect(sticks({ x: 0, y: 0, z: 18 }, wall)).toBe(false);
  });

  it('sticks to a desk top from above', () => {
    expect(sticks({ x: 0.5, y: -15, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(true);
  });
});

describe('toEvict', () => {
  const darts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, born: 100 + ((i * 7) % n) }));

  it('keeps everything under the cap', () => {
    expect(toEvict(darts(DART_CAP - 1))).toEqual([]);
  });

  it('removes the oldest when the next dart would go over', () => {
    const list = darts(DART_CAP);
    const out = toEvict(list);
    expect(out).toHaveLength(1);
    expect(out[0].born).toBe(Math.min(...list.map((d) => d.born)));
  });

  it('catches up when far over the cap', () => {
    const list = darts(DART_CAP + 5);
    const out = toEvict(list, DART_CAP, 1);
    expect(out).toHaveLength(6);
    const kept = list.filter((d) => !out.includes(d));
    expect(Math.min(...kept.map((d) => d.born))).toBeGreaterThan(Math.max(...out.map((d) => d.born)));
  });
});
