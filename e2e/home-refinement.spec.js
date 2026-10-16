import { test, expect } from '@playwright/test';

test('sign-in retains entered values after a refused request and supports retry', async ({ page }) => {
  await page.route('**/api/identity/sessions', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Email or password is incorrect.' } }) });
  });
  await page.goto('/#signin');
  const form = page.locator('[data-shell-signin]');
  await form.locator('[name=email]').fill('admin@southvalley.test');
  await form.locator('[name=password]').fill('Phase1-Admin-Password-2026!');
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expect(form.locator('[name=email]')).toHaveValue('admin@southvalley.test');
  await expect(form.locator('[name=password]')).toHaveValue('Phase1-Admin-Password-2026!');
  await expect(form.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await page.unroute('**/api/identity/sessions');
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('[data-home-area="Students"]')).toBeVisible();
  await page.evaluate(() => window.svuSession.signOut());
});

test('home distinguishes a failed inbox load from an empty inbox and retries', async ({ page }) => {
  await page.route('**/api/notifications/me?limit=3', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Temporary inbox failure' } }) }));
  await page.goto('/#signin');
  const form = page.locator('[data-shell-signin]');
  await form.locator('[name=email]').fill('admin@southvalley.test');
  await form.locator('[name=password]').fill('Phase1-Admin-Password-2026!');
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.home-load-errors')).toContainText('Messages: could not be loaded.');
  await expect(page.locator('[data-home-messages]')).toHaveCount(0);
  await expect(page.locator('[data-home-area="Students"]')).toBeVisible();
  await page.unroute('**/api/notifications/me?limit=3');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.home-load-errors')).toHaveCount(0);
  await expect(page.locator('[data-home-messages]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.svuSession.signOut());
});
