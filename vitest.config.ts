import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts, whose root is client/, so tests in server/ and shared/ are found too.
export default defineConfig({
  test: {
    root: '.',
    include: ['{client,server,shared}/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Anything a test imports must never see the live office's state (~/.office-swarm) or its ports.
    env: { SWARM_HOME: path.join(os.tmpdir(), `office-swarm-vitest-${process.pid}`), SWARM_PORT: '0' },
  },
});
