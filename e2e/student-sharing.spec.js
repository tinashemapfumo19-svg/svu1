import { test,expect } from '@playwright/test';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { readNotificationDeliveryContent } from '../server/notification-queue.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Sharing fixtures require the isolated integration database.');
test('students authorize verified revocable category-limited record sharing',async ({page,request},info) => {
  test.setTimeout(240000);page.setDefaultTimeout(15000);
  const api=async (method,path,data,token,status=200) => {
    const r=await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(r.status(),`${method} ${path}: ${await r.text()}`).toBe(status);return (await r.json()).data;
  };
  const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
  const student=await api('POST','/api/identity/sessions',{email:'tinashe@example.edu',password:'Phase1-Student-Password-2026!'},null,201);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const stamp=`${info.project.name}.${Date.now()}`,email=`guardian.${stamp}@example.edu`,password='Verified-Recipient-Passphrase-2026!';
  let ownerId;
  try {
    const me=await api('GET','/api/identity/me',undefined,student.token);
    ownerId=me.account.id;
    await db.query('update accounts set email=$2 where id=$1',[ownerId,' TINASHE@EXAMPLE.EDU ']);
    const template=(await db.query(`select programme_id from intakes where id='intake_2027_feb'`)).rows[0];
    const intake=await api('POST','/api/master-data/intakes',{programmeId:template.programme_id,label:`Sharing fixture ${stamp}`,capacity:5,startsOn:'2027-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+30*86400000).toISOString()},admin.token,201);
    await api('POST',`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:'published',reason:'Isolated sharing cohort'},admin.token);
    await api('POST','/api/admissions/migrations',{source:`SAMPLE-SHARING-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:'SAMPLE-SHARING-STUDENT',accountId:me.account.id,intakeId:intake.id,state:'Accepted',referenceNumber:`SAMPLE-${stamp}`,studyModeCode:'FULL_TIME',answers:{applicantCategory:'standard'},documents:[],decision:{decision:'offer',conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token,201);
    const own=await api('GET','/api/registry/me',undefined,student.token),sp=own.programmes.find(p => p.intakeId===intake.id),root=`/api/registry/me/sharing/${sp.id}`;
    await api('GET','/api/registry/me/sharing/other-programme',undefined,student.token,404);
    await api('POST',root,{email:'tinashe@example.edu',categories:['programme_status'],days:5,requestKey:randomUUID()},student.token,400);
    await open(student,`/#office/sharing?programme=${sp.id}`,'.sharing-own');
    const form=page.locator('[data-share-invite]');await form.locator('[name="email"]').fill(email);await form.locator('[name="days"]').fill('30');
    for(const category of ['programme_status','fee_summary'])await form.locator(`[value="${category}"]`).check();
    await form.getByRole('button',{name:'Invite recipient'}).click();await expect(page.getByRole('status').filter({hasText:'Sharing invitation queued.'})).toBeVisible();
    let share=(await api('GET',root,undefined,student.token)).shares[0];expect(share.status).toBe('pending');
    const first=(await invitations(email)).at(-1),oldToken=token(first);
    const resend={revision:1,requestKey:randomUUID()};share=await api('POST',`/api/student-sharing/${share.id}/resend`,resend,student.token);
    expect((await api('POST',`/api/student-sharing/${share.id}/resend`,resend,student.token)).invitationCount).toBe(2);
    expect(await invitations(email)).toHaveLength(2);
    await api('POST','/api/student-sharing/register',{token:oldToken,legalName:'Fixture Parent',preferredName:'Parent',password,accept:true},null,404);
    const invitation=(await invitations(email)).at(-1),challenge=token(invitation);
    const durable=await readNotificationDeliveryContent(db,invitation.notificationId,loadConfig().dataEncryptionKey);
    expect(durable.recipientEmail).toBe(email);expect(durable.body.includes(challenge)).toBe(true);
    const envelope=(await db.query('select envelope from notification_delivery_content where notification_id=$1',[invitation.notificationId])).rows[0].envelope;
    expect(envelope.includes(challenge)).toBe(false);expect(envelope.includes(email)).toBe(false);
    await expect(db.query('update notification_delivery_content set envelope=$2 where notification_id=$1',[invitation.notificationId,envelope])).rejects.toThrow();
    await expect(db.query('delete from notification_delivery_content where notification_id=$1',[invitation.notificationId])).rejects.toThrow();
    await api('POST','/api/student-sharing/accept',{token:challenge,accept:true},admin.token,403);
    await api('POST','/api/student-sharing/register',{token:challenge,legalName:'Fixture Parent',preferredName:'Parent',password:'short',accept:true},null,400);
    await page.goto('/');await page.evaluate(() => window.svuSession.clear());await page.goto(invitation.variables.invitationLink);
    await expect(page.locator('[data-share-accept]')).toBeVisible();expect(page.url()).not.toContain(challenge);
    const signup=page.locator('[data-share-accept]');await signup.locator('[name="legalName"]').fill(`Fixture Parent ${info.project.name}`);await signup.locator('[name="preferredName"]').fill('Parent');await signup.locator('[name="password"]').fill(password);await signup.locator('[name="accept"]').check();
    await signup.getByRole('button',{name:'Create account and accept'}).click();await expect(page.locator(`[data-received-share="${share.id}"]`)).toBeVisible();
    const parent=await api('POST','/api/identity/sessions',{email,password},null,201);
    await db.query('update accounts set email=$2 where id=$1',[parent.accountId,` ${email.toUpperCase()} `]);
    const parentMe=await api('GET','/api/identity/me',undefined,parent.token);expect(parentMe.roles.map(r => r.code)).toEqual(['record_recipient']);
    expect(parentMe.permissions).toEqual(['sharing.read']);
    await api('POST','/api/student-sharing/register',{token:challenge,legalName:'Fixture Parent',preferredName:'Parent',password,accept:true},null,409);
    await api('GET',`/api/student-sharing/${share.id}/published_results`,undefined,parent.token,403);
    await api('GET',`/api/student-sharing/${share.id}/fee_summary`,undefined,admin.token,403);
    await api('GET',`/api/student-sharing/${share.id}/fee_summary`,undefined,student.token,403);
    await api('GET',`/api/registry/me/restricted/${sp.id}`,undefined,parent.token,403);
    await page.locator(`[data-share-read="programme_status"][data-id="${share.id}"]`).click();await expect(page.locator('[data-shared-record]')).toContainText('pending onboarding');
    await page.evaluate(() => {document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:info.outputPath('shared-recipient.png'),fullPage:true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    share=(await api('GET',root,undefined,student.token)).shares.find(s => s.id===share.id);
    const revoke={revision:share.revision,requestKey:randomUUID()};await api('POST',`/api/student-sharing/${share.id}/revoke`,revoke,student.token);
    await api('POST',`/api/student-sharing/${share.id}/revoke`,revoke,student.token);
    await api('GET',`/api/student-sharing/${share.id}/programme_status`,undefined,parent.token,403);
    await api('POST',`/api/student-sharing/${share.id}/resend`,{revision:share.revision,requestKey:randomUUID()},student.token,409);
    const definition={email,categories:['programme_status','confirmed_registration','published_results','fee_summary'],days:10,requestKey:randomUUID()};
    share=await api('POST',root,definition,student.token,201);
    expect((await api('POST',root,Object.fromEntries(Object.entries({...definition,categories:[...definition.categories].reverse()}).reverse()),student.token,201)).id).toBe(share.id);
    expect(await invitations(email)).toHaveLength(3);
    await api('POST',root,{...definition,days:11},student.token,409);
    const duplicateEmail=`duplicate.${email}`;
    const duplicateInvite=await api('POST','/api/identity/invitations',{email:duplicateEmail,roleCode:'applicant'},admin.token,201);
    const duplicate=await api('POST','/api/identity/activations',{token:duplicateInvite.activationToken,password,preferredName:'Duplicate fixture',legalName:'Isolated duplicate recipient'},null);
    await db.query('drop index accounts_canonical_email_key');
    try {
      await db.query('update accounts set email=$2 where id=$1',[duplicate.id,email.toUpperCase()]);
      for(const inactive of [false,true]) {
        if(inactive)await api('POST',`/api/identity/accounts/${duplicate.id}/suspend`,{reason:'Isolated ambiguous share recipient'},admin.token);
        const before=await sharingSnapshot();
        await api('POST','/api/student-sharing/accept',{token:token((await invitations(email)).at(-1)),accept:true},parent.token,403);
        expect(await sharingSnapshot()).toEqual(before);
      }
    } finally {
      await db.query('update accounts set email=$2 where id=$1',[duplicate.id,duplicateEmail]);
      await db.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))');
    }
    await api('POST','/api/student-sharing/accept',{token:token((await invitations(email)).at(-1)),accept:true},parent.token);
    await fixtureRecords(sp);
    const fees=await api('GET',`/api/student-sharing/${share.id}/fee_summary`,undefined,parent.token);
    expect(fees.data.currencies).toMatchObject([{currency:'USD',balance:12345,due:12345}]);expect(JSON.stringify(fees)).not.toContain('PRIVATE_LEDGER_NOTE');
    const registrations=await api('GET',`/api/student-sharing/${share.id}/confirmed_registration`,undefined,parent.token);
    expect(registrations.data.total).toBe(1);expect(registrations.data.records[0].courses[0].code).toBe('SHARE-PUB');expect(JSON.stringify(registrations)).not.toContain('PRIVATE_CONFIRMATION_NOTE');
    const results=await api('GET',`/api/student-sharing/${share.id}/published_results`,undefined,parent.token);
    expect(results.data.total).toBe(1);expect(results.data.records).toMatchObject([{code:'SHARE-PUB',mark:81,grade:'A'}]);expect(JSON.stringify(results)).not.toMatch(/PRIVATE_RESULT_NOTE|SHARE-DRAFT/);
    const ownResults=await api('GET',`/api/registry/me/programmes/${sp.id}/results`,undefined,student.token);
    expect(ownResults).toHaveLength(1);expect(Array.isArray(ownResults[0])).toBe(false);expect(ownResults[0].results).toMatchObject([{code:'SHARE-PUB',mark:81}]);
    await open(parent,'/#shared','.shared-workspace');
    for(const [category,expected] of [['fee_summary','123.45'],['confirmed_registration','SHARE-PUB'],['published_results','Grade A']]) {
      await page.locator(`[data-share-read="${category}"][data-id="${share.id}"]`).click();
      await expect(page.locator('[data-shared-record]')).toContainText(expected);
      expect(await page.locator('[data-shared-record]').innerText()).not.toMatch(/PRIVATE_LEDGER_NOTE|PRIVATE_CONFIRMATION_NOTE|PRIVATE_RESULT_NOTE|SHARE-DRAFT/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.evaluate(() => {document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:info.outputPath('shared-results.png'),fullPage:true});
    await page.locator('[data-share-close]').click();
    await expect(page.locator('[data-shared-record]')).toHaveCount(0);
    const withdraw=await api('POST',`/api/student-sharing/${share.id}/decline`,{revision:2,requestKey:randomUUID()},parent.token);expect(withdraw.status).toBe('declined');
    await api('GET',`/api/student-sharing/${share.id}/published_results`,undefined,parent.token,403);
    const expiryId=`share_${randomUUID()}`;
    await db.query(`insert into student_record_shares(id,student_programme_id,owner_id,recipient_email,recipient_id,categories,status,expires_at,accepted_at,challenge_hash,challenge_expires_at)
      values($1,$2,$3,$4,$5,'["fee_summary"]','accepted',now()-interval '1 minute',now()-interval '1 day',$6,now()-interval '1 hour')`,[expiryId,sp.id,me.account.id,email,parentMe.account.id,randomUUID()]);
    await api('GET',`/api/student-sharing/${expiryId}/fee_summary`,undefined,parent.token,403);
    const assignment=(await db.query(`select id from role_assignments where account_id=$1 and role_code='record_recipient' and ended_at is null`,[parentMe.account.id])).rows[0];
    await api('POST',`/api/access/role-assignments/${assignment.id}/end`,{reason:'Isolated recipient suspension'},admin.token);
    const restricted=await api('POST',root,{email,categories:['programme_status'],days:5,requestKey:randomUUID()},student.token,201);
    await api('POST','/api/student-sharing/accept',{token:token((await invitations(email)).at(-1)),accept:true},parent.token);
    expect((await api('GET','/api/identity/me',undefined,parent.token)).permissions).not.toContain('sharing.read');
    await api('GET',`/api/student-sharing/${restricted.id}/programme_status`,undefined,parent.token,403);
    const scoped=await api('POST','/api/access/role-assignments',{accountId:parentMe.account.id,roleCode:'record_recipient',scope:{programmeCodes:['OTHER'],intakeIds:['other-intake']},reason:'Isolated scoped restoration'},admin.token,201);
    await api('POST','/api/access/role-assignments',{accountId:parentMe.account.id,roleCode:'applicant',scope:{},reason:'Unrelated global fixture role'},admin.token,201);
    await api('GET',`/api/student-sharing/${restricted.id}/programme_status`,undefined,parent.token,404);
    await api('POST',`/api/access/role-assignments/${scoped.id}/end`,{reason:'Restore the correct explicit scope'},admin.token);
    await api('POST','/api/access/role-assignments',{accountId:parentMe.account.id,roleCode:'record_recipient',scope:{},reason:'Isolated explicit recipient restoration'},admin.token,201);
    await api('GET',`/api/student-sharing/${restricted.id}/programme_status`,undefined,parent.token);
    const otherEmail=`other.${email}`;
    await api('POST',root,{email:otherEmail,categories:['programme_status'],days:5,requestKey:randomUUID()},student.token,201);
    const otherToken=token((await invitations(otherEmail)).at(-1));
    await api('POST','/api/student-sharing/register',{token:otherToken,legalName:'Other Fixture Recipient',preferredName:'Other',password,accept:true},null,201);
    const other=await api('POST','/api/identity/sessions',{email:otherEmail,password},null,201);
    await api('GET',`/api/student-sharing/${restricted.id}/programme_status`,undefined,other.token,404);
    const studentRecord=(await db.query('select student_id from student_programmes where id=$1',[sp.id])).rows[0];
    await db.query(`update students set account_id='acct_system_admin' where id=$1`,[studentRecord.student_id]);
    await api('GET',`/api/student-sharing/${restricted.id}/programme_status`,undefined,parent.token,403);
    await db.query(`update students set account_id=$2 where id=$1`,[studentRecord.student_id,me.account.id]);
    const originalName=(await db.query(`select pe.legal_name,pe.id from people pe join students s on s.person_id=pe.id where s.id=$1`,[studentRecord.student_id])).rows[0];
    await db.query(`update people set legal_name='PRIVATE_IDENTITY_CHANGE' where id=$1`,[originalName.id]);
    expect(JSON.stringify(await api('GET','/api/student-sharing/received',undefined,parent.token))).not.toContain('PRIVATE_IDENTITY_CHANGE');
    await db.query(`update people set legal_name=$2 where id=$1`,[originalName.id,originalName.legal_name]);
    for(const table of ['student_share_history','student_share_access','student_share_commands'])await expect(db.query(`delete from ${table}`)).rejects.toThrow();
    await expect(db.query(`update student_record_shares set categories='["medical"]',revision=revision+1 where id=$1`,[expiryId])).rejects.toThrow();
    await expect(db.query(`delete from student_record_shares where id=$1`,[expiryId])).rejects.toThrow();
    const records=(await db.query(`select challenge_hash from student_record_shares where student_programme_id=$1`,[sp.id])).rows;
    expect(JSON.stringify(records)).not.toContain(challenge);
    const queue=(await db.query(`select payload from notifications n join notification_templates t on t.id=n.template_id where t.code='student.sharing_invitation'`)).rows;
    expect(JSON.stringify(queue)).not.toContain(challenge);
    const adminQueue=await api('GET','/api/notifications',undefined,admin.token);
    expect(JSON.stringify(adminQueue).includes(challenge)).toBe(false);
    expect(JSON.stringify(adminQueue).includes(envelope)).toBe(false);
    expect(JSON.stringify((await api('GET','/api/notifications/me',undefined,parent.token)))).not.toContain(challenge);
    await open(student,`/#office/sharing?programme=${sp.id}`,'.sharing-own');await expect(page.locator('.sharing-own')).toContainText('Recent recipient access');
    await page.evaluate(() => {document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:info.outputPath('shared-owner.png'),fullPage:true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    async function sharingSnapshot() {
      const names=(await db.query("select tablename from pg_tables where schemaname='public' and (tablename like 'student_share%' or tablename='student_record_shares') order by tablename")).rows.map(r=>r.tablename);
      const hashes=[];
      for(const name of [...names,'accounts','people','role_assignments','notifications','notification_delivery_content','audit_events']) {
        if(!/^[a-z_]+$/.test(name))throw Error('Invalid sharing fixture table');
        hashes.push((await db.query(`select md5(coalesce(string_agg(row::text,'' order by row::text),'')) digest from (select to_jsonb(t) row from ${name} t) r`)).rows[0].digest);
      }
      return hashes;
    }
  } finally {
    try {if(ownerId)await db.query('update accounts set email=$2 where id=$1',[ownerId,'tinashe@example.edu']);}
    finally {await db.end();}
  }
  async function open(actor,path,ready) {await page.goto('/');await page.evaluate(s => window.svuSession.set(s),actor);await page.goto(path);await expect(page.locator(ready)).toBeVisible();await expect(page.locator('[data-student-controls], [data-share-controls]').first()).not.toHaveAttribute('inert');}
  async function invitations(to) {const rows=[];for(const name of await readdir(process.env.SVU_DEV_OUTBOX)){if(name.endsWith('.json')){const r=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'));if(r.templateCode==='student.sharing_invitation' && r.recipientEmail===to)rows.push(r);}}return rows.sort((a,b) => a.queuedAt.localeCompare(b.queuedAt));}
  function token(message) {return new URLSearchParams(message.variables.invitationLink.split('?')[1]).get('token');}
  async function fixtureRecords(sp) {
    const row=(await db.query('select student_id,programme_version_id from student_programmes where id=$1',[sp.id])).rows[0];
    const course=(await db.query('select id from courses order by id limit 1')).rows[0].id;
    const year=info.project.name==='desktop' ? 2048 : 2050;
    const parent=await api('POST','/api/master-data/academic-periods',{code:`SHARE-Y-${stamp}`,name:'Synthetic sharing year',periodType:'academic_year',startsOn:`${year}-01-01`,endsOn:`${year}-12-31`},admin.token,201);
    for(const [index,status] of ['published','draft'].entries()) {
      const period=await api('POST','/api/master-data/academic-periods',{code:`SHARE-S-${stamp}-${index}`,name:`Synthetic sharing semester ${index}`,periodType:'semester',parentId:parent.id,startsOn:`${year}-${index ? '07' : '01'}-01`,endsOn:`${year}-${index ? '12' : '06'}-28`},admin.token,201);
      const rp=`rp_${randomUUID()}`,registration=`reg_${randomUUID()}`,batch=`rb_${randomUUID()}`,snapshot={programmeId:sp.id,registrationId:registration,courseId:course,code:index ? 'SHARE-DRAFT' : 'SHARE-PUB',title:'Shared synthetic course',credits:15,mark:81,grade:'A',points:4,privateNote:'PRIVATE_RESULT_NOTE'};
      await db.query(`insert into registration_periods(id,intake_id,academic_period_id,programme_version_id,year_of_study,term,credit_limit) values($1,$2,$3,$4,1,'S1',30)`,[rp,sp.intakeId,period.id,row.programme_version_id]);
      await db.query(`insert into student_registrations(id,student_programme_id,period_id,status,reference_number,confirmed_at,confirmation) values($1,$2,$3,$4,$5,now(),$6)`,[registration,sp.id,rp,index ? 'draft' : 'confirmed',`SHARING-${stamp}-${index}`,{credits:15,courses:[{code:'SHARE-PUB',title:'Shared synthetic course',credits:15,privateNote:'PRIVATE_CONFIRMATION_NOTE'}],privateNote:'PRIVATE_CONFIRMATION_NOTE'}]);
      await db.query(`insert into course_enrolments(registration_id,student_id,academic_period_id,course_id,course_snapshot) values($1,$2,$3,$4,$5)`,[registration,row.student_id,period.id,course,snapshot]);
      const policy={rule:{id:'fixture-rule',version:1,rules:{creditWeighted:true,retakePolicy:'latest',excludeGrades:[],includeFailed:true,rounding:{decimals:2,mode:'half_up'}}},scheme:{id:'fixture-scheme',version:1,bands:[{minMark:0,maxMark:39,grade:'F',points:0,passing:false},{minMark:40,maxMark:100,grade:'A',points:4,passing:true}],classifications:[{minGpa:2,label:'Pass'}]}};
      await db.query(`insert into result_batches(id,period_id,source_ref,checksum,row_count,mark_total,rows,policy_snapshot,status,created_by,import_reason,published_by,published_at) values($1,$2,$3,'fixture',1,81,$4,$6,$5,'acct_registrar','Isolated projection fixture','acct_system_admin',now())`,[batch,rp,`SHARING-${stamp}-${index}`,JSON.stringify([snapshot]),status,policy]);
      await db.query(`insert into academic_results(registration_id,course_id,batch_id,result_snapshot) values($1,$2,$3,$4)`,[registration,course,batch,snapshot]);
    }
    await db.query(`insert into ledger_entries(student_programme_id,entry_type,currency,amount_minor,charge_code,description,due_on,actor_id) values($1,'charge','USD',12345,'TUITION','PRIVATE_LEDGER_NOTE',current_date,'acct_system_admin')`,[sp.id]);
  }
});
