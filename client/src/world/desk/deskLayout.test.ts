import { describe, expect, it } from 'vitest';
import { deskItems, newCareer, PLAQUES } from '../../../../shared/careers';
import { deskLayout, MONITOR, moreSpot, PLAQUE, plaqueSpot, photoSpot, plantSpot, STICKER, starSpot, stickerSpot, toySpot } from './deskLayout';

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

  it('keeps the stickers on the bezel and the personal items clear of the keyboard, mouse, mug, lamp, lunch and test tubes', () => {
    for (let i = 0; i < 3; i++) {
      const s = stickerSpot(i);
      expect(Math.abs(s.x) + STICKER / 2).toBeLessThan(MONITOR.w / 2);
      expect(Math.abs(s.y) + STICKER / 2).toBeLessThan(MONITOR.h / 2 + 0.01);
    }
    const busy = [
      { x: 0, z: 0.27, r: 0.3 }, // keyboard
      { x: 0.46, z: 0.29, r: 0.13 }, // mouse
      { x: 0.76, z: 0.02, r: 0.06 }, // mug
      { x: -0.72, z: -0.2, r: 0.16 }, // QA test tubes
      { x: 0, z: -0.34, r: 0.18 }, // monitor stand
      { x: 0.72, z: -0.3, r: 0.1 }, // the evening desk lamp (Rituals.tsx)
      { x: -0.56, z: 0.2, r: 0.12 }, // the lunch plate
    ];
    for (const p of [photoSpot(), toySpot()]) for (const b of busy) expect(Math.hypot(p.x - b.x, p.z - b.z), JSON.stringify({ p, b })).toBeGreaterThan(b.r + 0.05);
    // the testers' plant stands behind their test tubes, inside the desk
    const qa = plantSpot('qa');
    expect(qa.z - 0.07).toBeGreaterThan(-0.475);
    expect(qa.z + 0.07).toBeLessThan(-0.25);
  });

  it('shows what the career earned, and only that', () => {
    const fresh = deskLayout(deskItems(newCareer(NOW), { specialty: '', role: 'dev' }, NOW), 'dev');
    expect(fresh).toMatchObject({ shelf: false, plaques: [], more: null, star: null, stickers: [], photo: null, toy: null });
    const recent = [12, 9, 4].map((n) => ({ n, title: '', at: NOW }));
    const busy = deskLayout(deskItems({ ...newCareer(NOW - 5 * DAY), merged: 3, firstPass: 10, recent }, { specialty: 'audio', role: 'dev' }, NOW), 'dev');
    expect(busy.plaques.map((p) => p.n)).toEqual([12, 9, 4]);
    expect(busy).toMatchObject({ shelf: true, more: null, stickers: [{ slug: 'audio' }], toy: { kind: 'speaker' } });
    expect(busy.star).not.toBeNull();
    expect(busy.photo).not.toBeNull();
    expect(busy.plant.grow).toBeGreaterThan(fresh.plant.grow);
  });
});
