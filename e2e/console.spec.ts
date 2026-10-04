import { MANAGER_DESK } from '../client/src/world/layout';
import { enterOffice, expect, phoneButton, startAt, test, type SavedView } from './helpers';

// The manager's console at the manager's desk.

test("the manager's console opens with E at its desk and closes with Esc", async ({ page }) => {
  // Start in the manager's office, just in front of the desk, looking down at the computer (-Z is north).
  const spot: SavedView = { floor: 0, x: MANAGER_DESK.x, z: MANAGER_DESK.z + MANAGER_DESK.d / 2 + 0.8, yaw: 0, pitch: -0.6 };
  await startAt(page, spot);
  await enterOffice(page);
  await expect(page.getByText("Open the manager's console")).toBeVisible(); // the crosshair hint
  await page.keyboard.press('e');
  const panel = page.getByText(/Manager's console/); // the panel's title; the hint and help text say "manager's"
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});
