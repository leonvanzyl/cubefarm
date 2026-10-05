import { enterOffice, expect, startAt, test, type SavedView } from './helpers';

// Shared presence: two tabs on one office see each other (window.__swarmPresence, world/presence/presenceState.ts).

type Win = {
  __swarmPresence: {
    me(): { id: string };
    roster(): { id: string; floor: number }[];
    visible(): { id: string; x: number | null; held: { k: string } | null }[];
    lastEmote(): { id: string; e: string } | null;
    pings(): { label: string; mine: boolean }[];
    fakes(n: number): void;
    appear(on: boolean): void;
    emote(e: string): void;
    ping(x: number, y: number, z: number, label?: string): void;
    follow(id: string): boolean;
    following(): string | null;
  };
  __swarmGiveMug(sips: number): void;
};

test('two tabs see each other, wave, ping, follow, and "Appear to others" off takes you away', async ({ page, baseURL }) => {
  const spot: SavedView = { floor: 1, x: 2, z: 9.6, yaw: 0.2, pitch: -0.1 };
  const other = await page.context().newPage();
  await other.route(
    (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
    (route) => route.fulfill({ status: 200, body: '' }),
  );
  await startAt(page, spot);
  await startAt(other, { ...spot, x: 0.5, z: 5, yaw: Math.PI });
  await enterOffice(page);
  await enterOffice(other);
  await page.evaluate(() => (window as unknown as Win).__swarmPresence.fakes(0)); // just the two tabs

  const them = await other.evaluate(() => (window as unknown as Win).__swarmPresence.me().id);
  expect(them).toBeTruthy();
  const seen = () => page.evaluate((id) => (window as unknown as Win).__swarmPresence.visible().find((v) => v.id === id) ?? null, them);
  await expect.poll(async () => (await seen())?.x ?? null, { timeout: 20_000 }).not.toBeNull();

  await other.evaluate(() => (window as unknown as Win).__swarmPresence.emote('wave'));
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__swarmPresence.lastEmote()?.e ?? null)).toBe('wave');
  await other.evaluate(() => (window as unknown as Win).__swarmPresence.ping(0, 0, 7, 'here'));
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__swarmPresence.pings().some((p) => !p.mine && p.label === 'here'))).toBe(true);

  await other.evaluate(() => (window as unknown as Win).__swarmGiveMug(3));
  await expect.poll(async () => (await seen())?.held?.k ?? null).toBe('mug');

  await page.evaluate((id) => (window as unknown as Win).__swarmPresence.follow(id), them);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__swarmPresence.following())).toBe(them);

  await other.evaluate(() => (window as unknown as Win).__swarmPresence.appear(false));
  await expect.poll(() => page.evaluate((id) => (window as unknown as Win).__swarmPresence.roster().some((v) => v.id === id), them), { timeout: 1000 }).toBe(false);
  await page.evaluate(() => (window as unknown as Win).__swarmPresence.fakes(2));
  await other.close();
});
