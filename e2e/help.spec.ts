import { enterOffice, expect, phoneButton, test } from './helpers';

// The help panel.

test('H opens help and Esc closes it', async ({ page }) => {
  await enterOffice(page);
  const help = page.getByText('How the office works', { exact: true });
  await page.keyboard.press('h');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(phoneButton(page)).toBeVisible();
});
