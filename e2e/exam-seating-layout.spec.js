import { test, expect } from '@playwright/test';

test('seating workspace fits long labels and submits exact source-bound draft assignments',async ({page},info) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.registryExamsUI));
  await page.evaluate(() => {
    const data = {sittingId:'seat-layout',code:'EXM102',paper:'Extended examination paper with individual candidate seating review',digest:'a'.repeat(64),publishedRevision:5,
      rooms:[{key:'main',venue:'Main examination hall with a long descriptive location',location:'Science wing, ground floor',candidates:[{studentNumber:'S25000001'},{studentNumber:'S25000002'}]},
        {key:'quiet',venue:'Quiet supervised examination room',location:'Accessible ground floor',candidates:[{studentNumber:'S25000003'}]}],plan:null,capabilities:{prepare:true,publish:true},accountId:'maker',started:false};
    const state = {examSeating:data,examManifest:{code:'EXM102',paper:'Cached manifest',publishedAt:'2026-10-05T07:00:00Z',rooms:[]}},root = document.querySelector('.page-container');
    root.innerHTML = window.registryExamsUI.render(state);window.seatWrites = [];
    const bind = () => window.registryExamsUI.bind(root,state,{act:async (work) => {await work();root.innerHTML = window.registryExamsUI.render(state);bind();},api:async (method,path,input) => {
      window.seatWrites.push({method,path,input});
      return {...data,plan:{revision:input.revision+1,status:'draft',entries:input.entries,preparedBy:'maker',publishedSnapshot:null,stale:false}};
    }});bind();
  });
  const panel = page.locator('[data-exam-seating-panel]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await panel.locator('.section-header').evaluate((header) => {
    const title = header.querySelector('h3').getBoundingClientRect(),close = header.querySelector('button').getBoundingClientRect();
    return title.right <= close.left && close.width >= 44 && close.height >= 44;
  })).toBe(true);
  await page.locator('[data-seat-candidate="S25000001"]').fill('A-1');await page.locator('[data-seat-candidate="S25000002"]').fill('A-2');await page.locator('[data-seat-candidate="S25000003"]').fill('Q-1');
  await panel.screenshot({path:info.outputPath('seating-long-labels.png')});
  const save = page.getByRole('button',{name:'Save seating draft'});await save.evaluate((button) => button.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await save.evaluate((button) => button.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('seating-controls-viewport.png')});
  await panel.locator('[name="reason"]').fill('Checked physical room labels');await save.click();
  await expect(panel).toContainText('Draft seating revision 1');await expect(page.locator('[data-exam-manifest-panel]')).toHaveCount(0);
  await expect(page.locator('[data-seating-publish-blocked]')).toBeVisible();
  expect(await page.evaluate(() => window.seatWrites[0])).toEqual({method:'POST',path:'/api/exams/sittings/seat-layout/seating',input:{revision:0,publishedRevision:5,manifestDigest:'a'.repeat(64),reason:'Checked physical room labels',entries:[
    {roomKey:'main',studentNumber:'S25000001',seat:'A-1'},{roomKey:'main',studentNumber:'S25000002',seat:'A-2'},{roomKey:'quiet',studentNumber:'S25000003',seat:'Q-1'}
  ]}});
  await page.locator('[data-exam-seating-clear]').click();await panel.locator('[name="reason"]').fill('Prepare optional seat withdrawal');await save.click();
  await expect(panel).toContainText('Draft seating revision 2');expect(await page.evaluate(() => window.seatWrites[1].input.entries)).toEqual([]);
  await page.getByRole('button',{name:'Close seating'}).click();await expect(panel).toHaveCount(0);
});
