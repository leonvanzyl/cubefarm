import type { Page } from '@playwright/test';
import { EXPRESSIONS } from '../client/src/world/face';
import { enterOffice, expect, startAt, test } from './helpers';

// Characters' faces and looks (#207): blinks and expressions, and the look editor in an agent's ⚙️ Setup.

type Look = { hair: string; build: string };
type Person = { id: string; expression: string | null; lid: number; look: Look | null };
type Probe = { list: () => Person[]; express: (id: string, e: string, s?: number) => void };
const people = (page: Page) => page.evaluate(() => (window as unknown as { __swarmPeople: Probe }).__swarmPeople.list());
const person = async (page: Page, id: string) => (await people(page)).find((p) => p.id === id);

test('faces blink and change expression', async ({ page }) => {
  await startAt(page, { floor: 1, x: 0, z: 8, yaw: 0, pitch: 0 });
  await enterOffice(page);
  await expect.poll(async () => (await people(page)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  for (const p of await people(page)) {
    expect(EXPRESSIONS).toContain(p.expression);
    expect(p.look?.hair).toBeTruthy();
  }
  // someone on the floor blinks within a few seconds
  await expect.poll(async () => (await people(page)).some((p) => p.lid > 0.5), { message: 'a blink', timeout: 20_000, intervals: [50] }).toBe(true);
  const [{ id }] = await people(page);
  await page.evaluate((id) => (window as unknown as { __swarmPeople: Probe }).__swarmPeople.express(id, 'surprised', 30), id);
  await expect.poll(async () => (await person(page, id))?.expression).toBe('surprised');
});

test('a look picked in Setup shows on their character at once, and goes back to the seeded one', async ({ page, request }) => {
  await startAt(page, { floor: 1, x: 0, z: 8, yaw: 0, pitch: 0 });
  await enterOffice(page);
  // the demo's developers are busy as it opens: open one's panel from the list of who's working (this floor's come
  // first, after the CEO in the lobby); dispatched, as the first-run tour may sit over the list
  await page.locator('.wk-row').filter({ hasNotText: 'Morgan' }).first().dispatchEvent('click');
  await page.getByRole('button', { name: /Setup/ }).dispatchEvent('click');
  const editor = page.locator('.look-editor');
  await expect(editor.locator('.look-preview canvas')).toBeVisible();
  const hair = editor.locator('label.field').filter({ has: page.locator('span', { hasText: /^Hair$/ }) }).locator('select');
  const pick = (await hair.inputValue()) === 'bob' ? 'mohawk' : 'bob';
  await hair.selectOption(pick);
  // saved on the agent, and drawn (the probe reads the character, kept up to date under the panel)
  type Agent = { id: string; style: { hair?: string } | null };
  const styled = async () => ((await (await request.get('/api/state')).json()) as { agents: Agent[] }).agents.find((a) => a.style?.hair === pick);
  await expect.poll(async () => (await styled())?.id, { message: 'the pick saved' }).toBeTruthy();
  const { id } = (await styled())!;
  await expect.poll(async () => (await person(page, id))?.look?.hair).toBe(pick);
  await editor.getByRole('button', { name: /Back to their seeded look/ }).dispatchEvent('click');
  await expect.poll(async () => (await person(page, id))?.look?.hair).not.toBe(pick);
  const after = ((await (await request.get('/api/state')).json()) as { agents: Agent[] }).agents.find((a) => a.id === id);
  expect(after?.style).toBeNull();
});
