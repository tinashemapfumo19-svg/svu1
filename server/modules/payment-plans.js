import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, requestError, todayIso, withTransaction } from "../support.js";
import { financialStatus, formatMoney, notifyStudent } from "./student-finance.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
const addDays = (date,days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0,10);

// Instalments: 2-12, strictly later dates from today to a year ahead, positive whole minor units summing to the covered amount.
export function validateInstalments(instalments,coveredAmount,today = todayIso()) {
  if (!Array.isArray(instalments) || instalments.length < 2 || instalments.length > 12) throw requestError(400,"A plan needs 2-12 instalments.");
  const rows = instalments.map((row) => {
    if (!row || Object.keys(row).some((key) => !["dueOn","amountMinor"].includes(key)) || !isDate(row.dueOn) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) {
      throw requestError(400,"Each instalment needs a real due date (YYYY-MM-DD) and a positive whole minor-unit amount.");
    }
    return {dueOn:row.dueOn,amountMinor:row.amountMinor};
  });
  if (rows.some((row,index) => index && row.dueOn <= rows[index - 1].dueOn)) throw requestError(400,"Instalment dates must be in order, one per date.");
  if (rows[0].dueOn < today || rows.at(-1).dueOn > addDays(today,365)) throw requestError(400,"Instalments must fall between today and one year ahead.");
  const total = rows.reduce((sum,row) => sum + row.amountMinor,0);
  if (total !== coveredAmount) throw requestError(400,`Instalments total ${total} but the outstanding charges total ${coveredAmount}.`);
  return rows;
}

const planSelect = `select id::int,student_programme_id as "programmeId",currency,covered_entry_ids as "coveredEntryIds",covered_amount as "coveredAmount",instalments,status,reason,
  requested_by as "requestedBy",requested_at as "requestedAt",reviewed_by as "reviewedBy",reviewed_at as "reviewedAt",review_reason as "reviewReason",cancelled_at as "cancelledAt",cancel_reason as "cancelReason" from payment_plans`;
const shape = (row) => ({...row,coveredEntryIds:row.coveredEntryIds.map(Number),coveredAmount:Number(row.coveredAmount)});

async function programmeFor(db,id,actor,permission) {
  const row = (await db.query(`select sp.id,sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id = sp.intake_id
    join programmes p on p.id = i.programme_id where sp.id = $1 for update of sp`,[id])).rows[0];
  if (!row) throw requestError(404,"Student programme was not found.");
  assertActorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}

// The plan covers every charge in the currency that is outstanding when it is requested; approval re-checks that the
// covered balance has not changed, so a plan always matches the ledger it was approved against.
async function outstandingCharges(db,programmeId,currency) {
  const summary = await financialStatus(db,programmeId);
  return summary.entries.filter((row) => row.entryType === "charge" && row.currency === currency && row.outstanding > 0);
}

export function createPaymentPlansModule(pool) {
  return {
    async listPaymentPlans(programmeId,actor) {
      return withTransaction(pool,async (db) => {
        const programme = (await db.query(`select sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[programmeId])).rows[0];
        if (!programme) throw requestError(404,"Student programme was not found.");
        assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
        const status = await financialStatus(db,programmeId);
        const plans = (await db.query(`${planSelect} where student_programme_id = $1 order by id desc`,[programmeId])).rows.map(shape)
          .map((plan) => ({...plan,standing:status.plans.find((row) => row.id === plan.id)?.standing || null}));
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        return {plans,currencies:status.currencies,accountId:actor.accountId,capabilities:{request:can("finance.adjustment.request"),approve:can("finance.adjustment.approve")}};
      });
    },
    async requestPaymentPlan(programmeId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["currency","instalments","reason"].includes(key)) || !/^[A-Z]{3}$/.test(input.currency ?? "") || !text(input.reason,2000)) {
        throw requestError(400,"Provide the currency, the instalments, and a reason.");
      }
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.request");
        if ((await db.query("select 1 from payment_plans where student_programme_id = $1 and currency = $2 and status in ('requested','approved')",[programmeId,input.currency])).rowCount) {
          throw requestError(409,"A payment plan for this currency is already requested or in force.");
        }
        const charges = await outstandingCharges(db,programmeId,input.currency);
        if (!charges.length) throw requestError(409,"There is no outstanding balance in this currency to cover.");
        const coveredAmount = charges.reduce((sum,row) => sum + row.outstanding,0);
        const instalments = validateInstalments(input.instalments,coveredAmount);
        const row = (await db.query(`insert into payment_plans (student_programme_id,currency,covered_entry_ids,covered_amount,instalments,reason,requested_by) values ($1,$2,$3,$4,$5,$6,$7) returning id::int`,
          [programmeId,input.currency,charges.map((charge) => charge.id),coveredAmount,JSON.stringify(instalments),input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"finance.plan.requested",subjectType:"PaymentPlan",subjectId:String(row.id),reason:input.reason,metadata:{programmeId,currency:input.currency,coveredAmount,instalments:instalments.length}});
        return shape((await db.query(`${planSelect} where id = $1`,[row.id])).rows[0]);
      });
    },
    async reviewPaymentPlan(programmeId,planId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.approve");
        const plan = (await db.query(`${planSelect} where id = $1 and student_programme_id = $2 for update`,[planId,programmeId])).rows.map(shape)[0];
        if (!plan) throw requestError(404,"Payment plan was not found.");
        if (plan.status !== "requested") throw requestError(409,"Only requested plans can be reviewed.");
        if (plan.requestedBy === actor.accountId) throw requestError(403,"A payment plan must be approved by someone other than its requester.");
        if (input.outcome === "approved") {
          const charges = await outstandingCharges(db,programmeId,plan.currency);
          const ids = charges.map((row) => row.id).sort((a,b) => a - b),covered = [...plan.coveredEntryIds].sort((a,b) => a - b);
          if (JSON.stringify(ids) !== JSON.stringify(covered) || charges.reduce((sum,row) => sum + row.outstanding,0) !== plan.coveredAmount) {
            throw requestError(409,"The outstanding balance changed after this plan was requested. Reject it and request a new plan.");
          }
        }
        await db.query("update payment_plans set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[planId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`finance.plan.${input.outcome}`,subjectType:"PaymentPlan",subjectId:String(planId),reason:input.reason,metadata:{programmeId}});
        if (input.outcome === "approved") await notifyStudent(db,programmeId,"finance.plan",async () => ({count:plan.instalments.length,total:formatMoney(plan.currency,plan.coveredAmount),
          firstDue:plan.instalments[0].dueOn,firstAmount:formatMoney(plan.currency,plan.instalments[0].amountMinor)}));
        return shape((await db.query(`${planSelect} where id = $1`,[planId])).rows[0]);
      });
    },
    // Cancelling ends the plan's protection immediately; the ledger itself is untouched.
    async cancelPaymentPlan(programmeId,planId,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A cancellation reason is required.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.request");
        const plan = (await db.query(`${planSelect} where id = $1 and student_programme_id = $2 for update`,[planId,programmeId])).rows[0];
        if (!plan) throw requestError(404,"Payment plan was not found.");
        if (!["requested","approved"].includes(plan.status)) throw requestError(409,"Only requested or approved plans can be cancelled.");
        await db.query("update payment_plans set status = 'cancelled',cancelled_by = $2,cancelled_at = now(),cancel_reason = $3 where id = $1",[planId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.plan.cancelled",subjectType:"PaymentPlan",subjectId:String(planId),reason:input.reason,metadata:{programmeId,fromStatus:plan.status}});
        return shape((await db.query(`${planSelect} where id = $1`,[planId])).rows[0]);
      });
    }
  };
}
