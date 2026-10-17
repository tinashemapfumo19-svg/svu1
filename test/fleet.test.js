import test from 'node:test';
import assert from 'node:assert/strict';
import {createFleetModule,fleetAuthority,fleetInteger,fleetPage,fleetTimestamp,validateFleetCommand} from '../server/modules/fleet.js';
import {createSeedData} from '../scripts/seed-data.js';
import {staffInvitationRoles} from '../server/modules/staff.js';
import {encryptSecret} from '../server/security.js';

const key=Buffer.alloc(32,9),actor={accountId:'a',roles:[{scope:{},permissions:['fleet.view','fleet.manage','fleet.approve','fleet.incidents']}]};
const vehicle={assetId:'asset',registration:'test 1',description:'Vehicle',distanceUnit:'km',openingOdometer:'1000',evidenceReference:'Evidence',requestKey:'valid_request_key'};
test('fleet roles separate operational, review and restricted incident authority',()=>{
  const seed=createSeedData();
  for(const code of ['fleet_officer','fleet_approver','fleet_safety_officer'])assert.equal(staffInvitationRoles.includes(code),false);
  assert.ok(seed.rolePermissions.fleet_officer.includes('fleet.manage'));assert.equal(seed.rolePermissions.fleet_officer.includes('fleet.incidents'),false);
  assert.ok(seed.rolePermissions.fleet_approver.includes('fleet.approve'));assert.equal(seed.rolePermissions.fleet_approver.includes('fleet.manage'),false);
  assert.ok(seed.rolePermissions.fleet_safety_officer.includes('fleet.incidents'));
  assert.equal(fleetAuthority({accountId:'a',roles:[{permissions:['fleet.manage'],scope:{programmeCodes:['x']}},{permissions:['fleet.view'],scope:{}}]},'fleet.manage'),false);
  assert.equal(fleetAuthority({accountId:'a',permissions:['fleet.manage'],roles:[]},'fleet.manage'),false);
});
test('fleet quantity/date/page inputs are exact, bounded and reject inferred authority',()=>{
  assert.equal(fleetTimestamp('2026-10-10T12:00:00Z'),'2026-10-10T12:00:00.000Z');
  for(const value of ['2026-02-30T12:00:00Z','2026-10-10T25:00:00Z','2026-10-10T12:00:00+02:00','2026-10-10',null])assert.throws(()=>fleetTimestamp(value),{statusCode:400});
  for(const value of [1,'01','1.5','1e3','-1','1000000001',null])assert.throws(()=>fleetInteger(value),{statusCode:400});
  assert.equal(fleetInteger('1000000000'),'1000000000');
  for(const input of [null,[],{offset:1},{offset:'01'},{offset:'100001'},{accountId:'a'},{limit:'1000'}])assert.throws(()=>fleetPage(input),{statusCode:400});
  assert.deepEqual(fleetPage({}),{offset:0,q:'',vehicleId:''});
});
test('fleet command validation refuses spoofed actors, partial readings and unknown fields',()=>{
  assert.equal(validateFleetCommand('vehicle',vehicle).registration,'TEST 1');
  for(const input of [{...vehicle,createdBy:'other'},{...vehicle,openingOdometer:1000},{...vehicle,distanceUnit:'metres'},{...vehicle,requestKey:['valid_request_key']}])assert.throws(()=>validateFleetCommand('vehicle',input),{statusCode:400});
  assert.throws(()=>validateFleetCommand('tripEvent',{revision:0,kind:'approved',odometer:'1',evidenceReference:'x',requestKey:'valid_request_key'}),{statusCode:400});
  assert.throws(()=>validateFleetCommand('driverRequest',{staffId:'s',validFrom:'2026-10-10T00:00:00Z',validUntil:'2026-10-09T00:00:00Z',evidenceReference:'x',requestKey:'valid_request_key'}),{statusCode:400});
  assert.throws(()=>validateFleetCommand('fuel',{vehicleId:'v',receiptReference:'r',purchasedOn:'2099-01-01',volumeMillilitres:'1',paidMinor:'1',currency:'USD',requestKey:'valid_request_key'}),{statusCode:400});
});
test('vehicle corrections require bounded definitions, exact revisions and explicit independent outcomes',()=>{
  const input={revision:0,registration:' corrected ',description:'Corrected',evidenceReference:'Evidence',requestKey:'valid_request_key'};
  assert.equal(validateFleetCommand('vehicleCorrection',input).registration,'CORRECTED');
  for(const change of [{revision:'0'},{revision:-1},{revision:2147483647},{revision:Number.MAX_SAFE_INTEGER},{distanceUnit:'mi'},{assetId:'other'},{openingOdometer:'0'},{registration:''},{description:'x'.repeat(201)},{requestedBy:'other'}])assert.throws(()=>validateFleetCommand('vehicleCorrection',{...input,...change}),{statusCode:400});
  assert.throws(()=>validateFleetCommand('vehicleCorrectionDecision',{revision:0,outcome:'accepted',evidenceReference:'Evidence',requestKey:'valid_request_key'}),{statusCode:400});
});
test('meter commands bind exact snapshots and refuse inferred units, identities and reading targets',()=>{
  const input={revision:0,readingRevision:0,lastEventId:null,kind:'replacement',closingOdometer:'1000',openingOdometer:'0',meterReference:'Meter reference',occurredAt:'2026-10-10T12:00:00Z',evidenceReference:'Evidence',requestKey:'valid_request_key'};
  assert.equal(validateFleetCommand('meterChange',input).openingOdometer,'0');
  for(const change of [{readingRevision:'0'},{lastEventId:undefined},{lastEventId:1},{lastEventId:'01'},{lastEventId:'9223372036854775808'},{openingOdometer:0},{closingOdometer:'1e3'},{kind:'convert'},{distanceUnit:'mi'},{meterReference:''},{occurredAt:'2026-02-30T12:00:00Z'}])assert.throws(()=>validateFleetCommand('meterChange',{...input,...change}),{statusCode:400});
  const correction={revision:0,meterRevision:0,lastEventId:null,targetMeterRevision:0,targetKind:'opening',targetEventId:null,odometer:'900',evidenceReference:'Evidence',requestKey:'valid_request_key'};
  assert.equal(validateFleetCommand('readingCorrection',correction).odometer,'900');
  for(const change of [{meterRevision:null},{targetKind:'trip'},{targetEventId:'1'},{targetMeterRevision:-1},{odometer:'-1'},{approvedBy:'other'}])assert.throws(()=>validateFleetCommand('readingCorrection',{...correction,...change}),{statusCode:400});
  for(const value of [null,'1',-1,2147483647])assert.throws(()=>validateFleetCommand('tripEvent',{revision:1,kind:'dispatched',meterRevision:value,odometer:'1',occurredAt:input.occurredAt,evidenceReference:'Evidence',requestKey:input.requestKey}),{statusCode:400});
});
test('fleet refuses local authority and missing encryption before database access',async()=>{
  const module=createFleetModule({connect(){throw new Error('must not connect');}});
  await assert.rejects(module.fleetWorkspace({},{}),{statusCode:403});await assert.rejects(module.registerFleetVehicle(vehicle,actor),{statusCode:503});
  await assert.rejects(module.getFleetIncident('i',{}, {...actor,roles:[{scope:{},permissions:['fleet.view']}]}),{statusCode:403});
});
test('fleet rechecks active native authority before receipt lookup or records',async()=>{
  const calls=[],db={release(){},async query(sql){calls.push(sql);return {rowCount:0,rows:[]};}};
  const module=createFleetModule({async connect(){return db;}},{dataEncryptionKey:key});
  await assert.rejects(module.registerFleetVehicle(vehicle,actor),{statusCode:403});
  assert.equal(calls.some(sql=>sql.includes('fleet_command_receipts')),false);assert.equal(calls.at(-1),'rollback');
});
test('fleet command receipt faults roll back business change and audit',async()=>{
  const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};if(sql.startsWith('insert into fleet_command_receipts'))throw new Error('receipt fault');return {rows:[],rowCount:0};}};
  const module=createFleetModule({async connect(){return db;}},{dataEncryptionKey:key});
  await assert.rejects(module.registerFleetVehicle(vehicle,actor),/receipt fault/);
  assert.ok(calls.some(sql=>sql.startsWith('insert into fleet_vehicles')));assert.ok(calls.some(sql=>sql.startsWith('insert into audit_events')));assert.equal(calls.at(-1),'rollback');
});
test('fleet incident envelopes bind record, vehicle, trip, recorder and resolution actor',async()=>{
  const content={id:'i',vehicleId:'v',tripId:null,recordedBy:'a',details:'PRIVATE INCIDENT',policyReference:'TEST-POLICY',retentionRule:'TEST-RETENTION'};
  for(const mismatch of ['id','vehicleId','tripId','recordedBy','resolution','key']){
    const calls=[],db={release(){},async query(sql){calls.push(sql);
      if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};
      if(sql==='select * from fleet_incidents where id=$1')return {rows:[{id:'i',vehicle_id:'v',trip_id:null,recorded_by:'a',details_encrypted:encryptSecret(JSON.stringify({...content,...(['resolution','key'].includes(mismatch)?{}:{[mismatch]:'wrong'})}),key)}]};
      if(sql.startsWith('select * from fleet_incident_resolutions'))return {rows:mismatch==='resolution'?[{resolved_by:'a',details_encrypted:encryptSecret(JSON.stringify({id:'i',resolvedBy:'other',details:'PRIVATE RESOLUTION'}),key)}]:[]};
      return {rows:[]};}};
    const module=createFleetModule({async connect(){return db;}},{dataEncryptionKey:mismatch==='key'?Buffer.alloc(32,3):key});
    await assert.rejects(module.getFleetIncident('i',{},actor),{statusCode:409});assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.startsWith('insert into audit_events')),false);
  }
});
test('fleet snapshot/authority conflicts return a refresh conflict without business reads',async()=>{
  const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql.includes('select a.id from accounts'))throw Object.assign(new Error('snapshot changed'),{code:'40001'});return {rows:[]};}};
  const module=createFleetModule({async connect(){return db;}},{dataEncryptionKey:key});
  await assert.rejects(module.fleetWorkspace({},actor),{statusCode:409});assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('fleet_vehicles')),false);
});
