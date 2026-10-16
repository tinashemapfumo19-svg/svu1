import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationInboxModule,notificationInboxFilters,notificationInboxPage} from '../server/modules/notification-inbox.js';

const cursorTime = '2026-10-06T03:00:00.123456Z';
test('message filters refuse recipient overrides, unbounded pages and malformed cursors',() => {
  assert.deepEqual(notificationInboxFilters(),{view:'all',limit:20,before:null});
  for (const input of [null,[],{recipientAccountId:'other'},{view:'delivered'},{limit:20},{limit:'0'},{limit:'51'},{limit:'1.2'},{cursor:'%%%'}]) assert.throws(() => notificationInboxFilters(input),{statusCode:400});
  for (const value of [{time:cursorTime},[cursorTime,'id','extra'],['invalid','id'],[cursorTime,'../id']]) assert.throws(() => notificationInboxFilters({cursor:Buffer.from(JSON.stringify(value)).toString('base64url')}),{statusCode:400});
  for (const time of ['2026-02-31T00:00:00.123456Z','2025-02-29T00:00:00.123456Z','2026-10-06T24:00:00.123456Z','0000-01-01T00:00:00.123456Z']) assert.throws(() => notificationInboxFilters({cursor:Buffer.from(JSON.stringify([time,'not_cursor'])).toString('base64url')}),{statusCode:400});
  assert.deepEqual(notificationInboxFilters({cursor:Buffer.from(JSON.stringify(['2024-02-29T00:00:00.123456Z','not_leap'])).toString('base64url')}).before,['2024-02-29T00:00:00.123456Z','not_leap']);
});
test('message pages preserve timestamp precision and expose only safe message fields',() => {
  const row = {id:'not_first',subject:'Notice',body:'Private message',createdAt:new Date(),readAt:null,cursorTime,recipientAccountId:'hidden',payload:{variables:{secret:'hidden'}},status:'queued'};
  const page = notificationInboxPage([row,{...row,id:'not_second'}],1);
  assert.deepEqual(Object.keys(page.items[0]).sort(),['body','createdAt','id','readAt','subject']);
  assert.deepEqual(notificationInboxFilters({cursor:page.nextCursor,limit:'1',view:'unread'}),{view:'unread',limit:1,before:[cursorTime,'not_first']});
  assert.equal(notificationInboxPage([row],1).nextCursor,null);
  assert.deepEqual(notificationInboxPage([],1),{items:[],nextCursor:null});
});
function fakePool(handler) {
  const calls=[];return {calls,connect:async () => ({query:async (sql,args) => {calls.push({sql,args});return await handler(sql,args);},release:() => calls.push({sql:'release'})})};
}
test('own inbox binds every query to the authenticated account in one snapshot',async () => {
  const pool = fakePool(sql => ({rows:sql.includes('count(*)') ? [{total:2,unread:1}] : sql.includes('select n.id') ? [{id:'not_first',subject:'Notice',body:'Body',createdAt:cursorTime,readAt:null,cursorTime}] : []}));
  const cursor = Buffer.from(JSON.stringify([cursorTime,'not_after'])).toString('base64url');
  const result = await createNotificationInboxModule(pool).listOwnNotifications({limit:'1',cursor,view:'unread'},{accountId:'own'});
  assert.equal(result.total,2);assert.equal(result.unread,1);
  const queries = pool.calls.filter(row => row.sql.includes('from notifications'));
  assert.equal(queries.length,2);for (const row of queries) {assert.equal(row.args[0],'own');assert.match(row.sql,/recipient_account_id = \$1/);assert.match(row.sql,/payload->'sensitive' = 'false'/);assert.ok(row.args[1].includes('identity.password_recovery'));}
  assert.deepEqual(queries[1].args.slice(2),[cursorTime,'not_after',2]);
  assert.match(queries[1].sql,/created_at,n.id\) < \(\$3::timestamptz,\$4::text\)/);
  assert.ok(pool.calls.some(row => row.sql === 'set transaction isolation level repeatable read'));
});
test('first read is locked, audited transactionally, and never changes delivery status',async () => {
  const readAt = new Date(),pool = fakePool(sql => ({rows:sql.startsWith('select n.id') ? [{id:'not_own',readAt:null}] : sql.startsWith('update notifications') ? [{id:'not_own',readAt}] : []}));
  assert.deepEqual(await createNotificationInboxModule(pool).markOwnNotificationRead('not_own',{}, {accountId:'own'}),{id:'not_own',readAt});
  const lock = pool.calls.find(row => row.sql.includes('for update'));
  assert.deepEqual(lock.args.slice(0,1),['own']);assert.equal(lock.args[2],'not_own');assert.match(lock.sql,/for update of n/);
  assert.equal(pool.calls.filter(row => row.sql.startsWith('update')).length,1);
  assert.equal(pool.calls.find(row => row.sql.includes('insert into audit_events')).args[2],'notification.read');
  assert.ok(pool.calls.some(row => row.sql === 'commit'));
  assert.ok(!pool.calls.some(row => /set status/.test(row.sql)));
});
test('repeat reads retain the original timestamp without another audit',async () => {
  const readAt = new Date(),pool = fakePool(sql => ({rows:sql.startsWith('select n.id') ? [{id:'not_own',readAt}] : []}));
  const inbox = createNotificationInboxModule(pool);
  assert.deepEqual(await inbox.markOwnNotificationRead('not_own',{}, {accountId:'own'}),{id:'not_own',readAt});
  assert.ok(!pool.calls.some(row => row.sql.startsWith('update') || row.sql.includes('insert into audit_events')));
  await assert.rejects(() => inbox.markOwnNotificationRead('not_own',{recipientAccountId:'other'},{accountId:'own'}),{statusCode:400});
});
test('missing or hidden messages refuse read acknowledgements without writes',async () => {
  const pool = fakePool(() => ({rows:[]}));
  await assert.rejects(() => createNotificationInboxModule(pool).markOwnNotificationRead('not_other',{}, {accountId:'own'}),{statusCode:404});
  assert.ok(pool.calls.some(row => row.sql === 'rollback'));
  assert.ok(!pool.calls.some(row => row.sql.startsWith('update') || row.sql.includes('insert into audit_events')));
});
test('audit failure rolls back the read acknowledgement',async () => {
  const pool = fakePool(sql => {if (sql.includes('insert into audit_events')) throw new Error('Audit unavailable');return {rows:sql.startsWith('select n.id') ? [{id:'not_own',readAt:null}] : sql.startsWith('update notifications') ? [{id:'not_own',readAt:new Date()}] : []};});
  await assert.rejects(() => createNotificationInboxModule(pool).markOwnNotificationRead('not_own',{}, {accountId:'own'}),/Audit unavailable/);
  assert.ok(pool.calls.some(row => row.sql === 'rollback'));assert.ok(!pool.calls.some(row => row.sql === 'commit'));
});

test('a message link is returned only when the message has one',() => {
  const row = {id:'not_link',subject:'Due soon',body:'Essay due',createdAt:new Date(),readAt:null,cursorTime:'2026-10-12T08:00:00.000000Z'};
  assert.deepEqual(notificationInboxPage([{...row,link:'#study/timetable'}],1).items[0].link,'#study/timetable');
  assert.equal('link' in notificationInboxPage([{...row,link:null}],1).items[0],false);
});
