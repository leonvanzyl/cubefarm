import { enterOffice, expect, savedView, test } from './helpers';

// Sound effects (ui/sfx.ts) through the __swarmSfx probe. Each feature's own sounds are tested in its spec file.

test('__swarmSfx records sounds, fading and panning with where you stand', async ({ page }) => {
  type Rec = { name: string; at: { x: number } | null; gain: number; pan: number; played: boolean };
  const ping = (x: number, z: number) =>
    page.evaluate(([px, pz]) => {
      const w = window as unknown as { __swarmSfxPing: (x: number, y: number, z: number) => void; __swarmSfx: Rec[] };
      w.__swarmSfxPing(px, 1.2, pz);
      return w.__swarmSfx[w.__swarmSfx.length - 1];
    }, [x, z]);

  // Before any click or key press nothing plays, but the probe still records it.
  await page.goto('/');
  const locked = await ping(0, 0);
  expect(locked.name).toBe('ping');
  expect(locked.played).toBe(false);

  await enterOffice(page);
  await expect.poll(() => savedView(page)).not.toBeNull(); // frames have run, so the listener follows the camera
  const v = (await savedView(page))!;
  const right = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) }; // the camera's right, at yaw 0 it's +x
  const at = (d: number) => ping(v.x + right.x * d, v.z + right.z * d);
  const [near, mid, far] = [await at(2), await at(8), await at(30)];
  expect(near.gain).toBeGreaterThan(mid.gain);
  expect(mid.gain).toBeGreaterThan(0);
  expect(far.gain).toBe(0); // beyond hearing: culled
  expect(far.played).toBe(false);
  expect(near.pan).toBeGreaterThan(0.5);
  const left = await ping(v.x - right.x * 3, v.z - right.z * 3);
  expect(left.pan).toBeLessThan(-0.5);
});
