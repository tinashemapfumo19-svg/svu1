import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Asset workflows require the isolated integration database.');
test('assets retain custody and stock checks with replay-safe independent disposal',async ({page,request},info) => {
  test.setTimeout(240000);page.setDefaultTimeout(15000);
  const suffix=`${info.project.name.toUpperCase()}_${Date.now()}`,today=new Date().toISOString().slice(0,10),assetTag=`AS_${suffix}`;
  const api=async (method,path,data,token,status=200) => {
    const r=await request.fetch(path,{method,data,maxRetries:method==='GET' ? 2 : 0,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(r.status(),`${method} ${path}: ${await r.text()}`).toBe(status);return (await r.json()).data;
  };
  const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
  const registrar=await api('POST','/api/identity/sessions',{email:'registrar@southvalley.test',password:'Kariba-Senate-Approvals-2026!'},null,201);
  const student=await api('POST','/api/identity/sessions',{email:'tinashe@example.edu',password:'Phase1-Student-Password-2026!'},null,201);
  const reviewer=await account('reviewer','asset_approver',{});
  const scoped=await account('scoped','asset_officer',{programmeCodes:['BSC-IS']});
  const scopedMe=await api('GET','/api/identity/me',undefined,scoped.token);
  await api('POST','/api/access/role-assignments',{accountId:scopedMe.account.id,roleCode:'hr_officer',scope:{},reason:'Unrelated global role cannot widen asset authority'},admin.token,201);
  const registrarMe=await api('GET','/api/identity/me',undefined,registrar.token);
  expect((await api('GET','/api/staff-leave',undefined,reviewer.token)).capabilities.request).toBe(true);
  await api('POST','/api/access/role-assignments',{accountId:registrarMe.account.id,roleCode:'asset_approver',scope:{},reason:'Asset disposal fixture'},admin.token,201);
  let custodian=(await api('GET','/api/staff?q=registrar%40southvalley.test',undefined,admin.token)).items[0];
  if (!custodian) {
    custodian=await api('POST','/api/staff',{email:'registrar@southvalley.test',legalName:'Registrar Custodian',preferredName:'Registrar',category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode:'lecturer',engagedOn:'2026-01-01',reason:'Custody fixture',linkExistingAccount:true},admin.token,201);
    const appointments=await api('GET','/api/identity/staff-appointments',undefined,registrar.token);
    await api('POST',`/api/identity/staff-appointments/${appointments[0].invitationId}`,{accept:true},registrar.token);
  }
  await api('GET','/api/assets',undefined,student.token,403);
  await api('GET','/api/assets',undefined,scoped.token,403);
  await open(admin);
  await page.locator('[data-asset-create-panel] > summary').click();
  await submit(page.locator('[data-asset-create]'),{assetTag,barcode:`BC_${suffix}`,serialNumber:`SN_${suffix}`,name:`Portable Computer ${suffix}`,category:'Computing',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',value:'123.45',currency:'USD',departmentId:'dept_computing',location:'Central stores',condition:'serviceable',reason:'Goods received'});
  await expect(page.getByRole('status')).toHaveText('Asset registered.');
  let a=(await api('GET',`/api/assets?q=${assetTag}`,undefined,admin.token)).items[0];
  expect(a).toMatchObject({assetTag,valueMinor:'12345',status:'available',revision:1});
  const definition={assetTag,barcode:`BC_${suffix}`,serialNumber:`SN_${suffix}`,name:`Portable Computer ${suffix}`,category:'Computing',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:12345,currency:'USD',departmentId:'dept_computing',location:'Central stores',condition:'serviceable',reason:'Duplicate',replayKey:randomUUID()};
  await api('POST','/api/assets',definition,admin.token,409);
  await api('POST','/api/assets',{...definition,assetTag:`OTHER_${suffix}`,barcode:null,serialNumber:null,currency:'QQQ'},admin.token,400);
  await api('POST','/api/assets',{...definition,assetTag:`OTHER_${suffix}`,barcode:null,serialNumber:null,replayKey:[randomUUID()]},admin.token,400);
  const replayDefinition={...definition,assetTag:`REPLAY_${suffix}`,barcode:null,serialNumber:null,replayKey:randomUUID()};
  const replayRegistered=await api('POST','/api/assets',replayDefinition,admin.token,201);
  expect((await api('POST','/api/assets',Object.fromEntries(Object.entries(replayDefinition).reverse()),admin.token,201)).id).toBe(replayRegistered.id);
  expect((await api('GET',`/api/assets?q=REPLAY_${suffix}`,undefined,admin.token)).total).toBe(1);
  await api('POST',`/api/assets/${a.id}/allocate`,{revision:1,staffId:custodian.id,allocatedOn:today,location:'Office 4',reason:'Forbidden',replayKey:randomUUID()},reviewer.token,403);
  await action('edit',{name:`Revised Computer ${suffix}`,location:'Secure stores',reason:'Correct item description'});
  a=await get(a.id);expect(a).toMatchObject({revision:2,name:`Revised Computer ${suffix}`,location:'Secure stores'});
  const race=[0,1].map(() => ({revision:a.revision,staffId:custodian.id,allocatedOn:today,location:'Office 4',reason:'Custody issue',replayKey:randomUUID()}));
  const results=await Promise.all(race.map((data) => request.post(`/api/assets/${a.id}/allocate`,{data,headers:{Authorization:`Bearer ${admin.token}`}})));
  expect(results.map((r) => r.status()).sort()).toEqual([200,409]);
  const winning=race[results.findIndex((r) => r.status()===200)];
  a=await get(a.id);expect(a.custody).toHaveLength(1);expect(a.status).toBe('allocated');
  await api('POST',`/api/assets/${a.id}/check`,{revision:0,checkedOn:today,outcome:'found',observedCondition:'serviceable',observedLocation:'Office 4',reason:'Malformed revision',replayKey:randomUUID()},admin.token,400);
  expect((await api('GET',`/api/assets?${new URLSearchParams({q:assetTag,staffQ:'Registrar Custodian'})}`,undefined,admin.token)).items.map((r) => r.id)).toEqual([a.id]);
  expect((await api('GET',`/api/assets?${new URLSearchParams({q:assetTag,staffQ:'No custodian 99999'})}`,undefined,admin.token)).total).toBe(0);
  await api('POST',`/api/assets/${a.id}/allocate`,Object.fromEntries(Object.entries(winning).reverse()),admin.token);
  expect((await get(a.id)).custody).toHaveLength(1);
  await api('POST',`/api/assets/${a.id}/allocate`,{...winning,location:'Changed replay'},admin.token,409);
  await selectAsset(a.id);
  await action('check',{checkedOn:today,outcome:'damaged',observedCondition:'damaged',observedLocation:'Office 4',reason:'Damaged hinge found'});
  a=await get(a.id);expect(a).toMatchObject({status:'allocated',condition:'damaged'});expect(a.checks[0]).toMatchObject({expectedStaffId:custodian.id,expectedLocation:'Office 4',observedCondition:'damaged'});
  await action('return',{returnedOn:today,location:'Repair store',condition:'repair',reason:'Custodian returned equipment'});
  a=await get(a.id);expect(a).toMatchObject({status:'available',condition:'repair'});expect(a.custody[0]).toMatchObject({endKind:'returned',endedOn:today,endCondition:'repair'});
  await api('POST',`/api/assets/${a.id}/allocate`,{...winning,revision:a.revision,replayKey:randomUUID()},admin.token,409);
  await action('check',{checkedOn:today,outcome:'found',observedCondition:'serviceable',observedLocation:'Central stores',reason:'Repair completed and physically verified'});
  await action('copy',{acquiredOn:today,departmentId:'dept_computing',location:'New stock store',condition:'serviceable',reason:'Two identical new acquisitions'},[{assetTag:`COPY1_${suffix}`,barcode:`C1_${suffix}`},{assetTag:`COPY2_${suffix}`,serialNumber:`C2_${suffix}`}]);
  await expect(page.getByRole('status')).toHaveText('2 assets copied.');
  const copies=(await api('GET',`/api/assets?q=COPY&limit=100`,undefined,admin.token)).items.filter((r) => r.assetTag.endsWith(suffix));
  expect(copies).toHaveLength(2);expect(copies.every((r) => r.copiedFrom===a.id && r.status==='available' && r.custodianStaffId===null && r.acquiredOn===today)).toBe(true);
  let counted=await get(copies[0].id);
  for (let i=0;i<27;i++) counted=await api('POST',`/api/assets/${counted.id}/check`,{revision:counted.revision,checkedOn:today,outcome:'found',observedCondition:'serviceable',observedLocation:'New stock store',reason:`Stock-check pagination fixture ${i}`,replayKey:randomUUID()},admin.token);
  expect(counted.checks).toHaveLength(25);expect(counted.events).toHaveLength(25);expect(counted.historyTotal).toBe(28);
  const tail=await api('GET',`/api/assets/${counted.id}?historyOffset=25`,undefined,admin.token);
  await api('GET','/api/assets/reports',undefined,student.token,403);
  await api('GET','/api/assets/reports',undefined,scoped.token,403);
  await api('GET','/api/assets/reports?kind=register&from=2026-01-01',undefined,admin.token,400);
  await api('GET','/api/assets/reports?kind=register&kind=allocations',undefined,admin.token,400);
  const reports=await api('GET',`/api/assets/reports?kind=stock_checks&q=${counted.assetTag}&from=${today}&to=${today}`,undefined,reviewer.token);
  expect(reports.rowCount).toBe(27);expect(reports.csv.split('\r\n')).toHaveLength(29);
  expect((await api('GET',`/api/assets/reports?kind=register&q=${counted.assetTag}`,undefined,admin.token)).rowCount).toBe(1);
  expect((await api('GET',`/api/assets/reports?kind=allocations&q=${counted.assetTag}`,undefined,admin.token)).rowCount).toBe(0);
  const reportForm=page.locator('[data-asset-report]');
  await expect(reportForm.locator('[name="from"]')).toBeDisabled();
  await reportForm.locator('[name="kind"]').selectOption('stock_checks');
  await expect(reportForm.locator('[name="from"]')).toBeEnabled();
  await reportForm.locator('[name="from"]').fill(today);await reportForm.locator('[name="to"]').fill(today);
  const downloadPromise=page.waitForEvent('download');await reportForm.getByRole('button',{name:'Download asset report'}).click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('assets-stock_checks.csv');
  await expect(page.getByRole('status')).toContainText('Asset report exported:');
  await page.screenshot({path:info.outputPath('asset-reports.png'),fullPage:true});
  expect(tail.checks).toHaveLength(2);expect(tail.events).toHaveLength(3);
  for (const rows of [[...counted.checks,...tail.checks],[...counted.events,...tail.events]]) {
    const ids=rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((left,right) => BigInt(left)>BigInt(right) ? -1 : 1));
  }
  await selectAsset(counted.id);await page.locator('[data-asset-history="1"]').click();
  await expect(page.getByText('26-28 of 28 changes',{exact:true})).toBeVisible();
  a=await get(a.id);expect(a.status).toBe('available');expect(a.custody).toHaveLength(1);
  await api('POST',`/api/assets/${a.id}/copy`,{revision:a.revision,copies:[{assetTag:`ROLLBACK_${suffix}`},{assetTag:copies[0].assetTag}],acquiredOn:today,departmentId:'dept_computing',location:'Store',condition:'serviceable',reason:'Atomic duplicate batch',replayKey:randomUUID()},admin.token,409);
  expect((await api('GET',`/api/assets?q=ROLLBACK_${suffix}`,undefined,admin.token)).total).toBe(0);
  await selectAsset(a.id);
  await action('allocate',{staffId:custodian.id,allocatedOn:today,location:'Office 4',reason:'Reissued after repair'});
  await action('dispose',{proposedOn:today,value:'20.50',method:'Approved recycling',reason:'Beyond economic repair'});
  a=await get(a.id);expect(a).toMatchObject({status:'disposal_pending',canReview:false});
  const review={revision:a.revision,outcome:'approve',reviewedOn:today,reason:'Independent approval',replayKey:randomUUID()};
  await api('POST',`/api/assets/${a.id}/review`,review,admin.token,403);
  await api('POST',`/api/assets/${a.id}/review`,{...review,replayKey:randomUUID()},registrar.token,403);
  await api('POST',`/api/assets/${a.id}/return`,{revision:a.revision,returnedOn:today,location:'Store',condition:'damaged',reason:'Pending disposal cannot be bypassed',replayKey:randomUUID()},admin.token,409);
  await open(reviewer);await selectAsset(a.id);
  await action('review',{outcome:'deny',reviewedOn:today,reason:'Repair alternative remains available'});
  a=await get(a.id);expect(a.status).toBe('allocated');expect(a.disposals[0].status).toBe('denied');
  await open(admin);await selectAsset(a.id);await action('dispose',{proposedOn:today,value:'20.50',method:'Recycling',reason:'Reviewed disposal evidence'});
  a=await get(a.id);
  await api('POST',`/api/assets/${a.id}/review`,{...review,revision:a.revision-1,replayKey:randomUUID()},reviewer.token,409);
  await open(reviewer);await selectAsset(a.id);await action('review',{outcome:'approve',reviewedOn:today,reason:'Independent disposal evidence accepted'});
  a=await get(a.id);expect(a.status).toBe('disposed');expect(a.custody.filter((c) => !c.endedOn)).toHaveLength(0);expect(a.custody[0].endKind).toBe('disposed');expect(a.disposals.map((p) => p.status)).toEqual(['approved','denied']);
  expect(a.events.map((e) => e.action)).toEqual(['disposal_approved','dispose','disposal_denied','dispose','allocate','check','return','check','allocate','edited','registered']);
  await api('POST',`/api/assets/${a.id}/check`,{revision:a.revision,checkedOn:today,outcome:'found',observedCondition:'serviceable',observedLocation:'Store',reason:'Closed',replayKey:randomUUID()},admin.token,409);
  const workspace=await api('GET',`/api/assets?${new URLSearchParams({q:suffix,status:'disposed'})}`,undefined,reviewer.token);
  expect(workspace.total).toBe(1);expect(workspace.totals).toEqual([{currency:'USD',count:1,valueMinor:'12345'}]);
  await page.evaluate(async () => {document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath('asset-history.png'),fullPage:true});
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try {
    const indexes=(await db.query("select indexname from pg_indexes where schemaname='public' and indexname=any($1::text[])",[['asset_custody_history_lookup','asset_stock_checks_history_lookup','asset_events_history_lookup','asset_disposals_history_lookup']])).rows;
    expect(indexes).toHaveLength(4);
    await expect(db.query('delete from asset_events where asset_id=$1',[a.id])).rejects.toThrow();
    await expect(db.query("update asset_custody set location='Changed' where asset_id=$1",[a.id])).rejects.toThrow('immutable');
    await expect(db.query("update asset_stock_checks set reason='Changed' where asset_id=$1",[a.id])).rejects.toThrow();
    await expect(db.query("update asset_disposals set reason='Changed' where asset_id=$1",[a.id])).rejects.toThrow('immutable');
    await expect(db.query("update institution_assets set status='available' where id=$1",[a.id])).rejects.toThrow('immutable');
    await expect(db.query('delete from asset_command_receipts where actor_id=$1',[a.createdBy])).rejects.toThrow();
  } finally {await db.end();}
  const events=await api('GET',`/api/audit/events?subjectId=${a.id}`,undefined,admin.token);
  expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['assets.registered','assets.allocate','assets.return','assets.check','assets.disposal_denied','assets.disposal_approved']));

  async function get(id) {return api('GET',`/api/assets/${id}`,undefined,admin.token);}
  async function open(actor) {await page.goto('/');await page.evaluate((s) => window.svuSession.set(s),actor);await page.goto('/#registry/assets');await expect(page.locator('.asset-workspace')).toBeVisible();await expect(page.locator('.review-controls')).toBeEnabled();}
  async function selectAsset(id) {await page.locator(`[data-asset-detail="${id}"]`).click();await expect(page.locator(`[data-asset-record="${id}"]`)).toBeVisible();await expect(page.locator('.review-controls')).toBeEnabled();}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const input=form.locator(`[name="${name}"]`);if (await input.evaluate((n) => n.tagName==='SELECT')) await input.selectOption(String(value));else await input.fill(String(value));}await form.locator('button[type=submit]').click();await expect(page.locator('.review-controls')).toBeEnabled();}
  async function action(kind,values,copies) {
    const summary=page.locator(`[data-asset-action-panel="${kind}"] > summary`);await expect(summary).toHaveAttribute('aria-disabled','false');await summary.click();
    const form=page.locator(`[data-asset-action="${kind}"]`);
    if (copies) {for (let i=1;i<copies.length;i++) await form.locator('[data-asset-add-copy]').click();for (let i=0;i<copies.length;i++) for (const [name,value] of Object.entries(copies[i])) await form.locator('[data-asset-copy-row]').nth(i).locator(`[name="${name}"]`).fill(value);}
    await submit(form,values);await expect(page.getByRole('status')).toHaveText(kind==='copy' ? `${copies.length} assets copied.` : 'Asset action recorded.');
  }
  async function account(label,roleCode,scope) {
    const id=`asset_${label}_${suffix}`,email=`${id.toLowerCase()}@example.edu`,db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
    try {
      await db.query("insert into people(id,preferred_name,legal_name,personas,status) values($1,$2,$2,'[\"staff\"]','active')",[id,`Asset ${label} ${suffix}`]);
      await db.query("insert into accounts(id,person_id,email,status,password_hash,password_salt,password_set_at) select $1,$1,$2,'active',password_hash,password_salt,password_set_at from accounts where email='tinashe@example.edu'",[id,email]);
    } finally {await db.end();}
    await api('POST','/api/access/role-assignments',{accountId:id,roleCode,scope,reason:'Asset workflow fixture'},admin.token,201);
    const session=await api('POST','/api/identity/sessions',{email,password:'Phase1-Student-Password-2026!'},null,201);
    await api('POST','/api/staff',{email,legalName:`Asset ${label} ${suffix}`,preferredName:label,category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode,scope,engagedOn:'2026-01-01',reason:'Asset staff appointment fixture',linkExistingAccount:true},admin.token,201);
    const appointments=await api('GET','/api/identity/staff-appointments',undefined,session.token);
    await api('POST',`/api/identity/staff-appointments/${appointments[0].invitationId}`,{accept:true},session.token);
    return session;
  }
});
