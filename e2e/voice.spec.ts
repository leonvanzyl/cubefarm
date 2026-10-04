import { test as base, expect, type Page } from '@playwright/test';
import { CEO_ID } from '../shared/types';

// Messages read aloud (docs/voice.md), with the demo's fake ElevenLabs: a CEO reply is spoken without opening the
// phone, the voice slider and M (mute) apply, two messages play one after the other, and a reload stays silent.

interface Spoken {
  id: number;
  provider: string;
  start: number;
  end: number | null;
  volume: number;
}

const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    await page.route(
      (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
      (route) => route.fulfill({ status: 200, body: '' }),
    );
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    });
    await use(page);
    expect(problems, 'console errors or failed requests').toEqual([]);
  },
});

// One demo office serves every spec file: turn the voice on for these tests only.
test.beforeAll(async ({ request }) => {
  expect((await request.put('/api/voice/key', { data: { key: 'demo-voice-key-1234' } })).ok()).toBe(true);
  expect((await request.patch('/api/settings', { data: { voice: { provider: 'elevenlabs', voiceId: 'demoVoiceAvery00001', voiceName: 'Avery' } } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.patch('/api/settings', { data: { voice: { provider: 'off' } } });
  await request.put('/api/voice/key', { data: { key: '' } });
});

/** Loads the office and walks in: that click is also what lets the page play sound. */
async function enterOffice(page: Page) {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter the office' });
  const skipSetup = page.getByRole('button', { name: /skip setup/i });
  await expect(enter.or(skipSetup)).toBeVisible();
  if (await skipSetup.isVisible()) await skipSetup.click();
  else {
    await expect(enter).toBeEnabled();
    await enter.click();
  }
  await expect(page.getByTitle('Your phone (P)')).toBeVisible();
}

const spoken = (page: Page) => page.evaluate(() => ((window as unknown as { __swarmVoice?: Spoken[] }).__swarmVoice ?? []).map((s) => ({ ...s })));

/** Texts the CEO and returns the ids of the CEO's messages so far, to tell new replies from old. */
async function ceoIds(page: Page): Promise<number[]> {
  const state = await (await page.request.get('/api/state')).json();
  return (state.messages as { id: number; from: string }[]).filter((m) => m.from === 'ceo').map((m) => m.id);
}

async function textCeo(page: Page, text: string) {
  expect((await page.request.post('/api/ceo/message', { data: { text } })).ok()).toBe(true);
}

/** Waits until every message in `ids` has been read aloud and finished. */
async function heard(page: Page, ids: number[]): Promise<Spoken[]> {
  await expect.poll(async () => (await spoken(page)).filter((s) => ids.includes(s.id) && s.end !== null).length, { timeout: 30_000 }).toBe(ids.length);
  return (await spoken(page)).filter((s) => ids.includes(s.id));
}

/** The CEO's replies after `before`, once there are `n` of them. */
async function newReplies(page: Page, before: number[], n: number): Promise<number[]> {
  let ids: number[] = [];
  await expect
    .poll(
      async () => {
        ids = (await ceoIds(page)).filter((id) => !before.includes(id));
        return ids.length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(n);
  return ids;
}

test("a CEO reply is read aloud without opening the phone, and the voice slider and M apply", async ({ page }) => {
  await enterOffice(page);

  let before = await ceoIds(page);
  await textCeo(page, 'How is it going?');
  const [first] = await newReplies(page, before, 1);
  const [rec] = await heard(page, [first]);
  expect(rec.provider).toBe('elevenlabs');
  expect(rec.end! - rec.start).toBeGreaterThan(100); // the demo's chime lasts at least 0.4 s
  expect(rec.volume).toBeGreaterThan(0);
  await expect(page.locator('.phone-overlay')).toHaveCount(0);

  // The Voice slider: half way is a quarter of the gain (slider levels are squared).
  await page.keyboard.press('h');
  const slider = page.getByRole('slider', { name: 'Voice volume' });
  await expect(slider).toBeVisible();
  await slider.fill('50');
  await page.keyboard.press('Escape');
  before = await ceoIds(page);
  await textCeo(page, 'And the voice slider?');
  const [second] = await newReplies(page, before, 1);
  const [quieter] = await heard(page, [second]);
  expect(quieter.volume).toBeCloseTo(rec.volume / 4, 5);

  // M mutes the voice too.
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cubefarm:audio') ?? '{}').muted)).toBe(true);
  before = await ceoIds(page);
  await textCeo(page, 'Can you hear me now?');
  const [third] = await newReplies(page, before, 1);
  const [muted] = await heard(page, [third]);
  expect(muted.volume).toBe(0);
  await page.keyboard.press('m');
  await page.evaluate(() => localStorage.removeItem('cubefarm:audio'));
});

test('two quick messages play one after the other, and a reload reads nothing again', async ({ page }) => {
  await enterOffice(page);
  const before = await ceoIds(page);
  // The first starts a CEO session; the second reaches it while it works and gets its own reply (queued texts would
  // be merged into one job).
  await textCeo(page, 'First question');
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).agents.find((a: { id: string }) => a.id === CEO_ID)?.status, { timeout: 30_000 }).toBe('working');
  await textCeo(page, 'Second question');
  const ids = (await newReplies(page, before, 2)).slice(0, 2);
  const [a, b] = (await heard(page, ids)).sort((x, y) => x.start - y.start);
  expect([a.id, b.id]).toEqual([...ids].sort((x, y) => x - y));
  expect(b.start).toBeGreaterThanOrEqual(a.end!);

  await page.reload();
  await enterOffice(page);
  await page.waitForTimeout(2000); // long enough for a replayed message to start
  expect(await spoken(page)).toEqual([]);
});

test('with two office tabs open, each message is read in only one of them', async ({ page, baseURL }) => {
  const other = await page.context().newPage();
  await other.route(
    (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
    (route) => route.fulfill({ status: 200, body: '' }),
  );
  await enterOffice(page);
  await enterOffice(other);
  const before = await ceoIds(page);
  await textCeo(page, 'Who answers?');
  const [id] = await newReplies(page, before, 1);
  const readIn = async () => (await spoken(page)).some((s) => s.id === id && s.end !== null) || (await spoken(other)).some((s) => s.id === id && s.end !== null);
  await expect.poll(readIn, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(1000); // a second tab, if it wrongly spoke too, has started by now
  const count = (await spoken(page)).filter((s) => s.id === id).length + (await spoken(other)).filter((s) => s.id === id).length;
  expect(count).toBe(1);
  await other.close();
});
