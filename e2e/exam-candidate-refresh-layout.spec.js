import { test, expect } from '@playwright/test';

test('candidate refresh form fits and clears previously loaded manifest state',async ({page},info) => {
  await page.goto('/#registry');
  await page.waitForFunction(() => Boolean(window.registryExamsUI));
  await page.evaluate(() => {
    const sitting = {id:'candidate-layout',courseId:'course',code:'EXM102',paper:'Extended examination paper for candidate cohort revision',startsAt:'2099-10-10T07:00:00Z',durationMinutes:120,venue:'Main hall',status:'scheduled',revision:3,invigilators:[],arrangements:[]};
    const data = {period:{id:'period',name:'October examinations',programmeCode:'BSC',intakeLabel:'2026'},timetable:{status:'published',revision:5},sittings:[sitting],offerings:[],orders:[],venues:[],staff:[],clashes:[],capacity:[],deferredIssues:[],resourceIssues:[],arrangementIssues:[],deferredGroups:[],capabilities:{schedule:true,publish:false},candidateChanges:[{sittingId:sitting.id,added:1,removed:1,current:2,started:false}]};
    const state = {examPeriods:[data.period],examsOpen:true,examTimetable:data,examManifest:{code:'EXM102',paper:'Old manifest',publishedAt:'2026-10-05T07:00:00Z',rooms:[]}};
    const root = document.querySelector('.page-container');root.innerHTML = window.registryExamsUI.render(state);
    window.refreshReads = [];window.refreshState = state;
    window.registryExamsUI.bind(root,state,{act:async (work) => {await work();root.innerHTML = window.registryExamsUI.render(state);},api:async (method,path,input) => {
      window.refreshReads.push({method,path,input});
      return method === 'POST' ? {...data,timetable:{status:'draft',revision:6}} : [data.period];
    }});
  });
  const section = page.locator('[data-exam-candidate-changes]');
  await expect(section).toContainText('1 added, 1 removed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  const button = section.getByRole('button',{name:'Prepare candidate revision'});
  await button.evaluate((entry) => entry.scrollIntoView({block:'center',behavior:'instant'}));
  expect(await button.evaluate((entry) => {
    const bounds = entry.getBoundingClientRect(),navigation = document.querySelector('.mobile-nav');
    return entry.scrollWidth <= entry.clientWidth && bounds.height >= 44 && (getComputedStyle(navigation).display === 'none' || bounds.bottom <= navigation.getBoundingClientRect().top);
  })).toBe(true);
  await section.screenshot({path:info.outputPath('candidate-refresh-form.png')});
  await section.locator('[name="reason"]').fill('Prepare revised confirmed cohort');await button.click();
  await expect(page.locator('[data-exam-status]')).toHaveText('Draft revision 6');
  await expect(page.locator('[data-exam-manifest-panel]')).toHaveCount(0);
  await expect(page.locator('[data-exam-candidate-refresh]')).toHaveCount(0);
  expect(await page.evaluate(() => window.refreshReads)).toEqual([{method:'POST',path:'/api/exams/periods/period/refresh-candidates',input:{revision:5,reason:'Prepare revised confirmed cohort'}},{method:'GET',path:'/api/exams/periods'}]);
});
