import { test, expect } from '@playwright/test';

test('admissions separates tools and preserves review position, drafts and queue navigation', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let failNote = false;
  const queue = Array.from({ length: 35 }, (_, i) => ({ id: `application-${i}`, referenceNumber: `SVU-${1000 + i}`, applicantName: `Applicant ${i}`, programmeCode: 'BSC-IS', workflowState: 'Completeness review', daysWaiting: 35 - i }));
  const detail = id => ({
    id, referenceNumber: queue.find(row => row.id === id).referenceNumber, applicant: { legalName: `Applicant ${id.split('-')[1]}` }, programmeCode: 'BSC-IS', workflowState: 'Completeness review',
    allowedTransitions: ['Academic review', 'Information requested'], possibleDuplicates: [], fee: { status: 'verified', method: 'bank' }, reviewers: [], notes: [], requests: [], history: [{ state: 'Submitted', reason: 'Application submitted', occurredAt: '2026-10-13T08:00:00Z' }],
    capabilities: { 'admissions.configure': true, 'document.create': true },
    checklist: Array.from({ length: 8 }, (_, i) => ({ documentType: `requirement_${i}`, status: 'verified', satisfied: true, documents: [{ id: `document-${i}`, fileName: `Evidence ${i}.pdf`, lifecycle: 'verified' }] }))
  });
  await page.addInitScript(() => sessionStorage.setItem('svu.registry.session', JSON.stringify({ token: 'admissions-layout-fixture' })));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { data } : { error: { message: data } }) });
    if (path === '/api/identity/me') return respond({ account: { email: 'admin@example.test' }, person: { legalName: 'System Administrator' }, roles: [{ code: 'system_administrator' }], permissions: ['registry.view', 'admissions.review', 'admissions.configure'], mfa: { enrolled: true } });
    if (path === '/api/notifications/me') return respond({ items: [], unread: 0 });
    if (path === '/api/admissions/catalogue' || path === '/api/master-data/programmes' || path === '/api/master-data/intakes') return respond([]);
    if (path === '/api/master-data/reference-lists/decision_reason') return respond({ values: [] });
    if (path === '/api/admissions/routes') return respond([{ code: 'standard', name: 'Standard route' }]);
    if (path === '/api/admissions/review/applications') return respond(queue);
    if (/\/applications\/application-\d+\/notes$/.test(path)) return respond(failNote ? 'Temporary note failure' : {}, failNote ? 503 : 200);
    if (/\/applications\/application-\d+$/.test(path)) return respond(detail(path.split('/').at(-1)));
    return respond('Not available in this fixture', 403);
  });
  await page.goto('/#admissions');
  await expect(page.locator('[data-application-id]')).toHaveAttribute('data-application-id', 'application-0');
  const mobile = info.project.name === 'mobile';
  for (const width of mobile ? [320, 390, 768] : [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    if (width > 1023) expect((await page.locator('.review-queue').boundingBox()).width).toBe(340);
  }
  await page.setViewportSize(info.project.use.viewport);
  await page.screenshot({ path: info.outputPath('admissions-initial.png'), fullPage: false });
  const list = page.locator('[data-review-list]');
  const search = page.locator('[data-review-search]');
  await search.fill('SVU-1003');
  await expect(page.locator('[data-review-detail]:visible')).toHaveCount(1);
  await search.fill('');
  await expect(page.locator('[data-review-detail]:visible')).toHaveCount(35);
  if (!mobile) await list.evaluate(node => { node.scrollTop = 200; });
  await page.locator('[data-review-detail="application-3"]').click();
  await expect(page.locator('[data-application-id]')).toHaveAttribute('data-application-id', 'application-3');
  const note = page.locator('[data-form="review-note"] [name="body"]');
  const reason = page.locator('[data-form="review-transition"] [name="reason"]');
  await reason.fill('Unsent academic review reason');
  await note.fill('Keep this note after a failed save');
  const noteForm = page.locator('[data-form="review-note"]');
  await noteForm.scrollIntoViewIfNeeded();
  const before = await noteForm.boundingBox();
  failNote = true;
  await noteForm.locator('button[type=submit]').click();
  await expect(page.getByRole('status')).toContainText('Temporary note failure');
  await expect(note).toHaveValue('Keep this note after a failed save');
  await expect(reason).toHaveValue('Unsent academic review reason');
  expect(Math.abs((await noteForm.boundingBox()).y - before.y)).toBeLessThan(60);
  failNote = false;
  await noteForm.locator('button[type=submit]').click();
  await expect(page.getByRole('status')).toContainText('Review note added');
  await expect(note).toHaveValue('');
  await expect(reason).toHaveValue('Unsent academic review reason');
  if (!mobile) {
    const geometry = await page.locator('.review-queue').evaluate(node => ({ y: node.getBoundingClientRect().top, expected: parseFloat(getComputedStyle(node).top) }));
    expect(geometry.y).toBeCloseTo(geometry.expected, 0);
    expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  }
  await page.locator('[data-admissions-tab=communication]').click();
  await expect(page.locator('[data-form=review-message]')).toBeVisible();
  await page.locator('[data-form=review-message] [name=message]').fill('Unsent message');
  await page.locator('[data-admissions-tab=reports]').click();
  await expect(page.locator('[data-form=review-message]')).toBeHidden();
  await page.goBack();
  await expect(page.locator('[data-form=review-message] [name=message]')).toHaveValue('Unsent message');
  await page.locator('[data-admissions-tab=applications]').click();
  await expect(reason).toHaveValue('Unsent academic review reason');
  if (mobile) { await page.locator('[data-review-back]').click(); await expect(list).toBeVisible(); await expect(note).toBeHidden(); }
  await page.locator('[data-review-detail="application-4"]').click();
  await expect(page.locator('[data-application-id]')).toHaveAttribute('data-application-id', 'application-4');
  await expect(reason).toHaveValue('');
  await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
  const tabs = await page.locator('.admissions-tabs').boundingBox();
  const header = await page.locator('.top-nav').boundingBox();
  expect(tabs.y).toBeCloseTo(header.height, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath('admissions-workspace.png'), fullPage: false });
  expect(errors).toEqual([]);
});
