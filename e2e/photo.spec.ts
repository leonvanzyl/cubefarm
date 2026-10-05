import fs from 'node:fs';
import { enterOffice, expect, phoneButton, savedView, startAt, test } from './helpers';
import { decodePng } from './png';

// Photo mode: K freezes the office under a camera of its own, a 2× shot downloads at twice the screen's size, and
// K again puts everything back.

interface PhotoProbe {
  mode: 'photo' | 'off';
  frozen: boolean;
  state: { frames: number; camera: { x: number; z: number } } | null;
  fly(x: number, y: number, z: number, yawDeg?: number, pitchDeg?: number): Promise<unknown>;
  set(patch: Record<string, unknown>): Promise<unknown>;
  shot(scale: number): Promise<{ width: number; height: number } | null>;
}
declare const __swarmPhoto: PhotoProbe;
declare const __swarmPeople: { list(): { id: string; x: number; z: number; heading: number }[] };

test('K freezes the office for a 2× shot and K again puts everything back', async ({ page }) => {
  await startAt(page, { floor: 1, x: 0, z: 8, yaw: 0, pitch: -0.05 });
  await enterOffice(page);
  await expect.poll(() => savedView(page)).not.toBeNull();
  const before = await savedView(page);

  await page.keyboard.press('k');
  await expect(page.getByRole('complementary', { name: 'Photo mode' })).toBeVisible();
  await expect(phoneButton(page)).toBeHidden(); // the HUD steps aside
  expect(await page.evaluate(() => __swarmPhoto.frozen)).toBe(true);

  // frozen: nobody moves, and nothing is redrawn while the camera stands still. The office's own people, that is:
  // visitors (other tabs, and the demo's fake ones that follow them between floors) still come and go, unseen until
  // the next redraw.
  const people = () => page.evaluate(() => JSON.stringify(__swarmPeople.list().filter((p) => !p.id.startsWith('visitor:')).map((p) => [p.id, p.x, p.z, p.heading])));
  const frames = () => page.evaluate(() => __swarmPhoto.state?.frames ?? 0);
  const still = await people();
  const drawn = await frames();
  await page.waitForTimeout(2000);
  expect(await people()).toBe(still);
  expect(await frames()).toBe(drawn);

  await page.evaluate(() => __swarmPhoto.fly(-4, 2.2, 2, 30, -12));
  await page.evaluate(() => __swarmPhoto.set({ filter: 'warm', daytime: 'golden' }));
  const download = page.waitForEvent('download');
  const shot = await page.evaluate(() => __swarmPhoto.shot(2));
  const file = await (await download).path();
  const png = decodePng(fs.readFileSync(file));
  const size = page.viewportSize()!;
  expect(shot).toMatchObject({ width: size.width * 2, height: size.height * 2 });
  expect([png.width, png.height]).toEqual([size.width * 2, size.height * 2]);
  await expect(page.getByText(/Saved cubefarm-.*\.png/)).toBeVisible();

  await page.keyboard.press('k');
  await expect(page.getByRole('complementary', { name: 'Photo mode' })).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
  expect(await page.evaluate(() => [__swarmPhoto.mode, __swarmPhoto.frozen])).toEqual(['off', false]);
  // the player is exactly where they were, and the office moves on
  await page.waitForTimeout(1500);
  expect(await savedView(page)).toEqual(before);
});
