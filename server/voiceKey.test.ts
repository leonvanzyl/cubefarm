import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

// Its own folder: notifier.test.ts writes the same demo secrets file in the shared one, and two test processes
// renaming it at once fail on Windows.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-voicekey-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');
afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

// The ElevenLabs key goes in through PUT /api/voice/key and must never come back out: not in the snapshot, not in
// the settings broadcast, not in any event.
describe('the voice key', () => {
  it('never reaches the snapshot or a broadcast', async () => {
    const swarm = new Swarm(createDemoBackend());
    const sent: string[] = [];
    const ws = { OPEN: 1, readyState: 1, send: (m: string) => sent.push(m), on: () => undefined } as unknown as WebSocket;
    swarm.addClient(ws);

    const key = 'sk_demo_secret_key_9876';
    expect(await swarm.voice.setKey(key)).toEqual({ voiceKeySet: true, voiceKeyHint: '9876' });
    swarm.updateSettings({ voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', model: 'eleven_flash_v2_5', speakOffice: true, keepDays: 7 } });

    const snap = swarm.snapshot();
    expect(snap).toMatchObject({ voiceKeySet: true, voiceKeyHint: '9876' });
    expect(snap.settings.voice.provider).toBe('elevenlabs');
    expect(JSON.stringify(snap)).not.toContain(key);
    expect(sent.some((m) => JSON.parse(m).type === 'settings')).toBe(true);
    expect(sent.some((m) => JSON.parse(m).type === 'voiceKey')).toBe(true);
    for (const m of sent) expect(m).not.toContain(key);
  });
});
