import test from 'node:test';
import assert from 'node:assert/strict';
import {guidanceContent,guidanceFilters,guidanceCan,guidanceLiveVersion,createAdmissionsGuidanceModule} from '../server/modules/admissions-guidance.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const input = {programmeId:'P',intakeId:'I',title:'Advice',body:'Curated public content',sourceRef:'Official source',effectiveFrom:'2026-10-05',validUntil:null,reason:'Private review reason',requestKey:'guidance-key'};
const actor = {accountId:'author',permissions:['guidance.manage','guidance.publish','audit.view'],roles:[{permissions:['guidance.manage','guidance.publish'],scope:{programmeCodes:['CODE'],intakeIds:['I']}},{permissions:['audit.view'],scope:{}}]};
function moduleWith(query) {return createAdmissionsGuidanceModule({async connect(){return {query,release(){}};}},{dataEncryptionKey:Buffer.alloc(32,3)});}
test('guidance content is bounded, explicit, canonical and rejects invalid calendar dates',() => {
  assert.deepEqual(guidanceContent(input,true),guidanceContent(Object.fromEntries(Object.entries(input).reverse()),true));
  for (const data of [null,{...input,programmeId:null},{...input,effectiveFrom:'2026-02-30'},{...input,validUntil:'2026-10-04'},{...input,validUntil:undefined},{...input,title:'x'.repeat(181)},{...input,body:'x'.repeat(6001)},{...input,reason:''},{...input,requestKey:'../file'},{...input,publishedBy:'author'}]) assert.throws(() => guidanceContent(data,true),{statusCode:400});
  const {programmeId,intakeId,...version} = input;
  assert.throws(() => guidanceContent(version),{statusCode:400});assert.equal(guidanceContent({...version,revision:1}).revision,1);
});
test('guidance filters prohibit private knobs and bound offsets and search',() => {
  assert.equal(guidanceFilters({offset:'25'}).offset,25);
  for (const data of [{status:'draft'},{offset:'-1'},{offset:'1000001'},{q:'x\0'},{q:'x'.repeat(161)}]) assert.throws(() => guidanceFilters(data),{statusCode:400});
  assert.throws(() => guidanceFilters({q:'search'},true),{statusCode:400});
});
test('intake authority cannot publish programme-wide or institutional advice or borrow audit authority',() => {
  assert.equal(guidanceCan(actor,{programmeCode:'CODE',intakeId:'I'},'guidance.publish'),true);
  for (const row of [{programmeCode:'CODE',intakeId:'OTHER'},{programmeCode:'CODE',intakeId:null},{programmeCode:null,intakeId:null},{programmeCode:'OTHER',intakeId:'I'}]) assert.equal(guidanceCan(actor,row,'guidance.publish'),false);
  assert.equal(guidanceCan({...actor,permissions:['guidance.manage']},{programmeCode:'CODE',intakeId:'I'},'guidance.publish'),false);
});
test('started replacement expiry never resurrects old advice; future and draft versions stay hidden',() => {
  const old = {version:1,status:'published',effectiveFrom:'2026-01-01',validUntil:null},expired = {...old,version:2,effectiveFrom:'2026-09-01',validUntil:'2026-10-04'};
  assert.equal(guidanceLiveVersion([old,expired], '2026-10-05'),null);
  assert.equal(guidanceLiveVersion([old,{...old,version:3,effectiveFrom:'2026-10-06'},{...old,version:4,status:'draft'}],'2026-10-05').version,1);
  assert.equal(guidanceLiveVersion([expired],'2026-10-04').version,2);
});
test('private guidance scope is checked before content lookup and decryption',async () => {
  const calls = [],module = moduleWith(async (sql) => {calls.push(sql);return {rows:sql.startsWith('select g.id') ? [{id:'hidden',programmeCode:'CODE',intakeId:'OTHER'}] : []};});
  await assert.rejects(module.getStaffGuidance('hidden',actor),{statusCode:404});assert.equal(calls.some((sql) => sql.includes('title_encrypted')),false);
});
test('public SQL resolves started publication before expiry and never returns private review metadata',async () => {
  const calls = [],module = moduleWith(async (sql,values) => {calls.push({sql,values});return {rows:[]};});
  assert.deepEqual((await module.listPublicGuidance({q:'fees'})).items,[]);
  const read = calls.find((c) => c.sql.includes('join lateral'));
  assert.match(read.sql,/status = 'published' and effective_from <=/);assert.match(read.sql,/p.status = 'published'/);assert.match(read.sql,/pv.effective_from <= coalesce\(i.starts_on/);assert.match(read.sql,/order by version desc limit 1/);assert.match(read.sql,/websearch_to_tsquery/);assert.equal(read.values[3],'fees');assert.doesNotMatch(read.sql,/reason_encrypted|created_by|published_by/);
});
test('staff loaders stop before second private read after session departure and erase revoked caches',async () => {
  const context = {window:{},Symbol,URLSearchParams};vm.runInNewContext(await readFile('src/admissions-guidance.js','utf8'),context);
  const ui = context.window.admissionsGuidanceUI,state = {session:{token:'old'}};let calls = 0;
  await ui.loadStaff(state,async () => {calls++;state.session = null;return {};});assert.equal(calls,1);assert.equal(state.guidanceMetadata,undefined);
  Object.assign(state,{session:{token:'new'},guidanceAuthorized:true,guidanceDraft:{body:'private'},guidanceKey:'retry',guidanceDetail:{body:'private'},guidanceSelectedId:'private'});
  await ui.loadStaff(state,async () => {throw Object.assign(new Error('Revoked'),{status:403});});
  assert.equal(state.guidanceDraft,undefined);assert.equal(state.guidanceDetail,undefined);assert.equal(state.guidanceKey,undefined);assert.equal(state.guidanceError,'Revoked');
});
test('database guidance guards freeze content, origins, withdrawals and maker-checker',async () => {
  const sql = await readFile('migrations/064_admissions_guidance.sql','utf8');
  for (const pattern of [/published_by <> created_by/,/Guidance version content is immutable/,/old.status = 'withdrawn'/,/ledger_append_only/,/new.intake_id.*not exists/]) assert.match(sql,pattern);
});
