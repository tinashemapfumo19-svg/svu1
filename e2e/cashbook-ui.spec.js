import {test,expect} from '@playwright/test';
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Cashbook UI requires the isolated integration database.');
test('cashbook workspace supports native policy, posting, capture and independent closure',async({page,request},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const api=async(method,path,data,token,status=200)=>{const response=await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);return (await response.json()).data;};
  const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},'',201),reviewer=await api('POST','/api/identity/sessions',{email:'registrar@southvalley.test',password:'Kariba-Senate-Approvals-2026!'},'',201);
  const me=await api('GET','/api/identity/me',undefined,reviewer.token);
  const assignment=await api('POST','/api/access/role-assignments',{accountId:me.account.id,roleCode:'cashbook_approver',scope:{},reason:'Isolated UI approver'},admin.token,201);
  let reviewerEnded=false;
  try {
  const title=`UI policy ${info.project.name} ${Date.now()}`,name=`UI cashbook ${info.project.name}`;
  async function open(session){await page.goto('/');await page.evaluate(value=>window.svuSession.set(value),session);await page.goto('/#registry/cashbook');await expect(page.locator('.cashbook-workspace')).toBeVisible();await expect(page.locator('.review-controls')).toBeEnabled();}
  async function submit(action,values,within=page,success=true){const form=within.locator(`[data-cb-command="${action}"]`);await form.locator('xpath=..').locator(':scope > summary').click();for(const [key,value] of Object.entries(values)){const field=form.locator(`[name="${key}"]`);if(await field.evaluate(element=>element.tagName==='SELECT'))await field.selectOption(String(value));else await field.fill(String(value));}await form.locator('button[type="submit"]').click();if(success)await expect(page.getByRole('status')).toHaveText('Cashbook command recorded.');else await expect(page.getByRole('status')).toHaveText(/fetch|network/i);await expect(page.locator('.review-controls')).toBeEnabled();}
  await open(admin);await submit('policy',{title,owner:'Isolated owner',policyReference:'UI-POLICY',retentionRule:'Retained test evidence',reason:'Review request'});
  await expect(page.locator('.cashbook-workspace li').filter({hasText:title}).getByText('Publish policy',{exact:true})).toHaveCount(0);
  const policy=(await api('GET','/api/cashbooks',undefined,admin.token)).policies.find(row=>row.title===title);
  await open(reviewer);const policyRow=page.locator('.cashbook-workspace li').filter({hasText:title});await submit('policy-change',{reason:'Independent policy review'},policyRow);
  await open(admin);await submit('book',{name,policyId:policy.id,currency:'USD',startsOn:'2026-01-01',reason:'Institutional book fixture'});
  const book=(await api('GET','/api/cashbooks',undefined,admin.token)).books.find(row=>row.name===name);
  await expect(page.locator(`[data-cb-book-record="${book.id}"]`)).toBeVisible();
  await submit('account',{name:'Bank account',kind:'bank',openedOn:'2026-01-01',openingMinor:'1000',evidenceRef:'UI_OPENING',reason:'Opening evidence'});
  const account=(await api('GET',`/api/cashbooks/${book.id}`,undefined,admin.token)).accounts[0];
  const requests=[];
  await page.route(`**/api/cashbooks/${book.id}/movements`,async route=>{requests.push(route.request().postDataJSON());if(requests.length===1){await route.fetch();await route.abort('failed');}else await route.continue();});
  await submit('movement',{kind:'expenditure',occurredOn:'2026-01-05',amountMinor:'100',accountId:account.id,evidenceRef:'UI_EXPENSE',reason:'Paid expense'},page,false);
  await submit('movement',{});await page.unroute(`**/api/cashbooks/${book.id}/movements`);
  expect(requests).toHaveLength(2);expect(requests[0].requestKey).toBe(requests[1].requestKey);expect((await api('GET',`/api/cashbooks/${book.id}`,undefined,admin.token)).movementTotal).toBe(1);
  await submit('period',{from:'2026-01-01',to:'2026-01-31',reason:'January reconciliation'});
  const period=(await api('GET',`/api/cashbooks/${book.id}`,undefined,admin.token)).periods[0];
  const captureForm=page.locator('[data-cb-command="capture"]');await captureForm.locator('xpath=..').locator(':scope > summary').click();await expect(captureForm.locator(`[name="observed_${account.id}"]`)).toHaveValue('');await captureForm.locator('xpath=..').locator(':scope > summary').click();
  await submit('capture',{[`observed_${account.id}`]:'900',[`evidence_${account.id}`]:'UI_STATEMENT',reason:'Verified observations'});
  await expect(page.locator('[data-cb-command="close"]')).toHaveCount(0);
  await open(reviewer);await page.locator(`[data-cb-book="${book.id}"]`).click();await expect(page.locator('.review-controls')).toBeEnabled();await page.locator(`[data-cb-period="${period.id}"]`).click();await expect(page.locator('[data-cb-command="close"]')).toBeAttached();await expect(page.locator('.review-controls')).toBeEnabled();
  await submit('close',{reason:'Independent reconciliation closure'});await expect(page.locator(`[data-cb-period-record="${period.id}"]`)).toContainText('closed');
  await expect(page.locator('[data-cb-command="capture"]')).toHaveCount(0);
  const reportForm=page.locator('[data-cb-report]');
  for(const kind of ['movements','accounts','reconciliation']) {
    await reportForm.locator('[name="kind"]').selectOption(kind);
    if(kind==='movements') {await reportForm.locator('[name="from"]').fill('2026-01-05');await reportForm.locator('[name="to"]').fill('2026-01-05');}
    else await expect(reportForm.locator('[name="from"]')).toBeDisabled();
    const pending=page.waitForEvent('download');await reportForm.getByRole('button',{name:'Download cashbook report'}).click();const download=await pending;
    expect(download.suggestedFilename()).toBe(`cashbook-${kind}.csv`);
    const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const csv=Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain('cashbook-reports-v1');expect(csv).toContain(book.id);expect(csv).toContain('USD');
    expect(csv).toContain(kind==='movements' ? 'UI_EXPENSE' : kind==='accounts' ? 'UI_OPENING' : 'UI_STATEMENT');
    if(kind==='reconciliation')expect(csv).toContain('"closed","3"');
    await expect(page.getByRole('status')).toHaveText('Cashbook report exported: 1 rows.');await expect(page.locator('.review-controls')).toBeEnabled();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath('cashbook-workspace.png'),fullPage:true});
  await page.locator('[data-cb-period-record]').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('cashbook-balances.png')});
  await api('POST',`/api/access/role-assignments/${assignment.id}/end`,{reason:'Revoke UI reviewer'},admin.token);
  reviewerEnded=true;
  await page.locator(`[data-cb-book="${book.id}"]`).click();await expect(page.locator('[data-cb-period-record]')).toHaveCount(0);await expect(page.locator('[data-cb-book-record]')).toHaveCount(0);await expect(page.getByText('UI_STATEMENT',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Refresh cashbook',exact:true}).click();await expect(page.locator('[data-cb-book-record]')).toHaveCount(0);
  await open(admin);await page.locator(`[data-cb-book="${book.id}"]`).click();await expect(page.locator('.review-controls')).toBeEnabled();const movement=page.locator('[data-cb-command="movement"]');await movement.locator('xpath=..').locator(':scope > summary').click();await movement.locator('[name="reason"]').fill('UNSENT_CASHBOOK_DRAFT');
  await page.evaluate(value=>window.svuSession.set(value),reviewer);await expect(page.locator('[data-cb-book-record]')).toHaveCount(0);await expect(page.locator('textarea')).toHaveCount(0);
  expect(await page.evaluate(()=>Object.values(sessionStorage).some(value=>value.includes('UNSENT_CASHBOOK_DRAFT') || value.includes('UI_STATEMENT')))).toBe(false);
  expect(errors).toEqual([]);
  } finally {if(!reviewerEnded)await api('POST',`/api/access/role-assignments/${assignment.id}/end`,{reason:'Clean isolated UI reviewer'},admin.token);}
});
