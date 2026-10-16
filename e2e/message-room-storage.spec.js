import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Room storage checks require the isolated integration database.');

test('room storage binds consent, membership, moderation and closure without private authority',async()=>{
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const suffix=randomUUID(),room=`room_${suffix}`,ownerMember=`owner_${suffix}`,studentMember=`student_${suffix}`,moderatorMember=`moderator_${suffix}`;
  try {
    const accounts=(await db.query("select id,email from accounts where email in ('admin@southvalley.test','registrar@southvalley.test','tinashe@example.edu')")).rows;
    const account=email=>accounts.find(row=>row.email===email).id;
    const owner=account('admin@southvalley.test'),moderator=account('registrar@southvalley.test'),student=account('tinashe@example.edu');
    // Direct storage actors/envelopes are fixtures, not authenticated appointments or crypto verification.
    async function consent(id,enabled) {
      const revision=((await db.query('select revision from room_message_preferences where account_id=$1',[id])).rows[0]?.revision ?? 0)+1;
      await db.query('begin');
      try {
        await db.query('insert into room_message_preferences(account_id,enabled,revision) values($1,$2,$3) on conflict(account_id) do update set enabled=excluded.enabled,revision=excluded.revision,updated_at=now()',[id,enabled,revision]);
        await db.query('insert into room_message_preference_history(account_id,revision,enabled) values($1,$2,$3)',[id,revision,enabled]);
        await db.query('commit');return revision;
      }catch(error){await db.query('rollback');throw error;}
    }
    const ownerConsent=await consent(owner,true),moderatorConsent=await consent(moderator,true),studentConsent=await consent(student,true);
    await db.query("insert into message_rooms(id,title,purpose,policy_reference,retention_rule,created_by) values($1,'Isolated room','Invitation-only test discussion','TEST-ROOM-POLICY','Retained isolated evidence',$2)",[room,owner]);
    const invite=(id,person,role='member')=>db.query("insert into message_room_memberships(id,room_id,account_id,invited_by,role) values($1,$2,$3,$4,$5)",[id,room,person,owner,role]);
    await expect(invite(studentMember,student)).rejects.toThrow('active room');
    await expect(db.query("update message_rooms set status='active',revision=2,reviewed_by=$2,activated_at=now() where id=$1",[room,owner])).rejects.toThrow();
    await db.query("update message_rooms set status='active',revision=2,reviewed_by=$2,activated_at=now() where id=$1",[room,moderator]);
    await expect(db.query("update message_rooms set title='Changed' where id=$1",[room])).rejects.toThrow('protected');
    await db.query("insert into message_room_memberships(id,room_id,account_id,invited_by,status,accepted_at,accepted_by,consent_revision) values($1,$2,$3,$3,'accepted',now(),$3,$4)",[ownerMember,room,owner,ownerConsent]);
    await invite(studentMember,student);await invite(moderatorMember,moderator,'moderator');
    await expect(db.query("update message_room_memberships set accepted_at=now(),accepted_by=$2,consent_revision=$3,revision=2 where id=$1",[studentMember,student,studentConsent])).rejects.toThrow();
    const send=(id,member,person,kind='text',connection=db)=>connection.query('insert into room_messages(id,room_id,author_id,membership_id,kind,envelope) values($1,$2,$3,$4,$5,$6)',[id,room,person,member,kind,'opaque-storage-fixture']);
    await expect(send(`pending_${suffix}`,studentMember,student)).rejects.toThrow('accepted membership');
    const accept=(member,person,revision)=>db.query("update message_room_memberships set status='accepted',revision=2,accepted_at=now(),accepted_by=$2,consent_revision=$3 where id=$1",[member,person,revision]);
    await expect(accept(studentMember,owner,studentConsent)).rejects.toThrow();
    await accept(studentMember,student,studentConsent);await accept(moderatorMember,moderator,moderatorConsent);
    const message=`message_${suffix}`;await send(message,studentMember,student);await send(`action_${suffix}`,studentMember,student,'action');
    await expect(send(`notice_denied_${suffix}`,studentMember,student,'notice')).rejects.toThrow('accepted membership');
    await send(`notice_${suffix}`,moderatorMember,moderator,'notice');
    await expect(send(`spoof_${suffix}`,studentMember,owner)).rejects.toThrow();
    await expect(db.query('update room_messages set envelope=$2 where id=$1',[message,'changed'])).rejects.toThrow();
    await expect(db.query('delete from room_messages where id=$1',[message])).rejects.toThrow();
    const moderate=(actor,revision,hidden)=>db.query('insert into room_message_moderation(room_id,message_id,revision,hidden,actor_id,reason_encrypted) values($1,$2,$3,$4,$5,$6)',[room,message,revision,hidden,actor,'opaque-reason-fixture']);
    await expect(moderate(student,1,true)).rejects.toThrow('moderator');await moderate(moderator,1,true);
    await expect(moderate(moderator,1,false)).rejects.toThrow('revision');await moderate(moderator,2,false);
    await db.query("update message_room_memberships set role='member',revision=3 where id=$1",[moderatorMember]);
    await expect(moderate(moderator,3,true)).rejects.toThrow('moderator');await moderate(owner,3,true);
    await expect(db.query('delete from room_message_moderation where message_id=$1',[message])).rejects.toThrow();
    const consentWaiter=new pg.Client({connectionString:process.env.DATABASE_URL});await consentWaiter.connect();let pendingConsent;
    try {
      const pid=(await consentWaiter.query('select pg_backend_pid() as pid')).rows[0].pid;
      await db.query('begin');await moderate(owner,4,false);
      pendingConsent=consentWaiter.query('update room_message_preferences set enabled=false,revision=revision+1 where account_id=$1',[owner]).then(()=>({changed:true}),error=>({error}));
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++) {
        waiting=(await db.query("select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting",[pid])).rows[0].waiting;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);await db.query('rollback');expect(await pendingConsent).toEqual({changed:true});
      await expect(moderate(owner,4,false)).rejects.toThrow('moderator');
      // Restore only the preference, never the old membership's consent revision.
      const updated=(await db.query('select revision from room_message_preferences where account_id=$1',[owner])).rows[0].revision;
      await db.query('insert into room_message_preference_history(account_id,revision,enabled) values($1,$2,false)',[owner,updated]);
      const renewedOwner=await consent(owner,true);
      await expect(moderate(owner,4,false)).rejects.toThrow('moderator');
      await db.query("update message_room_memberships set status='left',revision=2,ended_at=now() where id=$1",[ownerMember]);
      await db.query("insert into message_room_memberships(id,room_id,account_id,invited_by,status,accepted_at,accepted_by,consent_revision) values($1,$2,$3,$3,'accepted',now(),$3,$4)",[`renewed_owner_${suffix}`,room,owner,renewedOwner]);
    } finally {await db.query('rollback');if(pendingConsent)await pendingConsent;await consentWaiter.end();}
    await db.query("insert into message_room_membership_history(membership_id,revision,status,role,actor_id,reason_encrypted) values($1,2,'accepted','member',$2,'opaque-history-fixture')",[studentMember,student]);
    await expect(db.query("insert into message_room_membership_history(membership_id,revision,status,role,actor_id,reason_encrypted) values($1,3,'accepted','member',$2,'opaque-history-fixture')",[studentMember,student])).rejects.toThrow('current revision');
    await expect(db.query('delete from message_room_membership_history where membership_id=$1',[studentMember])).rejects.toThrow();
    await consent(student,false);await expect(send(`optout_${suffix}`,studentMember,student)).rejects.toThrow('consent');
    const renewed=await consent(student,true);await expect(send(`resurrect_${suffix}`,studentMember,student)).rejects.toThrow('consent');
    await db.query("update message_room_memberships set status='banned',revision=3,ended_at=now() where id=$1",[studentMember]);
    await expect(invite(`duplicate_${suffix}`,student)).rejects.toThrow();
    await expect(db.query("update message_room_memberships set status='accepted',revision=4 where id=$1",[studentMember])).rejects.toThrow('protected');
    await db.query("update message_room_memberships set status='left',revision=4 where id=$1",[studentMember]);
    const fresh=`fresh_${suffix}`;await invite(fresh,student);await accept(fresh,student,renewed);await send(`renewed_${suffix}`,fresh,student);
    await expect(send(`old_membership_${suffix}`,studentMember,student)).rejects.toThrow('accepted membership');
    await db.query('insert into room_message_receipts(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)',[student,randomUUID(),'0'.repeat(64),JSON.stringify({id:message})]);
    await expect(db.query('delete from room_message_receipts where actor_id=$1',[student])).rejects.toThrow();
    const closing=new pg.Client({connectionString:process.env.DATABASE_URL});await closing.connect();let pending;
    try {
      const pid=(await closing.query('select pg_backend_pid() as pid')).rows[0].pid;
      await db.query('begin');await send(`before_close_${suffix}`,fresh,student);
      pending=closing.query("update message_rooms set status='closed',revision=3,closed_at=now() where id=$1",[room]).then(()=>({closed:true}),error=>({error}));
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        waiting=(await db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waiting",[pid])).rows[0].waiting;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);await db.query('commit');expect(await pending).toEqual({closed:true});
    } finally {await db.query('rollback');if(pending)await pending;await closing.end();}
    await expect(send(`after_close_${suffix}`,fresh,student)).rejects.toThrow('accepted membership');
    await expect(moderate(owner,4,false)).rejects.toThrow('moderator');
    await expect(invite(`closed_invitation_${suffix}`,moderator)).rejects.toThrow('active room');
    await expect(db.query('delete from message_rooms where id=$1',[room])).rejects.toThrow('retained');
  } finally {await db.end();}
});
