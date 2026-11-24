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
  expect(saved.ships[0].path.length).toBeGreaterThanOrEqual(9);
  expect(saved.ships[0].path.at(-2)).toEqual({ x: 510, y: 334 });
  expect(saved.ships[0].path.at(-1)).toEqual({ x: 512, y: 334 });
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

test('a mixed-cargo boat can unload and continue to a second dock', async ({ page, context }, testInfo) => {
  const level = `${syntheticLevel}dockElement\n800 434\n0\n0\n1\n1\n1\n`;
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(level),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  await page.evaluate(fingerprint => {
    localStorage.setItem('harbor-auto-dock', '0');
    localStorage.setItem('harbor-master-saved-shift-v1', JSON.stringify({
      version: 1, levelFingerprint: fingerprint, shiftId: 'mixed-browser',
      score: 0, nextId: 1, elapsed: 0, spawnIn: 0, lastWarning: 0,
      pressure: { phase: 0, phaseElapsed: 0, spawnElapsed: 0, threshold: 1 },
      activePacing: { from: 0, interval: 9999, maxSmall: 1, maxMedium: 0, maxLarge: 0 },
      ships: [{ id: 0, x: 512, y: 334, angle: 0, speed: 100, size: 1,
        cargoType: 0, cargo: 2, cargoSlots: [0, 1], state: 'unloading', path: [],
        dockIndex: 0, targetDockIndex: null, unloadTime: .1, entered: true }],
    }));
  }, fingerprintLevel(level));
  await page.reload();
  await page.getByRole('button', { name: /Continue shift/ }).click();
  await expect(page.locator('#score')).toHaveText('1');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const partial = await page.evaluate(() => JSON.parse(localStorage.getItem('harbor-master-saved-shift-v1') || '{}'));
  expect(partial.ships[0].state).toBe('waiting');
  expect(partial.ships[0].cargoSlots).toEqual([null, 1]);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  const box = await page.getByLabel('Treasure Island harbor game').boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  const point = (x: number, y: number) => ({x: box.x + x / 1024 * box.width, y: box.y + y / 768 * box.height});
  const start = point(512, 334), end = point(790, 334);
  if (testInfo.project.name === 'desktop') {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, {steps: 4}); await page.mouse.up();
  } else {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[start]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[end]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await cdp.detach();
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const routed = await page.evaluate(() => JSON.parse(localStorage.getItem('harbor-master-saved-shift-v1') || '{}'));
  expect(routed.ships[0].targetDockIndex).toBe(1);
  expect(routed.ships[0].dockIndex).toBeNull();
  expect(routed.ships[0].cargoSlots).toEqual([null, 1]);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#score')).toHaveText('2', {timeout: 10000});
});

test('dragging to a dock across an island stops at the shore', async ({ page, context }, testInfo) => {
  // The square island is synthetic; the dock sits on its left-hand shore.
  const level = `${syntheticLevel}landElement\n4\n0 100\n100 100\n100 0\n0 0\n`;
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(level),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  await page.evaluate(fingerprint => {
    localStorage.setItem('harbor-auto-dock', '0');
    localStorage.setItem('harbor-master-saved-shift-v1', JSON.stringify({
      version: 1, levelFingerprint: fingerprint, shiftId: 'shoreline-browser',
      score: 0, nextId: 1, elapsed: 0, spawnIn: 0, lastWarning: 0,
      pressure: {phase: 0, phaseElapsed: 0, spawnElapsed: 0, threshold: 1},
      activePacing: {from: 0, interval: 9999, maxSmall: 1, maxMedium: 0, maxLarge: 0},
      ships: [{id: 0, x: 700, y: 334, angle: Math.PI, speed: 0, size: 0,
        cargoType: 0, cargo: 1, state: 'sailing', path: [], dockIndex: null,
        targetDockIndex: null, unloadTime: 0, entered: true}],
    }));
  }, fingerprintLevel(level));
  await page.reload();
  await page.getByRole('button', {name: /Continue shift/}).click();
  const box = await page.getByLabel('Treasure Island harbor game').boundingBox();
  if (!box) throw new Error('Game canvas is not visible');
  const point = (x: number, y: number) => ({x: box.x + x / 1024 * box.width, y: box.y + y / 768 * box.height});
  const start = point(700, 334), end = point(512, 334);
  if (testInfo.project.name === 'desktop') {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y); await page.mouse.up();
  } else {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [end]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await cdp.detach();
  }
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('harbor-master-saved-shift-v1') || '{}'));
  expect(saved.ships[0].targetDockIndex).toBeNull();
  expect(saved.ships[0].path.length).toBeGreaterThan(0);
  expect(saved.ships[0].path.at(-1).x).toBeGreaterThanOrEqual(611.99);
});
