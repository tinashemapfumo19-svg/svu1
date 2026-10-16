import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {encryptSecret,decryptSecret} from '../server/security.js';
import {registryMetrics} from '../server/modules/registry-reporting.js';
import {reportEditionKinds,reportEditionInput,reportEditionListFilters,reportEditionGrants,reportEditionScopeAllowed,createReportEditionsModule,maxReportEditionBytes} from '../server/modules/report-editions.js';

const key=Buffer.alloc(32,7),scope={programmeCodes:['P'],intakeIds:['I']};
const actor={accountId:'owner',permissions:['registry.view','audit.view'],roles:[{permissions:['registry.view'],scope},{permissions:['audit.view'],scope:{}}]};
const input={reportKind:'registry',filters:{intakeId:'I'},title:'=Private title',reason:'SECRET CUSTODY REASON',retainUntil:'2026-10-06',requestKey:'edition_request_1'};
const counts=Object.fromEntries(registryMetrics.map((m) => [m.id,0])),controls={programmesReconcile:true,periodsReconcile:true,registrationsReconcile:true};
function fixture() {
  const f={rows:[],calls:[],sourceCalls:0,now:'2026-10-05T12:00:01Z',intakes:[{intakeId:'I',programmeCode:'P'}]};
  f.report={definitionVersion:'registry-enrolment-operations-v1',generatedAt:'2026-10-05T12:00:00Z',filters:{programmeCode:'',intakeId:'I'},metrics:registryMetrics,totals:{...counts},controls,rows:[{intakeId:'I',programmeCode:'P',label:'=FORMULA',counts:{...counts},controls}],availableIntakes:[{intakeId:'OTHER',programmeCode:'PRIVATE'}]};
  const db={release(){},async query(sql,values=[]) {
    f.calls.push({sql,values});
    if(sql.includes('transaction_timestamp()'))return {rows:[{now:f.now}]};
    if(sql.startsWith('select i.id'))return {rows:f.intakes};
    if(sql.startsWith('select payload_encrypted'))return {rows:f.rows.filter((r) => r.id === values[0]).map((r) => ({payload:r.payloadEncrypted}))};
    if(sql.startsWith('select id,created_by'))return {rows:f.rows.filter((r) => sql.includes('where id =') ? r.id === values[0] && r.createdBy === values[1] : r.createdBy === values[0] && (sql.includes('request_key =') ? r.requestKey === values[1] : !values[1] || r.reportKind === values[1])).map(({payloadEncrypted,...r}) => ({...r}))};
    if(sql.startsWith('insert into report_editions')) {const names=['id','createdBy','reportKind','requestKey','requestHash','definitionVersion','sourceGeneratedAt','createdAt','retainUntil','grants','titleEncrypted','reasonEncrypted','payloadEncrypted','payloadDigest','custodyDigest'];f.rows.push({...Object.fromEntries(names.map((n,i) => [n,values[i]])),status:'retained',withdrawnAt:null});}
    if(sql.startsWith('update report_editions')) {const r=f.rows.find((r) => r.id === values[0]);r.status='withdrawn';r.withdrawnAt=f.now;r.withdrawalReasonEncrypted=values[1];}
    return {rows:[]};
  }};
  f.module=createReportEditionsModule({async connect(){return db;}},{dataEncryptionKey:key,sources:{registry:async () => {f.sourceCalls++;return structuredClone(f.report);}}});return f;
}
const payloadReads=(f) => f.calls.filter((q) => q.sql.startsWith('select payload_encrypted')).length;

test('ten native domains and strict custody/filter contracts reject browser totals and CSV',() => {
  assert.equal(Object.keys(reportEditionKinds).length,10);assert.deepEqual(reportEditionInput(input),input);
  for(const change of [{reportKind:'__proto__'},{reportKind:'missing'},{filters:[]},{filters:{format:'csv'}},{filters:{counts:9}},{retainUntil:'2026-02-30'},{requestKey:'short'},{title:' '},{reason:'x'.repeat(2001)},{csv:'invented'}])assert.throws(() => reportEditionInput({...input,...change}),{statusCode:400});
  assert.deepEqual(reportEditionListFilters({limit:'2',offset:'3'}),{reportKind:'',status:'all',limit:2,offset:3});
  for(const filters of [{reportKind:0},{reportKind:null},{status:'deleted'},{limit:0},{limit:101},{offset:10001},{offset:'1.1'},{counts:3}])assert.throws(() => reportEditionListFilters(filters),{statusCode:400});
});
test('scope checks bind both original and current intake programme and ignore unrelated global roles',() => {
  const grants={intakes:[{intakeId:'I',programmeCode:'P'}],financeImportGlobal:false},current=[{intakeId:'I',programmeCode:'P'}];
  assert.equal(reportEditionScopeAllowed(actor,'registry',grants,current),true);
  for(const rows of [[],[{intakeId:'I',programmeCode:'OTHER'}]])assert.equal(reportEditionScopeAllowed(actor,'registry',grants,rows),false);
  assert.equal(reportEditionScopeAllowed({...actor,roles:[actor.roles[1]]},'registry',grants,current),false);
  assert.equal(reportEditionScopeAllowed(actor,'registry',{...grants,intakes:[{intakeId:'I',programmeCode:'OTHER'}]},current),false);
});
test('captured secondary enquiry and global finance-import authority are retained, including empty ledger intakes',() => {
  const office={...actor,permissions:['enquiries.manage','finance.view','finance.import'],roles:[{permissions:['enquiries.manage','finance.view','finance.import'],scope},actor.roles[1]]},current=[{intakeId:'I',programmeCode:'P'}];
  const enquiry=reportEditionGrants('enquiries',{rows:[{...current[0],applicationAuthority:true}]});assert.equal(reportEditionScopeAllowed(office,'enquiries',enquiry,current),false);
  const reviewer={...office,permissions:[...office.permissions,'admissions.review'],roles:[...office.roles,{permissions:['admissions.review'],scope}]};assert.equal(reportEditionScopeAllowed(reviewer,'enquiries',enquiry,current),true);
  const finance=reportEditionGrants('finance',{availableIntakes:current,rows:[],filters:{},unmatchedQueue:[]});assert.equal(finance.intakes.length,1);assert.equal(reportEditionScopeAllowed(office,'finance',finance,current),false);
  assert.equal(reportEditionScopeAllowed({...office,roles:[...office.roles,{permissions:['finance.import'],scope:{}}]},'finance',finance,current),true);
  assert.equal(reportEditionScopeAllowed(office,'finance',{...finance,financeImportGlobal:false},current),true);
});
test('academic domains preserve native first-award-permission authority; exam permissions form scoped union',() => {
  const current=[{intakeId:'I',programmeCode:'P'}],grants={intakes:[{...current[0],domains:{results:false,decisions:false,awards:true}}]};
  const office={...actor,permissions:['registry.view','registry.award.approve'],roles:[{permissions:['registry.view'],scope:{programmeCodes:['OTHER']}},{permissions:['registry.award.approve'],scope:{}}]};
  assert.equal(reportEditionScopeAllowed(office,'academic',grants,current),false);
  assert.equal(reportEditionScopeAllowed({...office,permissions:['registry.award.approve']},'academic',grants,current),true);
  const exam={...actor,permissions:['exams.schedule','exams.publish'],roles:[{permissions:['exams.schedule'],scope:{programmeCodes:['OTHER']}},{permissions:['exams.publish'],scope}]};assert.equal(reportEditionScopeAllowed(exam,'examinations',{intakes:current},current),true);
});
test('capture encrypts custody and payload, excludes choice metadata and pins native CSV and definitions',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor);assert.equal(saved.replayed,false);assert.equal(saved.title,input.title);assert.equal(f.sourceCalls,1);
  const r=f.rows[0];assert.doesNotMatch(JSON.stringify(r),/SECRET CUSTODY|Private title|FORMULA/);assert.equal(decryptSecret(r.reasonEncrypted,key),input.reason);
  const read=await f.module.readReportEdition(saved.id,actor);assert.equal(read.report.availableIntakes,undefined);assert.equal(read.report.availablePeriods,undefined);assert.equal(read.report.metrics[0].formula,registryMetrics[0].formula);
  const csv=(await f.module.readReportEdition(saved.id,actor,true)).csv;assert.match(csv,/"'=FORMULA"/);assert.match(csv,/owner approval pending/);assert.doesNotMatch(csv,/SECRET|Private title|PRIVATE/);
  f.report.totals.programmeRecords=55;assert.deepEqual((await f.module.readReportEdition(saved.id,actor)).report,read.report);assert.equal((await f.module.readReportEdition(saved.id,actor,true)).csv,csv);
  assert.doesNotMatch(JSON.stringify(f.calls.filter((q) => q.sql.includes('insert into audit_events'))),/SECRET|FORMULA|Private title/);
});
test('request replay returns original edition without generating again and refuses changed custody fields',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor),again=await f.module.captureReportEdition({...input,filters:{intakeId:'I'}},actor);assert.equal(again.id,saved.id);assert.equal(again.replayed,true);assert.equal(f.rows.length,1);assert.equal(f.sourceCalls,1);
  await assert.rejects(f.module.captureReportEdition({...input,title:'Changed'},actor),{statusCode:409});assert.equal(f.sourceCalls,1);
  f.intakes=[];await assert.rejects(f.module.captureReportEdition(input,actor),{statusCode:404});assert.equal(f.sourceCalls,1);
});
test('other creators and revoked scopes cannot read, decrypt, download or count private editions',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor),other={...actor,accountId:'other'},revoked={...actor,roles:[actor.roles[1]]};
  for(const office of [other,revoked]) {for(const download of [false,true])await assert.rejects(f.module.readReportEdition(saved.id,office,download),{statusCode:404});assert.equal((await f.module.listReportEditions({},office)).total,0);}
  assert.equal(payloadReads(f),0);assert.deepEqual(await f.module.listReportEditions({}, {...actor,permissions:[]}),{items:[],total:0,kinds:[],filters:reportEditionListFilters()});
});
test('UTC keep-until is inclusive; expired content is refused before payload lookup and remains scoped metadata',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor);f.now='2026-10-06T23:59:59Z';assert.equal((await f.module.readReportEdition(saved.id,actor)).edition.status,'retained');
  f.now='2026-10-07T00:00:00Z';const reads=payloadReads(f);await assert.rejects(f.module.readReportEdition(saved.id,actor,true),{statusCode:404});assert.equal(payloadReads(f),reads);assert.equal((await f.module.listReportEditions({status:'expired'},actor)).items[0].status,'expired');await assert.rejects(f.module.captureReportEdition(input,actor),{statusCode:404});
  for(const retainUntil of ['2026-10-04','2027-10-07'])await assert.rejects(fixture().module.captureReportEdition({...input,retainUntil},actor),{statusCode:400});
});
test('withdrawal is creator-only, terminal and idempotent even after source-authority loss',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor),revoked={...actor,permissions:[],roles:[]};
  await assert.rejects(f.module.withdrawReportEdition(saved.id,{reason:'Withdraw'}, {...revoked,accountId:'other'}),{statusCode:404});
  assert.deepEqual(await f.module.withdrawReportEdition(saved.id,{reason:'SECRET WITHDRAWAL'},revoked),{id:saved.id,status:'withdrawn',replayed:false});assert.equal(payloadReads(f),0);
  const reason=f.rows[0].withdrawalReasonEncrypted;assert.equal((await f.module.withdrawReportEdition(saved.id,{reason:'Changed'},revoked)).replayed,true);assert.equal(f.rows[0].withdrawalReasonEncrypted,reason);assert.equal(decryptSecret(reason,key),'SECRET WITHDRAWAL');
  await assert.rejects(f.module.readReportEdition(saved.id,actor),{statusCode:404});assert.equal((await f.module.listReportEditions({status:'withdrawn'},actor)).total,1);
});
test('library applies complete scope checks before pagination and never selects encrypted report bodies',async () => {
  const f=fixture();await f.module.captureReportEdition(input,actor);f.intakes.push({intakeId:'J',programmeCode:'Q'});f.report.rows=[{...f.report.rows[0],intakeId:'J',programmeCode:'Q'}];
  const global={...actor,roles:[{permissions:['registry.view'],scope:{}}]};await f.module.captureReportEdition({...input,requestKey:'other_request',filters:{intakeId:'J'}},global);
  const result=await f.module.listReportEditions({limit:1,offset:0},actor);assert.equal(result.total,1);assert.equal(result.items.length,1);assert.equal(result.items[0].id,f.rows[0].id);assert.equal((await f.module.listReportEditions({limit:1,offset:1},actor)).items.length,0);assert.equal(payloadReads(f),0);
});
test('header and payload integrity faults fail closed with reconciliation errors',async () => {
  for(const field of ['titleEncrypted','grants','definitionVersion','payloadDigest','custodyDigest']) {const f=fixture(),saved=await f.module.captureReportEdition(input,actor);f.rows[0][field]=field === 'grants' ? {intakes:[]} : 'BROKEN';await assert.rejects(f.module.readReportEdition(saved.id,actor),{statusCode:409});assert.equal(payloadReads(f),0);await assert.rejects(f.module.listReportEditions({},actor),{statusCode:409});}
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor);f.rows[0].payloadEncrypted+='broken';await assert.rejects(f.module.readReportEdition(saved.id,actor,true),{statusCode:409});
});
test('validly encrypted malformed payload bindings produce controlled 409 rather than server exceptions',async () => {
  const f=fixture(),saved=await f.module.captureReportEdition(input,actor),r=f.rows[0],digest=(v) => createHmac('sha256',key).update(v).digest('hex');
  r.payloadEncrypted=encryptSecret(JSON.stringify({report:{definitionVersion:r.definitionVersion,generatedAt:'INVALID'},csv:'broken'}),key);r.payloadDigest=digest(r.payloadEncrypted);
  const names=['id','createdBy','reportKind','requestKey','requestHash','definitionVersion','sourceGeneratedAt','createdAt','retainUntil','grants','titleEncrypted','reasonEncrypted','payloadDigest'],header=Object.fromEntries(names.map((n) => [n,['sourceGeneratedAt','createdAt'].includes(n) ? new Date(r[n]).toISOString() : r[n]]));
  r.custodyDigest=digest(JSON.stringify(header,(_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k,v[k]])) : v));await assert.rejects(f.module.readReportEdition(saved.id,actor),{statusCode:409});
});
test('oversized snapshots and invalid generation bindings cannot be retained',async () => {
  const f=fixture();f.report.large='x'.repeat(maxReportEditionBytes);await assert.rejects(f.module.captureReportEdition(input,actor),{statusCode:413});assert.equal(f.rows.length,0);
  for(const generatedAt of ['INVALID','2099-01-01T00:00:00Z']) {const f=fixture();f.report.generatedAt=generatedAt;await assert.rejects(f.module.captureReportEdition(input,actor),{statusCode:409});assert.equal(f.rows.length,0);}
  await assert.rejects(fixture().module.captureReportEdition(input,{...actor,permissions:[]}),{statusCode:403});
});
