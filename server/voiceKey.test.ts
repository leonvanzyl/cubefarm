import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

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
    swarm.updateSettings({ voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery', model: 'eleven_flash_v2_5', speakOffice: true } });

    const snap = swarm.snapshot();
    expect(snap).toMatchObject({ voiceKeySet: true, voiceKeyHint: '9876' });
    expect(snap.settings.voice.provider).toBe('elevenlabs');
    expect(JSON.stringify(snap)).not.toContain(key);
    expect(sent.some((m) => JSON.parse(m).type === 'settings')).toBe(true);
    expect(sent.some((m) => JSON.parse(m).type === 'voiceKey')).toBe(true);
    for (const m of sent) expect(m).not.toContain(key);
  });
});
