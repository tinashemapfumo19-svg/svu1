import {test,expect} from '@playwright/test';

const row = (id,title = id) => ({id,title,collectionId:'C',status:'published',currentVersion:1,keywords:[id],resourceType:id === 'book' ? 'book' : null});
const list = (items,name = 'Synthetic collection') => ({total:items.length,items,collections:[{id:'C',name,status:'active'}],capabilities:{}});
async function mount(page,handler) {
  await page.addInitScript(() => sessionStorage.setItem('svu.applicant.session',JSON.stringify({token:'first'})));
  await page.route('**/api/**',async (route) => {
    if(new URL(route.request().url()).pathname.startsWith('/api/repository'))await handler(route);
    else await route.fulfill({json:{data:null}});
  });
  await page.goto('/#resources');
}
async function changeSession(page,token) {
  await page.evaluate((value) => {
    if(value)sessionStorage.setItem('svu.applicant.session',JSON.stringify({token:value}));
    else sessionStorage.clear();
    window.renderResources(document.querySelector('#app'));
  },token);
}
const detail = {item:row('private','FIRST PRIVATE TITLE'),collection:{name:'FIRST PRIVATE COLLECTION',classification:'confidential'},versions:[{version:1,status:'published',fileName:'private.pdf',sizeBytes:24,changeNote:'Synthetic version'}],access:null,capabilities:{download:true},accountId:'first'};

test('repository loading disables controls and serializes filter reset and keyword search',async ({page},info) => {
  let release,entered;const gate=new Promise((ok) => {release=ok;}),started=new Promise((ok) => {entered=ok;});const searches=[];
  await mount(page,async (route) => {
    const type=new URL(route.request().url()).searchParams.get('resourceType') || '';searches.push(type);
    if(type === 'book'){entered();await gate;}
    await route.fulfill({json:{data:list(type === 'book' ? [row('book')] : [row('book'),row('handbook')])}});
  });
  await expect(page.locator('[data-resource-item="handbook"]')).toBeVisible();
  await page.locator('[name="resourceType"]').selectOption('book');await page.locator('[data-resource-search] button').click();await started;
  try {
    await expect(page.locator('.resources-page')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('[name="resourceType"]')).toBeDisabled();
    await expect(page.locator('[data-resource-keyword="handbook"]')).toBeDisabled();
    await page.screenshot({path:info.outputPath('repository-busy.png')});
  }finally {release();}
  await expect(page.locator('.resources-page')).toHaveAttribute('aria-busy','false');
  await page.locator('[name="resourceType"]').selectOption('');await page.locator('[data-resource-search] button').click();
  await page.locator('[data-resource-keyword="handbook"]').click();
  await expect(page.locator('.resources-page')).toHaveAttribute('aria-busy','false');
  expect(searches.slice(0,3)).toEqual(['','book','']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
});

test('repository token changes clear private details, viewers, choices and departed responses without a reload',async ({page}) => {
  let release,entered;const gate=new Promise((ok) => {release=ok;}),started=new Promise((ok) => {entered=ok;});const calls=[];
  await page.route('**/synthetic-private-view',route => route.fulfill({contentType:'text/html',body:'Synthetic private viewer'}));
  await mount(page,async (route) => {
    const req=route.request(),url=new URL(req.url()),first=req.headers().authorization === 'Bearer first';calls.push(first?'first':'second');
    if(url.pathname.endsWith('/access'))return route.fulfill({json:{data:{url:'/synthetic-private-view',fileName:'private.pdf'}}});
    if(url.pathname.includes('/items/'))return route.fulfill({json:{data:detail}});
    if(first && url.searchParams.get('q') === 'held'){entered();await gate;}
    await route.fulfill({json:{data:first ? list([row('private','FIRST PRIVATE TITLE')],'FIRST PRIVATE COLLECTION') : list([row('second','SECOND AUTHORIZED TITLE')],'SECOND AUTHORIZED COLLECTION')}});
  });
  await page.locator('[data-resource-open="private"]').click();await page.locator('[data-resource-access="view"]').click();
  await expect(page.locator('[data-resource-viewer]')).toBeVisible();
  await changeSession(page,'second');
  await expect(page.locator('[data-resource-viewer]')).toHaveCount(0);await expect(page.locator('[data-resource-detail]')).toHaveCount(0);
  await expect(page.locator('[data-resource-item="second"]')).toBeVisible();
  await expect(page.locator('.resources-page')).not.toContainText('FIRST PRIVATE');
  await changeSession(page,'first');await expect(page.locator('[data-resource-item="private"]')).toBeVisible();
  await page.locator('[name="q"]').fill('held');await page.locator('[data-resource-search] button').click();await started;
  try {await changeSession(page,'second');await expect(page.locator('[data-resource-item="private"]')).toHaveCount(0);}finally {release();}
  await expect(page.locator('[data-resource-item="second"]')).toBeVisible();await expect(page.locator('.resources-page')).not.toContainText('FIRST PRIVATE');
  expect(calls).toContain('second');
  await changeSession(page,null);await expect(page.locator('[data-resource-item]')).toHaveCount(0);await expect(page.locator('.resources-page')).not.toContainText('SECOND AUTHORIZED');
});

test('repository stale downloads create no file and authority refusals clear private figures with authorized retry',async ({page}) => {
  let release,entered,status=200;const gate=new Promise((ok) => {release=ok;}),started=new Promise((ok) => {entered=ok;});let downloads=0,downloadRequests=0;
  page.on('download',() => downloads++);
  await page.route('**/synthetic-private-download',async (route) => {
    downloadRequests++;
    await route.fulfill({contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename="private.pdf"'},body:'Synthetic private download'});
  });
  await mount(page,async (route) => {
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/access')){entered();await gate;return route.fulfill({json:{data:{url:'/synthetic-private-download',fileName:'private.pdf'}}});}
    if(url.pathname.includes('/items/'))return route.fulfill({json:{data:detail}});
    if(status !== 200)return route.fulfill({status,json:{error:{message:'Authority refused'}}});
    await route.fulfill({json:{data:list([row('private','SYNTHETIC AUTHORIZED TITLE')])}});
  });
  await page.locator('[data-resource-open="private"]').click();await page.locator('[data-resource-access="download"]').click();await started;
  try {await changeSession(page,'second');await expect(page.locator('[data-resource-detail]')).toHaveCount(0);}finally {release();}
  await expect(page.locator('[data-resource-item="private"]')).toBeVisible();expect(downloads).toBe(0);expect(downloadRequests).toBe(0);
  for(const denied of [401,403,404]) {
    status=denied;await page.locator('[data-resource-search] button').click();
    await expect(page.getByRole('status')).toHaveText('Authority refused');await expect(page.locator('[data-resource-item]')).toHaveCount(0);
    await expect(page.locator('[data-resource-detail], [data-resource-viewer], [data-resource-search]')).toHaveCount(0);
    status=200;await page.getByRole('button',{name:'Refresh documents'}).click();await expect(page.locator('[data-resource-item="private"]')).toBeVisible();
  }
});
