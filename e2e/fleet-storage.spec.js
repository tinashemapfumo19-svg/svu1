import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Fleet storage checks require the isolated integration database.');

test('fleet storage retains evidence and serializes bookings, dispatch and operational history',async({request})=>{
  test.setTimeout(120000);
  const suffix=randomUUID(),db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const api=async(method,path,data,token,status=200)=>{
    const response=await request.fetch(path,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});
    expect(response.status(),`${method} ${path}`).toBe(status);return (await response.json()).data;
  };
  try {
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const registrar=await api('POST','/api/identity/sessions',{email:'registrar@southvalley.test',password:'Kariba-Senate-Approvals-2026!'},null,201);
    const owner=(await api('GET','/api/identity/me',undefined,admin.token)).account.id;
    const driver=(await api('GET','/api/identity/me',undefined,registrar.token)).account.id;
    const reviewer=(await db.query("select id from accounts where email='tinashe@example.edu'")).rows[0].id;
    let staff=(await api('GET','/api/staff?q=registrar%40southvalley.test',undefined,admin.token)).items[0];
    if(!staff){
      staff=await api('POST','/api/staff',{email:'registrar@southvalley.test',legalName:'Fleet Driver Fixture',preferredName:'Driver',category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode:'lecturer',engagedOn:'2026-01-01',reason:'Isolated fleet storage fixture',linkExistingAccount:true},admin.token,201);
      const appointments=await api('GET','/api/identity/staff-appointments',undefined,registrar.token);
      await api('POST',`/api/identity/staff-appointments/${appointments[0].invitationId}`,{accept:true},registrar.token);
    }
    const vehicle=`vehicle_${suffix}`,otherVehicle=`other_vehicle_${suffix}`,auth=`driver_${suffix}`;
    for(const [index,id] of [vehicle,otherVehicle].entries()){
      const asset=await api('POST','/api/assets',{assetTag:`FL_${suffix}_${index}`.toUpperCase(),name:'Fleet fixture vehicle',category:'Vehicle',acquiredOn:'2026-01-01',acquisitionMethod:'Purchase',valueMinor:10000,currency:'USD',departmentId:'dept_computing',location:'Fleet stores',condition:'serviceable',reason:'Isolated fleet fixture',replayKey:randomUUID()},admin.token,201);
      await db.query("insert into fleet_vehicles(id,asset_id,registration,description,distance_unit,opening_odometer,evidence_reference,created_by) values($1,$2,$3,'Fleet fixture','km',1000,'TEST-REGISTRATION',$4)",[id,asset.id,`${suffix}_${index}`,owner]);
    }
    const authorise=(id,approver=reviewer)=>db.query("insert into fleet_driver_authorisations(id,staff_id,valid_from,valid_until,evidence_reference,requested_by,approved_by) values($1,$2,now()-interval '1 day',now()+interval '30 days','TEST-DRIVER-AUTH',$3,$4)",[id,staff.id,owner,approver]);
    // Direct SQL approval actors and opaque envelopes are storage fixtures, not role or crypto proof.
    await expect(authorise(`self_${suffix}`,driver)).rejects.toThrow('independent approval');
    await authorise(auth);
    const trip=`trip_${suffix}`,conflict=`conflict_${suffix}`,driverConflict=`driver_conflict_${suffix}`,later=`later_${suffix}`;
    const book=(id,v=vehicle,start="now()-interval '1 minute'",end="now()+interval '1 hour'")=>db.query(`insert into fleet_trips(id,vehicle_id,driver_authorisation_id,requested_by,purpose,destination,planned_start,planned_end) values($1,$2,$3,$4,'Fixture journey','Campus',${start},${end})`,[id,v,auth,owner]);
    const event=(id,revision,kind,actor=reviewer,odometer=null,connection=db)=>connection.query('insert into fleet_trip_events(trip_id,revision,kind,actor_id,evidence_reference,odometer,occurred_at) values($1,$2,$3,$4,$5,$6,case when $6::bigint is null then null else clock_timestamp() end)',[id,revision,kind,actor,'TEST-TRIP-EVIDENCE',odometer]);
    await book(trip);await book(conflict);await book(driverConflict,otherVehicle);
    await book(later,vehicle,"now()+interval '2 hours'","now()+interval '3 hours'");
    await expect(event(trip,1,'dispatched',owner,1000)).rejects.toThrow('transition');
    await expect(event(trip,1,'approved',owner)).rejects.toThrow('independent');
    await expect(event(trip,1,'approved',driver)).rejects.toThrow('independent');
    await event(trip,1,'approved');
    await expect(event(conflict,1,'approved')).rejects.toThrow('conflicts');
    await expect(event(driverConflict,1,'approved')).rejects.toThrow('conflicts');
    await event(later,1,'approved');
    await expect(event(trip,1,'dispatched',owner,1000)).rejects.toThrow('revision');
    await expect(event(trip,2,'dispatched',owner,999)).rejects.toThrow('Odometer');
    const service=(kind,actor=owner)=>db.query('insert into fleet_service_events(vehicle_id,kind,actor_id,evidence_reference) values($1,$2,$3,$4)',[vehicle,kind,actor,'TEST-SERVICE']);
    await expect(service('release',reviewer)).rejects.toThrow('independent evidence');
    await service('hold');await expect(service('hold')).rejects.toThrow('already held');
    await service('service');
    await expect(event(trip,2,'dispatched',owner,1000)).rejects.toThrow('unavailable');
    await expect(service('release')).rejects.toThrow('independent evidence');await service('release',reviewer);
    await db.query("update staff_members set status='suspended' where id=$1",[staff.id]);
    await expect(event(trip,2,'dispatched',owner,1000)).rejects.toThrow('not current');
    await db.query("update staff_members set status='active' where id=$1",[staff.id]);
    await db.query("update accounts set status='locked' where id=$1",[driver]);
    await expect(event(trip,2,'dispatched',owner,1000)).rejects.toThrow('not current');
    await db.query("update accounts set status='active' where id=$1",[driver]);
    await event(trip,2,'dispatched',owner,1000);
    await expect(event(trip,3,'cancelled')).rejects.toThrow('transition');
    await expect(event(trip,3,'returned',owner,999)).rejects.toThrow('Odometer');
    await db.query('insert into fleet_driver_revocations(authorisation_id,actor_id,evidence_reference) values($1,$2,$3)',[auth,reviewer,'TEST-REVOKED']);
    await event(later,2,'cancelled');
    await service('hold');
    // Return remains possible after a safety hold or driver revocation, without re-authorising either.
    await event(trip,3,'returned',owner,1050);
    await expect(event(trip,4,'approved')).rejects.toThrow('transition');
    await service('release',reviewer);
    await expect(book(`revoked_${suffix}`)).rejects.toThrow('not current');
    const freshAuth=`fresh_${suffix}`;await authorise(freshAuth);
    const freshTrip=`fresh_trip_${suffix}`;
    await db.query("insert into fleet_trips(id,vehicle_id,driver_authorisation_id,requested_by,purpose,destination,planned_start,planned_end) values($1,$2,$3,$4,'Fresh journey','Campus',now()-interval '1 minute',now()+interval '1 hour')",[freshTrip,vehicle,freshAuth,owner]);
    await event(freshTrip,1,'approved');await expect(event(freshTrip,2,'dispatched',owner,1049)).rejects.toThrow('Odometer');
    await event(freshTrip,2,'dispatched',owner,1050);await event(freshTrip,3,'returned',owner,1100);
    const fuel=`fuel_${suffix}`;
    const receipt=(id,volume=10000,date='2026-01-01')=>db.query('insert into fleet_fuel_receipts(id,vehicle_id,receipt_reference,purchased_on,volume_millilitres,paid_minor,currency,recorded_by) values($1,$2,$3,$4,$5,12345,\'USD\',$6)',[id,vehicle,`TEST-FUEL-${suffix}`,date,volume,owner]);
    await expect(receipt(fuel,0)).rejects.toThrow();await expect(receipt(fuel,10000,'2099-01-01')).rejects.toThrow('future');await receipt(fuel);
    await expect(receipt(`duplicate_${suffix}`)).rejects.toThrow();
    expect((await db.query('select volume_millilitres::text,paid_minor::text,accounting_reference from fleet_fuel_receipts where id=$1',[fuel])).rows[0]).toEqual({volume_millilitres:'10000',paid_minor:'12345',accounting_reference:null});
    const incident=`incident_${suffix}`;
    const report=(v)=>db.query("insert into fleet_incidents(id,vehicle_id,trip_id,occurred_at,details_encrypted,evidence_reference,recorded_by) values($1,$2,$3,clock_timestamp(),'opaque-test-only','TEST-INCIDENT',$4)",[incident,v,trip,owner]);
    await expect(report(otherVehicle)).rejects.toThrow('matching vehicle');await report(vehicle);
    await db.query("insert into fleet_incident_resolutions(incident_id,evidence_reference,details_encrypted,resolved_by) values($1,'TEST-RESOLUTION','opaque-test-only',$2)",[incident,reviewer]);
    await db.query('insert into fleet_command_receipts(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)',[owner,suffix,'0'.repeat(64),{id:trip}]);
    for(const table of ['fleet_vehicles','fleet_driver_authorisations','fleet_driver_revocations','fleet_trips','fleet_trip_events','fleet_service_events','fleet_fuel_receipts','fleet_incidents','fleet_incident_resolutions','fleet_command_receipts']){
      await expect(db.query(`delete from ${table}`)).rejects.toThrow();
      await expect(db.query(`update ${table} set ${table==='fleet_driver_revocations'?'evidence_reference=evidence_reference':table==='fleet_command_receipts'?'result=result':table==='fleet_incident_resolutions'?'evidence_reference=evidence_reference':table==='fleet_trips'?'purpose=purpose':table==='fleet_trip_events'?'kind=kind':table==='fleet_service_events'?'kind=kind':table==='fleet_fuel_receipts'?'paid_minor=paid_minor':table==='fleet_incidents'?'details_encrypted=details_encrypted':table==='fleet_driver_authorisations'?'staff_id=staff_id':'registration=registration'}`)).rejects.toThrow();
    }
    // Both proposals overlap. The second connection waits, then sees the committed winner.
    const first=`concurrent_a_${suffix}`,second=`concurrent_b_${suffix}`;
    for(const id of [first,second])await db.query("insert into fleet_trips(id,vehicle_id,driver_authorisation_id,requested_by,purpose,destination,planned_start,planned_end) values($1,$2,$3,$4,'Concurrency fixture','Campus',now()+interval '5 hours',now()+interval '6 hours')",[id,vehicle,freshAuth,owner]);
    const waiter=new pg.Client({connectionString:process.env.DATABASE_URL});await waiter.connect();let pending;
    try {
      const pid=(await waiter.query('select pg_backend_pid() as pid')).rows[0].pid;
      await db.query('begin');await event(first,1,'approved');
      pending=event(second,1,'approved',reviewer,null,waiter).then(()=>({ok:true}),error=>({error:error.message}));
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        waiting=(await db.query('select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',[pid])).rows[0].waiting;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);await db.query('commit');expect((await pending).error).toContain('conflicts');
      await event(first,2,'cancelled');
    }finally{await db.query('rollback');if(pending)await pending;await waiter.end();}
  }finally{await db.query('rollback');await db.end();}
});
