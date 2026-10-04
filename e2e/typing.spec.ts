import { MAX_DESKS, QA_LAB } from '../client/src/world/layout';
import { keyboardSpot } from '../client/src/world/typing';
import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// Typing and mouse clicks from working agents' desks.

test("working agents type at their desks, and stop while a panel covers the view", async ({ page }) => {
  // The middle of floor 1, where the demo's developers are busy.
  const spot: SavedView = { floor: 1, x: 0, z: -7, yaw: 0, pitch: 0.15 };
  await startAt(page, spot);
  await enterOffice(page);
  const entered = await page.evaluate(() => performance.now());
  type Vec = { x: number; y: number; z: number };
  type Entry = { name: string; group: string; at: Vec | null; played: boolean; from: Vec | null; t: number };
  const typing = () => page.evaluate(() => ((window as unknown as { __swarmTyping?: Entry[] }).__swarmTyping ?? []).filter((e) => e.group === 'typing'));
  await expect.poll(async () => (await typing()).filter((e) => e.t > entered).length, { message: 'typing sounds', timeout: 60_000 }).toBeGreaterThan(0);
  // Every keystroke comes from someone's keyboard or mouse on this floor.
  const desks = [
    ...Array.from({ length: MAX_DESKS }, (_, slot) => ({ role: 'dev' as const, slot })),
    ...QA_LAB.stations.map((_, slot) => ({ role: 'qa' as const, slot })),
  ].flatMap(({ role, slot }) => [false, true].map((mouse) => keyboardSpot(role, slot, mouse, { x: 0, y: 0, z: 0 })));
  for (const e of await typing()) expect(desks.some((d) => Math.hypot(d.x - e.at!.x, d.y - e.at!.y, d.z - e.at!.z) < 1e-6)).toBe(true);
  // Right after Enter (typists picked behind the start screen), each sound that plays comes from its keyboard,
  // not a panner left at the origin. Headless audio may be unavailable: then nothing plays and `from` stays null.
  for (const e of await typing()) if (e.played && e.from) expect(Math.hypot(e.from.x - e.at!.x, e.from.y - e.at!.y, e.from.z - e.at!.z)).toBeLessThan(1e-3);
  await expect(page.getByText('Open the Kanban board')).toBeVisible(); // the crosshair hint
  await page.keyboard.press('e'); // the Kanban board covers the view
  await expect(page.getByText(/In progress/).first()).toBeVisible();
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => performance.now());
  await page.waitForTimeout(1500);
  expect((await typing()).filter((e) => e.t > before)).toEqual([]);
  await page.keyboard.press('Escape');

  // A typist who gets up and walks away leaves their desk quiet.
  const resumed = await page.evaluate(() => performance.now());
  const here = new Set(await page.evaluate(() => (window as unknown as { __swarmPeople: { list: () => { id: string }[] } }).__swarmPeople.list().map((p) => p.id)));
  const spotsOf = (desk: number) => [false, true].map((mouse) => keyboardSpot('dev', desk, mouse, { x: 0, y: 0, z: 0 }));
  const atDesk = (e: Entry, desk: number) => spotsOf(desk).some((d) => Math.hypot(d.x - e.at!.x, d.y - e.at!.y, d.z - e.at!.z) < 1e-6);
  type AgentRow = { id: string; role: string; desk: number; status: string };
  let typist: AgentRow | undefined;
  await expect
    .poll(
      async () => {
        const { agents } = (await (await page.request.get('/api/state')).json()) as { agents: AgentRow[] };
        const recent = (await typing()).filter((e) => e.t > resumed);
        typist = agents.find((a) => a.role === 'dev' && a.status === 'working' && here.has(a.id) && recent.some((e) => atDesk(e, a.desk)));
        return typist?.id ?? null;
      },
      { message: 'someone typing at their desk', timeout: 30_000, intervals: [250] },
    )
    .not.toBeNull();
  const { id, desk } = typist!;
  await page.evaluate(([who, x, z]) => (window as unknown as { __swarmPeople: { place: (id: string, x: number, z: number) => void } }).__swarmPeople.place(who, x, z), [id, spot.x + 1, spot.z + 3] as const);
  await page.waitForTimeout(1000);
  const left = await page.evaluate(() => performance.now());
  // The log keeps only the last few dozen sounds: gather what's heard as it comes.
  const heard: Entry[] = [];
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    for (const e of await typing()) if (e.t > left && atDesk(e, desk)) heard.push(e);
  }
  expect(heard).toEqual([]);
});
