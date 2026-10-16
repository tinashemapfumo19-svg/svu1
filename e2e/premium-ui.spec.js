import { test, expect } from '@playwright/test';

test('shared shell, home filters and staff commands remain usable across screen sizes', async ({ page }, info) => {
  test.setTimeout(180000);
  if (!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error('Use the isolated integration runner.');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill('admin@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Phase1-Admin-Password-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page.locator('[data-home-area="Students"]')).toBeVisible();
  // Home cards and rows carry no pin buttons, no Pinned filter and no arrows.
  await expect(page.locator('.home-pin, [data-home-filter="pinned"], .ui-chevron')).toHaveCount(0);
  await page.locator('[data-home-filter="business"]').click();
  await expect(page.locator('[data-home-area="Finance"]')).toBeVisible();
  await expect(page.locator('[data-home-area="Students"]')).toHaveCount(0);
  await page.locator('[data-home-filter="all"]').click();

  const sizes = info.project.name === 'desktop' ? [1440, 1920, 1024] : [390, 360];
  for (const width of sizes) {
    await page.setViewportSize({ width, height: info.project.name === 'desktop' ? 1000 : 844 });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const shell = await page.locator('.top-nav').boundingBox();
    expect(shell.height).toBe(64);
    const actions = await page.locator('.nav-actions').boundingBox();
    const brand = await page.locator('.brand').boundingBox();
    expect(brand.x + brand.width).toBeLessThanOrEqual(actions.x);
    expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(244, 247, 251)');
    await page.screenshot({ path: info.outputPath(`premium-home-${width}.png`), fullPage: true });
  }
  await page.locator('[data-shell-command]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('[data-command-query]').fill('unique record');
  await expect(page.locator('[data-command-results]')).toContainText('Find student: unique record');
  await page.locator('[data-command-query]').press('ArrowDown');
  await expect(page.getByRole('link', { name: 'Find student: unique record Student records' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-shell-command]')).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.locator('[data-command-query]').fill('finance');
  await page.locator('[data-command-results] a[href="#registry/finance"]').click();
  await expect(page).toHaveURL(/#registry\/finance$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/#home');
  await expect(page.locator('[data-home-area="Students"]')).toBeVisible();
  await page.evaluate(() => window.svuSession.clear());
  await expect(page.locator('[data-shell-command]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
