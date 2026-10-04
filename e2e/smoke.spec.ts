import { canvasColours, enterOffice, expect, test } from './helpers';

// Smoke tests against the demo office: the API answers, it loads without errors, you can walk in and the 3D view
// renders. Only the core boot lives here: each feature's tests go in their own spec file (helpers.ts has the setup).
// Pointer lock may not work headless, so nothing in e2e/ depends on it.

test('/api/state returns JSON with floors', async ({ request }) => {
  const res = await request.get('/api/state');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('application/json');
  const state = await res.json();
  expect(state.demo).toBe(true);
  expect(state.repos.length).toBeGreaterThan(0);
  for (const repo of state.repos) expect(repo.floor).toBeGreaterThan(0);
  expect(state.agents.length).toBeGreaterThan(0);
});

test('the office loads, you can walk in and the 3D view renders', async ({ page }) => {
  await enterOffice(page);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  // A blank or failed WebGL canvas is one flat colour; the lobby has walls, furniture, people and signs.
  // Polled because the first frames can still be empty while the scene loads.
  await expect
    .poll(
      async () => {
        const { colours, topShare } = await canvasColours(page);
        return topShare < 0.9 ? colours : 0; // one colour covering nearly everything counts as blank
      },
      { message: 'distinct colours in the canvas', timeout: 90_000 },
    )
    .toBeGreaterThan(200);
});
