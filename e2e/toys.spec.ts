import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// The toys (world/toys/): balls you can pick up and throw, and the roomba.

test('a thrown ball bounces with its own sound, from where it lands', async ({ page }) => {
  // In the lobby, 1.6 m north of the basketball under its hoop (toys/balls.tsx), facing south and looking down at it.
  const spot: SavedView = { floor: 0, x: -9, z: 9.3, yaw: Math.PI, pitch: -0.73 };
  await startAt(page, spot);
  await enterOffice(page);
  await expect(page.getByText('Pick up ball')).toBeVisible({ timeout: 90_000 }); // the crosshair hint, once the toys load
  await page.keyboard.press('e');
  type Toys = { held: unknown; balls: { id: string; y: number }[] };
  const toys = () => page.evaluate(() => (window as unknown as { __swarmToys: Toys }).__swarmToys);
  await expect.poll(async () => (await toys()).held).toEqual({ kind: 'ball', id: 'basketball' });
  // wait until it's up in your hands, so the throw starts in the air
  await expect.poll(async () => (await toys()).balls.find((b) => b.id === 'basketball')!.y, { message: 'carried height' }).toBeGreaterThan(0.5);
  await page.keyboard.press('f'); // a tap: a gentle lob, down onto the floor in front
  type Sfx = { name: string; group: string | null; at: { x: number; z: number } | null; t: number };
  const sounds = () => page.evaluate(() => (window as unknown as { __swarmSfx: Sfx[] }).__swarmSfx.map(({ name, group, at, t }) => ({ name, group, at, t })));
  await expect.poll(async () => (await sounds()).some((s) => s.name === 'bounce:basketball'), { message: 'a bounce in __swarmSfx', timeout: 60_000 }).toBe(true);
  const all = await sounds();
  const thrown = all.find((s) => s.name === 'throw')!;
  expect(all.some((s) => s.name === 'grab:basketball' && s.group === 'toys')).toBe(true);
  const bounce = all.find((s) => s.name === 'bounce:basketball' && s.t >= thrown.t)!;
  expect(bounce.group).toBe('toys');
  // positional: in front of where you stood (south of you, towards the hoop)
  expect(Math.abs(bounce.at!.x - spot.x)).toBeLessThan(1);
  expect(bounce.at!.z).toBeGreaterThan(spot.z);
});

test('the roomba beeps from its dock as it heads out', async ({ page }) => {
  await enterOffice(page);
  // It starts on its dock nearly charged: a full-charge tune, then two beeps as it backs off. Both are recorded (and
  // positional, in the toys group) even when it's too far away to hear.
  const leave = () =>
    page.evaluate(() => {
      const w = window as unknown as { __swarmSfx: { name: string; group: string | null; at: unknown }[] };
      return w.__swarmSfx.find((r) => r.name === 'roomba:leave') ?? null;
    });
  await expect.poll(leave, { timeout: 60_000, intervals: [250] }).not.toBeNull();
  const rec = (await leave())!;
  expect(rec.group).toBe('toys');
  expect(rec.at).not.toBeNull();
});
