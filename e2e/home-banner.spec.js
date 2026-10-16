import { test, expect } from '@playwright/test';

const personas = [
  { code: 'system_administrator', permissions: ['registry.view', 'admissions.review', 'foundation.view'] },
  { code: 'applicant', permissions: ['admissions.apply'] },
  { code: 'student', permissions: ['registry.self', 'admissions.apply'] }
];

for (const persona of personas) {
  test(`${persona.code} home banner sticks, compacts and restores on scroll`, async ({ page }, info) => {
    await page.addInitScript(() => sessionStorage.setItem('svu.registry.session', JSON.stringify({ token: 'banner-fixture' })));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === '/api/identity/me') data = {
        account: { email: 'tariro@example.test' }, person: { preferredName: 'Tariro', legalName: 'Tariro Moyo' },
        permissions: persona.permissions, roles: [{ code: persona.code }], mfa: { enrolled: true }
      };
      if (path === '/api/notifications/me') data = { unread: 0, items: [] };
      if (path === '/api/me/work-summary') data = { tasks: 0, support: 0 };
      if (path === '/api/registry/me') data = {
        studentNumber: 'SVU2026001', programmes: [{ id: 'programme', programmeName: 'Bachelor of Information Systems', intakeLabel: 'August 2026', status: 'active' }]
      };
      if (path.endsWith('/account')) data = { currencies: [], hold: { held: false } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.goto('/#home');
    const selector = persona.code === 'student' ? '.student-greeting' : '.home-ui .dashboard-head';
    const banner = page.locator(selector);
    await expect(banner).toContainText('Tariro');
    await expect(page.locator(persona.code === 'student' ? '.student-recent-section' : '[data-home-messages]')).toBeVisible();
    await page.evaluate(student => {
      const spacer = document.createElement('div');
      spacer.style.height = '1800px';
      document.querySelector(student ? '.student-main-column' : '.home-ui').append(spacer);
    }, persona.code === 'student');
    const expanded = (await banner.boundingBox()).height;
    await page.evaluate(() => scrollTo({ top: 600, behavior: 'instant' }));
    await expect(banner).toHaveClass(/is-scrolled/);
    await expect.poll(async () => (await banner.boundingBox()).height).toBeLessThan(expanded);
    await expect.poll(() => banner.evaluate(node => {
      const top = parseFloat(getComputedStyle(node).top);
      return Math.abs(node.getBoundingClientRect().top - top);
    })).toBeLessThan(1);
    const header = await page.locator('.top-nav').boundingBox();
    const box = await banner.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath('sticky-banner.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await banner.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await expect(banner).not.toHaveClass(/is-scrolled/);
    await expect.poll(async () => (await banner.boundingBox()).height).toBeCloseTo(expanded, 0);
    await page.goto('/#verify');
    await expect(page.locator('.dashboard-head.is-scrolled, .student-greeting.is-scrolled')).toHaveCount(0);
  });
}
