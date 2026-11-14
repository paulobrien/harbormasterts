import { expect, test } from '@playwright/test';
import { syntheticGame } from './fixtures';

test('loads a bundled game, saves a paused shift, and resumes after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Continue shift/ }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('settings persist when the game bundle is unavailable', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.locator('#choose-label')).toBeVisible();
  await page.getByRole('button', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel(/Music volume/).focus();
  await dialog.getByLabel(/Music volume/).press('Home');
  await dialog.getByLabel('Auto Docking').uncheck();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(dialog.getByLabel(/Music volume/)).toHaveValue('0');
  await expect(dialog.getByLabel('Auto Docking')).not.toBeChecked();
});
