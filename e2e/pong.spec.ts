import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// Ping-pong (world/toys/PingPong.tsx, pongRunner.ts): pick up a paddle, and the probe feeds balls at you.

type Pong = {
  state: { phase: string | null; you: string | null; drill: { left: number; results: { landed: boolean; why: string }[] } | null; loaded: boolean };
  feed(n: number): boolean;
};
const pong = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __swarmPong: Pong }).__swarmPong.state);

test('E at an end picks up a paddle, returns land on the far half across a range of balls, and G puts it down', async ({ page }) => {
  // floor 1, just past the table's east end, looking down it
  const spot: SavedView = { floor: 1, x: -3.6, z: 8.2, yaw: Math.PI / 2, pitch: -0.45 };
  await startAt(page, spot);
  await enterOffice(page);
  await expect(page.getByText('Play ping-pong')).toBeVisible({ timeout: 90_000 }); // the crosshair hint, once the toys load
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __swarmToys: { held: unknown } }).__swarmToys.held)).toEqual({ kind: 'paddle', id: 'east' });
  await expect(page.locator('.hud-pong')).toBeVisible();

  // twelve balls, slow to quick, chopped to topspun, left to right; the autopilot meets each one with the same swing
  expect(await page.evaluate(() => (window as unknown as { __swarmPong: Pong }).__swarmPong.feed(12))).toBe(true);
  await expect.poll(async () => (await pong(page)).drill?.results.length ?? 0, { timeout: 90_000, intervals: [500] }).toBe(12);
  const results = (await pong(page)).drill!.results;
  expect(results.filter((r) => !r.landed)).toEqual([]);

  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __swarmToys: { held: unknown } }).__swarmToys.held)).toBeNull();
  await expect(page.locator('.hud-pong')).toBeHidden();
});
