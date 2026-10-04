// npm's pretest:e2e: stops `npm run test:e2e` in a second, with one clear line, when its browser or (with
// E2E_SKIP_BUILD=1) its build is missing, instead of a download or a failed boot halfway through.
import fs from 'node:fs';
import { browsersPathWarning, installedBrowsers, pickBrowser } from './e2eSteps.mjs';

const warning = browsersPathWarning(process.env, process.cwd());
if (warning) console.warn(`e2e: ${warning}`);

const { browser, ok, message } = pickBrowser(process.env, installedBrowsers());
if (!ok) {
  console.error(`e2e: ${message}`);
  process.exit(1);
}
if (process.env.E2E_SKIP_BUILD === '1' && !fs.existsSync('dist/index.html')) {
  console.error('e2e: E2E_SKIP_BUILD=1 but there is no dist/: run `npm run build` first.');
  process.exit(1);
}
console.log(`e2e: using ${browser === 'chrome' ? 'Google Chrome' : "Playwright's Chromium"}${process.env.E2E_SKIP_BUILD === '1' ? ', reusing dist/' : ''}`);
