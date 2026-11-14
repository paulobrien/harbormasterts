import { expect, test } from '@playwright/test';
import { syntheticGame } from './fixtures';

test('the game stays usable when browser preference and shift storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage is blocked', 'SecurityError'); },
    });
  });
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  await expect(page.getByText('Settings, scores and shift progress cannot be saved on this device.')).toBeVisible();
  await page.getByRole('button', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Auto Docking').uncheck();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#overlay-text')).toContainText('could not be saved');
  expect(errors).toEqual([]);
});

test('a game can still start when imported files cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() { throw new DOMException('Storage is blocked', 'SecurityError'); },
    });
  });
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('could not save the game files');
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
});

test('storage quota failures leave settings and the current shift usable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  });
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Auto Docking').uncheck();
  await expect(dialog.getByText('Changes will work for this visit, but cannot be saved on this device.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#overlay-text')).toContainText('could not be saved');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
});
