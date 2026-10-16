import {createHmac,randomUUID} from 'node:crypto';
import {decryptSecret,encryptSecret} from '../security.js';
import {insertAudit,isGlobalScope,parseEffectiveDate,requestError,todayIso,withTransaction} from '../support.js';

const fields=(input,allowed)=>{if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw requestError(400,'Unsupported fleet fields.');};
const text=(value,max=200,multiline=false)=>{if(typeof value!=='string' || !value.trim() || value.length>max || (multiline ? /\0/ : /[\0\r\n]/).test(value))throw requestError(400,'Provide bounded fleet text.');return value.trim();};
const canonical=value=>Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const lock=db=>db.query("select pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0))");
export function fleetAuthority(actor,permission){return !!actor?.accountId && !!actor.roles?.some(role=>role.permissions?.includes(permission) && isGlobalScope(role.scope));}
export function fleetTimestamp(value){
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw requestError(400,'Provide an exact UTC fleet timestamp.');
  const date=new Date(value),expected=value.includes('.') ? value : value.replace('Z','.000Z');
  if(!Number.isFinite(date.getTime()) || date.toISOString()!==expected || value<'1900')throw requestError(400,'Invalid fleet timestamp.');return date.toISOString();
}
export function fleetInteger(value,max=1000000000n,min=0n){
  if(typeof value!=='string' || !/^(?:0|[1-9]\d{0,10})$/.test(value) || BigInt(value)>max || BigInt(value)<min)throw requestError(400,'Provide a canonical exact fleet quantity string.');return value;
}
export function fleetPage(input){fields(input,['offset','q','vehicleId']);const offset=input.offset ?? '0';
  if(typeof offset!=='string' || !/^(?:0|[1-9]\d{0,5})$/.test(offset) || Number(offset)>100000)throw requestError(400,'Invalid fleet page.');
  return {offset:Number(offset),q:input.q===undefined || input.q==='' ? '' : text(input.q,200),vehicleId:input.vehicleId===undefined || input.vehicleId==='' ? '' : text(input.vehicleId,100)};
}
const definitions={
  vehicle:['assetId','registration','description','distanceUnit','openingOdometer','evidenceReference'],
  vehicleCorrection:['revision','registration','description','evidenceReference'],
  vehicleCorrectionDecision:['revision','outcome','evidenceReference'],
  meterChange:['revision','readingRevision','lastEventId','kind','closingOdometer','openingOdometer','meterReference','occurredAt','evidenceReference'],
  readingCorrection:['revision','meterRevision','lastEventId','targetMeterRevision','targetKind','targetEventId','odometer','evidenceReference'],
  meterDecision:['revision','outcome','evidenceReference'],readingDecision:['revision','outcome','evidenceReference'],
  driverRequest:['staffId','validFrom','validUntil','evidenceReference'],
  driverDecision:['revision','outcome','evidenceReference'],revoke:['evidenceReference'],
  trip:['vehicleId','driverAuthorisationId','purpose','destination','plannedStart','plannedEnd'],
  tripEvent:['revision','kind','evidenceReference','odometer','occurredAt','meterRevision'],
  service:['revision','kind','evidenceReference'],
  fuel:['vehicleId','receiptReference','purchasedOn','volumeMillilitres','paidMinor','currency','accountingReference'],
  reverseFuel:['evidenceReference'],
  incident:['vehicleId','tripId','occurredAt','details','evidenceReference','policyReference','retentionRule'],
  resolveIncident:['revision','details','evidenceReference']
};
export function validateFleetCommand(action,input){
  const allowed=definitions[action];if(!allowed)throw requestError(400,'Unknown fleet command.');fields(input,['requestKey',...allowed]);
  if(typeof input.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))throw requestError(400,'Provide a fleet request key.');
  const data={...input};
  for(const key of ['assetId','staffId','vehicleId','driverAuthorisationId','registration','description','evidenceReference','purpose','destination','receiptReference','accountingReference','policyReference','retentionRule','meterReference']){
    if(allowed.includes(key))data[key]=key==='accountingReference' && (input[key]===undefined || input[key]===null || input[key]==='') ? null : text(input[key],key==='purpose' || key==='retentionRule' ? 500 : key.endsWith('Id') ? 100 : key==='registration' ? 40 : 200);
  }
  if(allowed.includes('tripId'))data.tripId=input.tripId===undefined || input.tripId===null || input.tripId==='' ? null : text(input.tripId,100);
  if(allowed.includes('details'))data.details=text(input.details,2000,true);
  for(const name of ['revision','readingRevision','targetMeterRevision'])if(allowed.includes(name) && (!Number.isSafeInteger(input[name]) || input[name]<0 || input[name]>2147483646))throw requestError(400,'Provide the current fleet revision.');
  if(['meterChange','readingCorrection'].includes(action)){
    for(const name of ['lastEventId',...(action==='readingCorrection'?['targetEventId']:[])]){
      if(input[name]!==null && (typeof input[name]!=='string' || !/^[1-9]\d{0,18}$/.test(input[name]) || BigInt(input[name])>9223372036854775807n))throw requestError(400,'Provide the exact retained reading identity or null.');
    }
  }
  if(action==='meterChange'){
    if(!['replacement','reset'].includes(input.kind))throw requestError(400,'Choose a meter operation.');
    data.closingOdometer=fleetInteger(input.closingOdometer);data.openingOdometer=fleetInteger(input.openingOdometer);data.occurredAt=fleetTimestamp(input.occurredAt);
  }
  if(action==='readingCorrection'){
    if(!Number.isSafeInteger(input.meterRevision) || input.meterRevision<0 || input.meterRevision>2147483646)throw requestError(400,'Provide the current meter revision.');
    if(!['opening','closing','trip'].includes(input.targetKind) || (input.targetKind==='trip')!==(input.targetEventId!==null))throw requestError(400,'Choose a retained reading target.');data.odometer=fleetInteger(input.odometer);
  }
  if(action==='vehicle'){
    if(!['km','mi'].includes(input.distanceUnit))throw requestError(400,'Choose the distance unit.');data.registration=data.registration.toUpperCase();data.openingOdometer=fleetInteger(input.openingOdometer);
  }
  if(action==='driverRequest' || action==='trip'){
    const [start,end]=action==='trip' ? ['plannedStart','plannedEnd'] : ['validFrom','validUntil'];data[start]=fleetTimestamp(input[start]);data[end]=fleetTimestamp(input[end]);
    if(data[end]<=data[start])throw requestError(400,'Fleet end time must follow start time.');
  }
  if(action==='vehicleCorrection')data.registration=data.registration.toUpperCase();
  if(['driverDecision','vehicleCorrectionDecision','meterDecision','readingDecision'].includes(action) && !['approved','rejected'].includes(input.outcome))throw requestError(400,'Choose an independent decision.');
  if(action==='tripEvent'){
    if(!['approved','rejected','cancelled','dispatched','returned'].includes(input.kind))throw requestError(400,'Choose a trip event.');
    if(['dispatched','returned'].includes(input.kind)){data.odometer=fleetInteger(input.odometer);data.occurredAt=fleetTimestamp(input.occurredAt);data.meterRevision=input.meterRevision===undefined?0:input.meterRevision;if(!Number.isSafeInteger(data.meterRevision) || data.meterRevision<0 || data.meterRevision>2147483646)throw requestError(400,'Provide the current meter revision.');}
    else if(input.odometer!==undefined || input.occurredAt!==undefined || input.meterRevision!==undefined)throw requestError(400,'Only dispatch and return carry actual readings.');
  }
  if(action==='service' && !['hold','release','service'].includes(input.kind))throw requestError(400,'Choose a service event.');
  if(action==='fuel'){
    if(typeof input.purchasedOn!=='string' || !input.purchasedOn)throw requestError(400,'Provide a purchase date.');data.purchasedOn=parseEffectiveDate(input.purchasedOn);
    if(data.purchasedOn<'1900-01-01' || data.purchasedOn>todayIso())throw requestError(400,'Fuel purchase date must be in the past or today.');
    data.volumeMillilitres=fleetInteger(input.volumeMillilitres,1000000000n,1n);data.paidMinor=fleetInteger(input.paidMinor,10000000000n);
    if(typeof input.currency!=='string' || !/^[A-Z]{3}$/.test(input.currency))throw requestError(400,'Provide an explicit currency.');
  }
  if(action==='incident')data.occurredAt=fleetTimestamp(input.occurredAt);
  return data;
}

export function createFleetModule(pool,{dataEncryptionKey}={}){
  const requireLocal=(actor,permission)=>{if(!fleetAuthority(actor,permission))throw requestError(403,'Institution-wide fleet authority is required.');};
  const secure=()=>{if(!Buffer.isBuffer(dataEncryptionKey) || dataEncryptionKey.length!==32)throw requestError(503,'Fleet command/encryption key is unavailable.');};
  async function fresh(db,actor,permission){
    requireLocal(actor,permission);
    const row=await db.query(`select a.id from accounts a join role_assignments ra on ra.account_id=a.id
      join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
      where a.id=$1 and a.status='active' and ra.ended_at is null and ra.effective_from<=current_date and (ra.effective_to is null or ra.effective_to>=current_date)
      and ra.scope='{}'::jsonb and rp.permission_code=$2 for share of a,ra,r,rp`,[actor.accountId,permission]);
    if(!row.rowCount)throw requestError(403,'Current institution-wide fleet authority is required.');
  }
  const audit=(db,actor,id,action,metadata={})=>insertAudit(db,{actorId:actor.accountId,action:`fleet.${action}`,subjectType:'FleetRecord',subjectId:id,reason:'Authorized fleet operation',metadata});
  async function command(action,id,input,actor,permission,work){
    requireLocal(actor,permission);secure();const data=validateFleetCommand(action,input);
    const hash=createHmac('sha256',dataEncryptionKey).update(JSON.stringify(canonical({action,id,input:data}))).digest('hex');
    try{return await withTransaction(pool,async db=>{
      await lock(db);await fresh(db,actor,permission);
      const previous=(await db.query('select input_hash,result from fleet_command_receipts where actor_id=$1 and request_key=$2',[actor.accountId,data.requestKey])).rows[0];
      if(previous){if(previous.input_hash!==hash)throw requestError(409,'Request key belongs to a different fleet command.');return previous.result;}
      const result=await work(db,data);await audit(db,actor,result.id,action,{revision:result.revision ?? null});
      await db.query('insert into fleet_command_receipts(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)',[actor.accountId,data.requestKey,hash,JSON.stringify(result)]);return result;
    });}catch(error){if(['23503','23505','23514','P0001','40P01','40001'].includes(error.code))throw requestError(409,'Fleet records conflict or changed. Refresh and reconcile before acting.');throw error;}
  }
  async function get(db,table,id){
    const key=['fleet_driver_requests','fleet_vehicles','fleet_vehicle_corrections','fleet_meter_changes','fleet_reading_corrections','fleet_trips','fleet_driver_authorisations','fleet_fuel_receipts','fleet_incidents'].includes(table) ? 'id' : null;
    if(!key)throw new Error('Unsupported fleet record table');
    text(id,100);
    const row=(await db.query(`select * from ${table} where id=$1`,[id])).rows[0];if(!row)throw requestError(404,'Fleet record was not found.');return row;
  }
  async function activeStaff(db,id){
    const row=(await db.query(`select s.id,s.account_id from staff_members s join accounts a on a.id=s.account_id
      where s.id=$1 and s.status='active' and s.engaged_on<=current_date and a.status='active' for share of s,a`,[id])).rows[0];
    if(!row)throw requestError(409,'Driver needs a current active staff record and account.');return row;
  }
  const same=(expected,current)=>{if(expected!==current)throw requestError(409,'Fleet revision changed. Refresh before acting.');};
  async function tripState(db,id){return (await db.query('select revision,kind from fleet_trip_events where trip_id=$1 order by revision desc limit 1',[id])).rows[0] || {revision:0,kind:'requested'};}
  async function read(actor,permission,work){
    requireLocal(actor,permission);
    try{return await withTransaction(pool,async db=>{await db.query('set transaction isolation level repeatable read');await fresh(db,actor,permission);return work(db);});}
    catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Fleet authority or records changed. Refresh before reading.');throw error;}
  }
  const queries={
    vehicles:`select v.id,v.asset_id as "assetId",a.asset_tag as "assetTag",v.registration,v.description,v.definition_revision as "definitionRevision",v.distance_unit as "distanceUnit",
      v.opening_odometer::text as "openingOdometer",v.evidence_reference as "evidenceReference",a.status as "assetStatus",a.condition as "assetCondition",
      m.odometer::text as odometer,m.cumulative_odometer::text as "cumulativeOdometer",m.revision as "meterRevision",m.reading_revision as "readingRevision",m.last_event_id::text as "lastEventId",m.pending as "meterPending",
      coalesce((select revision from fleet_service_events where vehicle_id=v.id order by revision desc limit 1),0) as "serviceRevision",
      (select actor_id from fleet_service_events where vehicle_id=v.id and kind in ('hold','release') order by revision desc limit 1) as "serviceHeldBy",
      coalesce((select kind from fleet_service_events where vehicle_id=v.id and kind in ('hold','release') order by revision desc limit 1),'release') as "serviceState"
      from fleet_current_vehicles v join institution_assets a on a.id=v.asset_id cross join lateral fleet_meter_state(v.id) m`,
    drivers:`select d.id,d.staff_id as "staffId",s.legal_name as "staffName",s.account_id as "driverAccountId",s.status as "staffStatus",d.valid_from as "validFrom",d.valid_until as "validUntil",d.evidence_reference as "evidenceReference",
      d.requested_by as "requestedBy",coalesce(x.outcome,'requested') as status,x.authorisation_id as "authorisationId",x.actor_id as "reviewedBy",
      (x.request_id is not null)::int as revision,(rv.authorisation_id is not null) as revoked
      from fleet_driver_requests d join staff_members s on s.id=d.staff_id left join fleet_driver_decisions x on x.request_id=d.id left join fleet_driver_revocations rv on rv.authorisation_id=x.authorisation_id`,
    trips:`select t.id,t.vehicle_id as "vehicleId",v.registration,t.driver_authorisation_id as "driverAuthorisationId",s.legal_name as "driverName",s.account_id as "driverAccountId",
      t.requested_by as "requestedBy",t.purpose,t.destination,t.planned_start as "plannedStart",t.planned_end as "plannedEnd",coalesce(e.kind,'requested') as status,coalesce(e.revision,0) as revision,
      (select revision from fleet_meter_state(v.id)) as "meterRevision"
      from fleet_trips t join fleet_current_vehicles v on v.id=t.vehicle_id join fleet_driver_authorisations d on d.id=t.driver_authorisation_id join staff_members s on s.id=d.staff_id
      left join lateral(select kind,revision from fleet_trip_events where trip_id=t.id order by revision desc limit 1)e on true`,
    fuel:`select f.id,f.vehicle_id as "vehicleId",v.registration,f.receipt_reference as "receiptReference",to_char(f.purchased_on,'YYYY-MM-DD') as "purchasedOn",
      f.volume_millilitres::text as "volumeMillilitres",f.paid_minor::text as "paidMinor",f.currency,f.accounting_reference as "accountingReference",f.recorded_by as "recordedBy",(r.receipt_id is not null) as reversed
      from fleet_fuel_receipts f join fleet_current_vehicles v on v.id=f.vehicle_id left join fleet_fuel_reversals r on r.receipt_id=f.id`,
    service:`select s.id::text,s.vehicle_id as "vehicleId",v.registration,s.revision,s.kind,s.actor_id as "actorId",s.evidence_reference as "evidenceReference",s.recorded_at as "recordedAt"
      from fleet_service_events s join fleet_current_vehicles v on v.id=s.vehicle_id`,
    incidents:`select i.id,i.vehicle_id as "vehicleId",v.registration,i.trip_id as "tripId",i.occurred_at as "occurredAt",i.recorded_by as "recordedBy",(r.incident_id is not null)::int as revision
      from fleet_incidents i join fleet_current_vehicles v on v.id=i.vehicle_id left join fleet_incident_resolutions r on r.incident_id=i.id`
  };
  return {
    async fleetWorkspace(input,actor){fields(input,[]);return read(actor,'fleet.view',async db=>{
      const capabilities={};for(const permission of ['manage','approve','incidents']){capabilities[permission]=fleetAuthority(actor,`fleet.${permission}`);if(capabilities[permission])await fresh(db,actor,`fleet.${permission}`);}
      const totals=(await db.query('select (select count(*)::int from fleet_vehicles) as vehicles,(select count(*)::int from fleet_driver_requests) as drivers,(select count(*)::int from fleet_trips) as trips')).rows[0];
      await audit(db,actor,'workspace','workspace.read');return {accountId:actor.accountId,capabilities,totals,limit:25};
    });},
    async fleetList(kind,input,actor){if(!queries[kind])throw requestError(404,'Fleet collection was not found.');const {offset,q,vehicleId}=fleetPage(input);
      return read(actor,kind==='incidents'?'fleet.incidents':'fleet.view',async db=>{
        const where=`where ($1='' or (row_to_json(record)->>'registration') ilike '%' || $1 || '%' or (row_to_json(record)->>'staffName') ilike '%' || $1 || '%' or (row_to_json(record)->>'purpose') ilike '%' || $1 || '%')
          and ($2='' or coalesce(row_to_json(record)->>'vehicleId',case when $3='vehicles' then record.id::text end)=$2)`;
        const params=[q,vehicleId,kind],sql=`with record as (${queries[kind]})`;
        const total=(await db.query(`${sql} select count(*)::int as total from record ${where}`,params)).rows[0].total;
        const items=(await db.query(`${sql} select * from record ${where} order by id desc limit 25 offset $4`,[...params,offset])).rows;
        await audit(db,actor,kind,'list.read',{offset});return {items,total,offset,limit:25};
      });},
    async fleetTripHistory(id,input,actor){const {offset}=fleetPage(input);fields(input,['offset']);return read(actor,'fleet.view',async db=>{
      const trip=await get(db,'fleet_trips',id);const items=(await db.query(`select id::text,revision,kind,actor_id as "actorId",evidence_reference as "evidenceReference",odometer::text,meter_revision as "meterRevision",
        fleet_effective_reading($3,meter_revision,'trip',id)::text as "effectiveOdometer",(fleet_effective_reading($3,meter_revision,'trip',id)+fleet_meter_offset($3,meter_revision))::text as "cumulativeOdometer",
        occurred_at as "occurredAt",recorded_at as "recordedAt" from fleet_trip_events where trip_id=$1 order by revision desc limit 25 offset $2`,[id,offset,trip.vehicle_id])).rows;
      const total=(await db.query('select count(*)::int as total from fleet_trip_events where trip_id=$1',[id])).rows[0].total;
      await audit(db,actor,id,'trip.history.read',{offset});return {items,total,offset,limit:25};
    });},
    async fleetReferences(input,actor){const {offset,q}=fleetPage(input);fields(input,['offset','q']);return read(actor,'fleet.manage',async db=>{
      const assets=(await db.query("select id,asset_tag as \"assetTag\",name from institution_assets where status in ('available','allocated') and condition='serviceable' and not exists(select 1 from fleet_vehicles where asset_id=institution_assets.id) and (name ilike $1 or asset_tag ilike $1) order by id limit 25 offset $2",[`%${q}%`,offset])).rows;
      const staff=(await db.query("select s.id,s.employee_number as \"employeeNumber\",s.legal_name as \"staffName\" from staff_members s join accounts a on a.id=s.account_id where s.status='active' and s.engaged_on<=current_date and a.status='active' and (s.legal_name ilike $1 or s.employee_number ilike $1) order by s.id limit 25 offset $2",[`%${q}%`,offset])).rows;
      const currencies=(await db.query("select value_code as code,label from reference_values where list_code='currency' and status='active' and (effective_from is null or effective_from<=current_date) and (effective_to is null or effective_to>=current_date) order by value_code limit 200")).rows;
      await audit(db,actor,'references','references.read',{offset});return {assets,staff,currencies,offset,limit:25};
    });},
    registerFleetVehicle(input,actor){return command('vehicle',null,input,actor,'fleet.manage',async(db,data)=>{
      const id=`vehicle_${randomUUID()}`;await db.query('insert into fleet_vehicles(id,asset_id,registration,description,distance_unit,opening_odometer,evidence_reference,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,data.assetId,data.registration,data.description,data.distanceUnit,data.openingOdometer,data.evidenceReference,actor.accountId]);return {id};
    });},
    requestFleetVehicleCorrection(id,input,actor){return command('vehicleCorrection',id,input,actor,'fleet.manage',async(db,data)=>{
      await get(db,'fleet_vehicles',id);const correctionId=`vehicle_correction_${randomUUID()}`;
      await db.query('insert into fleet_vehicle_corrections(id,vehicle_id,expected_revision,registration,description,evidence_reference,requested_by) values($1,$2,$3,$4,$5,$6,$7)',[correctionId,id,data.revision,data.registration,data.description,data.evidenceReference,actor.accountId]);return {id:correctionId,vehicleId:id,revision:0};
    });},
    decideFleetVehicleCorrection(id,input,actor){return command('vehicleCorrectionDecision',id,input,actor,'fleet.approve',async(db,data)=>{
      const proposal=await get(db,'fleet_vehicle_corrections',id);const decided=(await db.query('select correction_id from fleet_vehicle_correction_decisions where correction_id=$1',[id])).rowCount;
      same(data.revision,decided);if(decided)throw requestError(409,'Vehicle correction is already decided.');
      if(proposal.requested_by===actor.accountId)throw requestError(403,'Vehicle correction requires independent review.');
      const current=(await db.query('select definition_revision from fleet_current_vehicles where id=$1',[proposal.vehicle_id])).rows[0];
      const appliedRevision=data.outcome==='approved'?current.definition_revision+1:null;
      await db.query('insert into fleet_vehicle_correction_decisions(correction_id,vehicle_id,outcome,applied_revision,actor_id,evidence_reference) values($1,$2,$3,$4,$5,$6)',[id,proposal.vehicle_id,data.outcome,appliedRevision,actor.accountId,data.evidenceReference]);return {id,vehicleId:proposal.vehicle_id,revision:1,appliedRevision};
    });},
    async fleetVehicleCorrections(id,input,actor){const {offset}=fleetPage(input);fields(input,['offset']);return read(actor,'fleet.view',async db=>{
      const original=await get(db,'fleet_vehicles',id);
      const items=(await db.query(`select c.id,c.expected_revision as "expectedRevision",c.registration,c.description,c.evidence_reference as "evidenceReference",c.requested_by as "requestedBy",c.recorded_at as "recordedAt",
        coalesce(d.outcome,'requested') as status,(d.correction_id is not null)::int as revision,d.applied_revision as "appliedRevision",d.actor_id as "reviewedBy",d.evidence_reference as "decisionEvidence",d.recorded_at as "decidedAt"
        from fleet_vehicle_corrections c left join fleet_vehicle_correction_decisions d on d.correction_id=c.id where c.vehicle_id=$1 order by c.recorded_at desc,c.id desc limit 25 offset $2`,[id,offset])).rows;
      const total=(await db.query('select count(*)::int as total from fleet_vehicle_corrections where vehicle_id=$1',[id])).rows[0].total;
      await audit(db,actor,id,'vehicle.corrections.read',{offset});return {vehicleId:id,original:{registration:original.registration,description:original.description,evidenceReference:original.evidence_reference},items,total,offset,limit:25};
    });},
    requestFleetMeterChange(id,input,actor){return command('meterChange',id,input,actor,'fleet.manage',async(db,data)=>{
      await get(db,'fleet_vehicles',id);const proposal=`meter_change_${randomUUID()}`;
      await db.query('insert into fleet_meter_changes(id,vehicle_id,expected_revision,expected_reading_revision,last_event_id,kind,closing_odometer,opening_odometer,meter_reference,occurred_at,evidence_reference,requested_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[proposal,id,data.revision,data.readingRevision,data.lastEventId,data.kind,data.closingOdometer,data.openingOdometer,data.meterReference,data.occurredAt,data.evidenceReference,actor.accountId]);return {id:proposal,vehicleId:id,revision:0};
    });},
    requestFleetReadingCorrection(id,input,actor){return command('readingCorrection',id,input,actor,'fleet.manage',async(db,data)=>{
      await get(db,'fleet_vehicles',id);const proposal=`reading_correction_${randomUUID()}`;
      await db.query('insert into fleet_reading_corrections(id,vehicle_id,expected_revision,expected_meter_revision,last_event_id,target_meter_revision,target_kind,target_event_id,odometer,evidence_reference,requested_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[proposal,id,data.revision,data.meterRevision,data.lastEventId,data.targetMeterRevision,data.targetKind,data.targetEventId,data.odometer,data.evidenceReference,actor.accountId]);return {id:proposal,vehicleId:id,revision:0};
    });},
    decideFleetMeterChange(id,input,actor){return command('meterDecision',id,input,actor,'fleet.approve',async(db,data)=>{
      const proposal=await get(db,'fleet_meter_changes',id),decided=(await db.query('select change_id from fleet_meter_decisions where change_id=$1',[id])).rowCount;
      same(data.revision,decided);if(decided)throw requestError(409,'Meter change is already decided.');if(proposal.requested_by===actor.accountId)throw requestError(403,'Meter change requires independent review.');
      const state=(await db.query('select * from fleet_meter_state($1)',[proposal.vehicle_id])).rows[0],appliedRevision=data.outcome==='approved'?state.revision+1:null;
      await db.query('insert into fleet_meter_decisions(change_id,vehicle_id,outcome,applied_revision,actor_id,evidence_reference) values($1,$2,$3,$4,$5,$6)',[id,proposal.vehicle_id,data.outcome,appliedRevision,actor.accountId,data.evidenceReference]);return {id,vehicleId:proposal.vehicle_id,revision:1,appliedRevision};
    });},
    decideFleetReadingCorrection(id,input,actor){return command('readingDecision',id,input,actor,'fleet.approve',async(db,data)=>{
      const proposal=await get(db,'fleet_reading_corrections',id),decided=(await db.query('select correction_id from fleet_reading_decisions where correction_id=$1',[id])).rowCount;
      same(data.revision,decided);if(decided)throw requestError(409,'Reading correction is already decided.');if(proposal.requested_by===actor.accountId)throw requestError(403,'Reading correction requires independent review.');
      const state=(await db.query('select * from fleet_meter_state($1)',[proposal.vehicle_id])).rows[0],appliedRevision=data.outcome==='approved'?state.reading_revision+1:null;
      await db.query('insert into fleet_reading_decisions(correction_id,vehicle_id,outcome,applied_revision,actor_id,evidence_reference) values($1,$2,$3,$4,$5,$6)',[id,proposal.vehicle_id,data.outcome,appliedRevision,actor.accountId,data.evidenceReference]);return {id,vehicleId:proposal.vehicle_id,revision:1,appliedRevision};
    });},
    async fleetMeters(id,input,actor){fields(input,['offset','readingOffset','correctionOffset']);const offsets={changes:fleetPage({offset:input.offset}).offset,readings:fleetPage({offset:input.readingOffset}).offset,corrections:fleetPage({offset:input.correctionOffset}).offset};return read(actor,'fleet.view',async db=>{
      await get(db,'fleet_vehicles',id);
      const state=(await db.query(`select v.registration,v.distance_unit as "distanceUnit",m.revision as "meterRevision",m.reading_revision as "readingRevision",m.last_event_id::text as "lastEventId",
        m.odometer::text as odometer,m.opening_odometer::text as "effectiveOpening",m.cumulative_odometer::text as "cumulativeOdometer",m.pending from fleet_current_vehicles v cross join lateral fleet_meter_state(v.id)m where v.id=$1`,[id])).rows[0];
      const sql={
        changes:`select c.id,c.kind,c.expected_revision as "expectedRevision",c.closing_odometer::text as "closingOdometer",c.opening_odometer::text as "openingOdometer",c.meter_reference as "meterReference",c.occurred_at as "occurredAt",c.evidence_reference as "evidenceReference",c.requested_by as "requestedBy",c.recorded_at as "recordedAt",coalesce(d.outcome,'requested') as status,(d.change_id is not null)::int as revision,d.applied_revision as "appliedRevision",d.evidence_reference as "decisionEvidence",d.recorded_at as "decidedAt" from fleet_meter_changes c left join fleet_meter_decisions d on d.change_id=c.id where c.vehicle_id=$1`,
        corrections:`select c.id,c.target_kind as "targetKind",c.target_meter_revision as "targetMeterRevision",c.target_event_id::text as "targetEventId",c.odometer::text,c.evidence_reference as "evidenceReference",c.requested_by as "requestedBy",c.recorded_at as "recordedAt",coalesce(d.outcome,'requested') as status,(d.correction_id is not null)::int as revision,d.applied_revision as "appliedRevision",d.evidence_reference as "decisionEvidence",d.recorded_at as "decidedAt" from fleet_reading_corrections c left join fleet_reading_decisions d on d.correction_id=c.id where c.vehicle_id=$1`,
        readings:`select r.*,fleet_effective_reading($1,r."targetMeterRevision",r."targetKind",r."targetEventId"::bigint)::text as odometer from (
          select 'opening:0' as id,0 as "targetMeterRevision",'opening' as "targetKind",null::text as "targetEventId",v.opening_odometer::text as "originalOdometer",v.created_at as "recordedAt" from fleet_vehicles v where v.id=$1
          union all select 'opening:' || d.applied_revision,d.applied_revision,'opening',null,c.opening_odometer::text,c.occurred_at from fleet_meter_changes c join fleet_meter_decisions d on d.change_id=c.id where d.vehicle_id=$1 and d.outcome='approved'
          union all select 'closing:' || (d.applied_revision-1),d.applied_revision-1,'closing',null,c.closing_odometer::text,c.occurred_at from fleet_meter_changes c join fleet_meter_decisions d on d.change_id=c.id where d.vehicle_id=$1 and d.outcome='approved'
          union all select 'trip:' || e.id,e.meter_revision,'trip',e.id::text,e.odometer::text,e.recorded_at from fleet_trip_events e join fleet_trips t on t.id=e.trip_id where t.vehicle_id=$1 and e.odometer is not null)r`
      },result={vehicleId:id,state};
      for(const name of ['changes','readings','corrections']){
        const total=(await db.query(`with r as (${sql[name]})select count(*)::int as total from r`,[id])).rows[0].total;
        const items=(await db.query(`with r as (${sql[name]})select * from r order by "recordedAt" desc,id desc limit 25 offset $2`,[id,offsets[name]])).rows;
        result[name]={items,total,offset:offsets[name],limit:25};
      }
      await audit(db,actor,id,'meters.read',offsets);return result;
    });},
    requestFleetDriver(input,actor){return command('driverRequest',null,input,actor,'fleet.manage',async(db,data)=>{
      await activeStaff(db,data.staffId);if(new Date(data.validUntil)<=new Date())throw requestError(400,'Driver authorisation must not already be expired.');
      const id=`driver_request_${randomUUID()}`;await db.query('insert into fleet_driver_requests(id,staff_id,valid_from,valid_until,evidence_reference,requested_by) values($1,$2,$3,$4,$5,$6)',[id,data.staffId,data.validFrom,data.validUntil,data.evidenceReference,actor.accountId]);return {id,revision:0};
    });},
    decideFleetDriver(id,input,actor){return command('driverDecision',id,input,actor,'fleet.approve',async(db,data)=>{
      const proposal=await get(db,'fleet_driver_requests',id);const current=(await db.query('select request_id from fleet_driver_decisions where request_id=$1',[id])).rowCount;
      same(data.revision,current);if(current)throw requestError(409,'Driver request is already decided.');
      const staff=(await db.query('select account_id from staff_members where id=$1 for share',[proposal.staff_id])).rows[0];
      if([proposal.requested_by,staff?.account_id].includes(actor.accountId))throw requestError(403,'Driver decision requires independent approval.');
      let authorisationId=null;if(data.outcome==='approved'){
        await activeStaff(db,proposal.staff_id);
        if(new Date(proposal.valid_until)<=new Date())throw requestError(409,'Driver request validity expired.');authorisationId=`driver_auth_${randomUUID()}`;
        await db.query('insert into fleet_driver_authorisations(id,staff_id,valid_from,valid_until,evidence_reference,requested_by,approved_by) values($1,$2,$3,$4,$5,$6,$7)',[authorisationId,proposal.staff_id,proposal.valid_from,proposal.valid_until,proposal.evidence_reference,proposal.requested_by,actor.accountId]);
      }
      await db.query('insert into fleet_driver_decisions(request_id,outcome,authorisation_id,actor_id,evidence_reference) values($1,$2,$3,$4,$5)',[id,data.outcome,authorisationId,actor.accountId,data.evidenceReference]);return {id,revision:1,authorisationId};
    });},
    revokeFleetDriver(id,input,actor){return command('revoke',id,input,actor,'fleet.approve',async(db,data)=>{
      await get(db,'fleet_driver_authorisations',id);await db.query('insert into fleet_driver_revocations(authorisation_id,actor_id,evidence_reference) values($1,$2,$3)',[id,actor.accountId,data.evidenceReference]);return {id};
    });},
    requestFleetTrip(input,actor){return command('trip',null,input,actor,'fleet.manage',async(db,data)=>{
      if(new Date(data.plannedEnd)<=new Date())throw requestError(400,'Trip cannot already have ended.');
      const id=`trip_${randomUUID()}`;await db.query('insert into fleet_trips(id,vehicle_id,driver_authorisation_id,requested_by,purpose,destination,planned_start,planned_end) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,data.vehicleId,data.driverAuthorisationId,actor.accountId,data.purpose,data.destination,data.plannedStart,data.plannedEnd]);return {id,revision:0};
    });},
    recordFleetTripEvent(id,input,actor){const data=validateFleetCommand('tripEvent',input);return command('tripEvent',id,data,actor,['approved','rejected'].includes(data.kind)?'fleet.approve':'fleet.manage',async(db,value)=>{
      const trip=await get(db,'fleet_trips',id);same(value.revision,(await tripState(db,id)).revision);
      if(['approved','rejected'].includes(value.kind)){
        const driver=(await db.query('select s.account_id from fleet_driver_authorisations d join staff_members s on s.id=d.staff_id where d.id=$1',[trip.driver_authorisation_id])).rows[0];
        if([trip.requested_by,driver?.account_id].includes(actor.accountId))throw requestError(403,'Trip decision requires independent approval.');
        if(value.kind==='approved' && new Date(trip.planned_end)<=new Date())throw requestError(409,'Trip planning interval has ended.');
      }
      const revision=value.revision+1;await db.query('insert into fleet_trip_events(trip_id,revision,kind,actor_id,evidence_reference,odometer,occurred_at,meter_revision) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,revision,value.kind,actor.accountId,value.evidenceReference,value.odometer ?? null,value.occurredAt ?? null,value.meterRevision ?? 0]);return {id,revision};
    });},
    recordFleetService(id,input,actor){const data=validateFleetCommand('service',input);return command('service',id,data,actor,data.kind==='release'?'fleet.approve':'fleet.manage',async(db,value)=>{
      await get(db,'fleet_vehicles',id);const current=(await db.query('select coalesce(max(revision),0)::int as revision from fleet_service_events where vehicle_id=$1',[id])).rows[0].revision;same(value.revision,current);
      if(value.kind==='release'){
        const hold=(await db.query("select actor_id from fleet_service_events where vehicle_id=$1 and kind in ('hold','release') order by revision desc limit 1",[id])).rows[0];
        if(hold?.actor_id===actor.accountId)throw requestError(403,'Service release requires independent approval.');
      }
      const row=(await db.query('insert into fleet_service_events(vehicle_id,kind,actor_id,evidence_reference) values($1,$2,$3,$4) returning revision',[id,value.kind,actor.accountId,value.evidenceReference])).rows[0];return {id,revision:row.revision};
    });},
    recordFleetFuel(input,actor){return command('fuel',null,input,actor,'fleet.manage',async(db,data)=>{
      const id=`fuel_${randomUUID()}`;await db.query('insert into fleet_fuel_receipts(id,vehicle_id,receipt_reference,purchased_on,volume_millilitres,paid_minor,currency,accounting_reference,recorded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,data.vehicleId,data.receiptReference,data.purchasedOn,data.volumeMillilitres,data.paidMinor,data.currency,data.accountingReference,actor.accountId]);return {id};
    });},
    reverseFleetFuel(id,input,actor){return command('reverseFuel',id,input,actor,'fleet.approve',async(db,data)=>{
      const receipt=await get(db,'fleet_fuel_receipts',id);if(receipt.recorded_by===actor.accountId)throw requestError(403,'Fuel reversal requires independent approval.');
      await db.query('insert into fleet_fuel_reversals(receipt_id,actor_id,evidence_reference) values($1,$2,$3)',[id,actor.accountId,data.evidenceReference]);return {id};
    });},
    recordFleetIncident(input,actor){return command('incident',null,input,actor,'fleet.incidents',async(db,data)=>{
      const id=`incident_${randomUUID()}`,envelope=encryptSecret(JSON.stringify({id,vehicleId:data.vehicleId,tripId:data.tripId,recordedBy:actor.accountId,details:data.details,policyReference:data.policyReference,retentionRule:data.retentionRule}),dataEncryptionKey);
      await db.query('insert into fleet_incidents(id,vehicle_id,trip_id,occurred_at,details_encrypted,evidence_reference,recorded_by) values($1,$2,$3,$4,$5,$6,$7)',[id,data.vehicleId,data.tripId,data.occurredAt,envelope,data.evidenceReference,actor.accountId]);return {id,revision:0};
    });},
    resolveFleetIncident(id,input,actor){return command('resolveIncident',id,input,actor,'fleet.incidents',async(db,data)=>{
      await get(db,'fleet_incidents',id);const current=(await db.query('select incident_id from fleet_incident_resolutions where incident_id=$1',[id])).rowCount;same(data.revision,current);if(current)throw requestError(409,'Incident already resolved.');
      const envelope=encryptSecret(JSON.stringify({id,resolvedBy:actor.accountId,details:data.details}),dataEncryptionKey);
      await db.query('insert into fleet_incident_resolutions(incident_id,evidence_reference,details_encrypted,resolved_by) values($1,$2,$3,$4)',[id,data.evidenceReference,envelope,actor.accountId]);return {id,revision:1};
    });},
    async getFleetIncident(id,input,actor){fields(input,[]);requireLocal(actor,'fleet.incidents');secure();return read(actor,'fleet.incidents',async db=>{
      const row=await get(db,'fleet_incidents',id),resolution=(await db.query('select * from fleet_incident_resolutions where incident_id=$1',[id])).rows[0];let content,resolved=null;
      try{
        content=JSON.parse(decryptSecret(row.details_encrypted,dataEncryptionKey));
        if(content.id!==row.id || content.vehicleId!==row.vehicle_id || content.tripId!==row.trip_id || content.recordedBy!==row.recorded_by || typeof content.details!=='string' || typeof content.policyReference!=='string' || typeof content.retentionRule!=='string')throw new Error('Incident binding');
        if(resolution){resolved=JSON.parse(decryptSecret(resolution.details_encrypted,dataEncryptionKey));if(resolved.id!==id || resolved.resolvedBy!==resolution.resolved_by || typeof resolved.details!=='string')throw new Error('Resolution binding');}
      }catch{throw requestError(409,'Incident requires secure reconciliation.');}
      await audit(db,actor,id,'incident.read');return {id,vehicleId:row.vehicle_id,tripId:row.trip_id,occurredAt:row.occurred_at,evidenceReference:row.evidence_reference,recordedBy:row.recorded_by,details:content.details,policyReference:content.policyReference,retentionRule:content.retentionRule,revision:resolution?1:0,resolution:resolution ? {details:resolved.details,evidenceReference:resolution.evidence_reference,resolvedBy:resolution.resolved_by,recordedAt:resolution.recorded_at}:null};
    });}
  };
}
