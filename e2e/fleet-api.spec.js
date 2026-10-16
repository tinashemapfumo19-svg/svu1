import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {createFleetModule} from '../server/modules/fleet.js';
import {loadConfig} from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Fleet API checks require the isolated integration database.');
test('fleet native APIs enforce fresh authority, independent decisions, audit/replay and restricted incidents',async({request},info)=>{
  test.setTimeout(180000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),stamp=`${info.project.name}-${Date.now()}`,base='/api/fleet',options={dataEncryptionKey:loadConfig().dataEncryptionKey};
  const now=offset=>new Date(Date.now()+offset).toISOString(),key=()=>randomUUID(),today=new Date().toISOString().slice(0,10);
  try{
    const owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const registrar=await api('POST','/api/identity/sessions',{email:'registrar@southvalley.test',password:'Kariba-Senate-Approvals-2026!'},null,201);
    const ownerId=(await api('GET','/api/identity/me',undefined,owner.token)).account.id;
    const reviewer=await account('reviewer'),scoped=await account('scoped');
    const appointment=await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode:'fleet_approver',scope:{},reason:'Isolated fleet review fixture'},owner.token,201);
    for(const roleCode of ['fleet_safety_officer','asset_approver'])await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode,scope:{},reason:'Isolated fleet safety/disposal fixture'},owner.token,201);
    await api('POST','/api/access/role-assignments',{accountId:scoped.accountId,roleCode:'fleet_officer',scope:{programmeCodes:['BSC-IS']},reason:'Scoped denial fixture'},owner.token,201);
    await api('POST','/api/access/role-assignments',{accountId:scoped.accountId,roleCode:'hr_officer',scope:{},reason:'Unrelated global role cannot widen fleet scope'},owner.token,201);
    await api('GET',base,undefined,null,401);await api('GET',base,undefined,registrar.token,403);await api('GET',base,undefined,scoped.token,403);
    await api('GET',`${base}/vehicles?offset=0&offset=1`,undefined,owner.token,400);
    await api('GET',`${base}/vehicles?accountId=other`,undefined,owner.token,400);
    const workspace=await api('GET',base,undefined,owner.token);expect(workspace.capabilities).toEqual({manage:true,approve:true,incidents:true});
    let staff=(await api('GET','/api/staff?q=registrar%40southvalley.test',undefined,owner.token)).items[0];
    if(!staff){
      staff=await api('POST','/api/staff',{email:'registrar@southvalley.test',legalName:'Fleet Driver Fixture',preferredName:'Driver',category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode:'lecturer',engagedOn:'2026-01-01',reason:'Isolated native fleet fixture',linkExistingAccount:true},owner.token,201);
      const appointments=await api('GET','/api/identity/staff-appointments',undefined,registrar.token);await api('POST',`/api/identity/staff-appointments/${appointments[0].invitationId}`,{accept:true},registrar.token);
    }
    const asset=await assetRecord('main'),spare=await assetRecord('spare');
    const vehicleInput={assetId:asset.id,registration:`TEST-${stamp}`,description:'Fleet API fixture',distanceUnit:'km',openingOdometer:'1000',evidenceReference:'TEST-REGISTRATION',requestKey:key()};
    const vehicle=await api('POST',`${base}/vehicles`,vehicleInput,owner.token,201);
    expect(await api('POST',`${base}/vehicles`,vehicleInput,owner.token,201)).toEqual(vehicle);
    await api('POST',`${base}/vehicles`,{...vehicleInput,description:'Changed input'},owner.token,409);
    await api('POST',`${base}/vehicles`,{...vehicleInput,createdBy:'other',requestKey:key()},owner.token,400);
    const driverInput={staffId:staff.id,validFrom:now(-86400000),validUntil:now(30*86400000),evidenceReference:'TEST-DRIVER-EVIDENCE',requestKey:key()};
    const proposal=await api('POST',`${base}/drivers`,driverInput,owner.token,201),decision={revision:0,outcome:'approved',evidenceReference:'TEST-INDEPENDENT-DRIVER-APPROVAL',requestKey:key()};
    await api('POST',`${base}/drivers/${proposal.id}/decision`,decision,owner.token,403);
    const authorisation=await api('POST',`${base}/drivers/${proposal.id}/decision`,decision,reviewer.token);
    expect(await api('POST',`${base}/drivers/${proposal.id}/decision`,decision,reviewer.token)).toEqual(authorisation);
    const tripInput={vehicleId:vehicle.id,driverAuthorisationId:authorisation.authorisationId,purpose:'Campus transfer',destination:'Campus',plannedStart:now(-60000),plannedEnd:now(3600000),requestKey:key()};
    const trip=await api('POST',`${base}/trips`,tripInput,owner.token,201),approval={revision:0,kind:'approved',evidenceReference:'TEST-TRIP-APPROVAL',requestKey:key()};
    await api('POST',`${base}/trips/${trip.id}/events`,{revision:0,kind:'dispatched',evidenceReference:'TEST-DISPATCH',odometer:'1000',occurredAt:now(0),requestKey:key()},owner.token,409);
    await api('POST',`${base}/trips/${trip.id}/events`,approval,owner.token,403);await api('POST',`${base}/trips/${trip.id}/events`,approval,reviewer.token);
    const disposal={revision:1,proposedOn:today,valueMinor:0,method:'Fixture retirement',reason:'Must refuse an approved trip',replayKey:key()};
    await api('POST',`/api/assets/${asset.id}/dispose`,disposal,owner.token,409);
    expect((await pool.query('select count(*)::int as total from asset_disposals where asset_id=$1',[asset.id])).rows[0].total).toBe(0);
    expect((await api('GET',`/api/assets/${asset.id}`,undefined,owner.token)).revision).toBe(1);
    const hold={revision:0,kind:'hold',evidenceReference:'TEST-SAFETY-HOLD',requestKey:key()};await api('POST',`${base}/vehicles/${vehicle.id}/service`,hold,owner.token);
    const dispatch={revision:1,kind:'dispatched',evidenceReference:'TEST-DISPATCH',odometer:'1000',occurredAt:now(0),requestKey:key()};
    await api('POST',`${base}/trips/${trip.id}/events`,dispatch,owner.token,409);
    await api('POST',`${base}/vehicles/${vehicle.id}/service`,{revision:1,kind:'release',evidenceReference:'TEST-RELEASE',requestKey:key()},owner.token,403);
    await api('POST',`${base}/vehicles/${vehicle.id}/service`,{revision:1,kind:'release',evidenceReference:'TEST-RELEASE',requestKey:key()},reviewer.token);
    dispatch.occurredAt=now(0);await api('POST',`${base}/trips/${trip.id}/events`,dispatch,owner.token);
    await api('POST',`${base}/trips/${trip.id}/events`,{revision:2,kind:'returned',evidenceReference:'TEST-RETURN',odometer:'999',occurredAt:now(0),requestKey:key()},owner.token,409);
    await api('POST',`${base}/trips/${trip.id}/events`,{revision:2,kind:'returned',evidenceReference:'TEST-RETURN',odometer:'1050',occurredAt:now(0),requestKey:key()},owner.token);
    const history=await api('GET',`${base}/trips/${trip.id}/events`,undefined,reviewer.token);expect(history.items.map(row=>row.kind)).toEqual(['returned','dispatched','approved']);expect(history.items[0].odometer).toBe('1050');
    const fuelInput={vehicleId:vehicle.id,receiptReference:`TEST-FUEL-${stamp}`,purchasedOn:today,volumeMillilitres:'12345',paidMinor:'7890',currency:'USD',accountingReference:'TEST-ACCOUNTING-REFERENCE',requestKey:key()};
    const fuel=await api('POST',`${base}/fuel`,fuelInput,owner.token,201);await api('POST',`${base}/fuel`,{...fuelInput,requestKey:key()},owner.token,409);
    const incidentInput={vehicleId:vehicle.id,tripId:trip.id,occurredAt:now(0),details:'PRIVATE FLEET INCIDENT',evidenceReference:'TEST-INCIDENT',policyReference:'TEST-INCIDENT-POLICY',retentionRule:'TEST-RETENTION-NOT-ACTUAL-POLICY',requestKey:key()};
    const incident=await api('POST',`${base}/incidents`,incidentInput,owner.token,201);
    // An operational-only native appointee has no incident metadata/body access.
    const officer=await account('officer');await api('POST','/api/access/role-assignments',{accountId:officer.accountId,roleCode:'fleet_officer',scope:{},reason:'Operational-only fixture'},owner.token,201);
    await api('GET',`${base}/incidents`,undefined,officer.token,403);await api('GET',`${base}/incidents/${incident.id}`,undefined,officer.token,403);
    expect((await api('GET',`${base}/incidents/${incident.id}`,undefined,reviewer.token)).details).toBe('PRIVATE FLEET INCIDENT');
    expect(JSON.stringify(await api('GET',`${base}/incidents`,undefined,reviewer.token))).not.toContain('PRIVATE FLEET INCIDENT');
    const raw=(await pool.query('select details_encrypted from fleet_incidents where id=$1',[incident.id])).rows[0].details_encrypted;expect(raw).not.toContain('PRIVATE FLEET INCIDENT');
    const pendingDriver=await api('POST',`${base}/drivers`,{...driverInput,requestKey:key()},owner.token,201);
    const rejectedDriver=await api('POST',`${base}/drivers`,{...driverInput,requestKey:key()},owner.token,201);
    let employment=await api('GET',`/api/staff/${staff.id}`,undefined,owner.token);
    await api('POST',`/api/staff/${staff.id}/status`,{revision:employment.revision,toStatus:'suspended',effectiveOn:today,reason:'Driver review suspension fixture'},owner.token);
    await api('POST',`${base}/drivers/${rejectedDriver.id}/decision`,{...decision,requestKey:key()},reviewer.token,409);
    await api('POST',`${base}/drivers/${rejectedDriver.id}/decision`,{...decision,outcome:'rejected',requestKey:key()},reviewer.token);
    employment=await api('GET',`/api/staff/${staff.id}`,undefined,owner.token);
    await api('POST',`/api/staff/${staff.id}/status`,{revision:employment.revision,toStatus:'active',effectiveOn:today,reason:'Restore isolated fixture'},owner.token);
    const pendingTrip=await api('POST',`${base}/trips`,{...tripInput,requestKey:key()},owner.token,201);
    const ownerActor={accountId:ownerId,roles:[{scope:{},permissions:['fleet.view','fleet.manage','fleet.approve','fleet.incidents']}]},reviewActor={accountId:reviewer.accountId,roles:[{scope:{},permissions:['fleet.view','fleet.approve','fleet.incidents']}]};
    const faults=[
      ['registerFleetVehicle',[{...vehicleInput,assetId:spare.id,registration:`SPARE-${stamp}`}],ownerActor],
      ['requestFleetDriver',[driverInput],ownerActor],['decideFleetDriver',[pendingDriver.id,decision],reviewActor],
      ['revokeFleetDriver',[authorisation.authorisationId,{evidenceReference:'TEST-REVOCATION'}],reviewActor],
      ['requestFleetTrip',[tripInput],ownerActor],['recordFleetTripEvent',[pendingTrip.id,approval],reviewActor],
      ['recordFleetService',[vehicle.id,{revision:2,kind:'hold',evidenceReference:'TEST-HOLD'}],ownerActor],
      ['recordFleetFuel',[{...fuelInput,receiptReference:`TEST-ROLLBACK-FUEL-${stamp}`}],ownerActor],
      ['reverseFleetFuel',[fuel.id,{evidenceReference:'TEST-REVERSE'}],reviewActor],
      ['recordFleetIncident',[incidentInput],ownerActor],['resolveFleetIncident',[incident.id,{revision:0,details:'PRIVATE RESOLUTION',evidenceReference:'TEST-RESOLUTION'}],reviewActor]
    ];
    for(const [method,args,actor] of faults)for(const target of ['audit_events','fleet_command_receipts']){
      let injected=false;const before=await counts(),parameters=[...args];parameters[parameters.length-1]={...parameters.at(-1),requestKey:key()};
      const failingPool={async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,values){if(sql.toLowerCase().includes(`insert into ${target}`)){injected=true;return client.query('select 1/0');}return client.query(sql,values);}};}};
      await expect(createFleetModule(failingPool,options)[method](...parameters,actor)).rejects.toThrow(/division by zero/);expect(injected,`${method}/${target}`).toBe(true);expect(await counts()).toEqual(before);
    }
    // Pause a real approval after its write; role removal must wait for the permission locks.
    let resume,entered;const paused=new Promise(resolve=>{resume=resolve;}),written=new Promise(resolve=>{entered=resolve;});
    const pausedPool={async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,values){const result=await client.query(sql,values);if(sql.startsWith('insert into fleet_trip_events')){entered();await paused;}return result;}};}};
    const ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let approvalOperation,roleEndOperation,cancelled=false;
    try{
      approvalOperation=createFleetModule(pausedPool,options).recordFleetTripEvent(pendingTrip.id,{...approval,requestKey:key()},reviewActor).then(result=>({result}),error=>({error}));
      await Promise.race([written,approvalOperation.then(value=>{throw value.error || new Error('Approval did not pause after its write');})]);
      await ending.query('begin');const pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;
      roleEndOperation=ending.query('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[appointment.id,ownerId,'Controlled role-lock fixture']).then(()=>({ended:true}),error=>({error}));
      let waiting=false;for(let attempt=0;attempt<100;attempt++){waiting=(await pool.query('select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',[pid])).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
      expect(waiting).toBe(true);resume();expect((await approvalOperation).result.revision).toBe(1);expect(await roleEndOperation).toEqual({ended:true});await ending.query('rollback');
      await api('POST',`${base}/trips/${pendingTrip.id}/events`,{revision:1,kind:'cancelled',evidenceReference:'TEST-CANCEL-LOCK-FIXTURE',requestKey:key()},owner.token);
      cancelled=true;
    }finally{
      resume();const completed=approvalOperation?await approvalOperation:null;if(roleEndOperation)await roleEndOperation;await ending.query('rollback');await ending.end();
      if(completed?.result && !cancelled)await api('POST',`${base}/trips/${pendingTrip.id}/events`,{revision:1,kind:'cancelled',evidenceReference:'TEST-CLEANUP-LOCK-FIXTURE',requestKey:key()},owner.token);
    }
    await api('POST',`${base}/fuel/${fuel.id}/reverse`,{evidenceReference:'TEST-REVERSE',requestKey:key()},owner.token,403);
    await api('POST',`${base}/fuel/${fuel.id}/reverse`,{evidenceReference:'TEST-REVERSE',requestKey:key()},reviewer.token);
    const fuelRows=await api('GET',`${base}/fuel?vehicleId=${vehicle.id}`,undefined,owner.token);expect(fuelRows.items[0]).toMatchObject({paidMinor:'7890',volumeMillilitres:'12345',reversed:true});
    await api('POST',`${base}/incidents/${incident.id}/resolve`,{revision:0,details:'PRIVATE RESOLUTION',evidenceReference:'TEST-RESOLUTION',requestKey:key()},reviewer.token);
    expect((await api('GET',`${base}/incidents/${incident.id}`,undefined,reviewer.token)).resolution.details).toBe('PRIVATE RESOLUTION');
    // Real simultaneous public approvals cannot reserve the same vehicle/driver twice.
    const booking={...tripInput,plannedStart:now(5*3600000),plannedEnd:now(6*3600000)};
    const concurrent=[];for(let index=0;index<2;index++)concurrent.push(await api('POST',`${base}/trips`,{...booking,requestKey:key()},owner.token,201));
    const responses=await Promise.all(concurrent.map(row=>request.post(`${base}/trips/${row.id}/events`,{data:{...approval,requestKey:key()},headers:{Authorization:`Bearer ${reviewer.token}`}})));
    expect(responses.map(row=>row.status()).sort()).toEqual([200,409]);const winner=concurrent[responses.findIndex(row=>row.status()===200)];
    await api('POST',`${base}/trips/${winner.id}/events`,{revision:1,kind:'cancelled',evidenceReference:'TEST-CANCEL',requestKey:key()},owner.token);
    const revoke={evidenceReference:'TEST-REVOKED',requestKey:key()};await api('POST',`${base}/authorisations/${authorisation.authorisationId}/revoke`,revoke,reviewer.token);
    await api('POST',`${base}/trips`,{...tripInput,requestKey:key()},owner.token,409);
    const pendingDisposal=await api('POST',`/api/assets/${asset.id}/dispose`,disposal,owner.token);expect(pendingDisposal.status).toBe('disposal_pending');
    await api('POST',`/api/assets/${asset.id}/review`,{revision:2,outcome:'approve',reviewedOn:today,reason:'Independent fixture disposal',replayKey:key()},reviewer.token);
    expect((await api('GET',`${base}/vehicles?vehicleId=${vehicle.id}`,undefined,owner.token)).items[0].assetStatus).toBe('disposed');
    await api('POST',`/api/access/role-assignments/${appointment.id}/end`,{reason:'End isolated fleet approval'},owner.token);
    await expect(createFleetModule(pool,options).revokeFleetDriver(authorisation.authorisationId,revoke,reviewActor)).rejects.toMatchObject({statusCode:403});
    await api('POST',`${base}/authorisations/${authorisation.authorisationId}/revoke`,revoke,reviewer.token,403);
    const sensitive=(await pool.query("select reason,metadata from audit_events where action like 'fleet.%'")).rows;
    expect(JSON.stringify(sensitive)).not.toContain('PRIVATE FLEET INCIDENT');expect(JSON.stringify(sensitive)).not.toContain('PRIVATE RESOLUTION');
    expect(JSON.stringify((await pool.query('select result from fleet_command_receipts')).rows)).not.toContain('PRIVATE FLEET INCIDENT');
    const references=await api('GET',`${base}/references`,undefined,owner.token);expect(references.assets.length).toBeLessThanOrEqual(25);expect(references.staff.length).toBeLessThanOrEqual(25);
  }finally{await pool.end();}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok() && url.startsWith(base))expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(name){
    const email=`fleet.${name}.${stamp}@example.edu`,password='Fleet-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Fleet ${name}`},null,202);
    let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const value=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(value.recipientEmail===email && value.variables?.activationToken)activation=value.variables.activationToken;}
    expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Fleet ${name}`});
    const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,accountId:me.account.id};
  }
  async function assetRecord(name){const session=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);return api('POST','/api/assets',{assetTag:`FA_${name}_${stamp}`.toUpperCase(),name:'Fleet API asset fixture',category:'Vehicle',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:10000,currency:'USD',departmentId:'dept_computing',location:'Fleet stores',condition:'serviceable',reason:'Isolated fleet API fixture',replayKey:key()},session.token,201);}
  async function counts(){
    const counts={};for(const table of ['fleet_vehicles','fleet_driver_requests','fleet_driver_decisions','fleet_driver_authorisations','fleet_driver_revocations','fleet_trips','fleet_trip_events','fleet_service_events','fleet_fuel_receipts','fleet_fuel_reversals','fleet_incidents','fleet_incident_resolutions','fleet_command_receipts'])counts[table]=(await pool.query(`select count(*)::int as total from ${table}`)).rows[0].total;
    counts.audit=(await pool.query("select count(*)::int as total from audit_events where action like 'fleet.%'")).rows[0].total;return counts;
  }
});
