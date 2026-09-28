import os from 'node:os';
import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts, whose root is client/, so tests in server/, shared/ and scripts/ are found too.
export default defineConfig({
  test: {
    root: '.',
    include: ['{client,server,shared,scripts}/**/*.test.{ts,tsx}'],
    // e2e/ is Playwright's (npm run test:e2e): it needs a browser and a running demo office.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'node',
    // Anything a test imports must never see the live office's state (~/.cubefarm) or its ports.
    env: { SWARM_HOME: path.join(os.tmpdir(), `cubefarm-vitest-${process.pid}`), SWARM_PORT: '0' },
  },
});
