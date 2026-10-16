import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {registryMetrics,registryMetricVersion} from '../server/modules/registry-reporting.js';

test('registry report fits long labels, refreshes and exports under fresh authority with error recovery',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryEnrolmentReportingUI) && admissionsData.catalogue !== null);
  await page.evaluate(({metrics,version}) => {
    const intake = {intakeId:'intake',programmeCode:'BSC',label:'Science and technology extended registry intake with an unusually long descriptive name',status:'published'};
    const counts = Object.fromEntries(metrics.map((entry) => [entry.id,0]));Object.assign(counts,{programmeRecords:1,onboarded:1,registrationPeriods:1,closedPeriods:1,registrationRecords:1,confirmedRegistrations:1,courseEnrolments:2});
    const controls = {programmesReconcile:true,periodsReconcile:true,registrationsReconcile:true};
    const report = {definitionVersion:version,generatedAt:'2026-10-05T11:00:00Z',filters:{programmeCode:'',intakeId:''},metrics,availableIntakes:[intake],rows:[{...intake,counts,controls}],totals:counts,controls};
    const state = {session:{token:'active'},registryReport:report,registryReportOpen:true},root = document.querySelector('.page-container');window.registryLayoutState = state;window.registryCalls = [];
    const bind = () => window.registryEnrolmentReportingUI.bind(root,state,{act:async (work) => {try {await work();} catch(error) {window.registryLayoutError = error.message;}root.innerHTML = window.registryEnrolmentReportingUI.render(state);bind();},api:async (method,path) => {
      window.registryCalls.push({method,path});if (path.endsWith('/intakes')) return [intake];if (window.denyRegistry) throw new Error('Registry authority revoked');
      const params = new URL(path,location.origin).searchParams;if (params.get('format') === 'csv') return {csv:'FRESH AUTHORIZED REGISTRY REPORT',fileName:'fresh-registry.csv'};
      if (window.failRegistry) throw new Error('Source reconciliation required');return {...report,filters:{programmeCode:'',intakeId:params.get('intakeId') || ''}};
    }});root.innerHTML = window.registryEnrolmentReportingUI.render(state);bind();
  },{metrics:registryMetrics,version:registryMetricVersion});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-registry-report-filter] [name="intakeId"]').selectOption('intake');await page.getByRole('button',{name:'Refresh registry report',exact:true}).click();
  expect(await page.evaluate(() => window.registryCalls.at(-1).path)).toBe('/api/reports/registry?intakeId=intake');
  const event = page.waitForEvent('download');await page.locator('[data-registry-report-export]').click();const file = await event;expect(await readFile(await file.path(),'utf8')).toBe('FRESH AUTHORIZED REGISTRY REPORT');
  expect(await page.evaluate(() => window.registryCalls.at(-1).path)).toBe('/api/reports/registry?programmeCode=&intakeId=intake&format=csv');
  await page.locator('[data-registry-definitions] > summary').click();await page.locator('[data-registry-definitions] .report-definition').first().locator('summary').click();await expect(page.locator('[data-registry-definitions]')).toContainText('owner approval pending');
  await page.locator('[data-registry-report]').screenshot({path:info.outputPath('registry-report-long-labels.png')});
  await page.locator('[data-registry-definitions] .report-definition').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await page.locator('[data-registry-definitions] .report-definition').last().evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);await page.screenshot({path:info.outputPath('registry-report-viewport.png')});
  await page.evaluate(() => {window.denyRegistry = true;window.registryDownloads = 0;URL.createObjectURL = () => {window.registryDownloads++;throw new Error('Must not download');};});
  await page.locator('[data-registry-report-export]').click();await expect.poll(() => page.evaluate(() => window.registryLayoutError)).toBe('Registry authority revoked');expect(await page.evaluate(() => window.registryDownloads)).toBe(0);
  await page.evaluate(() => {window.denyRegistry = false;window.failRegistry = true;});await page.getByRole('button',{name:'Refresh registry report',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Source reconciliation required');await expect(page.locator('[data-registry-metric]')).toHaveCount(0);await expect(page.locator('[data-registry-report-export]')).toBeDisabled();
  await page.evaluate(() => {window.failRegistry = false;});await page.getByRole('button',{name:'Refresh registry report',exact:true}).click();await expect(page.locator('[data-registry-metric="confirmedRegistrations"]')).toContainText('1');
});

test('departed registry report success and failures cannot restore old caches or metadata',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryEnrolmentReportingUI));
  expect(await page.evaluate(async () => {
    const outcomes = [];
    for (const fail of [false,true]) {
      const state = {session:{token:'departing'},registryReport:{private:'old'}};let deliver,reject;
      const pending = new Promise((resolve,fail) => {deliver = resolve;reject = fail;});let calls = 0;
      const read = window.registryEnrolmentReportingUI.load(state,() => {calls++;return pending;},{intakeId:'old-intake'});
      state.session = {token:'replacement'};state.registryReport = {private:'new'};
      if (fail) reject(new Error('Departed source failed'));else deliver({private:'late'});await read;outcomes.push({state,calls});
    }
    return outcomes;
  })).toEqual([false,true].map(() => ({state:{session:{token:'replacement'},registryReport:{private:'new'}},calls:1})));
});
