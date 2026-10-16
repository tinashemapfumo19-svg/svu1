import { randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret } from './security.js';
import { validNotificationDestination } from './notification-queue.js';
import { deliveryRecipientMatches } from './delivery-recipient.js';
import { withTransaction } from './support.js';

const lockPreference = (db,id) => db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`applicant-communications:${id}`]);

// Account before preference before recipient matches the audience publisher's source/consent order.
async function lockRecipient(db,id) {
  const source=(await db.query('select account_id from applicant_communication_recipients where id=$1',[id])).rows[0];
  if(!source)return null;
  const account=(await db.query('select status,email from accounts where id=$1 for share',[source.account_id])).rows[0];
  await lockPreference(db,source.account_id);
  const row=(await db.query(`select r.*,c.status as campaign_status,c.subject_encrypted,c.body_encrypted,
    coalesce(p.email,false) as consent from applicant_communication_recipients r
    join applicant_communication_campaigns c on c.id=r.campaign_id
    left join applicant_communication_preferences p on p.account_id=r.account_id where r.id=$1 for update of r`,[id])).rows[0];
  return {...row,account};
}

export async function enrollCampaignEmails(pool,{email,dataEncryptionKey,governance}) {
  const candidates=(await pool.query(`select r.id from applicant_communication_recipients r
    join applicant_communication_campaigns c on c.id=r.campaign_id
    where r.channel='email' and r.status='queued' and c.status='published' and c.published_at >= $1::timestamptz
    and not exists(select 1 from applicant_communication_email_links l where l.recipient_id=r.id)
    order by r.created_at,r.id limit 100`,[email.enabledAfter])).rows;
  // One recipient per transaction avoids holding several account/preference locks while another publisher runs.
  for(const {id} of candidates)await withTransaction(pool,async db=>{
    if(!await governance(db))return;
    const row=await lockRecipient(db,id);
    if(!row || row.status!=='queued' || row.campaign_status!=='published')return;
    if((await db.query('select 1 from applicant_communication_email_links where recipient_id=$1',[id])).rowCount)return;
    if(!row.consent){await db.query("update applicant_communication_recipients set status='cancelled' where id=$1",[id]);return;}
    let recipientEmail,subject,body;
    try {
      recipientEmail=decryptSecret(row.recipient_encrypted,dataEncryptionKey);
      subject=decryptSecret(row.subject_encrypted,dataEncryptionKey);body=decryptSecret(row.body_encrypted,dataEncryptionKey);
      if(!validNotificationDestination(recipientEmail) || !subject || subject.length>160 || /[\r\n\0]/.test(subject)
        || !body || body.length>4000 || body.includes('\0'))throw new Error('Invalid campaign source');
    } catch {await db.query("update applicant_communication_recipients set status='dead' where id=$1",[id]);return;}
    if(!await deliveryRecipientMatches(db,row.account_id,row.account,recipientEmail)){await db.query("update applicant_communication_recipients set status='dead' where id=$1",[id]);return;}
    const notificationId=`not_${randomUUID()}`;
    await db.query(`insert into notifications(id,recipient_account_id,channel,payload,status) values($1,$2,'email',$3,'queued')`,
      [notificationId,row.account_id,{sensitive:true,subject:'[restricted applicant update]',body:'[restricted applicant update]'}]);
    const content={notificationId,accountId:row.account_id,recipientEmail,templateCode:'applicant.campaign',subject,body};
    await db.query('insert into notification_delivery_content(notification_id,envelope) values($1,$2)',[notificationId,encryptSecret(JSON.stringify(content),dataEncryptionKey)]);
    await db.query('insert into applicant_communication_email_links(recipient_id,notification_id) values($1,$2)',[id,notificationId]);
  });
}

export async function campaignEmailGate(db,notificationId) {
  const link=(await db.query('select recipient_id from applicant_communication_email_links where notification_id=$1',[notificationId])).rows[0];
  if(!link)return null;
  const row=await lockRecipient(db,link.recipient_id);
  if(row.status==='cancelled' || !row.consent) {
    if(['queued','dead'].includes(row.status))await db.query("update applicant_communication_recipients set status='cancelled' where id=$1",[row.id]);
    return 'cancelled';
  }
  return row.channel==='email' && row.campaign_status==='published' && ['queued','dead'].includes(row.status) ? 'eligible' : 'reconcile';
}

export async function syncCampaignEmail(db,notificationId,status) {
  const next=status==='pending' ? 'queued' : status;
  // Withdrawal is final for this recipient; a later opt-in cannot resurrect an old campaign.
  await db.query(`update applicant_communication_recipients r set status=$2 from applicant_communication_email_links l
    where l.notification_id=$1 and r.id=l.recipient_id and r.status <> 'cancelled' and r.status <> $2`,[notificationId,next]);
}
