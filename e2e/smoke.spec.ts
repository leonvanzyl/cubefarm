import { test as base, expect, type Page } from '@playwright/test';
import { MANAGER_DESK } from '../client/src/world/layout';
import { colourStats, decodePng } from './png';

// Smoke tests against the demo office: it loads without errors, you can walk in, the 3D view renders and moves,
// and the main panels open and close. Pointer lock may not work headless, so nothing here depends on it.

const VIEW_KEY = 'cubefarm:view'; // where the client remembers the player's spot (store.ts saveView)

interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

// Every test fails on a console error, an uncaught exception, or a request to the office that failed.
const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    // Only the office itself is under test: stub anything external (the Google Fonts stylesheet) so the result
    // doesn't depend on the network.
    await page.route(
      (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
      (route) => route.fulfill({ status: 200, body: '' }),
    );
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    });
    await use(page);
    expect(problems, 'console errors or failed requests').toEqual([]);
  },
});

/** Loads the office and walks in through the first-run flow (the setup wizard if it's up, else the start screen). */
async function enterOffice(page: Page) {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter the office' });
  const skipSetup = page.getByRole('button', { name: /skip setup/i });
  await expect(enter.or(skipSetup)).toBeVisible();
  if (await skipSetup.isVisible()) await skipSetup.click();
  else {
    await expect(page.getByText(/DEMO MODE/)).toBeVisible();
    await expect(enter).toBeEnabled(); // it reads "Loading…" until the first snapshot arrives
    await enter.click();
  }
  await expect(enter).toBeHidden();
  await expect(phoneButton(page)).toBeVisible(); // the HUD only shows it once you're inside
}

const phoneButton = (page: Page) => page.getByTitle('Your phone (P)');

async function savedView(page: Page): Promise<SavedView | null> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), VIEW_KEY);
}

/**
 * The 3D view on its own: everything else on the page is hidden while it's captured. A page screenshot clipped to
 * the canvas, because an element screenshot first waits for frames in which it hasn't moved, and software WebGL
 * can take seconds per frame.
 */
async function canvasColours(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('the canvas has no size');
  const png = await page.screenshot({ clip: box, caret: 'initial', style: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  return colourStats(decodePng(png));
}

test('/api/state returns JSON with floors', async ({ request }) => {
  const res = await request.get('/api/state');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/json');
  const state = await res.json();
  expect(state.demo).toBe(true);
  expect(state.repos.length).toBeGreaterThan(0);
  for (const repo of state.repos) expect(repo.floor).toBeGreaterThan(0);
  expect(state.agents.length).toBeGreaterThan(0);
});

test('the office loads, you can walk in and the 3D view renders', async ({ page }) => {
  await enterOffice(page);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  // A blank or failed WebGL canvas is one flat colour; the lobby has walls, furniture, people and signs.
  // Polled because the first frames can still be empty while the scene loads.
  await expect
    .poll(
      async () => {
        const { colours, topShare } = await canvasColours(page);
        return topShare < 0.9 ? colours : 0; // one colour covering nearly everything counts as blank
      },
      { message: 'distinct colours in the canvas', timeout: 90_000 },
    )
    .toBeGreaterThan(200);
});

test('H opens help and Esc closes it', async ({ page }) => {
  await enterOffice(page);
  const help = page.getByText('How the office works', { exact: true });
  await page.keyboard.press('h');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});

test('the phone opens and closes with P, its button and Esc', async ({ page }) => {
  await enterOffice(page);
  const hires = page.getByRole('button', { name: /Hires/ }); // one of the phone's tabs
  const company = page.getByRole('button', { name: /Company/ });
  await page.keyboard.press('p');
  await expect(hires).toBeVisible();
  await expect(phoneButton(page)).toBeHidden();
  // The chat focuses its message box, where P types a "p"; from another tab P puts the phone away.
  await company.click();
  await expect(company).toHaveClass(/phone-tab-on/);
  await page.keyboard.press('p');
  await expect(hires).toBeHidden();

  // Closing a panel grabs the mouse again (#42); a locked pointer can't click the HUD, so let go of it first. The lock
  // request is async: wait for it to land (or be refused) before letting go, or it lands after and eats the click.
  await page
    .waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 3000 })
    .catch(() => undefined);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null);
  // Clicks are also ignored for a moment after a panel closes (so a double click can't act through it): retry.
  await expect(async () => {
    await phoneButton(page).click();
    await expect(hires).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press('Escape');
  await expect(hires).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});

test("the manager's console opens with E at its desk and closes with Esc", async ({ page }) => {
  // Start in the manager's office, just in front of the desk, looking down at the computer (-Z is north).
  const spot: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };
  await page.addInitScript(([key, view]) => localStorage.setItem(key, view), [VIEW_KEY, JSON.stringify(spot)] as const);
  await enterOffice(page);
  await expect(page.getByText("Open the manager's console")).toBeVisible(); // the crosshair hint
  await page.keyboard.press('e');
  const panel = page.getByText(/Manager's console/); // the panel's title; the hint and help text say "manager's"
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});

test('a thrown ball bounces with its own sound, from where it lands', async ({ page }) => {
  // In the lobby, 1.6 m north of the basketball under its hoop (toys/balls.tsx), facing south and looking down at it.
  const spot: SavedView = { floor: 0, x: -9, z: 9.3, yaw: Math.PI, pitch: -0.73 };
  await page.addInitScript(([key, view]) => localStorage.setItem(key, view), [VIEW_KEY, JSON.stringify(spot)] as const);
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

test('the coffee machine fills a mug you put under it', async ({ page }) => {
  // Floor 1's kitchenette (east wall): stand in front of the coffee machine, looking down at its drip tray.
  const spot: SavedView = { floor: 1, x: 14.75, z: 5.9, yaw: -Math.PI / 2, pitch: -0.83 };
  await page.addInitScript(([key, view]) => localStorage.setItem(key, view), [VIEW_KEY, JSON.stringify(spot)] as const);
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
