import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';

// Read-only journeys; the integration runner supplies disposable demo data by default.
// The base seed has no student records, so add the walkthrough data on isolated databases (it is rerunnable).
test.beforeAll(() => {
  test.setTimeout(180000);
  if (process.env.DATABASE_URL && /^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) {
    execFileSync(process.execPath, ['scripts/seed-walkthrough.js'], {env: process.env, timeout: 180000, stdio: 'pipe'});
  }
});
let cachedSession;
async function signIn(page) {
  if(cachedSession){
    await page.addInitScript(session=>sessionStorage.setItem('svu.registry.session',JSON.stringify(session)),cachedSession);
    return;
  }
  await page.goto('/#signin');
  await page.locator('[data-shell-signin] [name=email]').fill(process.env.SVU_LAYOUT_TEST_USERNAME || 'admin@southvalley.test');
  await page.locator('[data-shell-signin] [name=password]').fill(process.env.SVU_LAYOUT_TEST_PASSWORD || 'Phase1-Admin-Password-2026!');
  await page.locator('[data-shell-signin] button[type=submit]').click();
  await expect(page.locator('[data-shell-signin]')).toHaveCount(0);
  cachedSession=await page.evaluate(()=>window.svuSession.get());
}
async function top(locator) { return locator.evaluate(node => node.getBoundingClientRect().top); }
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test('student chooser stays available while the record scrolls, with reachable search and paging', async ({page}, info) => {
  await signIn(page);
  await page.goto('/#registry/students');
  await page.locator('[data-registry-detail]').first().click();
  await expect(page.locator('#record-overview')).toBeVisible();
  const picker = page.locator('.record-workbench .workspace-picker');
  const results = picker.locator('.workspace-picker-results');
  // Long pages are a layout condition, independent of the number of records in the test database.
  await results.evaluate(node => { for(let i=0;i<35;i++){const row=node.firstElementChild.cloneNode(true);row.removeAttribute('data-registry-detail');node.append(row);} });
  if (info.project.name === 'mobile') {
    await expect(picker).toHaveCSS('position','static');
    await expect(page.locator('.record-jump')).toHaveCSS('position','static');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    return;
  }
  const detailTop = await top(page.locator('#record-overview'));
  await page.evaluate(() => scrollBy(0,600));await settle(page);
  const boundary = await page.locator('.registry-workspace').evaluate(node => parseFloat(getComputedStyle(node).getPropertyValue('--workspace-top')));
  expect(await top(picker)).toBeGreaterThanOrEqual(boundary);
  expect(await top(picker)).toBeLessThan(boundary + 15);
  expect(await top(page.locator('#record-overview'))).toBeLessThan(detailTop - 200);
  await expect(picker.locator('[data-registry-filter]')).toBeInViewport();
  await expect(picker.locator('.staff-pager')).toBeInViewport();
  await results.hover();await page.mouse.wheel(0,500);await settle(page);
  expect(await results.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(picker.locator('[data-registry-filter]')).toBeInViewport();
  const jump = page.locator('.record-jump');
  expect(await top(jump)).toBeGreaterThanOrEqual(boundary);
  await page.locator('[data-record-jump="record-finance"]').click();await page.waitForTimeout(600);
  expect(await top(page.locator('#record-finance'))).toBeGreaterThanOrEqual((await jump.boundingBox()).y + (await jump.boundingBox()).height - 2);
  await page.screenshot({path:info.outputPath('students-sticky.png'),fullPage:false});
});

test('academic tabs and catalogue stay beside the editor, with narrow and short screen fallbacks', async ({page}, info) => {
  await signIn(page);await page.goto('/#registry/academic');
  await page.getByRole('tab',{name:'Courses',exact:true}).click();
  const picker=page.locator('.academic-list');
  await expect(picker.locator('[data-academic-action="select"]').first()).toBeVisible();
  await picker.locator('[data-academic-action="select"]').first().click();
  await page.locator('.academic-detail').evaluate(node => {const block=document.createElement('div');block.style.height='1800px';node.append(block);});
  await page.evaluate(()=>scrollBy(0,600));await settle(page);
  if(info.project.name==='mobile') {
    await expect(picker).toHaveCSS('position','static');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  } else {
    const tabs=page.locator('.academic-tabs');
    expect(await top(picker)).toBeGreaterThanOrEqual((await tabs.boundingBox()).y+(await tabs.boundingBox()).height);
    await expect(picker.locator('[data-academic-action="new"]')).toBeInViewport();
    const results=picker.locator('.workspace-picker-results');
    const saved=await results.evaluate(node=>{node.scrollTop=250;return node.scrollTop;});
    await picker.locator('[data-academic-action="select"]').first().evaluate(node=>node.click());
    await expect.poll(()=>results.evaluate(node=>node.scrollTop)).toBe(saved);
    await page.setViewportSize({width:1440,height:450});await settle(page);
    await expect(picker).toHaveCSS('position','static');
    await expect(tabs).toHaveCSS('position','static');
  }
});

test('account chooser stays beside account actions',async({page},info)=>{
  await signIn(page);await page.goto('/#foundation');
  await page.locator('[data-system-tab="accounts"]').click();
  const picker=page.locator('.system-accounts .workspace-picker');
  await expect(picker.locator('[data-system-account]').first()).toBeVisible();
  await picker.locator('[data-system-account]').first().click();
  await expect(page.locator('[data-system-account-detail] .staff-record-hero')).toBeVisible();
  await page.locator('[data-system-account-detail]').evaluate(node=>{const block=document.createElement('div');block.style.height='1800px';node.append(block);});
  await page.evaluate(()=>scrollBy(0,600));await settle(page);
  if(info.project.name==='mobile')await expect(picker).toHaveCSS('position','static');
  else {
    await expect(picker.locator('[data-system-account-filter]')).toBeInViewport();
    await expect(picker.locator('.staff-pager')).toBeInViewport();
    const boundary=await page.locator('.registry-workspace').evaluate(node=>parseFloat(getComputedStyle(node).getPropertyValue('--workspace-top')));
    expect(await top(picker)).toBeGreaterThanOrEqual(boundary);
    expect(await top(picker)).toBeLessThan(140);
  }
});

for(const [area,panel,filter,results] of [
  ['admin','[data-staff-panel]','[data-staff-filter]','Staff search results'],
  ['assets','.asset-workspace','[data-asset-filter]','Asset register results'],
  ['leave','.staff-leave','[data-leave-filter]','Leave requests results'],
  ['cashbook','.cashbook-workspace',null,'Cashbook list'],
]) test(`${area} keeps its chooser separate from forms and selected detail`,async({page},info)=>{
  await signIn(page);await page.goto(`/#registry/${area}`);
  const section=page.locator(panel);
  if(area==='admin')await section.locator(':scope > summary').click();
  const picker=section.locator('.workspace-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('region',{name:results,exact:true})).toBeVisible();
  if(filter)await expect(picker.locator(filter)).toBeVisible();
  expect(await picker.locator('[data-staff-create], [data-asset-create], [data-leave-new], [data-cb-form]').count()).toBe(0);
  if(area==='admin'){
    await picker.locator('[data-staff-detail]').first().click();
    await expect(section.locator('[data-staff-record]')).toBeVisible();
  }
  await section.locator('.review-detail').evaluate(node=>{const block=document.createElement('div');block.style.height='1800px';node.append(block);});
  await picker.evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+300));await settle(page);
  if(info.project.name==='mobile')await expect(picker).toHaveCSS('position','static');
  else {
    await expect(picker).toHaveCSS('position','sticky');
    expect(await top(picker)).toBeCloseTo(await picker.evaluate(node=>parseFloat(getComputedStyle(node).top)),0);
    if(filter)await expect(picker.locator(filter)).toBeInViewport();
    if(area==='assets'){
      await page.setViewportSize({width:1440,height:560});await settle(page);
      await expect(picker).toHaveCSS('position','static');
    }
  }
});

test('tabular work areas keep column headings inside the table and release them on mobile and print',async({page},info)=>{
  const {readFile}=await import('node:fs/promises');
  const css=(await Promise.all(['styles','svu-ui','student','academic-setup','staff','premium-ui','workspace-layout'].map(name=>readFile(`src/${name}.css`,'utf8')))).join('\n');
  const script=await readFile('src/workspace-layout.js','utf8');
  await page.setContent(`<style>${css}</style><header class="top-nav">Header</header><main><section class="registry-workspace"><nav class="workspace-tabs">Areas</nav><div class="staff-body" data-staff-body="reports"><section><h2>Results report</h2><div class="result-table-wrap"><table><thead><tr><th>Student</th><th>Mark</th></tr></thead><tbody>${Array.from({length:60},(_,i)=>`<tr><td>Student ${i+1}</td><td>70</td></tr>`).join('')}</tbody></table></div></section></div></section></main>`);
  await page.addScriptTag({content:script});await page.evaluate(()=>window.svuWorkspaceLayout.enhance(document));
  const region=page.getByRole('region',{name:'Results report table'}),heading=region.locator('th').first();
  await expect(region).toHaveAttribute('tabindex','0');
  if(info.project.name==='desktop'){
    await region.evaluate(node=>{node.scrollTop=600;});await settle(page);
    expect(await region.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    const border=await region.evaluate(node=>parseFloat(getComputedStyle(node).borderTopWidth));
    expect(await top(heading)).toBeCloseTo(await top(region)+border,0);
    expect(await page.evaluate(()=>scrollY)).toBe(0);
    await page.locator('.top-nav').evaluate(node=>{node.style.height='96px';});await settle(page);
    await expect(page.locator('.workspace-tabs')).toHaveCSS('top','96px');
    await page.emulateMedia({media:'print'});
    await expect(region).toHaveCSS('max-height','none');
    await expect(heading).toHaveCSS('position','static');
  } else await expect(region).toHaveCSS('max-height','none');
});

for(const area of ['admissions','fleet'])test(`${area} pins its own queue or view controls below workspace navigation`,async({page},info)=>{
  await signIn(page);await page.goto(area==='admissions'?'/#admissions':'/#registry/fleet');
  const control=page.locator(area==='admissions'?'.admissions-page .review-queue':'.fleet-toolbar');
  await expect(control).toBeVisible();
  // The queue re-renders once its reads finish; lengthen the page only after that, or the block is discarded.
  await page.waitForLoadState('networkidle');await settle(page);
  const detail=page.locator(area==='admissions'?'.review-application':'.fleet-workspace');
  await detail.evaluate(node=>{const block=document.createElement('div');block.dataset.layoutFiller='';block.style.height='1800px';node.append(block);});
  await expect(page.locator('[data-layout-filler]')).toHaveCount(1);
  await control.evaluate(node=>scrollTo(0,scrollY+node.getBoundingClientRect().top+300));await settle(page);
  if(info.project.name==='mobile')await expect(control).toHaveCSS('position','static');
  else {
    await expect(control).toHaveCSS('position','sticky');
    expect(await top(control)).toBeCloseTo(await control.evaluate(node=>parseFloat(getComputedStyle(node).top)),0);
  }
});
