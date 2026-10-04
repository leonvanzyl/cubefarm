import { COFFEE_CORNER, HALF_D } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// Coffee: the kitchenette's machine, the lobby's coffee corner and drinking from a mug.

test('the coffee machine fills a mug you put under it', async ({ page }) => {
  // Floor 1's kitchenette (east wall): stand in front of the coffee machine, looking down at its drip tray.
  const spot: SavedView = { floor: 1, x: 14.75, z: 5.9, yaw: -Math.PI / 2, pitch: -0.83 };
  await startAt(page, spot);
  await enterOffice(page);
  const coffee = () => page.evaluate(() => (window as unknown as { __swarmCoffee: { state: string; mug: { sips: number } | null } }).__swarmCoffee);
  const held = () => page.evaluate(() => (window as unknown as { __swarmToys: { held: unknown } }).__swarmToys.held);
  const act = (op: string) => page.evaluate((o) => (window as unknown as { __swarmCoffeeDo(op: string): void }).__swarmCoffeeDo(o), op);

  await act('brew'); // no mug: nothing happens
  expect((await coffee()).state).toBe('empty');

  await page.evaluate(() => (window as unknown as { __swarmGiveMug(sips: number): void }).__swarmGiveMug(0));
  await expect(page.getByText('Put mug under the machine')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('e');
  await expect.poll(async () => (await coffee()).state).toBe('mugPlaced');
  expect(await held()).toBeNull();

  await act('brew');
  expect((await coffee()).state).toBe('brewing');
  await expect.poll(async () => (await coffee()).state, { timeout: 15_000 }).toBe('ready');
  await expect(page.getByText('Take coffee')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('e');
  await expect.poll(held).toMatchObject({ kind: 'mug', sips: 3 });
  expect((await coffee()).state).toBe('empty');

  const sounds = await page.evaluate(() => (window as unknown as { __swarmSfx: { name: string; group: string | null; at: unknown }[] }).__swarmSfx.filter((s) => s.name.startsWith('coffee-')));
  expect(sounds.map((s) => s.name)).toEqual(expect.arrayContaining(['coffee-nope', 'coffee-mug', 'coffee-button']));
  expect(sounds.every((s) => s.group === 'toys' && s.at)).toBe(true);
});

test("the lobby's coffee corner hands out mugs and brews like the kitchenette", async ({ page }) => {
  // Stand in front of the corner's mug dispenser on the south wall, looking down at the stack (yaw π faces south).
  const spot: SavedView = { floor: 0, x: COFFEE_CORNER.x - 0.4, z: HALF_D - COFFEE_CORNER.d - 0.35, yaw: Math.PI, pitch: -0.5 };
  await startAt(page, spot);
  await enterOffice(page);
  const coffee = () => page.evaluate(() => (window as unknown as { __swarmCoffee: { state: string } }).__swarmCoffee);
  const held = () => page.evaluate(() => (window as unknown as { __swarmToys: { held: unknown } }).__swarmToys.held);
  const act = (op: string) => page.evaluate((o) => (window as unknown as { __swarmCoffeeDo(op: string): void }).__swarmCoffeeDo(o), op);

  await expect(page.getByText('Take a mug')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('e');
  await expect.poll(held).toMatchObject({ kind: 'mug', sips: 0 });

  await act('place');
  await expect.poll(async () => (await coffee()).state).toBe('mugPlaced');
  await act('brew');
  await expect.poll(async () => (await coffee()).state, { timeout: 15_000 }).toBe('ready');
  await act('take');
  await expect.poll(held).toMatchObject({ kind: 'mug', sips: 3 });

  // the machine's sounds come from the corner, not from where the kitchenette would be
  const at = await page.evaluate(() => (window as unknown as { __swarmSfx: { name: string; at: { x: number; z: number } | null }[] }).__swarmSfx.filter((s) => s.name === 'coffee-button')[0]?.at);
  expect(Math.abs(at!.x - COFFEE_CORNER.x)).toBeLessThan(COFFEE_CORNER.w / 2);
  expect(at!.z).toBeGreaterThan(HALF_D - COFFEE_CORNER.d);
});

test('E sips a full mug twice, gulps the last, then the empty mug drops with a clunk', async ({ page }) => {
  await enterOffice(page);
  type Toys = { held: { kind: string; sips: number } | null; sipping: boolean; mugs: { sips: number }[] };
  const toys = () => page.evaluate(() => (window as unknown as { __swarmToys: Toys }).__swarmToys);
  await page.evaluate(() => (window as unknown as { __swarmGiveMug(sips: number): void }).__swarmGiveMug(3));
  await expect(page.getByText('Sip coffee')).toBeVisible();

  for (const left of [2, 1]) {
    await page.keyboard.press('e');
    await expect.poll(async () => (await toys()).held?.sips).toBe(left);
    await expect.poll(async () => (await toys()).sipping).toBe(false);
  }
  await page.keyboard.press('e'); // the big last gulp
  await expect.poll(async () => (await toys()).held, { timeout: 10_000 }).toBeNull();
  await expect.poll(async () => (await toys()).mugs).toEqual([expect.objectContaining({ sips: 0 })]);

  type Rec = { name: string; group: string | null; at: unknown };
  const sounds = () => page.evaluate(() => (window as unknown as { __swarmSfx: Rec[] }).__swarmSfx.filter((s) => s.name.startsWith('mug-')));
  await expect.poll(async () => (await sounds()).some((s) => s.name === 'mug-clunk'), { timeout: 10_000 }).toBe(true);
  const recs = await sounds();
  expect(new Set(recs.map((s) => s.name))).toEqual(new Set(['mug-sip', 'mug-mm', 'mug-gulp', 'mug-ahh', 'mug-clunk']));
  expect(recs.every((s) => s.group === 'toys')).toBe(true);
  expect(recs.filter((s) => s.name === 'mug-clunk').every((s) => s.at)).toBe(true);
});
