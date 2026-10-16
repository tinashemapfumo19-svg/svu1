import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {populatedPreviewFiles,previewGreenPixels} from '../scripts/repository-preview-fixture.js';

// The headless shell has no PDF viewer. Full Chromium is required, not a skipped pixel assertion.
test.use({channel:'chromium'});
test('published populated PDF and PNG render through native view-only repository access',async ({page,browser,request},info) => {
  test.setTimeout(180_000);
  if (!process.env.SVU_DEV_OUTBOX) throw new Error('Use the isolated integration runner for native preview checks.');
  const stamp = `${info.project.name}.${Date.now()}`;
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const uploader = await account('uploader','records_manager');
  const publisher = await account('publisher','records_manager');
  const student = await account('student','student');
  const collection = await api('POST','/api/repository/collections',{code:`preview_${info.project.name}_${Date.now()}`,name:`Preview ${stamp}`,classification:'internal',studentAccess:true,allowDownload:false,reason:'Isolated populated preview regression'},uploader.token);
  const files = await populatedPreviewFiles(browser);
  await page.goto('/#resources');
  await page.evaluate(token => {sessionStorage.clear();sessionStorage.setItem('svu.applicant.session',JSON.stringify({token}));},student.token);
  for (const format of ['pdf','png']) {
    const bytes = files[format],contentType = format === 'pdf' ? 'application/pdf' : 'image/png';
    const created = await api('POST','/api/repository/items',{collectionId:collection.id,title:`Populated ${format} ${stamp}`,reason:'Synthetic visual fixture'},uploader.token);
    const id = created.item.id;
    const version = await api('POST',`/api/repository/items/${id}/versions`,{fileName:`sample.${format}`,contentType,sizeBytes:bytes.length,changeNote:'Populated fixture'},uploader.token);
    expect((await request.fetch(version.upload.url,{method:'PUT',data:bytes,headers:{'Content-Type':contentType}})).ok()).toBe(true);
    await api('POST',`/api/documents/${version.documentId}/scan-results`,{result:'clean'},admin.token);
    await api('POST',`/api/repository/items/${id}/versions/1/review`,{outcome:'published',reason:'Independent fixture publication'},publisher.token);
    await page.reload();
    await page.locator(`[data-resource-open="${id}"]`).click();
    await expect(page.locator('[data-resource-view-only]')).toBeVisible();
    await expect(page.locator('[data-resource-access="download"]')).toHaveCount(0);
    await page.locator('[data-resource-access="view"]').click();
    const viewer = page.locator('[data-resource-viewer]');
    await expect(viewer).toHaveAttribute('src',/op=view/);
    await expect.poll(async () => previewGreenPixels(page,await viewer.screenshot()),{timeout:15000}).toBeGreaterThan(1000);
    await viewer.screenshot({path:info.outputPath(`${format}-populated-viewer.png`)});
    const url = await viewer.getAttribute('src');
    const served = await request.fetch(url);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe(contentType);
    expect(served.headers()['content-disposition']).toBe(`inline; filename="sample.${format}"`);
    expect(served.headers()['cache-control']).toBe('no-store');
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    expect(await served.body()).toEqual(bytes);
    expect((await request.fetch(`/api/repository/items/${id}/access`,{method:'POST',data:{mode:'download'},headers:{Authorization:`Bearer ${student.token}`}})).status()).toBe(403);
    expect((await request.fetch(url.replace('op=view','op=download'))).status()).toBe(403);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await page.screenshot({path:info.outputPath(`${format}-populated-page.png`),fullPage:true});
  }
  async function api(method,url,data,token) {
    const response = await request.fetch(url,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(response.ok(),`${method} ${url}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  }
  async function account(name,role) {
    const email = `preview.${name}.${stamp}@example.com`,password='Kariba-Dam-Applicant-2026!',legalName=`Preview ${name}`;
    await api('POST','/api/admissions/registrations',{email,preferredName:'Preview',legalName});
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async file => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'))));
    const activation = messages.find(message => message.recipientEmail === email);
    expect(activation).toBeTruthy();
    await api('POST','/api/identity/activations',{token:activation.variables.activationToken,password,preferredName:'Preview',legalName});
    const session = await api('POST','/api/identity/sessions',{email,password});
    const me = await api('GET','/api/identity/me',undefined,session.token);
    await api('POST','/api/access/role-assignments',{accountId:me.account.id,roleCode:role,scope:{},reason:'Isolated preview regression'},admin.token);
    return session;
  }
});
