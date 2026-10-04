// The e2e run's setup decisions, shared by playwright.config.ts and e2e-check.mjs (npm's pretest:e2e): which browser
// runs the smoke tests, whether it is there, and whether the demo office needs a fresh build first.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const INSTALL_HINT = 'run `npx playwright install chromium` once; it is shared by every desk';

/**
 * CI always uses Playwright's Chromium, as before. Elsewhere an installed Google Chrome is used when there is one
 * (no download, nothing shared to break), unless E2E_BROWSER=chromium asks for Playwright's.
 */
export function pickBrowser(env, installed) {
  const wantsChromium = !!env.CI || env.E2E_BROWSER === 'chromium';
  const browser = !wantsChromium && installed.chrome ? 'chrome' : 'chromium';
  if (browser === 'chrome' || installed.chromium) return { browser, ok: true, message: null };
  return { browser, ok: false, message: `Playwright's Chromium is missing: ${INSTALL_HINT}.` };
}

/**
 * PLAYWRIGHT_BROWSERS_PATH pointing into node_modules ("0") or inside the checkout gives every desk its own browser
 * download; the default shared cache is the point. Returns a warning, or null.
 */
export function browsersPathWarning(env, cwd) {
  const value = env.PLAYWRIGHT_BROWSERS_PATH;
  if (!value) return null;
  const rel = path.relative(cwd, path.resolve(cwd, value));
  const inside = value === '0' || rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  return inside ? `PLAYWRIGHT_BROWSERS_PATH=${value} keeps browsers in this checkout; unset it to share one browser across desks.` : null;
}

/** E2E_SKIP_BUILD=1 boots the demo office from the dist/ you just built instead of building again. */
export function webServerCommand(env) {
  const boot = 'node --import tsx server/index.ts --demo';
  return env.E2E_SKIP_BUILD === '1' ? boot : `npm run build && ${boot}`;
}

/** Whether Google Chrome and Playwright's headless Chromium are installed, looked up the way Playwright does. */
export function installedBrowsers() {
  const { registry } = createRequire(import.meta.url)('playwright-core/lib/server/registry/index');
  const has = (name) => {
    const file = registry.findExecutable(name)?.executablePath('javascript');
    return !!file && fs.existsSync(file);
  };
  return { chrome: has('chrome'), chromium: has('chromium-headless-shell') };
}
