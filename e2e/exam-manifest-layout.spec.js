import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('manifest layout fits long labels and fresh CSV downloads neutralize spreadsheet formulas',async ({page},info) => {
  await page.goto('/#registry');
  await page.waitForFunction(() => Boolean(window.registryExamsUI));
  await page.evaluate(() => {
    const root = document.querySelector('.page-container');
    const data = {sittingId:'layout',code:'EXM102',paper:'Extended examination paper for candidate room manifest review',sittingRevision:3,publishedRevision:5,publishedAt:'2026-10-05T07:00:00Z',digest:'a'.repeat(64),
      rooms:[{key:'hall',venue:'Main examination hall with a long descriptive location',location:'Science wing, ground floor',startsAt:'2026-10-10T07:00:00Z',durationMinutes:210,
        candidates:[{studentNumber:'S25000001',extraMinutes:30,endsAt:'2026-10-10T10:30:00Z',instruction:'Allow supervised rest breaks during the extended examination period.'},
          {studentNumber:'S25000002',extraMinutes:0,endsAt:'2026-10-10T10:00:00Z',instruction:'=SUM(1,2)'}]}]};
    const state = {examManifest:data,examManifestSelf:true};
    root.innerHTML = window.registryExamsUI.render(state);
    window.manifestReads = [];
    window.registryExamsUI.bind(root,state,{act:async (work) => work(),api:async (method,path) => {
      window.manifestReads.push({method,path});
      return {...data,paper:'\t=1+1',publishedRevision:6};
    }});
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.locator('[data-exam-manifest-panel] > .section-header').evaluate((header) => {
    const title = header.querySelector('h3').getBoundingClientRect(),close = header.querySelector('button').getBoundingClientRect();
    return title.right <= close.left && close.height >= 44;
  })).toBe(true);
  await page.locator('[data-exam-manifest-panel]').screenshot({path:info.outputPath('manifest-long-labels.png')});
  await page.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
  if (info.project.name === 'mobile') expect(await page.evaluate(() => {
    return document.querySelector('[data-exam-manifest-panel]').getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top;
  })).toBe(true);
  await page.screenshot({path:info.outputPath('manifest-scrolled-viewport.png')});
  const file = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();
  const download = await file,content = await readFile(await download.path(),'utf8');
  expect(download.suggestedFilename()).toBe('exam-candidates-layout-r6.csv');
  expect(content).toContain("'\t=1+1");expect(content).toContain('"\'=SUM(1,2)"');
  expect(content).toContain('S25000001');expect(content).toContain('S25000002');
  expect(await page.evaluate(() => window.manifestReads)).toEqual([{method:'GET',path:'/api/exams/me/sittings/layout/manifest'}]);
});
