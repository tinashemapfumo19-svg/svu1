import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { queueNotification, readNotificationDeliveryContent } from '../server/notification-queue.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Delivery fixtures require the isolated integration database.');
test('activation, recovery and staff invitations retain private transactional delivery snapshots', async ({request},info) => {
  test.setTimeout(120000);
  const stamp=`${info.project.name}.${Date.now()}`, email=`delivery.${stamp}@example.edu`, password='Private-Delivery-Verification-2026!';
  const key=loadConfig().dataEncryptionKey;
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const api=async (method,path,data,token,status=200) => {
    const response=await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(response.status(),`${method} ${path}`).toBe(status);return (await response.json()).data;
  };
  try {
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    await api('POST','/api/admissions/registrations',{email,preferredName:'Delivery',legalName:`Delivery Fixture ${stamp}`},null,202);
    const activation=await message('admissions.registration_activation',email);
    await verify(activation,activation.variables.activationToken);
    await api('POST','/api/identity/activations',{token:activation.variables.activationToken,password,preferredName:'Delivery',legalName:`Delivery Fixture ${stamp}`});
    const account=await api('POST','/api/identity/sessions',{email,password},null,201);
    await api('POST','/api/identity/recovery-requests',{email},null,202);
    const recovery=await message('identity.password_recovery',email);
    await verify(recovery,recovery.variables.recoveryToken);
    const staffEmail=`staff.delivery.${stamp}@example.edu`;
    await api('POST','/api/staff',{email:staffEmail,legalName:`Delivery Staff ${stamp}`,preferredName:'Staff',category:'LECTURER',grade:'L1',departmentId:'dept_computing',roleCode:'lecturer',engagedOn:new Date(Date.now()-86400000).toISOString().slice(0,10),reason:'Isolated delivery verification'},admin.token,201);
    const invitation=await message('staff.invitation',staffEmail);
    await verify(invitation,invitation.variables.activationToken);
    const queue=JSON.stringify(await api('GET','/api/notifications',undefined,admin.token));
    for(const mail of [activation,recovery,invitation]) {
      expect(queue.includes(mail.variables.activationToken || mail.variables.recoveryToken)).toBe(false);
      const cipher=(await db.query('select envelope from notification_delivery_content where notification_id=$1',[mail.notificationId])).rows[0].envelope;
      expect(queue.includes(cipher)).toBe(false);
    }
    await api('GET','/api/notifications',undefined,account.token,403);
    const privateRoute=await request.get(`/api/notifications/delivery-content/${recovery.notificationId}`,{headers:{Authorization:`Bearer ${admin.token}`}});
    expect(privateRoute.status()).toBe(404);
    let rollbackId;
    await db.query('begin');
    try {
      rollbackId=await queueNotification(db,null,'identity.password_recovery',{recoveryToken:'ROLLBACK_FIXTURE_ONLY',expiresInMinutes:30},{sensitive:true,recipientEmail:email,dataEncryptionKey:key});
      expect((await readNotificationDeliveryContent(db,rollbackId,key)).body.includes('ROLLBACK_FIXTURE_ONLY')).toBe(true);
    } finally {await db.query('rollback');}
    expect((await db.query('select 1 from notifications where id=$1',[rollbackId])).rowCount).toBe(0);
    expect((await db.query('select 1 from notification_delivery_content where notification_id=$1',[rollbackId])).rowCount).toBe(0);
  } finally {await db.end();}
  async function message(code,to) {
    const messages=[];
    for(const name of await readdir(process.env.SVU_DEV_OUTBOX)) {
      if(!name.endsWith('.json'))continue;
      const value=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'));
      if(value.templateCode===code && value.recipientEmail===to)messages.push(value);
    }
    expect(messages.length).toBe(1);return messages[0];
  }
  async function verify(mail,secret) {
    const snapshot=await readNotificationDeliveryContent(db,mail.notificationId,key);
    expect(snapshot.recipientEmail).toBe(mail.recipientEmail);expect(snapshot.body.includes(secret)).toBe(true);
    const row=(await db.query('select payload,status from notifications where id=$1',[mail.notificationId])).rows[0];
    expect(row.status).toBe('queued');expect(JSON.stringify(row.payload).includes(secret)).toBe(false);
  }
});
