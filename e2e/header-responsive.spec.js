import {test,expect} from '@playwright/test';

test('full staff navigation stays inside the header at normal laptop widths',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('svu.registry.session',JSON.stringify({token:'header-layout-fixture'})));
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  let data=[];
  if(path==='/api/identity/me')data={account:{id:'fixture',email:'admin@example.test'},person:{preferredName:'Admin',legalName:'System Admin'},
   permissions:['registry.view','foundation.view','sharing.read','teaching.self','admissions.review'],roles:[{code:'system_administrator'}],mfa:{enrolled:true}};
  if(path==='/api/notifications/me')data={unread:0,items:[]};
  if(path==='/api/me/work-summary')data={tasks:0,support:0};
  if(path==='/api/teaching/me')data={allocations:[]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
 });
 for(const width of [1024,1199,1200,1280,1366,1399,1400,1440,1536,1920]){
  await page.setViewportSize({width,height:768});await page.goto('/#home');
  await expect(page.locator('.system-admin-home')).toBeVisible();
  await expect(page.locator('.nav-links a')).toHaveCount(7);
  const header=await page.locator('.top-nav').boundingBox();
  for(const link of await page.locator('.nav-links a').all()){
   const box=await link.boundingBox();
   expect(box.y,`navigation top at ${width}`).toBeGreaterThanOrEqual(header.y);
   expect(box.y+box.height,`navigation bottom at ${width}`).toBeLessThanOrEqual(header.y+header.height);
  }
  await expect(page.locator('[data-shell-command]')).toBeVisible();
  if(width<1400)await expect(page.locator('[data-shell-search]')).toBeHidden();
  else await expect(page.locator('[data-shell-search]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
 await page.setViewportSize({width:1280,height:768});
 await page.locator('[data-shell-command]').click();
 await expect(page.getByRole('dialog',{name:'Search SVU'})).toBeVisible();
});
