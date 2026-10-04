import { type Page } from '@playwright/test';
import { enterOffice, expect, test } from './helpers';

// Talking instead of typing (docs/voice.md). Headless Chromium has no microphone: __swarmMic.fake() stands in for the
// browser's speech recognition and __swarmMic.say() is what it hears. The ElevenLabs route is checked over HTTP.

interface MicProbe {
  state: string;
  mode: string | null;
  live: boolean;
  history: { mode: string; outcome: string | null; start: number; end: number | null }[];
  fake(on?: boolean): void;
  say(text: string, final?: boolean): boolean;
}
type MicWindow = { __swarmMic: MicProbe };

const LISTEN = { provider: 'browser', autoSend: false, handsFree: false };

// One demo office serves every spec file: the browser's recognition for these tests, and everything back after.
test.beforeAll(async ({ request }) => {
  expect((await request.patch('/api/settings', { data: { listen: LISTEN } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { listen: LISTEN, voice: { provider: 'off' } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

const mic = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as MicWindow).__swarmMic;
    return { state: m.state, mode: m.mode, live: m.live, history: m.history.map((h) => ({ ...h })) };
  });
const say = (page: Page, text: string, final = true) => page.evaluate(([t, f]) => (window as unknown as MicWindow).__swarmMic.say(t, f), [text, final] as const);
const box = (page: Page) => page.locator('.chat-input textarea');

/** The office with the fake recognition, and the phone open on the CEO chat. */
async function phone(page: Page) {
  await enterOffice(page);
  await page.evaluate(() => (window as unknown as MicWindow).__swarmMic.fake());
  await page.keyboard.press('p');
  await expect(page.locator('.phone')).toBeVisible();
  if (!(await box(page).isVisible())) await page.locator('.phone-tab').first().click(); // it opens on Hires when someone waits there
  await expect(box(page)).toBeFocused();
}

async function managerTexts(page: Page): Promise<string[]> {
  const state = await (await page.request.get('/api/state')).json();
  return (state.messages as { from: string; text: string }[]).filter((m) => m.from === 'manager').map((m) => m.text);
}

test("holding V fills the phone's message box as you speak, a tap still types a 'v', and Send delivers it", async ({ page }) => {
  await phone(page);
  await page.keyboard.press('v');
  await expect(box(page)).toHaveValue('v');
  await box(page).fill('');

  await page.keyboard.down('v');
  await expect.poll(async () => (await mic(page)).live).toBe(true);
  expect(await mic(page)).toMatchObject({ state: 'listening', mode: 'hold' });
  await say(page, 'what is everyone working on', false);
  await expect(box(page)).toHaveValue('What is everyone working on'); // live, before it settles
  await say(page, 'what is everyone working on today');
  await page.keyboard.up('v');
  await expect.poll(async () => (await mic(page)).state).toBe('idle');
  await expect(box(page)).toHaveValue('What is everyone working on today');
  expect((await mic(page)).history.at(-1)?.outcome).toBe('filled');

  await page.locator('.chat-input').getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await managerTexts(page)).at(-1)).toBe('What is everyone working on today');
});

test('a tap of the 🎙️ listens until you stop talking, sends by itself with auto-send on, and Esc stops it', async ({ page }) => {
  await phone(page);
  const button = page.locator('.chat-input .mic-btn');

  await button.click();
  await expect.poll(async () => (await mic(page)).live).toBe(true);
  expect((await mic(page)).mode).toBe('tap');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await mic(page)).state).toBe('idle');
  await expect(box(page)).toBeVisible(); // Esc stopped the mic, not the phone

  await page.request.patch('/api/settings', { data: { listen: { ...LISTEN, autoSend: true } } });
  await button.click();
  await expect.poll(async () => (await mic(page)).live).toBe(true);
  await say(page, 'do we need anyone new');
  await expect.poll(async () => (await managerTexts(page)).at(-1), { timeout: 10_000 }).toBe('Do we need anyone new');
  const last = (await mic(page)).history.at(-1)!;
  expect(last.outcome).toBe('sent');
  await expect(box(page)).toHaveValue('');
  await page.request.patch('/api/settings', { data: { listen: LISTEN } });
});

test("hands-free: after the CEO's spoken reply the phone listens, and closes after 8 s of silence", async ({ page }) => {
  expect((await page.request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  await page.request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery' }, listen: { ...LISTEN, handsFree: true } } });
  await phone(page);
  await expect(page.getByRole('button', { name: /Hands-free on/ })).toBeVisible();

  await box(page).fill('How is floor 1 doing?');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await mic(page)).mode, { timeout: 60_000 }).toBe('handsfree');
  await expect.poll(async () => (await mic(page)).state, { timeout: 15_000 }).toBe('idle');
  const s = (await mic(page)).history.at(-1)!;
  expect(s).toMatchObject({ mode: 'handsfree', outcome: 'nothing' });
  expect(s.end! - s.start).toBeGreaterThanOrEqual(8000);
  expect(s.end! - s.start).toBeLessThan(10_000);
  await page.request.patch('/api/settings', { data: { voice: { provider: 'off' }, listen: LISTEN } });
});

test('a browser without speech recognition explains itself and listens to nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.webkitSpeechRecognition;
    delete w.SpeechRecognition;
  });
  await enterOffice(page);
  await page.keyboard.press('p');
  if (!(await box(page).isVisible())) await page.locator('.phone-tab').first().click();
  const button = page.locator('.chat-input .mic-btn');
  await expect(button).toHaveAttribute('title', /can't turn speech into text/);
  await button.click();
  await expect(page.getByText(/can't turn speech into text/).first()).toBeVisible();
  expect((await mic(page)).state).not.toBe('listening');
});

test('the ElevenLabs route refuses what it should, in plain words, and never shows the key', async ({ request }) => {
  const clip = (bytes: number, ms = 2000) => request.post('/api/voice/transcribe', { headers: { 'Content-Type': 'audio/webm;codecs=opus', 'X-Clip-Ms': String(ms) }, data: Buffer.alloc(bytes, 1) });

  expect((await clip(10_000)).status()).toBe(409); // the browser is the provider
  await request.patch('/api/settings', { data: { listen: { ...LISTEN, provider: 'elevenlabs' } } });
  await request.put('/api/voice/key', { data: { key: '' } });
  const noKey = await clip(10_000);
  expect(noKey.status()).toBe(409);
  expect((await noKey.json()).error).toMatch(/Add your ElevenLabs API key/);

  const key = 'sk_e2e_secret_key_5150';
  expect((await request.put('/api/voice/key', { data: { key } })).ok()).toBe(true);
  const ok = await clip(10_000);
  expect(await ok.json()).toEqual({ text: "What's everyone working on?" }); // the demo's Speech to Text
  expect((await clip(6 * 1024 * 1024)).status()).toBe(413);
  expect((await clip(10_000, 90_000)).status()).toBe(413);
  expect(JSON.stringify(await (await request.get('/api/state')).json())).not.toContain(key);
  await request.patch('/api/settings', { data: { listen: LISTEN } });
});
