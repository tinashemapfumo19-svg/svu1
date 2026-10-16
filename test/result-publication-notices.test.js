import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resultPublicationRecipients} from '../server/modules/results.js';
import {queueNotification} from '../server/notification-queue.js';
import {notificationTemplates} from '../scripts/notification-templates.js';

const rows=()=>[{registrationId:'r1',courseId:'c1',programmeId:'p1',studentNumber:'S33000001'},{registrationId:'r1',courseId:'c2',programmeId:'p1',studentNumber:'S33000001'}];
const recipients=()=>rows().map(row=>({...row,accountId:'account1'}));

test('publication notices deduplicate verified courses/programmes into one notice per account',()=>{
  assert.deepEqual(resultPublicationRecipients(rows(),recipients().reverse()),['account1']);
  const more={registrationId:'r2',courseId:'c1',programmeId:'p2',studentNumber:'S33000002'};
  assert.deepEqual(resultPublicationRecipients([...rows(),more],[...recipients(),{...more,accountId:'account2'}]),['account1','account2']);
  assert.deepEqual(resultPublicationRecipients([...rows(),more],[...recipients(),{...more,accountId:'account1'}]),['account1']);
});
test('notice recipient custody rejects missing, extra, duplicate, unbound and mismatched identities',()=>{
  for(const input of [[],recipients().slice(0,1),[...recipients(),recipients()[0]],recipients().map(row=>({...row,accountId:null})),recipients().map(row=>({...row,programmeId:'wrong'})),recipients().map(row=>({...row,studentNumber:'wrong'})),recipients().map(row=>({...row,registrationId:'wrong'}))])assert.throws(()=>resultPublicationRecipients(rows(),input),{statusCode:409});
  assert.throws(()=>resultPublicationRecipients([],[]),{statusCode:409});
  assert.throws(()=>resultPublicationRecipients(null,recipients()),{statusCode:409});
});
test('publication template is static, private and identically provisioned by additive migration and canonical loader',()=>{
  const template=notificationTemplates.find(row=>row.code==='results.published');
  assert.equal(template.status,'active');assert.equal(template.version,1);
  assert.doesNotMatch(template.subject+template.body,/\{\{|https?:|studentNumber|mark|grade|programme|batch/i);
  const migration=readFileSync(new URL('../migrations/077_result_publication_notice.sql',import.meta.url),'utf8');
  for(const value of [template.id,template.code,template.subject,template.body])assert.ok(migration.includes(value));
});
test('result queue uses active-only template selection and stores no source or recipient variables in the payload',async()=>{
  const calls=[],template=notificationTemplates.find(row=>row.code==='results.published');
  const db={query:async(sql,args)=>{calls.push({sql,args});return sql.includes('select id')?{rowCount:1,rows:[template]}:{rowCount:1};}};
  await queueNotification(db,'account1','results.published',{}, {activeOnly:true});
  assert.deepEqual(calls[0].args,['results.published',true]);assert.match(calls[0].sql,/status = 'active'/);
  assert.deepEqual(calls[1].args[3],{subject:template.subject,body:template.body,sensitive:false});
  assert.equal(calls[1].args[1],'account1');
});
test('missing active publication template fails before any notification insert',async()=>{
  let queries=0;const db={query:async()=>{queries++;return {rowCount:0,rows:[]};}};
  await assert.rejects(()=>queueNotification(db,'account1','results.published',{}, {activeOnly:true}),{statusCode:500});
  assert.equal(queries,1);
});
test('legacy notification callers retain their existing template selection default',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push(args);return sql.includes('select id')?{rowCount:1,rows:[{id:'legacy',subject:'Hello',body:'Hello {{name}}'}]}:{rowCount:1};}};
  await queueNotification(db,'account1','legacy',{name:'Synthetic'});
  assert.deepEqual(calls[0],['legacy',false]);assert.equal(calls[1][3].body,'Hello Synthetic');
});
