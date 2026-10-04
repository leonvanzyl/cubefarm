import { BALCONY, BALCONY_OUT, DOOR_SENSOR, HALF_W, PLAYER_RADIUS, SIDE_OPENINGS, WALL_T } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test } from './helpers';

// Outside: walk out of floor 1's west door onto the balcony, to its railing, and back in. Keys only (no pointer lock
// headless): the saved view points you at the door, W walks you out and S backs you in. window.__swarmOutside
// (world/doors.ts) reports the doors and whether you're out.

interface Outside {
  floor: number;
  kind: string;
  doors: Record<'west' | 'east', { open: number; phase: string }>;
  out: boolean;
  side: string | null;
  x: number;
  z: number;
}

test('you can walk out of the west door onto the balcony, to the railing, and back in', async ({ page }) => {
  const door = SIDE_OPENINGS.office.west.door;
  const wall = -(HALF_W + WALL_T / 2);
  // inside, facing the west door (yaw π/2 faces -x), just beyond its sensor
  const start = { floor: 1, x: wall + DOOR_SENSOR.across + 0.6, z: door, yaw: Math.PI / 2, pitch: 0 };
  await startAt(page, start);
  await enterOffice(page);

  const outside = () => page.evaluate(() => (window as unknown as { __swarmOutside: Outside }).__swarmOutside);
  // The probe keeps only the last 50 sounds (footsteps among them): gather the doors' as they come.
  const heard = new Set<string>();
  const listen = async () => {
    for (const r of await page.evaluate(() => (window as unknown as { __swarmSfx: { name: string; t: number }[] }).__swarmSfx)) if (r.name.startsWith('door:')) heard.add(`${r.name}@${r.t}`);
    return [...heard].map((k) => k.split('@')[0]);
  };

  await expect
    .poll(async () => {
      const o = await outside();
      return [o.floor, o.kind, Math.round(o.x * 10) / 10];
    }, { timeout: 60_000 })
    .toEqual([1, 'office', Math.round(start.x * 10) / 10]);
  expect((await outside()).doors.west.phase).toBe('closed');

  // Out: the door slides open as you come, and you pass through it.
  const seen: { through: Outside | null } = { through: null }; // the first look at you out there
  await page.keyboard.down('w');
  try {
    await expect
      .poll(async () => {
        const o = await outside();
        await listen();
        if (o.out && !seen.through) seen.through = o;
        return o.x;
      }, { message: 'walking out to the railing', timeout: 60_000, intervals: [100] })
      .toBeLessThan(-(BALCONY_OUT - BALCONY.railT - PLAYER_RADIUS - 0.05));
  } finally {
    await page.keyboard.up('w');
  }
  expect(seen.through).toMatchObject({ out: true, side: 'west' });
  expect(seen.through!.doors.west.open).toBeGreaterThan(0.5);
  // the railing stops you, and the door shuts behind you
  const atRail = await outside();
  expect(atRail.x).toBeGreaterThanOrEqual(-(BALCONY_OUT - BALCONY.railT - PLAYER_RADIUS) - 1e-6);
  expect(Math.abs(atRail.z - door)).toBeLessThan(0.05);
  await expect.poll(async () => (await outside()).doors.west.phase, { timeout: 30_000 }).toBe('closed');
  expect((await outside()).out).toBe(true);
  await expect.poll(listen).toEqual(expect.arrayContaining(['door:open', 'door:close']));

  // And back in, backwards: it opens again and lets you through.
  heard.clear();
  await page.keyboard.down('s');
  try {
    await expect
      .poll(async () => {
        const o = await outside();
        await listen();
        return o.out ? -Infinity : o.x;
      }, { message: 'walking back in', timeout: 60_000, intervals: [100] })
      .toBeGreaterThan(start.x - 0.2);
  } finally {
    await page.keyboard.up('s');
  }
  expect((await outside()).side).toBeNull();
  await expect.poll(async () => (await outside()).doors.west.phase, { timeout: 30_000 }).toBe('closed');
  await expect.poll(listen).toEqual(expect.arrayContaining(['door:open', 'door:close']));
  expect((await outside()).doors.east.phase).toBe('closed');
});
