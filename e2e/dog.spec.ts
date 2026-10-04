import { enterOffice, expect, startAt, test } from './helpers';

// The office dog (world/toys/Dog.tsx, dogBrain.ts), through its probe window.__swarmDog.

type Dog = { here: boolean; floor: number | null; state: string | null; speed: number | null; fetches: number; returned: number; lost: number; lastDrop: number | null };
const dog = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __swarmDog: Record<string, unknown> }).__swarmDog;
    return Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v !== 'function')) as unknown as Dog;
  });

test('the dog comes when called and fetches a thrown ball back to your feet', async ({ page }) => {
  // In the lobby, on the open rug, facing east
  await startAt(page, { floor: 0, x: -6, z: 7, yaw: -Math.PI / 2, pitch: -0.12 });
  await enterOffice(page);
  await expect.poll(async () => (await dog(page)).here, { timeout: 90_000, message: 'the dog on your floor' }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __swarmToys: { balls: unknown[] } }).__swarmToys.balls.length), { timeout: 90_000 }).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __swarmDog: { come(): void } }).__swarmDog.come());
  await expect.poll(async () => (await dog(page)).state, { timeout: 60_000 }).toBe('follow');
  // the yarn ball: nobody else plays with it (people shoot hoops and toss the beach ball)
  const thrown = await page.evaluate(() => (window as unknown as { __swarmDog: { fetch(id: string, power: number): string | null } }).__swarmDog.fetch('yarn-ball', 0.4));
  expect(thrown).toBe('yarn-ball');
  await expect.poll(async () => (await dog(page)).returned, { timeout: 90_000, message: 'the ball back at your feet' }).toBe(1);
  const d = await dog(page);
  expect(d.fetches).toBe(1);
  expect(d.lost).toBe(0);
  expect(d.lastDrop).toBeLessThan(1.6);
});
