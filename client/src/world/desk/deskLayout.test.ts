import { describe, expect, it } from 'vitest';
import { deskItems, deskToy, newCareer, PLAQUES } from '../../../../shared/careers';
import { deskLayout, MONITOR, moreSpot, PLAQUE, plaqueSpot, photoSpot, plantSpot, starSpot, toySpot } from './deskLayout';

const NOW = Date.UTC(2026, 9, 4, 12);
const DAY = 24 * 3_600_000;

describe('a desk with a story', () => {
  it('lines the plaques, the +N and the star up along the top of the monitor without overlapping', () => {
    const xs = [...Array.from({ length: PLAQUES }, (_, i) => plaqueSpot(i).x), moreSpot().x];
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(PLAQUE.w);
    expect(starSpot().x - 0.04).toBeGreaterThan(moreSpot().x + PLAQUE.w / 2);
    for (const x of [...xs, starSpot().x]) expect(Math.abs(x) + 0.04).toBeLessThan(MONITOR.w / 2);
    expect(plaqueSpot(0).y - PLAQUE.h / 2).toBeGreaterThan(MONITOR.y + MONITOR.h / 2);
  });

  it('keeps the personal items clear of the keyboard, mouse, mug, plant, lamp and lunch', () => {
    const busy = [
      { x: 0, z: 0.27, r: 0.3 }, // keyboard
      { x: 0.46, z: 0.29, r: 0.13 }, // mouse
      { x: 0.76, z: 0.02, r: 0.06 }, // mug
      { x: plantSpot().x, z: plantSpot().z, r: 0.08 }, // the plant's pot
      { x: 0, z: -0.34, r: 0.18 }, // monitor stand
      { x: 0.72, z: -0.3, r: 0.1 }, // the evening desk lamp (Rituals.tsx)
      { x: -0.56, z: 0.2, r: 0.12 }, // the lunch plate
    ];
    for (const p of [photoSpot(), toySpot()]) for (const b of busy) expect(Math.hypot(p.x - b.x, p.z - b.z), JSON.stringify({ p, b })).toBeGreaterThan(b.r + 0.05);
  });

  it('shows what the career earned, and only that', () => {
    const fresh = deskLayout(deskItems(newCareer(NOW), 'ada', NOW));
    expect(fresh).toMatchObject({ shelf: false, plaques: [], more: null, star: null, photo: null, toy: null });
    const recent = [12, 9, 4].map((n) => ({ n, title: '', at: NOW }));
    const career = { ...newCareer(NOW - 5 * DAY), merged: 3, firstPass: 10, recent };
    const busy = deskLayout(deskItems(career, 'ada', NOW));
    expect(busy.plaques.map((p) => p.n)).toEqual([12, 9, 4]);
    expect(busy).toMatchObject({ shelf: true, more: null, toy: { kind: deskToy('ada', career) } });
    expect(busy.star).not.toBeNull();
    expect(busy.photo).not.toBeNull();
    expect(busy.plant.grow).toBeGreaterThan(fresh.plant.grow);
  });
});
