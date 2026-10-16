import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { examinationMetrics, examinationMetricVersion } from '../server/modules/examination-reporting.js';

test('workload report handles long labels, refreshes filters and exports only through a fresh authorized read',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryReportingUI));
  await page.evaluate(({metrics,version}) => {
    const period = {periodId:'period',programmeCode:'BSC',intakeId:'intake',intakeLabel:'Science and technology extended intake label',name:'October examination reporting period with an unusually long name'};
    const counts = Object.fromEntries(metrics.map((metric,index) => [metric.id,index+1]));
    const controls={ordersReconcile:true,timetablesReconcile:true,sittingsReconcile:true,publicationOriginsReconcile:true};
    const report = {definitionVersion:version,controlsVersion:'exam-source-controls-v1',controls,generatedAt:'2026-10-05T10:00:00Z',filters:{programmeCode:'',intakeId:'',periodId:''},availablePeriods:[period],rows:[{...period,counts,controls}],metrics,totals:counts};
    const state = {examinationReport:report,examinationReportOpen:true},root = document.querySelector('.page-container');window.workloadCalls = [];window.reportState = state;
    const bind = () => window.registryReportingUI.bind(root,state,{act:async (work) => {try {await work();} catch(error) {window.workloadError = error.message;}root.innerHTML = window.registryReportingUI.render(state);bind();},api:async (method,path) => {
      window.workloadCalls.push({method,path});
      if (window.denyWorkload) throw new Error('Authority revoked');
      if (path.includes('format=csv')) return {csv:'FRESH AUTHORIZED REPORT',fileName:'fresh-report.csv'};
      return {...report,filters:{...report.filters,periodId:new URL(path,location.origin).searchParams.get('periodId') || ''}};
    }});root.innerHTML = window.registryReportingUI.render(state);bind();
  },{metrics:examinationMetrics,version:examinationMetricVersion});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  const panel = page.locator('[data-examination-report]');await panel.screenshot({path:info.outputPath('examination-workload.png')});
  await page.locator('[data-examination-report-controls] > summary').click();
  await expect(page.locator('[data-examination-report-controls] tr')).toHaveCount(4);
  await expect(page.locator('[data-examination-report-controls] td')).toHaveText(['Agree','Agree','Agree','Agree']);
  await page.locator('[data-examination-report-controls]').evaluate((node) => node.scrollIntoView({block:'center',behavior:'instant'}));
  if(info.project.name === 'mobile')expect(await page.locator('[data-examination-report-controls]').evaluate((node) => node.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.locator('[data-examination-report-controls]').screenshot({path:info.outputPath('examination-source-controls.png')});
  await page.locator('[data-examination-report-filter] [name="periodId"]').selectOption('period');await page.getByRole('button',{name:'Refresh report'}).click();
  expect(await page.evaluate(() => window.workloadCalls.at(-1))).toEqual({method:'GET',path:'/api/reports/examinations?periodId=period'});
  const fileEvent = page.waitForEvent('download');await page.locator('[data-examination-report-export]').click();const file = await fileEvent;
  expect(await readFile(await file.path(),'utf8')).toBe('FRESH AUTHORIZED REPORT');
  expect(await page.evaluate(() => window.workloadCalls.at(-1).path)).toBe('/api/reports/examinations?programmeCode=&intakeId=&periodId=period&format=csv');
  await page.locator('[data-report-definitions] > summary').click();await expect(page.locator('[data-report-definitions]')).toContainText('owner approval pending');
  await page.locator('[data-report-definitions]').screenshot({path:info.outputPath('examination-metric-definitions.png')});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-report-period]').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await page.locator('[data-report-period]').last().evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('examination-workload-viewport.png')});
  await page.evaluate(() => {window.denyWorkload = true;window.deniedDownloads = 0;URL.createObjectURL = () => {window.deniedDownloads++;throw new Error('Must not download');};});
  await page.locator('[data-examination-report-export]').click();await expect.poll(() => page.evaluate(() => window.workloadError)).toBe('Authority revoked');
  expect(await page.evaluate(() => window.deniedDownloads)).toBe(0);
  await expect(page.locator('[data-report-totals]')).toHaveCount(0);
  await expect(page.locator('[data-examination-report-export]')).toHaveCount(0);
  await expect(page.locator('[data-examination-report] [role="alert"]')).toContainText('Authority revoked');
});

test('examination report discards stale sessions, superseded loads and revoked figures and offers source-fault retry',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryReportingUI));
  expect(await page.evaluate(async () => {
    const out=[];
    for(const failed of [false,true]) {
      const state={session:{token:'old'}};let deliver,reject;
      const work=registryReportingUI.load(state,() => new Promise((ok,no) => {deliver=ok;reject=no;}));
      state.session.token='new';state.examinationReport={marker:'new'};
      if(failed)reject(new Error('Private stale error'));else deliver({marker:'old'});
      await work;out.push(state.examinationReport);
    }
    const state={session:{token:'same'}};let deliver;
    const pending=registryReportingUI.load(state,() => new Promise((ok) => {deliver=ok;}));
    await registryReportingUI.load(state,async () => ({marker:'current'}));deliver({marker:'old'});await pending;out.push(state.examinationReport);
    for(const status of [401,403,404,409]) {
      const s={session:{token:'same'},examinationReport:{private:1},examinationReportError:'old'};
      await registryReportingUI.load(s,async () => {const error=new Error('Source reconciliation');error.status=status;throw error;});
      const root=document.createElement('div');root.innerHTML=registryReportingUI.render(s);
      out.push({report:s.examinationReport,error:s.examinationReportError || null,retry:root.querySelectorAll('[data-examination-report-retry]').length,figures:root.querySelectorAll('[data-report-totals]').length});
      if(status === 409) {
        let retry;registryReportingUI.bind(root,s,{act:(work) => {retry=work();return retry;},api:async () => ({marker:'recovered'})});
        root.querySelector('[data-examination-report-retry]').click();await retry;
        if(s.examinationReport.marker !== 'recovered' || s.examinationReportError)throw new Error('Retry did not clear the source error');
      }
    }
    const root=document.createElement('div');root.innerHTML='<button data-examination-report-export></button>';
    const s={session:{token:'old'},examinationReport:{filters:{periodId:'PRIVATE'}}};let work,blobs=0;const previous=URL.createObjectURL;
    try {URL.createObjectURL=() => {blobs++;return 'private';};registryReportingUI.bind(root,s,{act:(fn) => {work=fn();return work;},api:async () => {s.session.token='new';return {csv:'PRIVATE',fileName:'private.csv'};}});root.querySelector('button').click();await work;out.push(blobs);}finally {URL.createObjectURL=previous;}
    return out;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'current'},...Array.from({length:3},() => ({report:null,error:null,retry:0,figures:0})),{report:null,error:'Source reconciliation',retry:1,figures:0},0]);
});
