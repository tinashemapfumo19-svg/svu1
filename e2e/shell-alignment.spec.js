import { test, expect } from '@playwright/test';

const roles = [
  { name: 'student', permissions: ['registry.self', 'admissions.apply'], labels: ['Study', 'Student Office', 'Inbox'] },
  { name: 'lecturer', permissions: ['teaching.self', 'teaching.view'], labels: ['Home', 'My teaching', 'Workspace', 'Resources', 'Inbox'] },
  { name: 'registry', permissions: ['registry.view'], labels: ['Home', 'Workspace', 'Resources', 'Inbox'] },
  { name: 'finance', permissions: ['finance.view'], labels: ['Home', 'Workspace', 'Resources', 'Inbox'] },
  { name: 'admin', permissions: ['registry.view', 'admissions.review', 'foundation.view'], labels: ['Home', 'Admissions', 'Workspace', 'Resources', 'Inbox'] },
  { name: 'applicant', permissions: ['admissions.apply'], labels: ['Home', 'My application', 'Resources', 'Inbox'] }
];

for (const role of roles) {
  test(`${role.name} shares the shell grid and retains its permitted destinations`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('svu.registry.session', JSON.stringify({ token: 'shell-fixture', sessionId: 'fixture' }));
    });
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = [];
      if (path === '/api/identity/me') data = {
        account: { email: `${role.name}@example.com` },
        person: { preferredName: 'Tariro', legalName: 'Tariro Moyo' },
        permissions: role.permissions, roles: [{ code: role.name }], mfa: { enrolled: true }
      };
      if (path === '/api/notifications/me') data = { unread: 2, items: [] };
      if (path === '/api/repository') data = { collections: [], items: [], total: 0, capabilities: {} };
      if (path === '/api/document-templates') data = null;
      if (path === '/api/registry/me') data = {
        studentNumber: 'SVU2026001', programmes: [{ id: 'programme', programmeName: 'Bachelor of Information Systems', yearOfStudy: 2, intakeLabel: 'August 2026', status: 'active' }]
      };
      if (path.endsWith('/account')) data = { currencies: [{ currency: 'USD', balance: 20000, due: 0 }], hold: { held: false } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    });
    await page.goto('/#home');
    await expect(page.locator(role.name === 'student' ? '.student-greeting h1' : '.home-ui h1')).toContainText('Tariro');
    await expect(page.locator(role.name === 'student' ? '.student-recent-section' : '[data-home-messages]')).toBeVisible();
    await expect(page.locator('.nav-links a')).toHaveText(role.labels);
    await expect(page.locator('.nav-links [data-route=foundation]')).toHaveCount(0);
    await expect(page.locator('.dashboard-head a[href="#settings"]')).toHaveCount(0);

    const widths = info.project.name === 'mobile' ? [768, 390, 320] : [2560, 1920, 1440, 1024, 861];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.evaluate((student) => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { page: box('#app'), header: box('.header-container'), home: box(student ? '.student-experience' : '.home-ui'), nav: box('.nav-links a'), brand: box('.brand'), actions: box('.nav-actions'), overflow: document.documentElement.scrollWidth > innerWidth };
      }, role.name === 'student');
      expect(geometry.overflow).toBe(false);
      expect(geometry.page.x).toBe(geometry.header.x);
      expect(geometry.home.x).toBe(geometry.page.x);
      expect(geometry.page.width).toBeLessThanOrEqual(1600);
      if (width >= 1920) expect(geometry.page.width).toBe(1600);
      expect(geometry.actions.x + geometry.actions.width).toBeCloseTo(geometry.header.x + geometry.header.width, 0);
      if (width > 860) {
        expect(geometry.brand.x + geometry.brand.width).toBeLessThanOrEqual(geometry.nav.x);
        await expect(page.locator('.nav-links')).toBeVisible();
        await expect(page.locator('.mobile-nav')).toBeHidden();
      } else {
        if (role.name === 'student') await expect(page.locator('.nav-links')).toBeVisible();
        else await expect(page.locator('.nav-links')).toBeHidden();
        await expect(page.locator('.mobile-nav')).toBeVisible();
        await expect(page.locator('.mobile-nav a')).toHaveCount(role.name === 'registry' || role.name === 'finance' || role.name === 'applicant' ? 4 : 5);
        if (role.name === 'student') await expect(page.locator('.mobile-nav a[data-route=study]')).toHaveCount(3);
        else await expect(page.locator('.mobile-nav a[data-route=resources]')).toBeVisible();
        await expect(page.locator('[data-profile-toggle]')).toBeVisible();
      }
      await expect(page.locator(`.nav-links a[data-route=${role.name === 'student' ? 'study' : 'home'}]`)).toHaveAttribute('aria-current', 'page');
      await page.screenshot({ path: info.outputPath(`${role.name}-${width}.png`), fullPage: true });
    }

    await page.locator('[data-profile-toggle]').click();
    const system = page.getByRole('menuitem', { name: 'System administration' });
    if (role.name === 'admin') await expect(system).toBeVisible();
    else await expect(system).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.profile-dropdown')).toBeHidden();
    await expect(page.locator('[data-profile-toggle]')).toBeFocused();
    if (role.name === 'student') {
      const nav = page.locator('.student-local-nav');
      await expect(page.locator('.nav-links').getByRole('link', { name: 'Student Office', exact: true })).toHaveAttribute('href', /#office\/overview/);
      await nav.getByRole('link', { name: 'Resources', exact: true }).click();
      await expect(nav.getByRole('link', { name: 'Resources', exact: true })).toHaveAttribute('aria-current', 'page');
    }
    expect(errors).toEqual([]);
  });
}
