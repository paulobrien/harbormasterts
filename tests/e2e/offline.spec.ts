import { expect, test } from '@playwright/test';
import { syntheticGame } from './fixtures';

test('reopens the installed shell and saved game files offline', async ({ page, context }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // The second load must use IndexedDB, not the test's network response.
  await page.unroute('**/game/harbor-hd-assets.zip');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await expect(page.getByLabel('Treasure Island harbor game')).toBeVisible();
});
