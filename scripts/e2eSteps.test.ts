import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browsersPathWarning, pickBrowser, webServerCommand } from './e2eSteps.mjs';

describe('pickBrowser', () => {
  it('uses a local Google Chrome when there is one', () => {
    expect(pickBrowser({}, { chrome: true, chromium: false })).toEqual({ browser: 'chrome', ok: true, message: null });
  });

  it("falls back to Playwright's Chromium without Chrome", () => {
    expect(pickBrowser({}, { chrome: false, chromium: true })).toMatchObject({ browser: 'chromium', ok: true });
  });

  it("always uses Playwright's Chromium in CI or when asked", () => {
    expect(pickBrowser({ CI: 'true' }, { chrome: true, chromium: true }).browser).toBe('chromium');
    expect(pickBrowser({ E2E_BROWSER: 'chromium' }, { chrome: true, chromium: true }).browser).toBe('chromium');
  });

  it('says how to install the browser instead of downloading it', () => {
    const result = pickBrowser({ CI: 'true' }, { chrome: true, chromium: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('npx playwright install chromium');
    expect(pickBrowser({}, { chrome: false, chromium: false }).ok).toBe(false);
  });
});

describe('browsersPathWarning', () => {
  const cwd = path.resolve('desk');

  it('is quiet for the shared default cache or a folder outside the checkout', () => {
    expect(browsersPathWarning({}, cwd)).toBeNull();
    expect(browsersPathWarning({ PLAYWRIGHT_BROWSERS_PATH: path.resolve('shared-browsers') }, cwd)).toBeNull();
  });

  it('warns about per-checkout browsers', () => {
    expect(browsersPathWarning({ PLAYWRIGHT_BROWSERS_PATH: '0' }, cwd)).toContain('unset it');
    expect(browsersPathWarning({ PLAYWRIGHT_BROWSERS_PATH: '.browsers' }, cwd)).toContain('unset it');
    expect(browsersPathWarning({ PLAYWRIGHT_BROWSERS_PATH: path.join(cwd, 'pw') }, cwd)).toContain('unset it');
  });
});

describe('webServerCommand', () => {
  it('builds first unless E2E_SKIP_BUILD=1', () => {
    expect(webServerCommand({})).toBe('npm run build && node --import tsx server/index.ts --demo');
    expect(webServerCommand({ E2E_SKIP_BUILD: '1' })).toBe('node --import tsx server/index.ts --demo');
  });
});
