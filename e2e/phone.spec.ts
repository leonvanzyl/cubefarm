import { enterOffice, expect, phoneButton, test } from './helpers';

// The phone: opening and closing it.

test('the phone opens and closes with P, its button and Esc', async ({ page }) => {
  await enterOffice(page);
  const team = page.getByRole('tab', { name: /Team/ }); // one of the phone's tabs
  const company = page.getByRole('tab', { name: /Company/ });
  await page.keyboard.press('p');
  await expect(team).toBeVisible();
  await expect(phoneButton(page)).toBeHidden();
  // The chat focuses its message box, where P types a "p"; from another tab P puts the phone away.
  await company.click();
  await expect(company).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('p');
  await expect(team).toBeHidden();

  // Closing a panel grabs the mouse again (#42); a locked pointer can't click the HUD, so let go of it first. The lock
  // request is async: wait for it to land (or be refused) before letting go, or it lands after and eats the click.
  await page
    .waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 3000 })
    .catch(() => undefined);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null);
  // Clicks are also ignored for a moment after a panel closes (so a double click can't act through it): retry.
  await expect(async () => {
    await phoneButton(page).click();
    await expect(team).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press('Escape');
  await expect(team).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});
