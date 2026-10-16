import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { insertAudit, requestError, withTransaction } from './support.js';

// Push notifications (docs/INSTALLABLE_APP.md). Off unless SVU_PUSH=enabled with VAPID keys. Every non-secret Inbox
// message is also pushed, once, to the recipient's subscribed devices; muted groups were never queued in the first place.
const secretCodes = ['identity.password_recovery', 'admissions.registration_activation', 'staff.invitation', 'student.sharing_invitation'];

export function loadPushConfig(env = process.env) {
  const mode = env.SVU_PUSH || 'disabled';
  if (!['disabled', 'enabled'].includes(mode)) throw new Error('SVU_PUSH must be disabled or enabled.');
  if (mode === 'disabled') return { enabled: false };
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(env.VAPID_PUBLIC_KEY || '') || !/^[A-Za-z0-9_-]{40,50}$/.test(env.VAPID_PRIVATE_KEY || '')) throw new Error('Push needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (run: npx web-push generate-vapid-keys).');
  if (!/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT || '')) throw new Error('Push needs VAPID_SUBJECT (mailto: or https: contact).');
  return { enabled: true, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

// What a push shows: the message subject and the start of its body, plus its in-app link.
export function pushPayload(row) {
  const body = String(row.body || '');
  return JSON.stringify({ id: row.id, title: String(row.subject || 'South Valley University').slice(0, 120), body: body.length > 180 ? `${body.slice(0, 177)}…` : body, link: row.link || '#messages' });
}

export function createPushModule(pool, { push = { enabled: false } } = {}) {
  const enabled = () => { if (!push.enabled) throw requestError(409, 'Push notifications are not available.'); };
  return {
    pushStatus() { return { enabled: Boolean(push.enabled), publicKey: push.enabled ? push.publicKey : null }; },

    async savePushSubscription(input, actor) {
      enabled();
      const endpoint = input?.endpoint, keys = input?.keys || {};
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 800 || !/^[A-Za-z0-9_-]{40,120}$/.test(keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,40}$/.test(keys.auth || ''))
        throw requestError(400, 'That device subscription is not valid.');
      await withTransaction(pool, async (db) => {
        await db.query(`insert into push_subscriptions(id,account_id,endpoint,p256dh,auth,user_agent) values($1,$2,$3,$4,$5,$6)
          on conflict (endpoint) do update set account_id=excluded.account_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,failures=0`,
          [`psb_${randomUUID()}`, actor.accountId, endpoint, keys.p256dh, keys.auth, String(input.userAgent || '').slice(0, 300)]);
        await insertAudit(db, { actorId: actor.accountId, action: 'notification.push_subscribed', subjectType: 'Account', subjectId: actor.accountId, reason: 'Push notifications turned on for a device' });
      });
      return { subscribed: true };
    },
    async deletePushSubscription(input, actor) {
      if (typeof input?.endpoint !== 'string') throw requestError(400, 'Say which device to turn off.');
      const removed = await pool.query('delete from push_subscriptions where endpoint=$1 and account_id=$2', [input.endpoint, actor.accountId]);
      return { subscribed: false, removed: removed.rowCount };
    },
    async myPushDevices(actor) {
      return { enabled: Boolean(push.enabled), devices: (await pool.query('select count(*)::int as n from push_subscriptions where account_id=$1', [actor.accountId])).rows[0].n };
    }
  };
}

// Background sender: recent Inbox messages for people with subscribed devices, each pushed once.
export function startPushDispatcher(pool, push, { intervalMs = 20000, logger = console, send = webpush.sendNotification.bind(webpush) } = {}) {
  if (!push?.enabled) return { stop() {} };
  webpush.setVapidDetails(push.subject, push.publicKey, push.privateKey);
  // A sweep asked for while one runs waits for that one instead of starting another.
  let inflight = null;
  const sweep = () => inflight ||= run().finally(() => { inflight = null; });
  async function run() {
    try {
      const rows = (await pool.query(`select n.id,n.created_at as "createdAt",n.recipient_account_id as "accountId",n.payload->>'subject' as subject,n.payload->>'body' as body,
          case when n.payload->>'link' ~ '^#[A-Za-z0-9_/?=&.%-]{1,200}$' then n.payload->>'link' end as link
        from notifications n join notification_templates t on t.id=n.template_id
        where n.created_at>now()-interval '30 minutes' and n.recipient_account_id is not null and t.code<>all($1::text[])
          and (not n.payload ? 'sensitive' or n.payload->'sensitive'='false'::jsonb)
          and exists (select 1 from push_subscriptions s where s.account_id=n.recipient_account_id and s.created_at<=n.created_at)
          and not exists (select 1 from push_deliveries d where d.notification_id=n.id)
        order by n.created_at limit 200`, [secretCodes])).rows;
      for (const row of rows) {
        // Claim first so two servers never push the same message twice.
        const claimed = await pool.query('insert into push_deliveries(notification_id,devices) values($1,0) on conflict do nothing', [row.id]);
        if (!claimed.rowCount) continue;
        const devices = (await pool.query('select id,endpoint,p256dh,auth from push_subscriptions where account_id=$1 and created_at<=$2', [row.accountId, row.createdAt])).rows;
        let delivered = 0;
        for (const device of devices) {
          try {
            await send({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, pushPayload(row), { TTL: 3600 });
            delivered++; await pool.query('update push_subscriptions set last_success_at=now(),failures=0 where id=$1', [device.id]);
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) await pool.query('delete from push_subscriptions where id=$1', [device.id]);
            else await pool.query('update push_subscriptions set failures=failures+1 where id=$1', [device.id]);
          }
        }
        await pool.query('update push_deliveries set devices=$2 where notification_id=$1', [row.id, delivered]);
      }
    } catch (error) { logger.error?.('push_sweep_failed', { error: error.message }); }
  }
  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  sweep();
  return { stop: () => clearInterval(timer), sweep };
}
