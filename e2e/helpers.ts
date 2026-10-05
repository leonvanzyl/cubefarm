import { test as base, expect, type Page } from '@playwright/test';
import { colourStats, decodePng } from './png';

// What every e2e spec shares: the `test` that fails on console errors and failed requests, walking into the office,
// placing the player and looking at the 3D view. Specs import `test` and `expect` from here, not from Playwright.
// One spec file per feature: add a feature's tests to its own file, never to smoke.spec.ts.

export { expect };

export const VIEW_KEY = 'cubefarm:view'; // where the client remembers the player's spot (store.ts saveView)

export interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

// Every test fails on a console error, an uncaught exception, or a request to the office that failed.
export const test = base.extend<{ page: Page }>({
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

/**
 * Loads the office and walks in through the first-run flow (the setup wizard if it's up, else the start screen).
 * `loaded`: the page has the office open already, so it isn't loaded again (that would abort the lazy chunks the first
 * load is still fetching, which the fixture counts as failed requests).
 */
export async function enterOffice(page: Page, { loaded = false } = {}) {
  if (!loaded) await page.goto('/');
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

export const phoneButton = (page: Page) => page.getByTitle('Your phone (P)');

/** Puts the player at `spot` when the office next loads: call it before enterOffice. */
export async function startAt(page: Page, spot: SavedView) {
  await page.addInitScript(([key, view]) => localStorage.setItem(key, view), [VIEW_KEY, JSON.stringify(spot)] as const);
}

export async function savedView(page: Page): Promise<SavedView | null> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), VIEW_KEY);
}

/**
 * The 3D view on its own: everything else on the page is hidden while it's captured. A page screenshot clipped to
 * the canvas, because an element screenshot first waits for frames in which it hasn't moved, and software WebGL
 * can take seconds per frame.
 */
export async function canvasColours(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('the canvas has no size');
  const png = await page.screenshot({ clip: box, caret: 'initial', style: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  return colourStats(decodePng(png));
}
