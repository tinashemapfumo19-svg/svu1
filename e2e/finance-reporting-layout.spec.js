import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { financeMetrics,financeMetricVersion } from '../server/modules/finance-reporting.js';

test('finance report fits long labels, shows definitions, refreshes filters and exports only freshly authorized CSV',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.financeReportsUI) && admissionsData.catalogue !== null);
  await page.evaluate(({metrics,version}) => {
    const intake = {intakeId:'intake',programmeCode:'BSC',intakeLabel:'Science and technology finance intake with an unusually long descriptive name'};
    const values = {currency:'USD',accounts:2,opening:9000,charged:12000,paid:1200,credited:3000,balance:7800,outstanding:10800,due:10800,unallocated:3000,reconciles:true};
    const report = {definitionVersion:version,generatedAt:'2026-10-05T11:00:00Z',asOf:'2026-10-05',filters:{asOf:'2026-10-05',programmeCode:'',intakeId:'',currency:''},metrics,availableIntakes:[intake],rows:[{...intake,...values}],totals:[values],unmatchedQueue:null};
    const state = {session:{token:'active'},controlTotals:report},root = document.querySelector('.page-container');window.financeLayoutState = state;window.financeCalls = [];
    const bind = () => window.financeReportsUI.bind(root,state,{act:async (work) => {try {await work();} catch(error) {window.financeLayoutError = error.message;}root.innerHTML = window.financeReportsUI.render(state);bind();},api:async (method,path) => {
      window.financeCalls.push({method,path});if (window.denyFinanceExport) throw new Error('Finance authority revoked');
      const params = new URL(path,location.origin).searchParams;
      if (params.get('format') === 'csv') return {csv:'FRESH AUTHORIZED FINANCE REPORT',fileName:'fresh-finance.csv'};
      if (window.failFinanceRefresh) throw new Error('Source reconciliation required');
      return {...report,filters:{...report.filters,...Object.fromEntries(params)}};
    }});root.innerHTML = window.financeReportsUI.render(state);bind();
  },{metrics:financeMetrics,version:financeMetricVersion});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  const form = page.locator('[data-control-asof]');await form.locator('[name="intakeId"]').selectOption('intake');await form.locator('[name="currency"]').selectOption('USD');await form.locator('[type="submit"]').click();
  expect(await page.evaluate(() => window.financeCalls.at(-1).path)).toBe('/api/finance/reports/control-totals?asOf=2026-10-05&intakeId=intake&currency=USD');
  const event = page.waitForEvent('download');await page.locator('[data-control-csv]').click();const file = await event;
  expect(await readFile(await file.path(),'utf8')).toBe('FRESH AUTHORIZED FINANCE REPORT');
  expect(await page.evaluate(() => window.financeCalls.at(-1).path)).toBe('/api/finance/reports/control-totals?asOf=2026-10-05&programmeCode=&intakeId=intake&currency=USD&format=csv');
  await page.locator('[data-finance-definitions] > summary').click();await page.locator('[data-finance-definitions] .report-definition').first().locator('summary').click();
  await expect(page.locator('[data-finance-definitions]')).toContainText('finance owner approval pending');
  await page.locator('[data-control-totals]').screenshot({path:info.outputPath('finance-report-long-labels.png')});
  await page.locator('[data-finance-definitions] .report-definition').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await page.locator('[data-finance-definitions] .report-definition').last().evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath('finance-report-viewport.png')});
  await page.evaluate(() => {window.denyFinanceExport = true;window.financeDownloads = 0;URL.createObjectURL = () => {window.financeDownloads++;throw new Error('Must not download');};});
  await page.locator('[data-control-csv]').click();await expect.poll(() => page.evaluate(() => window.financeLayoutError)).toBe('Finance authority revoked');expect(await page.evaluate(() => window.financeDownloads)).toBe(0);
  await page.evaluate(() => {window.denyFinanceExport = false;window.failFinanceRefresh = true;});await form.locator('[type="submit"]').click();
  await expect(page.getByRole('alert')).toHaveText('Source reconciliation required');await expect(page.locator('[data-control-csv]')).toHaveCount(0);await expect(page.locator('[data-control-currency]')).toHaveCount(0);
  await page.evaluate(() => {window.failFinanceRefresh = false;});await page.locator('[data-control-asof] [type="submit"]').click();await expect(page.locator('[data-control-currency="USD"]')).toBeVisible();
});

test('departed finance report loads cannot restore a cache or replace a new session report',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.financeReportsUI));
  await page.evaluate(async () => {
    const state = {session:{token:'departing'},controlTotals:{private:'old'}};let deliver;
    const pending = new Promise((resolve) => {deliver = resolve;});
    const read = window.financeReportsUI.load(state,() => pending,{asOf:'2026-10-05'});
    state.session = {token:'replacement'};state.controlTotals = {private:'new-session'};deliver({private:'late-old-session'});await read;window.financeLateResult = state;
  });
  expect(await page.evaluate(() => window.financeLateResult)).toEqual({session:{token:'replacement'},controlTotals:{private:'new-session'}});
});
