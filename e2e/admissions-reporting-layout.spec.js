import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { admissionsMetrics, admissionsMetricVersion } from '../server/modules/admissions-reporting.js';

test('admissions workload fits long labels, exports a fresh scoped report and clears private state on session loss',async ({page},info) => {
  await page.goto('/#admissions');await page.waitForFunction(() => admissionsData.catalogue !== null && Boolean(window.admissionsReportingUI));
  const intake = {intakeId:'synthetic-intake',programmeCode:'BSC',label:'Science and technology extended admissions intake label with an unusually long name',status:'published',capacity:4};
  const counts = Object.fromEntries(admissionsMetrics.map((entry) => [entry.id,0]));Object.assign(counts,{applicationsTotal:1,underReview:1,capacity:4,placesRemaining:4});
  const report = {definitionVersion:admissionsMetricVersion,generatedAt:'2026-10-05T11:00:00Z',filters:{programmeCode:'',intakeId:''},metrics:admissionsMetrics,availableIntakes:[intake],rows:[{...intake,counts,controls:{applicationsReconcile:true,capacityReconciles:true}}],totals:counts,controls:{applicationsReconcile:true,capacityReconciles:true}};
  const calls = [];let denied = false;
  await page.route('**/api/identity/me', route => route.fulfill({contentType:'application/json',body:JSON.stringify({data:{account:{email:'reports@example.test'},person:{legalName:'Report reviewer'},permissions:['admissions.review'],roles:[{code:'admissions_officer'}],mfa:{enrolled:true}}})}));
  await page.route('**/api/reports/admissions?**',async (route) => {
    const url = new URL(route.request().url());calls.push(url.pathname+url.search);
    await route.fulfill({status:denied ? 401 : 200,contentType:'application/json',body:JSON.stringify(denied ? {error:{message:'Session expired'}} : {data:url.searchParams.get('format') === 'csv' ? {csv:'FRESH AUTHORIZED ADMISSIONS REPORT',fileName:'fresh-admissions.csv'} : {...report,filters:{programmeCode:'',intakeId:url.searchParams.get('intakeId') || ''}}})});
  });
  await page.evaluate((data) => {staffReview.session = {token:'synthetic-session',sessionId:'synthetic-session-id'};staffReview.admissionsReport = data;staffReview.admissionsReportOpen = true;staffReview.queue = [];sessionStorage.setItem('svu.staff.session',JSON.stringify(staffReview.session));render();},report);
  await page.locator('[data-admissions-tab=reports]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-admissions-report]').screenshot({path:info.outputPath('admissions-long-labels.png')});
  await page.locator('[data-admissions-report-filter] [name="intakeId"]').selectOption(intake.intakeId);await page.getByRole('button',{name:'Refresh admissions report'}).click();
  await expect.poll(() => calls.at(-1)).toBe('/api/reports/admissions?intakeId=synthetic-intake');
  const downloadEvent = page.waitForEvent('download');await page.locator('[data-admissions-report-export]').click();const file = await downloadEvent;
  expect(await readFile(await file.path(),'utf8')).toBe('FRESH AUTHORIZED ADMISSIONS REPORT');expect(calls.at(-1)).toBe('/api/reports/admissions?programmeCode=&intakeId=synthetic-intake&format=csv');
  await page.locator('[data-admissions-definitions] > summary').click();await page.locator('[data-admissions-definitions] .report-definition').first().locator('summary').click();
  await expect(page.locator('[data-admissions-definitions] .report-definition').first()).toContainText('owner approval pending');
  await page.locator('[data-admissions-report-intake]').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await page.locator('[data-admissions-report-intake]').evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('admissions-workload-viewport.png')});
  let downloads = 0;page.on('download',() => downloads++);denied = true;
  await page.locator('[data-admissions-report-export]').click();await expect(page.locator('[data-form="staff-signin"]')).toBeVisible();
  await expect(page.locator('[data-admissions-report]')).toHaveCount(0);expect(downloads).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('svu.staff.session'))).toBeNull();
  expect(await page.evaluate(() => ({report:staffReview.admissionsReport ?? null,detail:staffReview.detail,manifest:staffReview.manifest,queue:staffReview.queue}))).toEqual({report:null,detail:null,manifest:null,queue:null});
});

test('departed admissions responses cannot restore private report caches',async ({page}) => {
  await page.goto('/#admissions');await page.waitForFunction(() => admissionsData.catalogue !== null);
  let deliver,received = false;const pending = new Promise((resolve) => {deliver = resolve;});
  await page.route('**/api/reports/admissions?late=1',async (route) => {received = true;await pending;await route.fulfill({contentType:'application/json',body:JSON.stringify({data:{private:'DEPARTED SOURCE'}})});});
  await page.evaluate(() => {staffReview.session = {token:'departing',sessionId:'departing-id'};window.departedRead = requestJson('GET','/api/reports/admissions?late=1',undefined,'departing').then((data) => {staffReview.admissionsReport = data;}).catch((error) => {window.departedError = error.message;});});
  await expect.poll(() => received).toBe(true);
  await page.evaluate(() => {clearStaffSessionState();staffReview.session = {token:'replacement',sessionId:'replacement-id'};});deliver();
  await expect.poll(() => page.evaluate(() => window.departedError)).toContain('session changed');
  expect(await page.evaluate(() => staffReview.admissionsReport ?? null)).toBeNull();
});
