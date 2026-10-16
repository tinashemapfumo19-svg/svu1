import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('publication history fits long metadata and historical export pins the selected seating edition',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryExamsUI));
  await page.evaluate(() => {
    const row = {periodId:'history',revision:7,programmeCode:'BSC',name:'October examination publication with a long academic period name',intakeLabel:'Science and technology extended intake label',publishedAt:'2026-10-05T07:00:00Z',origin:'published',sittingCount:1};
    const edition = {...row,reason:'Independent timetable review',digest:'d'.repeat(64),sittings:[{id:'sitting',code:'EXM102',paper:'Extended examination paper',startsAt:'2099-10-10T07:00:00Z',durationMinutes:120,venue:'Main examination hall',candidateCount:1,manifestAvailable:true,invigilators:[{employeeNumber:'E1',legalName:'Examination colleague',role:'lead'}]}]};
    const manifest = {archived:true,periodId:'history',sittingId:'sitting',code:'EXM102',paper:'Extended examination paper for the historical candidate room',publishedRevision:7,publishedAt:row.publishedAt,sittingRevision:3,digest:'a'.repeat(64),publicationDigest:edition.digest,seatRevision:2,seating:{revision:2,digest:'b'.repeat(64)},seatingEditions:[{revision:2,publishedAt:row.publishedAt,assigned:1}],
      rooms:[{key:'main',venue:'Main examination hall with long room metadata',location:'Science wing, ground floor',startsAt:'2099-10-10T07:00:00Z',durationMinutes:120,candidates:[{studentNumber:'S25000001',seat:'A-2',extraMinutes:0,endsAt:'2099-10-10T09:00:00Z',instruction:'Operational instruction'}]}]};
    const state = {examPublications:{items:[row],total:1,q:'',offset:0,limit:25},examPublicationsOpen:true,examPublication:edition,examManifest:manifest},root = document.querySelector('.page-container');window.historyReads = [];
    const bind = () => window.registryExamsUI.bind(root,state,{act:async (work) => {await work();root.innerHTML = window.registryExamsUI.render(state);bind();},api:async (method,path) => {
      window.historyReads.push({method,path});
      const original = path.endsWith('seatRevision=0');return {...manifest,seatRevision:original ? 0 : 2,seating:original ? undefined : manifest.seating,rooms:manifest.rooms.map((room) => ({...room,candidates:room.candidates.map((candidate) => ({...candidate,seat:original ? undefined : candidate.seat}))}))};
    }});root.innerHTML = window.registryExamsUI.render(state);bind();
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.locator('[data-exam-publication-panel] > .section-header').evaluate((header) => {
    const title = header.querySelector('h3').getBoundingClientRect(),close = header.querySelector('button').getBoundingClientRect();return title.right <= close.left && close.height >= 44;
  })).toBe(true);
  await page.locator('[data-exam-publication-panel]').screenshot({path:info.outputPath('publication-long-labels.png')});
  await page.locator('[data-publication-seating]').selectOption('0');await expect(page.locator('[data-exam-manifest-panel]')).not.toContainText('A-2');
  await page.locator('[data-publication-seating]').selectOption('2');await expect(page.locator('[data-exam-manifest-panel]')).toContainText('A-2');
  await page.locator('[data-manifest-candidate]').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await page.locator('[data-manifest-candidate]').evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('historical-manifest-viewport.png')});
  const file = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();const downloaded = await file,content = await readFile(await downloaded.path(),'utf8');
  expect(downloaded.suggestedFilename()).toContain('-historical-seats-2');expect(content).toContain('A-2');expect(content).toContain('d'.repeat(64));
  expect(await page.evaluate(() => window.historyReads.at(-1))).toEqual({method:'GET',path:'/api/exams/periods/history/publications/7/sittings/sitting/manifest?seatRevision=2'});
  await page.getByRole('button',{name:'Close publication'}).click();await expect(page.locator('[data-exam-publication-panel]')).toHaveCount(0);await expect(page.locator('[data-exam-manifest-panel]')).toHaveCount(0);
});
