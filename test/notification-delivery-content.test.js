import test from 'node:test';
import assert from 'node:assert/strict';
import { queueNotification, readNotificationDeliveryContent, canonicalNotificationDestination } from '../server/notification-queue.js';
import { encryptSecret } from '../server/security.js';

const key = Buffer.alloc(32, 17);
function fixture(email='recipient@example.edu') {
  const calls = [], snapshots = new Map();
  const db = { async query(sql, values) {
    calls.push({sql,values});
    if (sql.includes('from notification_templates')) return {rowCount:1,rows:[{id:'template',subject:'Secret {{token}}',body:'Use {{token}} once.'}]};
    if (sql.startsWith('select email')) return {rows:[{email}]};
    if (sql.startsWith('insert into notification_delivery_content')) snapshots.set(values[0],values[1]);
    if (sql.startsWith('select envelope')) return {rows:snapshots.has(values[0]) ? [{envelope:snapshots.get(values[0])}] : []};
    return {rows:[],rowCount:1};
  }};
  return {db,calls,snapshots};
}

test('sensitive queue content is encrypted and bound to its notification, including subject and original destination', async () => {
  const f=fixture();
  await queueNotification(f.db,null,'activation',{token:'ONE_TIME_PRIVATE_SECRET'},{sensitive:true,recipientEmail:'invited@example.edu',dataEncryptionKey:key});
  const inserted=f.calls.find(c=>c.sql.startsWith('insert into notifications'));
  assert.doesNotMatch(JSON.stringify(inserted.values),/ONE_TIME_PRIVATE_SECRET|invited@example.edu/);
  const [id,envelope]=[...f.snapshots][0];
  assert.doesNotMatch(envelope,/ONE_TIME_PRIVATE_SECRET|invited@example.edu/);
  assert.deepEqual(await readNotificationDeliveryContent(f.db,id,key),{notificationId:id,accountId:null,recipientEmail:'invited@example.edu',templateCode:'activation',subject:'Secret ONE_TIME_PRIVATE_SECRET',body:'Use ONE_TIME_PRIVATE_SECRET once.'});
  assert.equal(f.calls.some(c=>c.sql.startsWith('select email')),false);
});

test('new default sensitive snapshots canonicalize preserved account mailboxes without changing explicit destinations',async()=>{
  const f=fixture(' RECIPIENT@EXAMPLE.EDU ');
  await queueNotification(f.db,'account','recovery',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key});
  const id=[...f.snapshots.keys()][0];
  assert.equal((await readNotificationDeliveryContent(f.db,id,key)).recipientEmail,'recipient@example.edu');
  const explicit=fixture();
  await queueNotification(explicit.db,'account','recovery',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key,recipientEmail:'RECIPIENT@EXAMPLE.EDU'});
  assert.equal((await readNotificationDeliveryContent(explicit.db,[...explicit.snapshots.keys()][0],key)).recipientEmail,'RECIPIENT@EXAMPLE.EDU');
  assert.ok(!f.calls.some(c=>/^(update|delete) /.test(c.sql)));
});

test('canonical notification addresses reject controls, coercion, lists and invalid mailbox syntax',()=>{
  assert.equal(canonicalNotificationDestination(' RECIPIENT@EXAMPLE.EDU '),'recipient@example.edu');
  for(const value of [null,undefined,1,{},'recipient@example.edu\t','\r\nrecipient@example.edu','a,b@example.edu','"Recipient" <recipient@example.edu>','a..b@example.edu','bad',`${'x'.repeat(65)}@example.edu`])assert.equal(canonicalNotificationDestination(value),null);
});

test('account-targeted sensitive messages snapshot the destination when queued', async () => {
  const f=fixture();
  await queueNotification(f.db,'account','recovery',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key});
  const id=[...f.snapshots.keys()][0];
  assert.equal((await readNotificationDeliveryContent(f.db,id,key)).recipientEmail,'recipient@example.edu');
  assert.equal(f.calls.find(c=>c.sql.startsWith('select email')).values[0],'account');
});

test('missing key and invalid destinations fail before public queue insertion', async () => {
  for (const options of [{sensitive:true},{sensitive:true,dataEncryptionKey:Buffer.alloc(16)}, {sensitive:true,dataEncryptionKey:key,recipientEmail:'recipient@example.edu\r\nBcc: attacker@example.edu'}]) {
    const f=fixture();
    await assert.rejects(queueNotification(f.db,null,'activation',{token:'PRIVATE'},options));
    assert.equal(f.calls.some(c=>c.sql.startsWith('insert')),false);
  }
  for (const recipientEmail of ['a,b@example.edu','a;recipient@example.edu','"Recipient" <recipient@example.edu>','.a@example.edu','a..b@example.edu','a@-example.edu']) {
    const f=fixture();
    await assert.rejects(queueNotification(f.db,null,'activation',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key,recipientEmail}));
    assert.equal(f.calls.some(c=>c.sql.startsWith('insert')),false);
  }
});

test('ordinary notification queuing is unchanged and does not require an encryption key', async () => {
  const f=fixture();await queueNotification(f.db,'account','ordinary',{token:'public'});
  assert.equal(f.snapshots.size,0);
  assert.equal(f.calls.find(c=>c.sql.startsWith('insert into notifications')).values[3].body,'Use public once.');
});

test('missing historical content cannot be reconstructed and tampering/key changes return generic errors', async () => {
  const f=fixture();assert.equal(await readNotificationDeliveryContent(f.db,'old',key),null);
  await queueNotification(f.db,'account','recovery',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key});
  const [id,envelope]=[...f.snapshots][0];
  await assert.rejects(readNotificationDeliveryContent(f.db,id,Buffer.alloc(32,2)),{statusCode:409,message:'Notification delivery content requires secure reconciliation.'});
  f.snapshots.set('other',envelope);
  await assert.rejects(readNotificationDeliveryContent(f.db,'other',key),{statusCode:409});
  f.snapshots.set(id,encryptSecret(JSON.stringify({notificationId:id,recipientEmail:'bad',subject:'PRIVATE',body:'PRIVATE',templateCode:'recovery'}),key));
  await assert.rejects(readNotificationDeliveryContent(f.db,id,key),{statusCode:409});
});

test('encrypted content insertion errors propagate to the surrounding business transaction', async () => {
  const f=fixture(),query=f.db.query;
  f.db.query=async (sql,values) => {if(sql.startsWith('insert into notification_delivery_content'))throw new Error('snapshot storage unavailable');return query(sql,values);};
  await assert.rejects(queueNotification(f.db,'account','recovery',{token:'PRIVATE'},{sensitive:true,dataEncryptionKey:key}),/snapshot storage unavailable/);
});
