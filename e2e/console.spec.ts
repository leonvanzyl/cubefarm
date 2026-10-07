import { MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, phoneButton, startAt, test, type SavedView } from './helpers';

// The manager's console at the manager's desk.

// In the manager's office, just in front of the desk, looking down at the computer (-Z is north).
const AT_DESK: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };

test("the manager's console opens with E at its desk and closes with Esc", async ({ page }) => {
  await startAt(page, AT_DESK);
  await enterOffice(page);
  await expect(page.getByText("Open the manager's console")).toBeVisible(); // the crosshair hint
  await page.keyboard.press('e');
  const panel = page.getByText(/Manager's console/); // the panel's title; the hint and help text say "manager's"
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});

test('the Team tab adds agents of one kind, and Settings sizes the teams', async ({ page }) => {
  await startAt(page, AT_DESK);
  await enterOffice(page);
  await page.keyboard.press('e');
  await page.getByRole('tab', { name: /Team/ }).click();
  await expect(page.getByRole('button', { name: '+ Agent' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /QA tester|Developer/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /Settings/ }).click();
  await expect(page.getByLabel('Most agents per floor')).toHaveValue('10');
  const scaling = page.getByRole('radiogroup', { name: 'Team changes from the CEO' });
  await expect(scaling.getByRole('radio')).toHaveCount(2);
  await expect(scaling.getByRole('radio').first()).toBeChecked(); // I approve each one
});
