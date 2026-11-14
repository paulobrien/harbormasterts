import { expect, test } from '@playwright/test';
import { syntheticGame } from './fixtures';

test('a keyboard user can import game files when no bundle is available', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  const addFiles = page.getByRole('button', { name: /Add game files/ });
  await expect(addFiles).toBeVisible();
  await addFiles.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'synthetic.ipa', mimeType: 'application/zip', buffer: syntheticGame() });
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
});

test('a failed replacement preserves the existing files and paused shift', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Back to harbor' }).click();
  await expect(page.getByRole('button', { name: /Continue shift/ })).toBeVisible();

  const change = page.getByRole('button', { name: 'Choose a different game file' });
  await expect(change).toBeVisible();
  let chooser = page.waitForEvent('filechooser');
  await change.click();
  await (await chooser).setFiles({ name: 'broken.ipa', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await expect(page.getByRole('status').first()).toContainText('Could not open this IPA');
  await expect(page.getByRole('button', { name: /Continue shift/ })).toBeVisible();
  chooser = page.waitForEvent('filechooser');
  await change.click();
  await (await chooser).setFiles({ name: 'bad.ipa', mimeType: 'application/zip', buffer: syntheticGame('not a valid level') });
  await expect(page.getByRole('status').first()).toContainText('does not contain any docks');
  await expect(page.getByRole('button', { name: /Continue shift/ })).toBeVisible();
  await page.unroute('**/game/harbor-hd-assets.zip');
  await page.reload();
  await page.getByRole('button', { name: /Continue shift/ }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
});
