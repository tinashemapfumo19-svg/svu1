import { randomUUID } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { createPaymentProvider } from '../payment-gateway.js';
import { financialStatus, paymentReferenceExists, postPayment, studentProgramme } from './student-finance.js';

// Online fee payments (docs/ONLINE_PAYMENTS.md). A checkout records an intent, the provider takes the money, and only a
// verified "paid" update for the exact amount posts the payment, through the same path as a cashier-recorded payment.
export const minimumOnlineMinor = 100;
const finalStatuses = ['paid', 'failed', 'cancelled', 'expired'];
const today = () => new Date().toISOString().slice(0, 10);

export function createOnlinePaymentsModule(pool, { payments = null, paymentProvider } = {}) {
  const provider = paymentProvider !== undefined ? paymentProvider : createPaymentProvider(payments);
  const enabled = () => { if (!provider) throw requestError(409, 'Online payment is not available yet.'); };
  const select = `select id,student_programme_id as "programmeId",account_id as "accountId",currency,amount_minor::int as "amountMinor",provider,provider_reference as "providerReference",
    poll_url as "pollUrl",status,status_detail as "statusDetail",payment_id as "paymentId",created_at as "createdAt" from payment_intents`;
  const view = (row) => ({ id: row.id, currency: row.currency, amountMinor: row.amountMinor, status: row.status, detail: row.statusDetail, createdAt: row.createdAt, receiptNumber: row.paymentId ? `RCT-${String(row.paymentId).padStart(8, '0')}` : null });

  // Apply a provider update once. A "paid" update must match the intent's amount, or the intent fails for review.
  async function apply(intentId, update, actorId) {
    return withTransaction(pool, async (db) => {
      const intent = (await db.query(`${select} where id=$1 for update`, [intentId])).rows[0];
      if (!intent) throw requestError(404, 'Payment was not found.');
      if (finalStatuses.includes(intent.status) || !update || update.status === intent.status) return intent;
      if (update.status === 'paid') {
        if (update.amountMinor !== undefined && update.amountMinor !== intent.amountMinor) {
          await db.query(`update payment_intents set status='failed',status_detail=$2,updated_at=now() where id=$1`, [intentId, 'Amount confirmed by the provider does not match; Finance must review.']);
          await insertAudit(db, { actorId, action: 'finance.online_payment.mismatch', subjectType: 'PaymentIntent', subjectId: intentId, reason: 'Provider amount differs from checkout amount', metadata: { expected: intent.amountMinor, received: update.amountMinor } });
          return { ...intent, status: 'failed' };
        }
        const programme = await studentProgramme(db, intent.programmeId, { accountId: intent.accountId }, true, true);
        if (await paymentReferenceExists(db, 'online', intent.id)) return intent;
        const posted = await postPayment(db, programme, { currency: intent.currency, amountMinor: intent.amountMinor, method: 'online', externalRef: intent.id, receivedOn: today(),
          reason: `Online payment via ${intent.provider}${update.providerReference ? ` (${update.providerReference})` : ''}` }, intent.accountId);
        await db.query(`update payment_intents set status='paid',payment_id=$2,provider_reference=coalesce($3,provider_reference),status_detail=$4,updated_at=now() where id=$1`, [intentId, posted.id, update.providerReference || null, update.detail || 'Paid']);
        return { ...intent, status: 'paid', paymentId: posted.id };
      }
      await db.query('update payment_intents set status=$2,status_detail=$3,updated_at=now() where id=$1', [intentId, update.status, update.detail || null]);
      if (['failed', 'cancelled'].includes(update.status)) await insertAudit(db, { actorId, action: `finance.online_payment.${update.status}`, subjectType: 'PaymentIntent', subjectId: intentId, reason: update.detail || update.status });
      return { ...intent, status: update.status };
    });
  }

  return {
    onlinePaymentsStatus() { return { enabled: Boolean(provider), provider: provider?.name || null, minimumMinor: minimumOnlineMinor }; },

    async startCheckout(programmeId, input, actor) {
      enabled();
      const amountMinor = input?.amountMinor, currency = input?.currency;
      if (!Number.isInteger(amountMinor) || amountMinor < minimumOnlineMinor || !/^[A-Z]{3}$/.test(currency || '')) throw requestError(400, 'Choose an amount of at least 1.00.');
      const intent = await withTransaction(pool, async (db) => {
        const programme = await studentProgramme(db, programmeId, actor, true, true);
        const balance = (await financialStatus(db, programmeId)).currencies.find((row) => row.currency === currency)?.balance || 0;
        if (balance <= 0) throw requestError(409, `There is nothing to pay in ${currency}.`);
        if (amountMinor > balance) throw requestError(400, `You can pay up to your balance of ${(balance / 100).toFixed(2)} ${currency}.`);
        await db.query(`update payment_intents set status='expired',updated_at=now() where student_programme_id=$1 and status in ('created','pending') and created_at<now()-interval '1 day'`, [programmeId]);
        const id = `pay_${randomUUID()}`;
        await db.query('insert into payment_intents(id,student_programme_id,account_id,currency,amount_minor,provider) values($1,$2,$3,$4,$5,$6)', [id, programmeId, actor.accountId, currency, amountMinor, provider.name]);
        await insertAudit(db, { actorId: actor.accountId, action: 'finance.online_payment.started', subjectType: 'PaymentIntent', subjectId: id, reason: 'Student started an online payment', metadata: { programmeId, currency, amountMinor } });
        return { id, amountMinor, currency, studentNumber: programme.studentNumber };
      });
      let started;
      try { started = await provider.initiate(intent, { email: '' }); }
      catch (error) { await apply(intent.id, { status: 'failed', detail: error.message }, actor.accountId); throw requestError(502, error.message || 'The payment provider is unavailable.'); }
      await pool.query(`update payment_intents set status='pending',poll_url=$2,updated_at=now() where id=$1`, [intent.id, started.pollUrl]);
      return { id: intent.id, redirectUrl: started.redirectUrl };
    },

    // The student's view after returning from the provider; asks the provider for news while still pending.
    async getPaymentIntent(intentId, actor) {
      const row = (await pool.query(`${select} where id=$1`, [intentId])).rows[0];
      if (!row || row.accountId !== actor.accountId) throw requestError(404, 'Payment was not found.');
      let current = row;
      if (provider && !finalStatuses.includes(row.status) && row.pollUrl && provider.poll) {
        try {
          const update = await provider.poll(row);
          if (update && update.reference === row.id) current = await apply(row.id, update, actor.accountId);
        } catch { /* provider unreachable: show the last known status */ }
      }
      return view(current);
    },

    async listMyPayments(programmeId, actor) {
      await withTransaction(pool, (db) => studentProgramme(db, programmeId, actor, true));
      return { enabled: Boolean(provider), provider: provider?.name || null, items: (await pool.query(`${select} where student_programme_id=$1 order by created_at desc limit 10`, [programmeId])).rows.map(view) };
    },

    // Paynow's result callback. Unverified or unknown updates are ignored; the reply is always plain "ok".
    async paymentProviderResult(fields) {
      if (!provider || provider.name !== 'paynow' || !provider.verify(fields)) return false;
      const update = provider.read(fields);
      if (!/^pay_[0-9a-f-]{36}$/.test(update.reference || '')) return false;
      const intent = (await pool.query(`${select} where id=$1`, [update.reference])).rows[0];
      if (!intent) return false;
      await apply(intent.id, update, intent.accountId);
      return true;
    },

    // Development only: the simulated gateway page settles a checkout.
    async simulatePaymentOutcome(intentId, input, actor) {
      if (provider?.name !== 'simulated') throw requestError(404, 'Not found.');
      const row = (await pool.query(`${select} where id=$1`, [intentId])).rows[0];
      if (!row || row.accountId !== actor.accountId) throw requestError(404, 'Payment was not found.');
      if (!['paid', 'cancelled', 'failed'].includes(input?.outcome)) throw requestError(400, 'Choose paid, cancelled or failed.');
      return view(await apply(intentId, { status: input.outcome, amountMinor: row.amountMinor, providerReference: `SIM-${intentId.slice(4, 12)}`, detail: `Simulated ${input.outcome}` }, actor.accountId));
    }
  };
}
