import type { Page } from '@playwright/test';
import { MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, phoneButton, savedView, startAt, test, type SavedView } from './helpers';

// The camera's other views (world/camera/): the overview, the building view and the follow cam, the gamepad and
// rebinding keys. window.__swarmCamera reports the camera and says where things are on screen; window.__swarmPad is
// a virtual gamepad.

interface CameraState {
  mode: 'first' | 'overview' | 'building' | 'follow';
  owns: boolean;
  flying: boolean;
  target: { id: string; label: string } | null;
  home: { x: number; z: number };
}

type Probe = Record<string, (...args: unknown[]) => unknown>;
const camera = (page: Page) => page.evaluate(() => (window as unknown as { __swarmCamera: { state: () => CameraState } }).__swarmCamera.state());
const call = (page: Page, probe: '__swarmCamera' | '__swarmPad' | '__swarmPeople', fn: string, ...args: unknown[]) =>
  page.evaluate(([p, f, a]) => (window as unknown as Record<string, Probe>)[p as string][f as string](...(a as unknown[])), [probe, fn, args] as const);
/** Waits for the camera to be in `mode` with its flight over. */
const settled = (page: Page, mode: CameraState['mode']) =>
  expect.poll(async () => {
    const s = await camera(page);
    return s.mode === mode && !s.flying ? mode : `${s.mode}${s.flying ? ' (flying)' : ''}`;
  }, { message: `the camera settled in ${mode}`, timeout: 60_000 }).toBe(mode);

// Floor 1, on the open wood floor between the front desk row and the elevator, facing north.
const SPOT: SavedView = { floor: 1, x: -4, z: 8.5, yaw: 0, pitch: -0.1 };

test('Tab flies up to the overview, a click on someone opens their panel, and Tab flies back to the same spot', async ({ page }) => {
  await startAt(page, SPOT);
  await enterOffice(page);
  await expect.poll(() => savedView(page)).not.toBeNull();
  await page.keyboard.press('Tab');
  await settled(page, 'overview');
  const people = (await call(page, '__swarmPeople', 'list')) as { id: string }[];
  expect(people.length).toBeGreaterThan(0);
  const at = (await call(page, '__swarmCamera', 'person', people[0].id)) as { x: number; y: number } | null;
  expect(at, 'the person is on screen').not.toBeNull();
  await page.mouse.click(at!.x, at!.y, { delay: 80 });
  await expect(page.getByRole('button', { name: '🎥 Follow' })).toBeVisible(); // their panel
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '🎥 Follow' })).toBeHidden();
  expect((await camera(page)).mode).toBe('overview'); // Esc closed the panel, not the overview
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await camera(page)).owns, { timeout: 60_000 }).toBe(false);
  const back = await savedView(page);
  expect(back).toMatchObject({ floor: 1, x: SPOT.x, z: SPOT.z });
});

test('Tab twice shows every floor, and a click on one goes there', async ({ page }) => {
  await startAt(page, SPOT);
  await enterOffice(page);
  // Two quick taps. Playwright's key presses wait out slow software-WebGL frames, so they'd land too far apart; the
  // office times taps by when they were pressed (the event's timeStamp), so both are made before either is handled.
  await page.evaluate(() => {
    const taps = [0, 1].map(() => new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true }));
    for (const e of taps) window.dispatchEvent(e);
  });
  await settled(page, 'building');
  await expect(page.getByText('🏢 The building')).toBeVisible();
  // floor 2's slice, against the south face: y is relative to the floor you're on
  const at = (await call(page, '__swarmCamera', 'screenOf', 0, 4.2 + 1.8, 12.33)) as { x: number; y: number } | null;
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y, { delay: 80 });
  await expect(page.locator('.floor-num')).toHaveText('2', { timeout: 60_000 });
  await settled(page, 'overview'); // you land looking over the floor you picked
  await expect(page.locator('.fade-label')).toHaveCount(0); // the elevator's fade is over (Tab waits for it)
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await camera(page)).owns, { timeout: 60_000 }).toBe(false);
  expect((await savedView(page))?.floor).toBe(2);
});

test('Follow trails someone on an errand, and W takes over again', async ({ page }) => {
  await startAt(page, SPOT);
  await enterOffice(page);
  const people = (await call(page, '__swarmPeople', 'list')) as { id: string; mode: string }[];
  const who = (people.find((p) => p.mode === 'seated') ?? people[0]).id;
  await call(page, '__swarmCamera', 'followAgent', who);
  await settled(page, 'follow');
  expect((await camera(page)).target?.id).toBe(who);
  await call(page, '__swarmPeople', 'walkTo', who, 8, -6); // across the room
  let seen = 0;
  for (let i = 0; i < 10; i++) {
    if (await call(page, '__swarmCamera', 'person', who)) seen++;
    await page.waitForTimeout(500);
  }
  expect(seen, 'samples with them in frame').toBe(10);
  await page.keyboard.press('w');
  await expect.poll(async () => (await camera(page)).owns, { timeout: 60_000 }).toBe(false);
  expect((await camera(page)).mode).toBe('first');
});

test('a gamepad walks, looks, picks up and throws a ball, and opens the phone', async ({ page }) => {
  // In the lobby, north of the basketball under its hoop and looking down at it (as toys.spec.ts).
  const spot: SavedView = { floor: 0, x: -9, z: 9.3, yaw: Math.PI, pitch: -0.73 };
  await startAt(page, spot);
  await enterOffice(page);
  await call(page, '__swarmPad', 'connect');
  await expect(page.getByText(/Virtual pad connected/)).toBeVisible();
  await expect(page.getByText('Pick up ball')).toBeVisible({ timeout: 90_000 });
  await call(page, '__swarmPad', 'press', 'A');
  type Toys = { held: unknown };
  const held = () => page.evaluate(() => (window as unknown as { __swarmToys: Toys }).__swarmToys.held);
  await expect.poll(held).toEqual({ kind: 'ball', id: 'basketball' });
  await call(page, '__swarmPad', 'hold', 'RT');
  await page.waitForTimeout(300);
  await call(page, '__swarmPad', 'release', 'RT');
  await expect.poll(held).toBeNull();
  // the right stick turns, the left one walks
  await call(page, '__swarmPad', 'stick', 'right', 1, 0);
  await expect.poll(async () => Math.abs((await savedView(page))!.yaw - spot.yaw), { timeout: 60_000 }).toBeGreaterThan(0.2);
  await call(page, '__swarmPad', 'stick', 'right', 0, 0);
  const from = (await savedView(page))!;
  await call(page, '__swarmPad', 'stick', 'left', 0, -1);
  await expect.poll(async () => {
    const at = (await savedView(page))!;
    return Math.hypot(at.x - from.x, at.z - from.z);
  }, { timeout: 60_000 }).toBeGreaterThan(0.2);
  await call(page, '__swarmPad', 'stick', 'left', 0, 0);
  await call(page, '__swarmPad', 'press', 'START');
  await expect(page.locator('.phone')).toBeVisible();
  await call(page, '__swarmPad', 'press', 'START');
  await expect(page.locator('.phone')).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});

test('interact rebound to F works, shows everywhere and survives a reload', async ({ page }) => {
  const spot: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };
  await startAt(page, spot);
  await enterOffice(page);
  await page.keyboard.press('h');
  await page.getByRole('button', { name: '🎮 Controls' }).click();
  await page.getByRole('button', { name: /^Use, pick up, sip: key E/ }).click();
  await page.keyboard.press('f');
  await expect(page.getByText(/F is now Use, pick up, sip/)).toBeVisible();
  await page.keyboard.press('Escape');
  const hint = page.locator('.hud-hint');
  await expect(hint).toContainText("Open the manager's console");
  await expect(hint.locator('kbd').first()).toHaveText('F');
  await page.keyboard.press('f');
  const panel = page.getByText(/Manager's console/);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // A reload, as a second tab: navigating this one away can abort a request in flight, which the fixture counts as a
  // failure. Same browser storage, same checks for errors.
  const baseURL = test.info().project.use.baseURL!;
  await page.context().route((url) => !url.href.startsWith(baseURL) && !url.protocol.startsWith('data'), (route) => route.fulfill({ status: 200, body: '' }));
  const again = await page.context().newPage();
  const problems: string[] = [];
  again.on('console', (m) => void (m.type() === 'error' && problems.push(m.text())));
  again.on('pageerror', (e) => void problems.push(e.message));
  await enterOffice(again);
  await expect(again.locator('.hud-hint kbd').first()).toHaveText('F');
  await again.keyboard.press('f');
  await expect(again.getByText(/Manager's console/)).toBeVisible();
  expect(problems, 'console errors after the reload').toEqual([]);
  await again.close();
});
