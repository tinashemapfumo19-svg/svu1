import {insertAudit,requestError,withTransaction} from '../support.js';

const secretCodes = ['identity.password_recovery','admissions.registration_activation','staff.invitation','student.sharing_invitation'];
const visible = `n.recipient_account_id = $1
  and jsonb_typeof(n.payload) = 'object'
  and (not n.payload ? 'sensitive' or n.payload->'sensitive' = 'false'::jsonb)
  and jsonb_typeof(n.payload->'subject') = 'string' and jsonb_typeof(n.payload->'body') = 'string'
  and t.code <> all($2::text[])`;
const columns = `n.id,n.payload->>'subject' as subject,n.payload->>'body' as body,
  n.created_at as "createdAt",n.read_at as "readAt",
  case when n.payload->>'link' ~ '^#[A-Za-z0-9_/?=&.%-]{1,200}$' then n.payload->>'link' end as link,
  to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTime"`;

export function notificationInboxFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['view','limit','cursor'].includes(key))) throw requestError(400,'Unsupported message filter.');
  const {view = 'all',limit = '20',cursor = ''} = input;
  if (!['all','unread','read'].includes(view) || typeof limit !== 'string' || !/^[1-9]\d?$/.test(limit) || Number(limit) > 50 || typeof cursor !== 'string' || cursor.length > 512) throw requestError(400,'Use bounded message filters.');
  let before = null;
  if (cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const bytes = Buffer.from(cursor,'base64url');
      if (bytes.toString('base64url') !== cursor) throw new Error();
      before = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(before) || before.length !== 2 || typeof before[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(before[0]) || !Number.isFinite(Date.parse(before[0])) || before[0].startsWith('0000-') || new Date(before[0]).toISOString().slice(0,19) !== before[0].slice(0,19) || typeof before[1] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(before[1])) throw new Error();
    } catch { throw requestError(400,'Invalid message page.'); }
  }
  return {view,limit:Number(limit),before};
}

export function notificationInboxPage(rows,limit) {
  const selected = rows.slice(0,limit),last = selected.at(-1);
  return {
    // An in-app link is included only when the message has one, so older messages keep the same fields.
    items:selected.map(({id,subject,body,createdAt,readAt,link}) => ({id,subject,body,createdAt,readAt,...(link ? {link} : {})})),
    nextCursor:rows.length > limit && last ? Buffer.from(JSON.stringify([last.cursorTime,last.id])).toString('base64url') : null
  };
}

export function createNotificationInboxModule(pool) {
  return {
    async listOwnNotifications(input,actor) {
      const {view,limit,before} = notificationInboxFilters(input);
      return withTransaction(pool,async db => {
        await db.query('set transaction isolation level repeatable read');
        const base = [actor.accountId,secretCodes];
        const counts = (await db.query(`select count(*)::int as total,count(*) filter (where n.read_at is null)::int as unread
          from notifications n join notification_templates t on t.id = n.template_id where ${visible}`,base)).rows[0];
        const conditions = [visible],values = [...base];
        if (view !== 'all') conditions.push(`n.read_at is ${view === 'unread' ? '' : 'not '}null`);
        if (before) {values.push(...before);conditions.push('(n.created_at,n.id) < ($3::timestamptz,$4::text)');}
        values.push(limit+1);
        const rows = (await db.query(`select ${columns} from notifications n join notification_templates t on t.id = n.template_id
          where ${conditions.join(' and ')} order by n.created_at desc,n.id desc limit $${values.length}`,values)).rows;
        return {...notificationInboxPage(rows,limit),...counts,view};
      });
    },
    async markOwnNotificationRead(id,input,actor) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw requestError(400,'Choose a message without additional fields.');
      return withTransaction(pool,async db => {
        const row = (await db.query(`select n.id,n.read_at as "readAt" from notifications n
          join notification_templates t on t.id = n.template_id where ${visible} and n.id = $3 for update of n`,[actor.accountId,secretCodes,id])).rows[0];
        if (!row) throw requestError(404,'Message not found.');
        if (row.readAt) return row;
        const updated = (await db.query('update notifications set read_at = now() where id = $1 returning id,read_at as "readAt"',[id])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:'notification.read',subjectType:'Notification',subjectId:id,reason:'Recipient marked the portal message as read'});
        return updated;
      });
    }
  };
}
