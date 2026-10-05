import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { STATE_FILE } from './config.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// The state file is written through one temp file: a save that starts while another is still writing (the debounced
// save, then shutdown or an office update) has to wait for it, or one of them renames a temp file that's gone.
describe('the state file', () => {
  it('survives saves that overlap', async () => {
    const swarm = new Swarm(createDemoBackend()) as unknown as { writeState(): Promise<void> };
    await expect(Promise.all(Array.from({ length: 8 }, () => swarm.writeState()))).resolves.toHaveLength(8);
    expect(JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))).toHaveProperty('agents');
  });
});
