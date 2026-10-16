import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { insertAudit, requestError, withTransaction } from './support.js';

// SMS for urgent notices (docs/SMS_NOTIFICATIONS.md). Off unless SVU_SMS is set. The provider is not yet chosen (D-06):
// 'africastalking' follows Africa's Talking's published messaging API and must be checked with a sandbox account before
// use; 'simulated' (development only) writes each text to a local outbox file and never sends anything.
export const smsTemplates = ['course.deadline_reminder', 'admissions.offer_expiry_reminder', 'finance.hold_notice', 'appointment.cancelled', 'exams.timetable'];
export const dailySmsLimit = 5;
export const normalisePhone = (value) => { const compact = String(value || '').replace(/[\s().-]/g, ''); return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null; };
export const smsText = (row) => { const text = `SVU: ${row.subject}. ${row.body}`.replace(/\s+/g, ' ').trim(); return text.length > 300 ? `${text.slice(0, 297)}...` : text; };
const digest = (accountId, code) => createHash('sha256').update(`${accountId}:${code}`).digest('hex');

export function loadSmsConfig(env = process.env) {
  const provider = env.SVU_SMS || 'disabled';
  if (!['disabled', 'africastalking', 'simulated'].includes(provider)) throw new Error('SVU_SMS must be disabled, africastalking or simulated.');
  const runtimeEnv = env.SVU_ENV || env.NODE_ENV || 'development';
  if (provider === 'simulated' && runtimeEnv !== 'development') throw new Error('The simulated SMS provider is only available in development.');
  if (provider === 'africastalking' && (!(env.AT_USERNAME || '').trim() || !(env.AT_API_KEY || '').trim())) throw new Error("Africa's Talking needs AT_USERNAME and AT_API_KEY.");
  return { provider, username: env.AT_USERNAME || null, apiKey: env.AT_API_KEY || null, senderId: env.AT_SENDER_ID || null, outboxDir: env.SVU_DEV_SMS_OUTBOX || 'data/dev-sms' };
}

export function createSmsSender(config, { fetchImpl = fetch } = {}) {
  if (!config || config.provider === 'disabled') return null;
  if (config.provider === 'simulated') return async (to, message) => {
    await mkdir(config.outboxDir, { recursive: true });
    await appendFile(join(config.outboxDir, 'outbox.log'), `${new Date().toISOString()}\t${to}\t${message}\n`);
    return { ok: true, reference: `SIM-${Date.now()}` };
  };
  return async (to, message) => {
    const response = await fetchImpl('https://api.africastalking.com/version1/messaging', { method: 'POST',
      headers: { apiKey: config.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: config.username, to, message, ...(config.senderId ? { from: config.senderId } : {}) }).toString() });
    const body = await response.json().catch(() => ({}));
    const recipient = body?.SMSMessageData?.Recipients?.[0];
    if (!response.ok || !recipient || !['Success', 'Sent'].includes(recipient.status)) return { ok: false, detail: recipient?.status || body?.SMSMessageData?.Message || `HTTP ${response.status}` };
    return { ok: true, reference: recipient.messageId || null };
  };
}

export function createSmsModule(pool, { sms = { provider: 'disabled' }, smsSender } = {}) {
  const send = smsSender !== undefined ? smsSender : createSmsSender(sms);
  const enabled = () => { if (!send) throw requestError(409, 'Text messages are not available.'); };
  const read = async (accountId) => (await pool.query(`select phone_e164 as phone,verified_at as "verifiedAt",enabled,code_expires_at as "codeExpiresAt" from sms_settings where account_id=$1`, [accountId])).rows[0] || null;
  const view = (row) => ({ available: Boolean(send), phone: row?.phone || null, verified: Boolean(row?.verifiedAt), enabled: Boolean(row?.enabled), codePending: Boolean(row?.codeExpiresAt && new Date(row.codeExpiresAt) > new Date() && !row?.verifiedAt) });

  return {
    async getSmsSettings(actor) { return view(await read(actor.accountId)); },

    // Step 1: send a 6-digit code to the number (at most 5 codes a day).
    async requestSmsCode(input, actor) {
      enabled();
      const phone = normalisePhone(input?.phone);
      if (!phone) throw requestError(400, 'Enter a mobile number in international form, for example +263 77 123 4567.');
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      await withTransaction(pool, async (db) => {
        const row = (await db.query('select codes_sent_today,codes_day from sms_settings where account_id=$1 for update', [actor.accountId])).rows[0];
        const sentToday = row && row.codes_day && new Date(row.codes_day).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10) ? row.codes_sent_today : 0;
        if (sentToday >= 5) throw requestError(429, 'Too many codes today. Try again tomorrow.');
        await db.query(`insert into sms_settings(account_id,phone_e164,verified_at,enabled,code_digest,code_expires_at,code_attempts,codes_sent_today,codes_day,updated_at)
          values($1,$2,null,false,$3,now()+interval '10 minutes',0,$4,current_date,now())
          on conflict (account_id) do update set phone_e164=excluded.phone_e164,verified_at=null,enabled=false,code_digest=excluded.code_digest,code_expires_at=excluded.code_expires_at,
            code_attempts=0,codes_sent_today=excluded.codes_sent_today,codes_day=excluded.codes_day,updated_at=now()`, [actor.accountId, phone, digest(actor.accountId, code), sentToday + 1]);
      });
      const result = await send(phone, `SVU: your verification code is ${code}. It expires in 10 minutes.`);
      if (!result.ok) throw requestError(502, 'The code could not be sent. Check the number and try again.');
      return view(await read(actor.accountId));
    },

    // Step 2: confirm the code; texts are then switched on.
    async verifySmsCode(input, actor) {
      enabled();
      const code = String(input?.code || '').replace(/\D/g, '');
      // A wrong code is counted and committed before the error is returned, so the five-attempt limit holds.
      const outcome = await withTransaction(pool, async (db) => {
        const row = (await db.query('select code_digest,code_expires_at,code_attempts from sms_settings where account_id=$1 for update', [actor.accountId])).rows[0];
        if (!row?.code_digest || new Date(row.code_expires_at) < new Date()) return 'expired';
        if (row.code_attempts >= 5) return 'locked';
        const ok = code.length === 6 && timingSafeEqual(Buffer.from(digest(actor.accountId, code)), Buffer.from(row.code_digest));
        if (!ok) { await db.query('update sms_settings set code_attempts=code_attempts+1 where account_id=$1', [actor.accountId]); return 'wrong'; }
        await db.query(`update sms_settings set verified_at=now(),enabled=true,code_digest=null,code_expires_at=null,updated_at=now() where account_id=$1`, [actor.accountId]);
        await insertAudit(db, { actorId: actor.accountId, action: 'notification.sms_verified', subjectType: 'Account', subjectId: actor.accountId, reason: 'Mobile number verified for text messages' });
        return 'verified';
      });
      if (outcome === 'expired') throw requestError(409, 'That code has expired. Send a new one.');
      if (outcome === 'locked') throw requestError(429, 'Too many attempts. Send a new code.');
      if (outcome === 'wrong') throw requestError(400, 'That code is not right.');
      // Read after the commit, so the reply shows the verified number.
      return view(await read(actor.accountId));
    },

    async setSmsEnabled(input, actor) {
      if (typeof input?.enabled !== 'boolean') throw requestError(400, 'Say whether texts are on or off.');
      const row = await read(actor.accountId);
      if (input.enabled && !row?.verifiedAt) throw requestError(409, 'Verify your mobile number first.');
      if (row) await pool.query('update sms_settings set enabled=$2,updated_at=now() where account_id=$1', [actor.accountId, input.enabled]);
      return view(await read(actor.accountId));
    },

    async removeSmsNumber(actor) {
      await pool.query('delete from sms_settings where account_id=$1', [actor.accountId]);
      return view(null);
    }
  };
}

// Background sender: recent allow-listed messages for people with texts on, each texted once, within the daily limit.
export function startSmsDispatcher(pool, sms, { intervalMs = 30000, logger = console, sender } = {}) {
  const send = sender || createSmsSender(sms);
  if (!send) return { stop() {} };
  let inflight = null;
  const sweep = () => inflight ||= run().finally(() => { inflight = null; });
  async function run() {
    try {
      const rows = (await pool.query(`select n.id,n.recipient_account_id as "accountId",n.payload->>'subject' as subject,n.payload->>'body' as body,s.phone_e164 as phone
        from notifications n join notification_templates t on t.id=n.template_id join sms_settings s on s.account_id=n.recipient_account_id and s.enabled and s.verified_at is not null and n.created_at>=s.verified_at
        where n.created_at>now()-interval '30 minutes' and t.code=any($1::text[]) and (not n.payload ? 'sensitive' or n.payload->'sensitive'='false'::jsonb)
          and not exists (select 1 from sms_deliveries d where d.notification_id=n.id) order by n.created_at limit 100`, [smsTemplates])).rows;
      for (const row of rows) {
        const today = (await pool.query(`select count(*)::int as n from sms_deliveries where account_id=$1 and status='sent' and sent_at>now()-interval '1 day'`, [row.accountId])).rows[0].n;
        const claimed = await pool.query(`insert into sms_deliveries(notification_id,account_id,status,detail) values($1,$2,$3,$4) on conflict do nothing`,
          [row.id, row.accountId, today >= dailySmsLimit ? 'skipped' : 'sent', today >= dailySmsLimit ? 'Daily text limit reached' : null]);
        if (!claimed.rowCount || today >= dailySmsLimit) continue;
        const result = await send(row.phone, smsText(row)).catch((error) => ({ ok: false, detail: error.message }));
        if (!result.ok) await pool.query(`update sms_deliveries set status='failed',detail=$2 where notification_id=$1`, [row.id, String(result.detail || 'Failed').slice(0, 300)]);
      }
    } catch (error) { logger.error?.('sms_sweep_failed', { error: error.message }); }
  }
  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  sweep();
  return { stop: () => clearInterval(timer), sweep };
}
