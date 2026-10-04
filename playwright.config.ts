import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { installedBrowsers, pickBrowser, webServerCommand } from './scripts/e2eSteps.mjs';

// Browser smoke tests (e2e/): build the app, boot a demo office on a test port with a throwaway SWARM_HOME,
// then drive it in headless Chromium (or a local Google Chrome, see scripts/e2eSteps.mjs) with software WebGL.

const PORT = Number(process.env.E2E_PORT || 4399);
// The live office runs on 4317 (server) and 5317 (Vite); a test run must never land on either.
if (!Number.isInteger(PORT) || PORT <= 0 || PORT === 4317 || PORT === 5317) throw new Error(`E2E_PORT ${process.env.E2E_PORT} is not allowed: pick a free port other than 4317/5317`);

// Workers load this file too and inherit the runner's env, so only the runner makes (and later removes) the folder.
if (!process.env.E2E_SWARM_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-e2e-'));
  process.env.E2E_SWARM_HOME = home;
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
}

const { browser } = pickBrowser(process.env, installedBrowsers());

const chromium = {
  ...devices['Desktop Chrome'],
  ...(browser === 'chrome' ? { channel: 'chrome' } : {}),
  headless: true,
  viewport: { width: 800, height: 450 }, // fewer pixels for software WebGL to fill
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
};

export default defineConfig({
  testDir: 'e2e',
  // One demo office is shared by every test, and software WebGL is CPU-bound: run one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Software WebGL on a busy machine can drop to a few frames a second, and every screenshot waits for a frame.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // No screencast in the trace: it costs frames, and software WebGL has few to spare.
    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'only-on-failure',
  },
  // The first test into a fresh office walks through first-run setup (skip setup, the tour starts, the mouse is
  // grabbed): smoke.spec.ts runs first so that's the boot smoke, not whichever feature spec sorts first.
  projects: [
    { name: 'smoke', testMatch: 'smoke.spec.ts', use: chromium },
    { name: 'chromium', testIgnore: 'smoke.spec.ts', dependencies: ['smoke'], use: chromium },
  ],
  webServer: {
    command: webServerCommand(process.env),
    url: `http://127.0.0.1:${PORT}/api/state`,
    env: { SWARM_HOME: process.env.E2E_SWARM_HOME, SWARM_PORT: String(PORT) },
    // Never attach to a server that's already there: it could be someone's office.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
