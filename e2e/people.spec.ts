import { surfaceAt } from '../client/src/world/layout';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// The people walking around the office: getting up, walking, chatting and their sounds.

test('people get up with a chair creak, walk over with footsteps for the floor, chat and move a sticky', async ({ page }) => {
  // Floor 1, on the open wood floor between the front desk row and the elevator.
  const spot: SavedView = { floor: 1, x: -4, z: 6, yaw: 0, pitch: 0 };
  await startAt(page, spot);
  await enterOffice(page);
  // window.__swarmPeople (world/people.ts) moves people by hand
  const people = (fn: 'list' | 'walkTo' | 'gesture', ...args: (string | number)[]) =>
    page.evaluate(([f, a]) => (window as unknown as { __swarmPeople: Record<string, (...x: unknown[]) => unknown> }).__swarmPeople[f](...a), [fn, args] as const);
  const ids = async () => ((await people('list')) as { id: string }[]).map((p) => p.id);
  await expect.poll(async () => (await ids()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const [a, b] = await ids();

  // The probe keeps only the last 50 sounds: gather what's been heard as it comes.
  type Rec = { name: string; group: string | null; at: { x: number; y: number; z: number } | null; t: number };
  const heard = new Map<string, Rec>();
  const listen = async () => {
    for (const r of await page.evaluate(() => (window as unknown as { __swarmSfx: Rec[] }).__swarmSfx)) heard.set(`${r.name}@${r.t}`, r);
    return [...heard.values()];
  };
  const names = async () => new Set((await listen()).map((r) => r.name));

  await people('walkTo', a, spot.x - 0.6, spot.z - 1.5);
  await people('walkTo', b, spot.x + 0.6, spot.z - 1.5);
  for (const name of ['chair:creak', 'chair:roll', 'chat:blah']) {
    await expect.poll(async () => (await names()).has(name), { message: `${name} in __swarmSfx`, timeout: 90_000, intervals: [250] }).toBe(true);
  }
  const steps = (await listen()).filter((r) => r.name.startsWith('step:') && r.name !== 'step:scuff');
  expect(steps.length).toBeGreaterThan(0);
  for (const s of steps) {
    expect(s.group).toBe('steps');
    expect(s.name).toBe(`step:${surfaceAt('office', s.at!.x, s.at!.z)}`); // the voice for the floor under their feet
  }
  const chat = (await listen()).find((r) => r.name === 'chat:blah')!;
  expect(chat.group).toBe('typing');
  expect(Math.abs(chat.at!.z - (spot.z - 1.5))).toBeLessThan(0.5); // from where they stand together

  await people('gesture', a, 'reach');
  await expect.poll(async () => (await names()).has('sticky:peel'), { timeout: 30_000, intervals: [250] }).toBe(true);
  await people('gesture', a, 'none');
  await expect.poll(async () => (await names()).has('sticky:slap'), { timeout: 30_000, intervals: [250] }).toBe(true);
});
