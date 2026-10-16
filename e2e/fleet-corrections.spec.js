import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {createFleetModule} from '../server/modules/fleet.js';
import {loadConfig} from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Fleet corrections require an isolated integration database.');
test.use({actionTimeout:15000,timezoneId:'Africa/Johannesburg'});
test('vehicle corrections retain originals and require fresh independent revision-bound review',async({page,browser,request},info)=>{
  test.setTimeout(240000);
  const stamp=`${info.project.name}-${Date.now()}`,base='/api/fleet',pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),key=()=>randomUUID();let context,owner,vehicle;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const ownerId=(await api('GET','/api/identity/me',undefined,owner.token)).account.id;
    const reviewer=await account(),appointment=await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode:'fleet_approver',scope:{},reason:'Isolated vehicle correction review'},owner.token,201);
    const asset=await assetRecord('main',owner),spare=await assetRecord('spare',owner),original=`VC-${stamp}`.toUpperCase(),changed=`COR-${stamp}`.toUpperCase();
    vehicle=await api('POST',`${base}/vehicles`,{assetId:asset.id,registration:original,description:'Original definition',distanceUnit:'km',openingOdometer:'1000',evidenceReference:'TEST-ORIGINAL',requestKey:key()},owner.token,201);
    await api('GET',`${base}/vehicles/${vehicle.id}/corrections`,undefined,null,401);
    await api('GET',`${base}/vehicles/${vehicle.id}/corrections?limit=100`,undefined,owner.token,400);
    await open(page,owner);await page.locator('[data-fleet-search="list"] [name="q"]').fill(original);await page.locator('[data-fleet-search="list"] button').click();await ready(page);
    await command(page,`vehicle-correction:${vehicle.id}`,{registration:changed,description:'Corrected <img src=x onerror="window.correctionLeak=1">',evidenceReference:'TEST-CORRECTION'});
    let history=await api('GET',`${base}/vehicles/${vehicle.id}/corrections`,undefined,owner.token);const proposal=history.items[0];expect(proposal.status).toBe('requested');expect((await vehicleRow()).registration).toBe(original);
    const decision={revision:0,outcome:'approved',evidenceReference:'TEST-INDEPENDENT-CORRECTION',requestKey:key()};
    await api('POST',`${base}/vehicle-corrections/${proposal.id}/decision`,decision,owner.token,403);
    await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,{revision:0,registration:changed,description:'Attempt',evidenceReference:'TEST',requestKey:key()},reviewer.token,403);
    await page.locator(`[data-fleet-corrections="${vehicle.id}"]`).click();await ready(page);await expect(page.locator(`[data-fleet-panel="vehicle-correction-decision:${proposal.id}"]`)).toHaveCount(0);
    context=await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name==='mobile',timezoneId:'Africa/Johannesburg'});const review=await context.newPage();review.on('pageerror',error=>errors.push(error.message));await open(review,reviewer);
    await review.locator(`[data-fleet-corrections="${vehicle.id}"]`).click();await ready(review);await command(review,`vehicle-correction-decision:${proposal.id}`,{outcome:'approved',evidenceReference:'TEST-INDEPENDENT-CORRECTION'});
    expect(await vehicleRow()).toMatchObject({registration:changed,definitionRevision:1,odometer:'1000',openingOdometer:'1000',distanceUnit:'km',assetId:asset.id});
    const retained=(await pool.query('select registration,description from fleet_vehicles where id=$1',[vehicle.id])).rows[0];expect(retained).toEqual({registration:original,description:'Original definition'});
    await expect(review.locator('.fleet-corrections')).toContainText(original);await expect(review.locator('.fleet-corrections')).toContainText('<img');expect(await review.evaluate(()=>window.correctionLeak)).toBeUndefined();
    expect(await review.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await review.evaluate(()=>scrollTo(0,0));await review.screenshot({path:info.outputPath('fleet-corrections.png'),fullPage:true});
    await api('POST',`${base}/vehicles`,{assetId:spare.id,registration:changed,description:'Collision',distanceUnit:'km',openingOdometer:'0',evidenceReference:'TEST',requestKey:key()},owner.token,409);
    await expect(pool.query('insert into fleet_vehicles(id,asset_id,registration,description,distance_unit,opening_odometer,evidence_reference,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[`case_${key()}`,spare.id,changed.toLowerCase(),'Case collision','km',0,'TEST',ownerId])).rejects.toThrow(/retained fleet identity/);
    const correction=description=>({revision:1,registration:changed,description,evidenceReference:'TEST-PROPOSAL',requestKey:key()});
    await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,{...correction('Stale'),revision:0},owner.token,409);
    await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,correction('Corrected <img src=x onerror="window.correctionLeak=1">'),owner.token,409);
    const proposalInput=correction('Second definition'),second=await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,proposalInput,owner.token,201);
    expect(await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,proposalInput,owner.token,201)).toEqual(second);
    await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,{...proposalInput,description:'Changed reused key'},owner.token,409);
    const third=await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,correction('Competing definition'),owner.token,201);
    const results=await Promise.all([second,third].map(row=>request.post(`${base}/vehicle-corrections/${row.id}/decision`,{data:{...decision,requestKey:key()},headers:{Authorization:`Bearer ${reviewer.token}`}})));
    expect(results.map(row=>row.status()).sort()).toEqual([200,409]);expect((await vehicleRow()).definitionRevision).toBe(2);
    const winner=[second,third][results.findIndex(row=>row.status()===200)],loser=[second,third][results.findIndex(row=>row.status()===409)];
    const rejected={...decision,outcome:'rejected',requestKey:key()};await api('POST',`${base}/vehicle-corrections/${loser.id}/decision`,rejected,reviewer.token);expect(await api('POST',`${base}/vehicle-corrections/${loser.id}/decision`,rejected,reviewer.token)).toMatchObject({revision:1,appliedRevision:null});
    await api('POST',`${base}/vehicle-corrections/${loser.id}/decision`,{...decision,revision:1,requestKey:key()},reviewer.token,409);
    const pending=await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,{...correction('Rollback decision'),revision:2},owner.token,201);
    const actors={owner:{accountId:ownerId,roles:[{scope:{},permissions:['fleet.manage']}]},reviewer:{accountId:reviewer.accountId,roles:[{scope:{},permissions:['fleet.approve']}]}};
    for(const [method,args,actor] of [['requestFleetVehicleCorrection',[vehicle.id,{...correction('Rollback proposal'),revision:2}],actors.owner],['decideFleetVehicleCorrection',[pending.id,decision],actors.reviewer]])for(const target of ['audit_events','fleet_command_receipts']){
      const before=await counts();let injected=false;const values=[...args];values[1]={...values[1],requestKey:key()};
      const failing={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(sql.toLowerCase().includes(`insert into ${target}`)){injected=true;return db.query('select 1/0');}return db.query(sql,params);}};}};
      await expect(createFleetModule(failing,{dataEncryptionKey:loadConfig().dataEncryptionKey})[method](...values,actor)).rejects.toThrow(/division by zero/);expect(injected).toBe(true);expect(await counts()).toEqual(before);expect((await vehicleRow()).definitionRevision).toBe(2);
    }
    for(let index=0;index<24;index++)await api('POST',`${base}/vehicles/${vehicle.id}/corrections`,{...correction(`Paged proposal ${index}`),revision:2},owner.token,201);
    history=await api('GET',`${base}/vehicles/${vehicle.id}/corrections`,undefined,owner.token);expect(history.items).toHaveLength(25);const next=await api('GET',`${base}/vehicles/${vehicle.id}/corrections?offset=25`,undefined,owner.token);expect(next.total).toBe(28);expect(next.items).toHaveLength(3);expect(next.items.some(row=>row.id===proposal.id)).toBe(true);
    await page.locator('[data-fleet-refresh]').click();await ready(page);await expect(page.locator('.fleet-corrections [data-fleet-page="corrections"][data-direction="1"]')).toBeEnabled();await page.locator('.fleet-corrections [data-fleet-page="corrections"][data-direction="1"]').click();await ready(page);await expect(page.locator('.fleet-corrections')).toContainText('26-28 of 28');
    for(const table of ['fleet_vehicle_corrections','fleet_vehicle_correction_decisions'])for(const operation of ['update','delete']){const sql=operation==='update'?`update ${table} set evidence_reference='ERASE'`:`delete from ${table}`;await expect(pool.query(sql)).rejects.toThrow(/append.only|immutable|retained/i);}
    await expect(pool.query('insert into fleet_vehicle_correction_decisions(correction_id,vehicle_id,outcome,applied_revision,actor_id,evidence_reference) values($1,$2,$3,$4,$5,$6)',[pending.id,vehicle.id,'approved',3,ownerId,'SELF'])).rejects.toThrow(/independent/);
    await api('POST',`/api/access/role-assignments/${appointment.id}/end`,{reason:'End isolated correction review'},owner.token);
    await api('POST',`${base}/vehicle-corrections/${loser.id}/decision`,rejected,reviewer.token,403);
    await expect(createFleetModule(pool,{dataEncryptionKey:loadConfig().dataEncryptionKey}).decideFleetVehicleCorrection(winner.id,decision,actors.reviewer)).rejects.toMatchObject({statusCode:403});
    expect(errors).toEqual([]);
  }finally{if(context)await context.close();await pool.end();}
  async function ready(target){await expect(target.locator('.review-controls')).toBeEnabled();}
  async function open(target,session){await target.goto('/');await target.evaluate(value=>window.svuSession.set(value),session);await target.goto('/#registry/fleet');await expect(target.locator('.fleet-workspace')).toBeVisible();await ready(target);}
  async function command(target,id,values){const panel=target.locator(`[data-fleet-panel="${id}"]`);if(await panel.getAttribute('open')===null)await panel.locator('summary').click();for(const [name,value] of Object.entries(values)){const field=panel.locator(`[name="${name}"]`);if(await field.evaluate(node=>node.tagName)==='SELECT')await field.selectOption(value);else await field.fill(value);}await panel.locator('button[type="submit"]').click();await expect(target.getByRole('status')).toContainText('Fleet command recorded.');await ready(target);}
  async function vehicleRow(){return (await api('GET',`${base}/vehicles?vehicleId=${vehicle.id}`,undefined,owner.token)).items[0];}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok() && url.startsWith(base))expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(){const email=`fleet.correction.${stamp}@example.edu`,password='Fleet-Correction-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:'Reviewer',legalName:'Correction Reviewer'},null,202);let activation;
    for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:'Reviewer',legalName:'Correction Reviewer'});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,accountId:me.account.id};}
  async function assetRecord(name,owner){return api('POST','/api/assets',{assetTag:`VC_${name}_${stamp}`.toUpperCase(),name:'Correction fixture',category:'Vehicle',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:10000,currency:'USD',departmentId:'dept_computing',location:'Fleet',condition:'serviceable',reason:'Isolated correction fixture',replayKey:key()},owner.token,201);}
  async function counts(){const result={};for(const {tablename} of (await pool.query("select tablename from pg_tables where schemaname='public' and tablename like 'fleet_%' order by tablename")).rows){if(!/^fleet_[a-z_]+$/.test(tablename))throw new Error('Invalid fixture table');result[tablename]=(await pool.query(`select count(*)::int as total from ${tablename}`)).rows[0].total;}result.audit=(await pool.query("select count(*)::int as total from audit_events where action like 'fleet.%' and action not like '%.read'")).rows[0].total;return result;}
});
