import { expect, test } from '@playwright/test';
import { fingerprintLevel } from '../../src/shift-save';
import { syntheticGame, syntheticLevel } from './fixtures';

test('a drawn route delivers cargo through the browser canvas', async ({ page, context }, testInfo) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  // Start a stationary boat near the dock so input setup cannot race the
  // animation. The saved speed is restored before the delivery below.
  await page.evaluate(fingerprint => {
    localStorage.setItem('harbor-auto-dock', '0');
    localStorage.setItem('harbor-master-saved-shift-v1', JSON.stringify({
      version: 1, levelFingerprint: fingerprint, shiftId: 'browser-route',
      score: 0, nextId: 1, elapsed: 0, spawnIn: 0, lastWarning: 0,
      pressure: { phase: 0, phaseElapsed: 0, spawnElapsed: 0, threshold: 0.25 },
      activePacing: { from: 0, interval: 9999, maxSmall: 1, maxMedium: 0, maxLarge: 0 },
      ships: [{ id: 0, x: 430, y: 334, angle: 0, speed: 0, size: 0,
        cargoType: 0, cargo: 1, state: 'sailing', path: [], dockIndex: null,
        targetDockIndex: null, unloadTime: 0, entered: true }],
    }));
  }, fingerprintLevel(syntheticLevel));
  await page.reload();
  await page.getByRole('button', { name: /Continue shift/ }).click();
  const canvas = page.getByLabel('Treasure Island harbor game');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  const point = (x: number, y: number) => ({ x: box.x + x / 1024 * box.width, y: box.y + y / 768 * box.height });
  const start = point(430, 334);
  const end = point(502, 334);
  if (testInfo.project.name === 'desktop') {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
  } else {
    // CDP produces a real touch pointer sequence in Chromium's device profiles.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('harbor-master-saved-shift-v1') || '{}'));
  expect(saved.ships[0].targetDockIndex).toBe(0);
  await page.getByRole('button', { name: 'Back to harbor' }).click();
  await page.evaluate(() => {
    const key = 'harbor-master-saved-shift-v1';
    const shift = JSON.parse(localStorage.getItem(key) || '{}');
    shift.ships[0].speed = 40;
    localStorage.setItem(key, JSON.stringify(shift));
  });
  await page.reload();
  await page.getByRole('button', { name: /Continue shift/ }).click();
  await expect(page.locator('#score')).toHaveText('1', { timeout: 8000 });
});
