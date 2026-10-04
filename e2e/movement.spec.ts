import { enterOffice, expect, savedView, test } from './helpers';

// Walking around the office.

test('holding W walks forward', async ({ page }) => {
  await enterOffice(page);
  // The client saves the player's spot about once a second while you're inside.
  await expect.poll(() => savedView(page)).not.toBeNull();
  const from = (await savedView(page))!;
  await page.keyboard.down('w');
  try {
    // Hold W until the saved spot has moved: about a second at 3.6 m/s, much longer when software WebGL on a busy
    // runner manages only a few frames a second (each frame moves you at most 0.18 m).
    await expect
      .poll(async () => {
        const at = await savedView(page);
        return at ? Math.hypot(at.x - from.x, at.z - from.z) : 0;
      }, { message: 'metres walked', timeout: 60_000 })
      .toBeGreaterThan(0.1);
  } finally {
    await page.keyboard.up('w');
  }
  const to = (await savedView(page))!;
  expect(to.floor).toBe(from.floor);
  expect(to.yaw).toBeCloseTo(from.yaw); // W walks, it doesn't turn
});
