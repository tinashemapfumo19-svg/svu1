import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { populatedPreviewFiles, previewGreenPixels } from './repository-preview-fixture.js';

// Synthetic routes only: this probe never authenticates or writes university records.
const base = new URL(process.env.SVU_BASE_URL || 'http://127.0.0.1:4177');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Preview probe requires a loopback server.');
const channel = process.env.SVU_BROWSER_CHANNEL || 'headless-shell';
if (!['headless-shell','chromium','chrome','msedge'].includes(channel)) throw new Error('Unsupported preview probe browser channel.');
const output = path.resolve('data/repository-preview-probe',channel);
await mkdir(output, { recursive: true });
const browser = await chromium.launch(process.env.SVU_BROWSER_CHANNEL ? {channel:process.env.SVU_BROWSER_CHANNEL} : {});
const observations = [];
try {
  const {pdf,png} = await populatedPreviewFiles(browser);
  await writeFile(path.join(output,'sample.pdf'),pdf);
  await writeFile(path.join(output,'sample.png'),png);
  for (const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844,isMobile:true,hasTouch:true}]) {
    for (const [format, bytes] of [['pdf',pdf],['png',png]]) {
      const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:!!viewport.isMobile,hasTouch:!!viewport.hasTouch});
      try {
        const page = await context.newPage();
        const contentType = format === 'pdf' ? 'application/pdf' : 'image/png';
        const item = {id:'private',title:'Synthetic populated preview',collectionId:'C',status:'published',currentVersion:1,keywords:[]};
        let requests = 0;
        await page.addInitScript(() => sessionStorage.setItem('svu.applicant.session',JSON.stringify({token:'synthetic-preview'})));
        await page.route('**/api/**',async route => {
          const pathname = new URL(route.request().url()).pathname;
          let data = null;
          if (pathname.endsWith('/items/private/access')) data = {url:'/synthetic-populated-view',fileName:`sample.${format}`,mode:'view',version:1};
          else if (pathname.endsWith('/items/private')) data = {item,collection:{name:'Synthetic collection',classification:'public'},versions:[{version:1,status:'published',fileName:`sample.${format}`,contentType,sizeBytes:bytes.length}],access:null,capabilities:{download:false},accountId:'synthetic-preview'};
          else if (pathname === '/api/repository') data = {items:[item],total:1,collections:[{id:'C',name:'Synthetic collection',status:'active'}],capabilities:{}};
          await route.fulfill({json:{data}});
        });
        await page.route('**/synthetic-populated-view',async route => {
          requests++;
          await route.fulfill({contentType,headers:{'Content-Disposition':`inline; filename="sample.${format}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'},body:bytes});
        });
        await page.goto(new URL('/#resources',base).href);
        await page.locator('[data-resource-open="private"]').click();
        await page.locator('[data-resource-access="view"]').click();
        const viewer = page.locator('[data-resource-viewer]');
        await viewer.waitFor({state:'visible'});
        let greenPixels = 0, screenshot;
        const deadline = Date.now() + 7000;
        do {
          screenshot = await viewer.screenshot();
          greenPixels = await previewGreenPixels(page,screenshot);
          if (greenPixels >= 1000) break;
          await page.waitForTimeout(250);
        } while (Date.now() < deadline);
        const name = `${viewport.name}-${format}`;
        await writeFile(path.join(output,`${name}-viewer.png`),screenshot);
        await page.screenshot({path:path.join(output,`${name}-page.png`),fullPage:true});
        const observation = {viewport:viewport.name,format,requests,greenPixels,rendered:greenPixels>=1000,overflow:await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)};
        observations.push(observation);
        console.log(JSON.stringify(observation));
      } finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output,'observations.json'),JSON.stringify({scope:'Synthetic inline viewer diagnostic; not native authorization acceptance',channel,observations},null,2));
}
if (observations.length !== 4 || observations.some(result => !result.rendered)) process.exitCode = 1;
