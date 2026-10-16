import {test,expect,request as requests} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Fleet workspace journeys require the isolated integration database.');
test.use({actionTimeout:15000,timezoneId:'Africa/Johannesburg'});
test('fleet staff workspace supports approvals, dispatch, exact receipts, restricted incidents and reply recovery',async({page,browser,request},info)=>{
  test.setTimeout(360000);
  const stamp=`${info.project.name}-${Date.now()}`,db=new pg.Client({connectionString:process.env.DATABASE_URL}),errors=[];await db.connect();
  let reviewContext,cleanupOwner,cleanupTrip,releaseHeldResponse;
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    cleanupOwner=owner;
    const driver=await api('POST','/api/identity/sessions',{email:'registrar@southvalley.test',password:'Kariba-Senate-Approvals-2026!'},null,201);
    const reviewer=await account('reviewer'),officer=await account('officer');
    for(const roleCode of ['fleet_approver','fleet_safety_officer'])await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode,scope:{},reason:'Isolated fleet UI appointment'},owner.token,201);
    await api('POST','/api/access/role-assignments',{accountId:officer.accountId,roleCode:'fleet_officer',scope:{},reason:'Operational UI appointment'},owner.token,201);
    let staff=(await api('GET','/api/staff?q=registrar%40southvalley.test',undefined,owner.token)).items[0];
    if(!staff){
      staff=await api('POST','/api/staff',{email:'registrar@southvalley.test',legalName:'Fleet Driver Fixture',preferredName:'Driver',category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode:'lecturer',engagedOn:'2026-01-01',reason:'Isolated fleet UI driver',linkExistingAccount:true},owner.token,201);
      const appointments=await api('GET','/api/identity/staff-appointments',undefined,driver.token);await api('POST',`/api/identity/staff-appointments/${appointments[0].invitationId}`,{accept:true},driver.token);
    }
    const asset=await api('POST','/api/assets',{assetTag:`FU_${stamp}`.toUpperCase(),name:'Fleet UI vehicle',category:'Vehicle',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:10000,currency:'USD',departmentId:'dept_computing',location:'Fleet stores',condition:'serviceable',reason:'Isolated fleet UI fixture',replayKey:randomUUID()},owner.token,201);
    await open(page,owner);
    await command(page,'vehicle',{assetId:asset.id,registration:`FV-${stamp}`,description:'Fleet <img src=x onerror="window.fleetLeak=1">',distanceUnit:'km',openingOdometer:'1000',evidenceReference:'TEST-UI-REGISTRATION'});
    const vehicle=(await api('GET','/api/fleet/vehicles',undefined,owner.token)).items.find(row=>row.registration===`FV-${stamp}`.toUpperCase());expect(vehicle).toBeTruthy();
    await expect(page.locator(`[data-fleet-row="${vehicle.id}"]`)).toContainText('<img');expect(await page.evaluate(()=>window.fleetLeak)).toBeUndefined();
    await tab(page,'drivers');await command(page,'driver',{staffId:staff.id,validFrom:await local(page,-86400000),validUntil:await local(page,2*86400000),evidenceReference:`UI-DRIVER-${stamp}`});
    const driverRequest=(await api('GET','/api/fleet/drivers',undefined,owner.token)).items.find(row=>row.evidenceReference===`UI-DRIVER-${stamp}`);expect(driverRequest.staffStatus).toBe('active');
    await expect(page.locator(`[data-fleet-key="driver-decision:${driverRequest.id}"]`)).toHaveCount(0);
    reviewContext=await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name==='mobile',timezoneId:'Africa/Johannesburg'});
    const review=await reviewContext.newPage();review.on('pageerror',error=>errors.push(error.message));await open(review,reviewer);await tab(review,'drivers');
    await command(review,`driver-decision:${driverRequest.id}`,{outcome:'approved',evidenceReference:'TEST-UI-INDEPENDENT-APPROVAL'});
    const authorised=(await api('GET','/api/fleet/drivers',undefined,owner.token)).items.find(row=>row.id===driverRequest.id);
    await tab(page,'trips');await command(page,'trip',{vehicleId:vehicle.id,driverAuthorisationId:authorised.authorisationId,purpose:`UI trip ${stamp}`,destination:'Campus',plannedStart:await local(page,-60000),plannedEnd:await local(page,3600000)});
    const trip=(await api('GET','/api/fleet/trips',undefined,owner.token)).items.find(row=>row.purpose===`UI trip ${stamp}`);expect(trip.driverAccountId).toBeTruthy();
    cleanupTrip=trip.id;
    await tab(review,'trips');await command(review,`decision:${trip.id}`,{kind:'approved',evidenceReference:'TEST-UI-TRIP-APPROVAL'});
    await tab(page,'service');await service(page,vehicle.id,'hold','TEST-UI-HOLD');
    expect((await api('GET','/api/fleet/service',undefined,owner.token)).items.some(row=>row.vehicleId===vehicle.id && row.kind==='hold')).toBe(true);
    await tab(review,'service');await service(review,vehicle.id,'release','TEST-UI-RELEASE');
    const inFlightCorrection=await api('POST',`/api/fleet/vehicles/${vehicle.id}/corrections`,{revision:0,registration:vehicle.registration,description:'Must not apply while dispatched',evidenceReference:'TEST-PENDING-IDENTITY',requestKey:randomUUID()},owner.token,201);
    await tab(page,'trips');await command(page,`dispatched:${trip.id}`,{odometer:'1000',occurredAt:await local(page),evidenceReference:'TEST-UI-DISPATCH'});
    await api('POST',`/api/fleet/vehicles/${vehicle.id}/corrections`,{revision:0,registration:vehicle.registration,description:'Must refuse an in-flight identity change',evidenceReference:'TEST-IN-FLIGHT',requestKey:randomUUID()},owner.token,409);
    await api('POST',`/api/fleet/vehicle-corrections/${inFlightCorrection.id}/decision`,{revision:0,outcome:'approved',evidenceReference:'TEST-IN-FLIGHT-APPROVAL',requestKey:randomUUID()},reviewer.token,409);
    await command(page,`returned:${trip.id}`,{odometer:'1025',occurredAt:await local(page),evidenceReference:'TEST-UI-RETURN'});
    await api('POST',`/api/fleet/vehicle-corrections/${inFlightCorrection.id}/decision`,{revision:0,outcome:'rejected',evidenceReference:'TEST-REJECT-PENDING-IDENTITY',requestKey:randomUUID()},reviewer.token);
    const newRegistration=`UPDATED-${stamp}`.toUpperCase(),correction=await api('POST',`/api/fleet/vehicles/${vehicle.id}/corrections`,{revision:0,registration:newRegistration,description:vehicle.description,evidenceReference:'TEST-AFTER-RETURN',requestKey:randomUUID()},owner.token,201);
    await api('POST',`/api/fleet/vehicle-corrections/${correction.id}/decision`,{revision:0,outcome:'approved',evidenceReference:'TEST-INDEPENDENT-IDENTITY',requestKey:randomUUID()},reviewer.token);
    expect((await api('GET',`/api/fleet/trips?vehicleId=${vehicle.id}`,undefined,owner.token)).items[0].registration).toBe(newRegistration);
    expect((await api('GET',`/api/fleet/service?vehicleId=${vehicle.id}`,undefined,owner.token)).items[0].registration).toBe(newRegistration);
    await page.locator(`[data-fleet-history="${trip.id}"]`).click();await expect(page.locator('.fleet-history')).toContainText('returned');await expect(page.locator('.fleet-history')).toContainText('1025');
    const createTrip=page.locator('[data-fleet-panel="trip"]');if(await createTrip.getAttribute('open')!==null)await createTrip.locator('summary').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('fleet-trips.png'),fullPage:true});
    await tab(page,'fuel');let dropped=false;
    await page.route('**/api/fleet/fuel',async route=>{if(route.request().method()==='POST' && !dropped){dropped=true;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}else await route.continue();});
    const fuelPanel=page.locator('[data-fleet-panel="fuel"]');await fuelPanel.locator('summary').click();
    await fill(fuelPanel.locator('form'),{vehicleId:vehicle.id,receiptReference:`UI-FUEL-${stamp}`,volumeLitres:'12.345',paid:'78.90',currency:'USD',accountingReference:'TEST-UI-ACCOUNTING'});await fuelPanel.locator('button[type="submit"]').click();
    await expect(page.locator('[data-fleet-retry]')).toBeVisible();await expect(fuelPanel.locator('[name="paid"]')).toBeDisabled();
    await page.locator('[data-fleet-retry]').click();await expect(page.locator('[data-fleet-retry]')).toHaveCount(0);await expect(page.getByRole('status')).toContainText('Fleet command recorded.');await page.unroute('**/api/fleet/fuel');
    expect(dropped).toBe(true);expect((await db.query('select count(*)::int as total from fleet_fuel_receipts where receipt_reference=$1',[`UI-FUEL-${stamp}`])).rows[0].total).toBe(1);
    const fuel=(await api('GET','/api/fleet/fuel',undefined,owner.token)).items.find(row=>row.receiptReference===`UI-FUEL-${stamp}`);expect(fuel).toMatchObject({volumeMillilitres:'12345',paidMinor:'7890',registration:newRegistration});
    await tab(review,'fuel');await command(review,`reverse:${fuel.id}`,{evidenceReference:'TEST-UI-FUEL-CORRECTION'});await expect(review.locator(`[data-fleet-row="${fuel.id}"]`)).toContainText('Reversed');
    await tab(page,'incidents');await command(page,'incident',{vehicleId:vehicle.id,tripId:trip.id,occurredAt:await local(page),evidenceReference:'TEST-UI-INCIDENT',policyReference:'TEST-POLICY',retentionRule:'TEST-RETENTION-NOT-ACTUAL-POLICY',details:`PRIVATE UI FLEET ${stamp} <img src=x onerror="window.fleetLeak=1">`});
    const incident=(await api('GET','/api/fleet/incidents',undefined,owner.token)).items.find(row=>row.vehicleId===vehicle.id);expect(incident.registration).toBe(newRegistration);
    await expect(page.locator('.fleet-list')).not.toContainText('PRIVATE UI FLEET');await page.locator(`[data-fleet-incident="${incident.id}"]`).click();await expect(page.locator('.fleet-incident')).toContainText('PRIVATE UI FLEET');expect(await page.evaluate(()=>window.fleetLeak)).toBeUndefined();
    await tab(review,'incidents');await review.locator(`[data-fleet-incident="${incident.id}"]`).click();await command(review,`resolve:${incident.id}`,{details:'PRIVATE UI RESOLUTION',evidenceReference:'TEST-UI-RESOLUTION'});
    await expect(review.locator('.fleet-incident')).toContainText('PRIVATE UI RESOLUTION');expect(await review.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await review.screenshot({path:info.outputPath('fleet-incident.png'),fullPage:true});
    // A delayed authorised response must not enter another account's registry state.
    await page.locator('[data-fleet-close-incident]').click();let release,entered;
    const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
    releaseHeldResponse=release;
    await page.route(`**/api/fleet/incidents/${incident.id}`,async route=>{const response=await route.fetch();entered();await held;await route.fulfill({response});});
    await page.locator(`[data-fleet-incident="${incident.id}"]`).click();await started;
    await page.evaluate(session=>window.svuSession.set(session),officer);release();
    await expect(page.locator('.review-controls')).toBeEnabled();await page.unroute(`**/api/fleet/incidents/${incident.id}`);await page.locator('[data-fleet-refresh]').click();await expect(page.locator('.review-controls')).toBeEnabled();
    await expect(page.locator('[data-fleet-tab="incidents"]')).toHaveCount(0);await expect(page.locator('#app')).not.toContainText('PRIVATE UI FLEET');await expect(page.locator('#app')).not.toContainText('PRIVATE UI RESOLUTION');
    await tab(page,'fuel');const newFuel=page.locator('[data-fleet-panel="fuel"]');await newFuel.locator('summary').click();await newFuel.locator('[name="accountingReference"]').fill('CLEARED ROUTE DRAFT');
    await page.goto('/#home');await page.goto('/#registry/fleet');await tab(page,'fuel');await page.locator('[data-fleet-panel="fuel"] > summary').click();await expect(page.locator('[data-fleet-command="fuel"] [name="accountingReference"]')).toHaveValue('');
    expect(errors).toEqual([]);
  }finally{
    let cleanupRequest;
    try{
      releaseHeldResponse?.();if(reviewContext)await reviewContext.close();
      if(cleanupTrip && cleanupOwner){
        // Test timeout closes its fixture client before finally cleanup can use it.
        cleanupRequest=await requests.newContext({baseURL:process.env.SVU_BASE_URL,timeout:15000});
        const current=(await api('GET',`/api/fleet/trips?q=${encodeURIComponent(stamp)}`,undefined,cleanupOwner.token,200,cleanupRequest)).items.find(row=>row.id===cleanupTrip);
        if(current && ['requested','approved','dispatched'].includes(current.status)){
          const body={revision:current.revision,kind:current.status==='dispatched'?'returned':'cancelled',evidenceReference:'TEST-UI-FIXTURE-CLEANUP',requestKey:randomUUID()};
          if(current.status==='dispatched'){const vehicle=(await api('GET',`/api/fleet/vehicles?vehicleId=${current.vehicleId}`,undefined,cleanupOwner.token,200,cleanupRequest)).items[0];body.odometer=vehicle.odometer;body.occurredAt=new Date().toISOString();}
          await api('POST',`/api/fleet/trips/${cleanupTrip}/events`,body,cleanupOwner.token,200,cleanupRequest);
        }
      }
    }finally{try{await cleanupRequest?.dispose();}finally{await db.end();}}
  }
  async function local(target,offset=0){return target.evaluate(offset=>new Date(Date.now()+offset-new Date().getTimezoneOffset()*60000).toISOString().slice(0,23).replace(/0+$/,'').replace(/\.$/,'').replace(/:00$/,''),offset);}
  async function open(target,session){await target.goto('/');await target.evaluate(value=>window.svuSession.set(value),session);await target.goto('/#registry/fleet');await expect(target.locator('.fleet-workspace')).toBeVisible();await expect(target.locator('.review-controls')).toBeEnabled();}
  async function tab(target,kind){await target.locator(`[data-fleet-tab="${kind}"]`).click();await expect(target.locator(`[data-fleet-tab="${kind}"]`)).toHaveAttribute('aria-pressed','true');await expect(target.locator('.review-controls')).toBeEnabled();}
  async function fill(form,values){for(const [name,value] of Object.entries(values)){const field=form.locator(`[name="${name}"]`);if(await field.evaluate(node=>node.tagName)==='SELECT')await field.selectOption(value);else await field.fill(value);}}
  async function command(target,key,values){const panel=target.locator(`[data-fleet-panel="${key}"]`);if(await panel.getAttribute('open')===null)await panel.locator('summary').click();await fill(panel.locator('form'),values);await panel.locator('button[type="submit"]').click();await expect(target.getByRole('status')).toContainText('Fleet command recorded.');await expect(target.locator('.review-controls')).toBeEnabled();}
  async function service(target,id,kind,evidence){const panel=target.locator('[data-fleet-panel="service"]');if(await panel.getAttribute('open')===null)await panel.locator('summary').click();await panel.locator('[name="vehicleId"]').selectOption(id);await expect(target.locator('.review-controls')).toBeEnabled();await expect(panel.locator('[name="vehicleId"]')).toHaveValue(id);await command(target,'service',{kind,evidenceReference:evidence});}
  async function api(method,url,data,token,status=200,client=request){const response=await client.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);return (await response.json()).data;}
  async function account(name){const email=`fleet.ui.${name}.${stamp}@example.edu`,password='Fleet-UI-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Fleet UI ${name}`},null,202);let activation;
    for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}
    expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Fleet UI ${name}`});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,accountId:me.account.id};}
});
