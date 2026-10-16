import { test, expect } from '@playwright/test';

test('long arrangement titles and archive labels fit their controls',async ({page},info) => {
  await page.goto('/#registry');
  await page.waitForFunction(() => Boolean(window.registryExamArrangementsUI));
  await page.evaluate(() => {
    const paper = 'Extended examination paper for historical arrangement review';
    const data = {sitting:{id:'layout-sitting',code:'EXM102',paper,startsAt:'2026-10-10T07:00:00Z',durationMinutes:180,status:'cancelled'},cases:[],history:[],candidates:[],venues:[],staff:[],capabilities:{manage:false,request:false,review:false}};
    const history = {q:'',status:'all',limit:25,offset:0,total:2,items:[1,2].map((number) => ({id:`layout-case-${number}`,sittingId:'layout-sitting',studentNumber:`S2500000${number}`,code:'EXM102',paper,startsAt:'2026-10-10T07:00:00Z',status:'returned',sittingStatus:'cancelled',intakeLabel:'SAMPLE historical programme intake with a long descriptive label'}))};
    document.querySelector('.page-container').innerHTML = `<section class="registry-workspace">${window.registryExamArrangementsUI.render({arrangementHistory:history,arrangementHistoryOpen:true,examArrangements:data})}</section>`;
  });
  await expect(page.locator('[data-arrangement-panel]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  for (const button of await page.locator('[data-arrangements-close],[data-arrangement-history-open]').all()) {
    expect(await button.evaluate((element) => {
      const parent = element.getBoundingClientRect(),range = document.createRange();range.selectNodeContents(element);
      return [...range.getClientRects()].every((rect) => rect.left >= parent.left-1 && rect.right <= parent.right+1 && rect.top >= parent.top-1 && rect.bottom <= parent.bottom+1);
    })).toBe(true);
  }
  expect(await page.locator('[data-arrangement-panel] > .section-header').evaluate((header) => {
    const title = header.querySelector('h2').getBoundingClientRect(),close = header.querySelector('button').getBoundingClientRect();
    return title.right <= close.left && close.height >= 44;
  })).toBe(true);
  await page.screenshot({path:info.outputPath('arrangement-long-title-layout.png'),fullPage:true});
});
