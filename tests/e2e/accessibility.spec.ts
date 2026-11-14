import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { syntheticGame } from './fixtures';

async function expectReadableText(page: Page) {
  const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const violations = result.violations.map(violation => ({
    id: violation.id,
    nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
  }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function focusAppearance(control: Locator, surface: string) {
  return control.evaluate((element, surfaceSelector) => {
    const style = getComputedStyle(element);
    const background = getComputedStyle(document.querySelector(surfaceSelector)!).backgroundColor;
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const first = luminance(style.outlineColor);
    const second = luminance(background);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      contrast: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
    };
  }, surface);
}

async function expectFocus(control: Locator, surface: string) {
  await expect(control).toBeFocused();
  const appearance = await focusAppearance(control, surface);
  expect(appearance.visible).toBe(true);
  expect(appearance.style).toBe('solid');
  expect(appearance.width).toBeGreaterThanOrEqual(2);
  expect(appearance.contrast).toBeGreaterThanOrEqual(3);
}

test('home and settings text meets contrast requirements', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({ status: 404 }));
  await page.addInitScript(() => localStorage.setItem('harbor-treasure-island-stats-v1', JSON.stringify({
    shifts: 3, totalCargo: 21, best: 10,
  })));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Add game files/ })).toBeVisible();
  await expect(page.getByRole('status').first()).toContainText('Add your game files');
  await expect(page.getByLabel('Treasure Island statistics')).toBeVisible();
  await expectReadableText(page);
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expectReadableText(page);
});

test('game and pause controls meet contrast requirements', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  await expectReadableText(page);
  await page.getByRole('button', { name: 'Fast forward' }).click();
  await expectReadableText(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expectReadableText(page);
});

test('keyboard focus is visible on home controls and settings inputs', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  const add = page.getByRole('button', { name: /Add game files/ });
  await expect(add).toBeVisible();
  await page.keyboard.press('Tab');
  await expectFocus(add, '.welcome');
  await page.getByRole('button', { name: /Settings/ }).focus();
  await page.keyboard.press('Enter');
  const music = page.getByLabel(/Music volume/);
  await music.focus();
  await expectFocus(music, '.settings-dialog');
});

test('keyboard focus is visible on the dark game bar and light pause panel', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  const play = page.getByRole('button', { name: /Play Treasure Island/ });
  await expect(play).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(play).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const music = page.getByRole('button', { name: 'Mute music' });
  await expectFocus(music, '.game-bar');
  const speed = page.getByRole('button', { name: 'Fast forward' });
  await speed.focus();
  await expectFocus(speed, '.game-bar');
  await page.keyboard.press('Space');
  await expect(speed).toHaveAttribute('aria-pressed', 'true');
  await expectFocus(speed, '.game-bar');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await pause.focus();
  await page.keyboard.press('Enter');
  const resume = page.getByRole('button', { name: 'Resume' });
  await resume.focus();
  await expectFocus(resume, '.overlay-card');
  await page.keyboard.press('Enter');
  await expect(speed).toHaveAttribute('aria-pressed', 'true');
  await speed.click();
  await expect(speed).toHaveAttribute('aria-pressed', 'false');
});

test('reduced motion removes button movement and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  const add = page.getByRole('button', { name: /Add game files/ });
  await add.hover();
  const styles = await add.evaluate(element => ({
    transform: getComputedStyle(element).transform,
    transition: getComputedStyle(element).transitionDuration,
  }));
  expect(styles.transform).toBe('none');
  expect(styles.transition).toBe('0s');
});

test('home actions and game controls remain within narrow viewports', async ({ page }) => {
  await page.route('**/game/harbor-hd-assets.zip', route => route.fulfill({
    status: 200, contentType: 'application/zip', body: syntheticGame(),
  }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Play Treasure Island/ })).toBeVisible();
  const widths = [320, 360, 361, 375, 414, 512, 513, 600, 601, 768];
  const outsideViewport = (selector: string) => page.locator(selector).evaluateAll(elements => elements
    .filter(element => element.getClientRects().length > 0)
    .map(element => ({ label: element.getAttribute('aria-label') || element.textContent?.trim(), box: element.getBoundingClientRect().toJSON() }))
    .filter(({ box }) => box.left < -1 || box.right > window.innerWidth + 1));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 640 });
    expect(await outsideViewport('#welcome button')).toEqual([]);
  }
  await page.getByRole('button', { name: /Play Treasure Island/ }).click();
  // Exercise the longest score allowed by the saved-shift format.
  await page.locator('#score').evaluate(element => { element.textContent = '1000000'; });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 640 });
    expect(await outsideViewport('.game-bar button, .game-name, .score')).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
});
