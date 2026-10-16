import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => {
  test.setTimeout(180000);
  if (process.env.DATABASE_URL && /^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) {
    execFileSync(process.execPath, ['scripts/seed-walkthrough.js'], { env: process.env, timeout: 180000, stdio: 'pipe' });
  }
});

test('student spaces preserve records, actions, context and mobile layout', async ({ page }, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill('active.student@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Active-Student-Demo-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page).toHaveURL(/#study\/today/);
  await expect(page.locator('.student-greeting')).toContainText('Tariro');
  await expect(page.locator('.nav-links')).toContainText('Student Office');
  await expect(page.locator('.student-course')).not.toHaveCount(0);
  await page.screenshot({ path: info.outputPath('study-today.png'), fullPage: true });
  const overflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await overflow();

  await page.locator('.student-local-nav').getByRole('link', { name: 'Courses', exact: true }).click();
  await expect(page.locator('[data-course-expand]')).not.toHaveCount(0);
  await page.locator('[data-course-expand] > summary').first().click();
  await expect(page.getByRole('heading', { name: '1. Learning Materials', exact: true })).toBeVisible();
  const course = page.locator('[data-course-expand] [data-course-workspace]').first();
  const courseHref = `#study/courses/${await course.getAttribute('data-period')}/${await course.getAttribute('data-course')}`;
  await page.goto(`/${courseHref}`);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  expect(page.url()).toContain(courseHref);

  await page.goto('/#office/registration');
  await expect(page.locator('.course-registration')).toBeVisible();
  await expect(page.locator('.registration-blockers')).not.toHaveCount(0);
  await page.screenshot({ path: info.outputPath('office-registration.png'), fullPage: true });
  const semester = page.locator('[data-student-period-context]');
  if (!await semester.isVisible()) await page.locator('.student-context-disclosure summary').click();
  const value = await semester.locator('option').nth(1).getAttribute('value');
  await semester.selectOption(value);
  await expect(page).toHaveURL(/period=/);
  await expect(page.locator('[data-student-period-context]')).toHaveValue(value);
  await page.reload();
  await expect(page.locator('[data-student-period-context]')).toHaveValue(value);

  for (const [path, selector] of [
    ['office/fees', '[data-finance-hold]'],
    ['office/details', '[data-form="student-profile"]'],
    ['office/documents', '.student-controls'],
    ['office/requests', '[data-support-student]'],
    ['study/results', '.student-results'],
    ['study/timetable', '[data-student-exams]'],
    ['study/resources', '[data-resource-search]']
  ]) {
    await page.goto(`/#${path}`);
    await expect(page.locator(selector)).toBeVisible();
    await overflow();
    await page.screenshot({ path: info.outputPath(`${path.replace('/', '-')}.png`), fullPage: true });
  }

  await page.goto('/#office/details');
  await page.locator('[data-form="student-profile"] [name=phone]').fill('+263771234599');
  await page.locator('.student-local-nav').getByRole('link', { name: 'Fees & Payments' }).click();
  await page.locator('.student-local-nav').getByRole('link', { name: 'My Details' }).click();
  await expect(page.locator('[data-form="student-profile"] [name=phone]')).toHaveValue('+263771234599');

  await page.goto('/#study/timetable');
  await page.locator('[data-arrangements-open]').first().click();
  await expect(page).toHaveURL(/#office\/requests.*sitting=/);
  await expect(page.locator('[data-arrangement-panel]')).toBeVisible();
  await page.locator('[data-arrangements-close]').click();
  await expect(page.locator('[data-arrangement-panel]')).toHaveCount(0);
  expect(page.url()).not.toContain('sitting=');

  await page.goto('/#office/details');
  await page.getByRole('link', { name: 'Application history', exact: true }).click();
  await expect(page.locator('.apply-signed-in .eyebrow')).toHaveText('Application history');
  await expect(page.locator('.apply-signed-in')).toContainText('Accepted');
  await expect(page.locator('.course-registration')).toHaveCount(0);

  await page.goto('/#office/documents');
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  const issued = await page.evaluate(async () => {
    const session = window.svuSession.get();
    const me = (await (await fetch('/api/registry/me', { headers: { Authorization: `Bearer ${session.token}` } })).json()).data;
    const records = (await (await fetch(`/api/registry/me/programmes/${me.programmes[0].id}/transcripts`, { headers: { Authorization: `Bearer ${session.token}` } })).json()).data;
    return records.transcripts.length;
  });
  if (issued) {
    await expect(page.locator('[data-student-transcript]')).toHaveCount(issued);
    await page.locator('[data-student-transcript]').first().click();
    await expect(page.locator('[data-transcript-print]')).toBeVisible();
  } else await expect(page.locator('.student-controls')).toContainText('No official transcripts or certificates');

  await page.route('**/api/registry/me/programmes/*/account', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Account temporarily unavailable' } }) }));
  await page.goto('/#study/today');
  await expect(page.locator('.student-load-errors')).toContainText('Account temporarily unavailable');
  await expect(page.locator('.student-course')).not.toHaveCount(0);
  await page.unroute('**/api/registry/me/programmes/*/account');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.student-load-errors')).toHaveCount(0);

  await page.clock.install();
  await page.clock.fastForward(16000);
  await page.route('**/api/master-data/reference-lists/country', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Country list unavailable' } }) }));
  await page.goto('/#office/details');
  await expect(page.locator('[data-form="student-profile"]')).toBeVisible();
  await expect(page.locator('.student-load-errors')).toContainText('Country list unavailable');
  await page.unroute('**/api/master-data/reference-lists/country');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.student-load-errors')).toHaveCount(0);

  await page.goto('/#office/requests?sitting=not-owned');
  await expect(page.locator('[data-support-student]')).toBeVisible();
  await expect(page.locator('.student-load-errors')).toBeVisible();
  await expect(page.locator('[data-form="student-identity"]')).toHaveCount(0);
  await expect(page.locator('[data-student-exams]')).toHaveCount(0);

  if (process.env.DATABASE_URL && /^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) {
    await page.goto('/#office/requests');
    await page.locator('[data-support-create-panel] summary').click();
    const subject = `Student Office ${info.project.name} ${Date.now()}`;
    await page.locator('[data-support-create] [name=subject]').fill(subject);
    await page.locator('[data-support-create] [name=body]').fill('Please help with my course registration.');
    await page.locator('[data-support-create] button[type=submit]').click();
    await expect(page.locator('[data-support-student]')).toContainText(subject);
    await page.locator('[data-support-open]').filter({ hasText: subject }).click();
    await expect(page.locator('[data-support-detail]')).toContainText('Please help with my course registration.');
  }

  await page.goto('/#study/today?programme=not-owned');
  await expect(page.getByRole('alert')).toContainText('not available');
  await page.goto('/#study/today');
  await expect(page.locator('.student-greeting')).toBeVisible();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await overflow();
    await page.screenshot({ path: info.outputPath(`today-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('expired student entry uses shared sign-in and preserves deep-link destination', async ({ page }) => {
  await page.goto('/#study/timetable');
  await expect(page).toHaveURL(/#signin\?next=study%2Ftimetable/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

test('a student who also teaches retains a separate teaching destination', async ({ page }) => {
  await page.route('**/api/identity/me', async route => {
    const response = await route.fetch(), payload = await response.json();
    payload.data.permissions.push('teaching.self');
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill('active.student@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Active-Student-Demo-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page).toHaveURL(/#study\/today/);
  await expect(page.locator('.nav-links').getByRole('link', { name: 'My teaching', exact: true })).toHaveCount(1);
  await page.goto('/#learning');
  await expect(page.getByRole('heading', { name: 'My teaching', exact: true })).toBeVisible();
  expect(page.url()).toContain('#learning');
});

test('student navigation reuses shared reads, loads in parallel and refreshes safely', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await page.clock.install();
  const requests = [];
  page.on('request', request => {
    if (request.method() === 'GET' && request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
  });
  const studentReads = () => requests.filter(path => path === '/api/registry/me').length;
  const registrationReads = () => requests.filter(path => path.endsWith('/registrations')).length;
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill('active.student@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Active-Student-Demo-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page.locator('.student-greeting')).toBeVisible();
  const initialStudentReads = studentReads(), initialRegistrationReads = registrationReads();
  await page.evaluate(() => { location.hash = '#study/courses'; });
  await expect(page.getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#study/timetable'; });
  await expect(page.locator('[data-student-exams]')).toBeVisible();
  expect(studentReads()).toBe(initialStudentReads);
  expect(registrationReads()).toBe(initialRegistrationReads);

  // A slow optional module must not stop unrelated modules from starting.
  let releaseLifecycle;
  const lifecycleGate = new Promise(resolve => { releaseLifecycle = resolve; });
  let lifecycleStarted = false;
  await page.route('**/api/registry/me/programmes/*/lifecycle', async route => {
    lifecycleStarted = true; await lifecycleGate; await route.continue();
  });
  try {
    await page.evaluate(() => { location.hash = '#office/details'; });
    await expect(page.locator('.student-local-nav [aria-current=page]')).toHaveText('My Details');
    await expect.poll(() => lifecycleStarted).toBe(true);
    await expect.poll(() => requests.includes('/api/registry/me/identity')).toBe(true);
    await expect.poll(() => requests.includes('/api/master-data/reference-lists/country')).toBe(true);
  } finally { releaseLifecycle(); }
  await expect(page.locator('[data-form="student-profile"]')).toBeVisible();
  await page.unroute('**/api/registry/me/programmes/*/lifecycle');

  // Expired shared reads are deduplicated even when navigation overtakes them.
  await page.clock.fastForward(16000);
  let releaseStudent;
  const studentGate = new Promise(resolve => { releaseStudent = resolve; });
  await page.route('**/api/registry/me', async route => { await studentGate; await route.continue(); });
  try {
    await page.evaluate(() => { location.hash = '#study/courses'; });
    await expect.poll(studentReads).toBe(initialStudentReads + 1);
    await page.evaluate(() => { location.hash = '#study/timetable'; });
    await expect(page.locator('.student-local-nav [aria-current=page]')).toHaveText('Calendar');
    await page.evaluate(() => { location.hash = '#office/requests'; });
    await expect(page.locator('.student-local-nav [aria-current=page]')).toHaveText('Requests');
    expect(studentReads()).toBe(initialStudentReads + 1);
  } finally { releaseStudent(); }
  await expect(page.locator('[data-support-student]')).toBeVisible();
  expect(registrationReads()).toBe(initialRegistrationReads + 1);
  await expect(page.locator('.student-load-errors')).toHaveCount(0);
  await page.unroute('**/api/registry/me');

  await page.clock.fastForward(16000);
  await page.route('**/api/registry/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Temporary student record failure' } }) }));
  await page.evaluate(() => { location.hash = '#study/today'; });
  await expect(page.getByRole('alert')).toContainText('Temporary student record failure');
  const failedReads = studentReads();
  await page.evaluate(() => { location.hash = '#study/courses'; });
  await expect(page.getByRole('alert')).toContainText('Temporary student record failure');
  expect(studentReads()).toBe(failedReads + 1);
  await page.unroute('**/api/registry/me');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
});

test('student visual primitives share the canvas and command search is keyboard accessible', async ({ page }, info) => {
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill('active.student@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill('Active-Student-Demo-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page.locator('.student-greeting')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
  await expect(page.locator('.student-greeting')).toHaveCSS('background-image', /campus-concept/);
  const asset = await page.request.get('/src/assets/campus-concept.jpg');
  expect(asset.status()).toBe(200); expect(asset.headers()['content-type']).toContain('image/jpeg');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search SVU' })).toBeVisible();
  const query = page.locator('[data-command-query]');
  await expect(query).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.student-command-result').last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.student-command-result').first()).toBeFocused();
  await query.focus();
  await query.fill('no-matching-student-destination');
  await expect(page.locator('.student-command-result')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Search SVU' })).toContainText('No matches');
  await query.fill('statement');
  await expect(page.locator('.student-command-result')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#office\/fees/);
  await expect(page.locator('[data-finance-hold]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(query).toBeFocused();
  await query.fill('COMP101');
  await expect(page.locator('.student-command-result').first()).toContainText('COMP101');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.student-command-result').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.student-command-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  for (const path of ['study/today', 'study/courses', 'office/registration', 'settings']) {
    await page.goto(`/#${path}`);
    await expect(page.locator(path === 'settings' ? '.settings-page' : '[data-student-controls]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 247, 251)');
    await page.screenshot({ path: info.outputPath(`refined-${path.replace('/', '-')}.png`), fullPage: true });
  }
});
