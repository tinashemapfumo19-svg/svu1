import {test,expect} from '@playwright/test';
import {assessmentMetrics} from '../server/modules/assessment-reporting.js';

test('assessment loaders discard departed, superseded and revoked state and stale exports',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.assessmentReportingUI));
  expect(await page.evaluate(async () => {
    const output=[];
    for(const failure of [false,true]) {const state={session:{token:'old'}};let deliver,reject;const deferred=new Promise((ok,no) => {deliver=ok;reject=no;});const work=assessmentReportingUI.load(state,() => deferred);state.session.token='new';state.assessmentReport={marker:'new'};if(failure)reject(new Error('Private old failure'));else deliver({marker:'old'});await work;output.push(state.assessmentReport);}
    const state={session:{token:'same'}};let deliver;const old=new Promise((ok) => {deliver=ok;}),pending=assessmentReportingUI.load(state,() => old);await assessmentReportingUI.load(state,async () => ({marker:'current',filters:{}}));deliver({marker:'old'});await pending;output.push(state.assessmentReport);
    for(const status of [401,403,404]) {const s={session:{token:'same'},assessmentReport:{private:1},assessmentReportMetadata:{private:2},assessmentReportFilters:{intakeId:'private'}};await assessmentReportingUI.load(s,async () => {const e=new Error('Denied');e.status=status;throw e;});output.push(Object.keys(s));}
    const s={session:{token:'same'},assessmentReport:{private:1}};await assessmentReportingUI.load(s,async (_m,path) => {if(path.endsWith('/metadata'))return {availableIntakes:[],availablePeriods:[],availableCourses:[]};throw new Error('Reconcile source');});output.push({report:s.assessmentReport,error:s.assessmentReportError});
    const root=document.createElement('div');root.innerHTML='<button data-assessment-report-export></button>';const selected={session:{token:'old'},assessmentReport:{filters:{intakeId:'PRIVATE'}}};let work,blobs=0;const previous=URL.createObjectURL;URL.createObjectURL=() => {blobs++;return 'private';};
    try {assessmentReportingUI.bind(root,selected,{act:(fn) => {work=fn();return work;},api:async () => {selected.session.token='new';return {csv:'PRIVATE',filename:'private.csv'};}});root.querySelector('button').click();await work;output.push(blobs);}finally{URL.createObjectURL=previous;}
    return output;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'current',filters:{}},['session'],['session'],['session'],{report:null,error:'Reconcile source'},0]);
});

test('assessment report controls filter dependent periods/courses, escape metadata and fit the viewport',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.assessmentReportingUI));
  const result=await page.evaluate(async (metrics) => {
    const counts=Object.fromEntries(metrics.map((m) => [m.id,m.unit === 'hours' ? null : 0]));const metadata={availableIntakes:[{intakeId:'I1',programmeCode:'LONG_PROGRAMME_CODE_WITHOUT_SPACES',label:'=Synthetic <intake> with a long visible label'},{intakeId:'I2',programmeCode:'P2',label:'Second intake'}],availablePeriods:[{periodId:'P1',intakeId:'I1',periodName:'First period'},{periodId:'P2',intakeId:'I2',periodName:'Second period'}],availableCourses:[{courseId:'C1',periodId:'P1',intakeId:'I1',code:'LONG_COURSE_IDENTIFIER',title:'Synthetic <course> with a long title'},{courseId:'C2',periodId:'P2',intakeId:'I2',code:'SECOND',title:'Second course'}]};
    const state={session:{token:'same'},assessmentReportOpen:true,assessmentReport:{...metadata,filters:{intakeId:'',periodId:'P2',courseId:'C2'},generatedAt:'2026-10-05T12:00:00Z',definitionVersion:'synthetic-assessment-v1',metrics,totals:counts,rows:[{...metadata.availableCourses[0],programmeCode:metadata.availableIntakes[0].programmeCode,intakeLabel:metadata.availableIntakes[0].label,periodName:'Long source period with synthetic metadata',counts,controls:{source:true}}],controls:{source:true}}};
    const root=document.createElement('div');root.innerHTML=assessmentReportingUI.render(state);document.querySelector('#app').replaceChildren(root);let work,captured;
    assessmentReportingUI.bind(root,state,{act:(fn) => {work=fn();return work;},api:async (_method,path) => {captured=Object.fromEntries(new URL(path,location.origin).searchParams);return {...state.assessmentReport,filters:captured};}});
    const form=root.querySelector('form');form.elements.intakeId.value='I1';form.elements.intakeId.dispatchEvent(new Event('change'));const options={period:form.elements.periodId.value,course:form.elements.courseId.value,wrongPeriod:form.elements.periodId.querySelector('[value="P2"]').disabled,wrongCourse:form.elements.courseId.querySelector('[value="C2"]').disabled};form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await work;
    return {options,captured,unsafeElements:root.querySelectorAll('script,iframe').length,rows:root.querySelectorAll('[data-assessment-report-offering]').length,oldest:root.querySelector('[data-assessment-report-metric="oldestSubmittedHours"] td:last-child').textContent};
  },assessmentMetrics);
  expect(result).toEqual({options:{period:'',course:'',wrongPeriod:true,wrongCourse:true},captured:{intakeId:'I1',periodId:'',courseId:''},unsafeElements:0,rows:1,oldest:'-'});
  expect(await page.locator('[data-assessment-report-offering] td:nth-child(2)').evaluate((cell) => cell.getBoundingClientRect().width)).toBeGreaterThanOrEqual(220);
  await expect(page.locator('[data-assessment-report-metric="oldestSubmittedHours"] td:first-child')).toHaveText('Oldest submitted sheet age (UTC hours)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);await page.locator('[data-assessment-report]').screenshot({path:info.outputPath('assessment-report-layout.png')});await page.screenshot({path:info.outputPath('assessment-report-layout-viewport.png')});
});
