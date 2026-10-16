import { randomUUID } from "node:crypto";
import { queueNotification } from "../notification-queue.js";
import { applyActiveSponsorships } from "./sponsorships.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";

const maxAmount = 10_000_000_000;
const isAmount = (value) => Number.isSafeInteger(value) && value > 0 && value <= maxAmount;
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function validateFeeSchedule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["programmeId","yearOfStudy","term","currency","effectiveFrom","dueDays","lines","reason"].includes(key))
    || !text(input.programmeId,100) || !Number.isInteger(input.yearOfStudy) || input.yearOfStudy < 1 || input.yearOfStudy > 8 || !["S1","S2","S3"].includes(input.term)
    || !/^[A-Z]{3}$/.test(input.currency ?? "") || !Number.isInteger(input.dueDays) || input.dueDays < 0 || input.dueDays > 365 || !text(input.reason,2000)
    || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 20) throw requestError(400,"Provide programme, study year, term, currency, effective date, due days, 1-20 charge lines, and a reason.");
  const lines = input.lines.map((line) => {
    if (!line || Object.keys(line).some((key) => !["chargeCode","description","amountMinor"].includes(key)) || !/^[A-Z][A-Z0-9_]{1,39}$/.test(line.chargeCode ?? "")
      || !text(line.description,200) || !isAmount(line.amountMinor)) throw requestError(400,"Each charge line needs a charge code, description, and positive whole minor-unit amount.");
    return {chargeCode:line.chargeCode,description:line.description.trim(),amountMinor:line.amountMinor};
  });
  if (new Set(lines.map((line) => line.chargeCode)).size !== lines.length) throw requestError(400,"Each charge code may appear once per schedule.");
  return {effectiveFrom:parseEffectiveDate(input.effectiveFrom),lines};
}

export function validatePayment(input,today = todayIso()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["currency","amountMinor","method","externalRef","receivedOn","reason"].includes(key))
    || !/^[A-Z]{3}$/.test(input.currency ?? "") || !isAmount(input.amountMinor) || !["bank","mobile_money","cash"].includes(input.method)
    || !text(input.externalRef,120) || !text(input.reason,2000) || !input.receivedOn) throw requestError(400,"Provide currency, positive whole minor-unit amount, method, external reference, received date, and reason.");
  const receivedOn = parseEffectiveDate(input.receivedOn);
  if (receivedOn > today) throw requestError(400,"A payment cannot be received in the future.");
  return {receivedOn,externalRef:input.externalRef.trim()};
}

// Oldest payment credit settles the earliest-due charge first; overpayment stays as unallocated credit.
export function allocateFifo(charges,payments) {
  const open = charges.filter((row) => row.outstanding > 0).map((row) => ({...row})).sort((a,b) => a.dueOn.localeCompare(b.dueOn) || a.id - b.id);
  const credit = payments.filter((row) => row.unallocated > 0).map((row) => ({...row})).sort((a,b) => a.id - b.id);
  const allocations = [];
  for (const payment of credit) for (const charge of open) {
    if (!payment.unallocated) break;
    const amount = Math.min(payment.unallocated,charge.outstanding);
    if (!amount) continue;
    allocations.push({paymentEntryId:payment.id,chargeEntryId:charge.id,amountMinor:amount});
    payment.unallocated -= amount; charge.outstanding -= amount;
  }
  return allocations;
}

// A plan is judged by what has been paid against its covered charges (the covered amount minus what is still
// outstanding on them) compared with the instalments due by today. Settling the covered amount completes it.
export function planStanding(plan,rows,today = todayIso()) {
  const outstanding = rows.filter((row) => row.entryType === "charge" && plan.coveredEntryIds.includes(row.id)).reduce((sum,row) => sum + row.outstanding,0);
  const paid = Math.max(plan.coveredAmount - outstanding,0);
  const due = plan.instalments.filter((row) => row.dueOn <= today);
  const requiredToDate = due.reduce((sum,row) => sum + row.amountMinor,0);
  const next = plan.instalments.find((row) => row.dueOn > today) || null;
  const status = paid >= plan.coveredAmount ? "completed" : paid >= requiredToDate ? "current" : "in_arrears";
  return {status,paid,requiredToDate,arrears:Math.max(requiredToDate - paid,0),outstanding,nextInstalment:next};
}

// Payments and approved adjustment credits both settle charges; refunds and manual debits are charges. Charges covered by
// an approved payment plan that is current do not raise the hold; a plan in arrears does not protect them.
export function accountSummary(entries,allocations,today = todayIso(),exemption = null,plans = []) {
  const applied = (key,id) => allocations.filter((row) => row[key] === id).reduce((sum,row) => sum + row.amountMinor,0);
  const rows = entries.map((entry) => entry.entryType === "charge" ? {...entry,outstanding:entry.amountMinor - applied("chargeEntryId",entry.id)} : {...entry,unallocated:entry.amountMinor - applied("paymentEntryId",entry.id)});
  const currencies = [...new Set(rows.map((row) => row.currency))].sort().map((currency) => {
    const own = rows.filter((row) => row.currency === currency),charges = own.filter((row) => row.entryType === "charge"),payments = own.filter((row) => row.entryType === "payment"),credits = own.filter((row) => row.entryType === "credit");
    const total = (list) => list.reduce((sum,row) => sum + row.amountMinor,0),charged = total(charges),paid = total(payments),credited = total(credits);
    return {currency,charged,paid,credited,balance:charged - paid - credited,due:charges.filter((row) => row.dueOn <= today).reduce((sum,row) => sum + row.outstanding,0),credit:[...payments,...credits].reduce((sum,row) => sum + row.unallocated,0)};
  });
  const standings = plans.map((plan) => ({...plan,standing:planStanding(plan,rows,today)}));
  const protectedIds = new Set(standings.filter((plan) => plan.standing.status === "current").flatMap((plan) => plan.coveredEntryIds));
  const reasons = rows.filter((row) => row.entryType === "charge" && row.outstanding > 0 && row.dueOn <= today && !protectedIds.has(row.id))
    .map((row) => ({entryId:row.id,currency:row.currency,amountMinor:row.outstanding,dueOn:row.dueOn,message:`${row.description} has ${row.currency} ${(row.outstanding / 100).toFixed(2)} outstanding, due ${row.dueOn}.`}));
  const exempt = Boolean(exemption && reasons.length && exemption.expiresOn >= today);
  return {entries:rows,currencies,hold:{held:reasons.length > 0 && !exempt,reasons,exemption:exempt ? exemption : null},plans:standings};
}

const entrySelect = `select e.id::int,e.entry_type as "entryType",e.currency,e.amount_minor as "amountMinor",e.charge_code as "chargeCode",e.description,to_char(e.due_on,'YYYY-MM-DD') as "dueOn",
  e.registration_period_id as "registrationPeriodId",e.billing_run_id::int as "billingRunId",e.payment_id::int as "paymentId",e.adjustment_id::int as "adjustmentId",e.recorded_at as "recordedAt",
  p.method,p.external_ref as "externalRef",to_char(p.received_on,'YYYY-MM-DD') as "receivedOn" from ledger_entries e left join student_payments p on p.id = e.payment_id`;

export async function ledgerFor(db,programmeId) {
  const entries = (await db.query(`${entrySelect} where e.student_programme_id = $1 order by e.id`,[programmeId])).rows.map((row) => ({...row,amountMinor:Number(row.amountMinor)}));
  const allocations = (await db.query(`select a.payment_entry_id::int as "paymentEntryId",a.charge_entry_id::int as "chargeEntryId",a.amount_minor as "amountMinor" from ledger_allocations a
    join ledger_entries e on e.id = a.charge_entry_id where e.student_programme_id = $1 order by a.id`,[programmeId])).rows.map((row) => ({...row,amountMinor:Number(row.amountMinor)}));
  return {entries,allocations};
}

export async function financialStatus(db,programmeId,today = todayIso()) {
  const {entries,allocations} = await ledgerFor(db,programmeId);
  const exemption = (await db.query(`select id::int,to_char(expires_on,'YYYY-MM-DD') as "expiresOn",review_reason as reason from finance_adjustments
    where student_programme_id = $1 and kind = 'hold_exemption' and status = 'approved' and expires_on >= $2::date order by expires_on desc limit 1`,[programmeId,today])).rows[0] || null;
  const plans = (await db.query(`select id::int,currency,covered_entry_ids as "coveredEntryIds",covered_amount as "coveredAmount",instalments,to_char(reviewed_at,'YYYY-MM-DD') as "approvedOn"
    from payment_plans where student_programme_id = $1 and status = 'approved' order by id`,[programmeId])).rows
    .map((row) => ({...row,coveredEntryIds:row.coveredEntryIds.map(Number),coveredAmount:Number(row.coveredAmount)}));
  return accountSummary(entries,allocations,today,exemption,plans);
}

export async function allocateProgramme(db,programmeId) {
  const {entries,allocations} = await ledgerFor(db,programmeId);
  const summary = accountSummary(entries,allocations);
  const created = [];
  for (const {currency} of summary.currencies) {
    const own = summary.entries.filter((row) => row.currency === currency);
    for (const row of allocateFifo(own.filter((entry) => entry.entryType === "charge"),own.filter((entry) => entry.entryType !== "charge"))) {
      await db.query("insert into ledger_allocations (payment_entry_id,charge_entry_id,amount_minor) values ($1,$2,$3)",[row.paymentEntryId,row.chargeEntryId,row.amountMinor]);
      created.push(row);
    }
  }
  return created;
}

// Serialises on the (method, reference) pair so concurrent replays see each other; call inside the posting transaction.
export async function paymentReferenceExists(db,method,externalRef) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))",[`payment:${method}:${externalRef}`]);
  return (await db.query("select 1 from student_payments where method = $1 and external_ref = $2",[method,externalRef])).rowCount > 0;
}

export async function postPayment(db,programme,payment,actorId) {
  const row = (await db.query(`insert into student_payments (student_programme_id,currency,amount_minor,method,external_ref,received_on,reason,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [programme.id,payment.currency,payment.amountMinor,payment.method,payment.externalRef,payment.receivedOn,payment.reason,actorId])).rows[0];
  await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,description,payment_id,actor_id) values ($1,'payment',$2,$3,$4,$5,$6)`,
    [programme.id,payment.currency,payment.amountMinor,payment.method === "online" ? `Online payment ${`RCT-${String(row.id).padStart(8,"0")}`}` : `Payment ${payment.method.replace("_"," ")} ${payment.externalRef}`,row.id,actorId]);
  const allocations = await allocateProgramme(db,programme.id);
  const receiptNumber = `RCT-${String(row.id).padStart(8,"0")}`;
  await notifyStudent(db,programme.id,"finance.payment_receipt",async (summary) => ({receiptNumber,amount:formatMoney(payment.currency,payment.amountMinor),method:payment.method.replace("_"," "),externalRef:payment.externalRef,receivedOn:payment.receivedOn,
    currency:payment.currency,balance:formatMoney(payment.currency,summary.currencies.find((entry) => entry.currency === payment.currency)?.balance ?? 0)}));
  await insertAudit(db,{actorId,action:"finance.payment.recorded",subjectType:"StudentPayment",subjectId:String(row.id),reason:payment.reason,
    metadata:{programmeId:programme.id,studentNumber:programme.studentNumber,currency:payment.currency,amountMinor:payment.amountMinor,method:payment.method,externalRef:payment.externalRef,receiptNumber,allocations:allocations.length,importRef:payment.importRef ?? null}});
  return {id:row.id,receiptNumber,allocations};
}

export const formatMoney = (currency,minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;

export async function notifyStudent(db,programmeId,templateCode,variables) {
  const student = (await db.query("select s.account_id as \"accountId\",s.student_number as \"studentNumber\" from student_programmes sp join students s on s.id = sp.student_id where sp.id = $1",[programmeId])).rows[0];
  const summary = await financialStatus(db,programmeId);
  await queueNotification(db,student.accountId,templateCode,{studentNumber:student.studentNumber,...await variables(summary)},{link:'#office/fees'});
}

export async function assertActiveReference(db,list,code,message) {
  const found = await db.query("select 1 from reference_values where list_code = $1 and value_code = $2 and status = 'active' and (effective_from is null or effective_from <= current_date) and (effective_to is null or effective_to >= current_date)",[list,code]);
  if (!found.rowCount) throw requestError(400,message);
}

export async function studentProgramme(db,id,actor,own,lock = false) {
  const row = (await db.query(`select sp.id,sp.status,sp.intake_id as "intakeId",i.programme_id as "programmeId",p.code as "programmeCode",s.account_id as "accountId",s.student_number as "studentNumber"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}

const scheduleSelect = `select id,programme_id as "programmeId",year_of_study as "yearOfStudy",term,currency,to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",due_days as "dueDays",lines,status,reason,
  created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt",publish_reason as "publishReason" from fee_schedules`;

async function catalogueProgramme(db,programmeId,actor) {
  const row = (await db.query(`select id,code from programmes where id = $1`,[programmeId])).rows[0];
  if (!row) throw requestError(404,"Programme was not found.");
  assertActorCanAccessScope(actor,{programmeCode:row.code});
  return row;
}

export function createStudentFinanceModule(pool) {
  return {
    async listFeeSchedules(filters,actor) {
      return withTransaction(pool,async (db) => {
        await catalogueProgramme(db,filters.programmeId,actor);
        return (await db.query(`${scheduleSelect} where programme_id = $1 order by year_of_study,term,effective_from desc,created_at desc`,[filters.programmeId])).rows;
      });
    },
    async createFeeSchedule(input,actor) {
      const {effectiveFrom,lines} = validateFeeSchedule(input);
      return withTransaction(pool,async (db) => {
        await catalogueProgramme(db,input.programmeId,actor);
        await assertActiveReference(db,"currency",input.currency,"Select an active currency.");
        for (const line of lines) await assertActiveReference(db,"charge_type",line.chargeCode,`${line.chargeCode} is not an active charge type.`);
        const id = `fee_${randomUUID()}`;
        await db.query(`insert into fee_schedules (id,programme_id,year_of_study,term,currency,effective_from,due_days,lines,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id,input.programmeId,input.yearOfStudy,input.term,input.currency,effectiveFrom,input.dueDays,JSON.stringify(lines),input.reason.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.schedule.drafted",subjectType:"FeeSchedule",subjectId:id,reason:input.reason,metadata:{programmeId:input.programmeId,yearOfStudy:input.yearOfStudy,term:input.term,currency:input.currency,effectiveFrom,total:lines.reduce((sum,line) => sum + line.amountMinor,0)}});
        return (await db.query(`${scheduleSelect} where id = $1`,[id])).rows[0];
      });
    },
    async publishFeeSchedule(id,input,actor) {
      if (!input || !text(input.reason,2000) || Object.keys(input).some((key) => key !== "reason")) throw requestError(400,"A publication reason is required.");
      return withTransaction(pool,async (db) => {
        const schedule = (await db.query(`${scheduleSelect} where id = $1 for update`,[id])).rows[0];
        if (!schedule) throw requestError(404,"Fee schedule was not found.");
        await catalogueProgramme(db,schedule.programmeId,actor);
        if (schedule.status !== "draft") throw requestError(409,"Only draft fee schedules can be published.");
        assertSeparateApprover(schedule.createdBy,actor);
        if ((await db.query("select 1 from fee_schedules where status = 'published' and programme_id = $1 and year_of_study = $2 and term = $3 and currency = $4 and effective_from = $5",
          [schedule.programmeId,schedule.yearOfStudy,schedule.term,schedule.currency,schedule.effectiveFrom])).rowCount) throw requestError(409,"A published schedule already covers this programme, year, term, currency, and date. Publish a later effective date instead.");
        await db.query("update fee_schedules set status = 'published',published_by = $2,published_at = now(),publish_reason = $3 where id = $1",[id,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.schedule.published",subjectType:"FeeSchedule",subjectId:id,reason:input.reason,metadata:{programmeId:schedule.programmeId,effectiveFrom:schedule.effectiveFrom}});
        return (await db.query(`${scheduleSelect} where id = $1`,[id])).rows[0];
      });
    },
    async runBilling(input,actor) {
      if (!input || Object.keys(input).some((key) => !["registrationPeriodId","reason"].includes(key)) || !text(input.registrationPeriodId,100) || !text(input.reason,2000)) throw requestError(400,"Provide the registration period and a billing reason.");
      return withTransaction(pool,async (db) => {
        const period = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.year_of_study as "yearOfStudy",rp.term,rp.status,i.programme_id as "programmeId",p.code as "programmeCode",
          ap.name,to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn" from registration_periods rp join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id
          join academic_periods ap on ap.id = rp.academic_period_id where rp.id = $1 for update of rp`,[input.registrationPeriodId])).rows[0];
        if (!period) throw requestError(404,"Registration period was not found.");
        assertActorCanAccessScope(actor,{programmeCode:period.programmeCode,intakeId:period.intakeId});
        if (period.status === "closed") throw requestError(409,"Closed registration periods cannot be billed.");
        const candidates = (await db.query(`${scheduleSelect} where status = 'published' and programme_id = $1 and year_of_study = $2 and term = $3 and effective_from <= $4::date order by effective_from desc`,
          [period.programmeId,period.yearOfStudy,period.term,period.startsOn])).rows;
        if (!candidates.length) throw requestError(409,"No published fee schedule applies to this programme, study year, term, and period start.");
        if (candidates.filter((row) => row.effectiveFrom === candidates[0].effectiveFrom).length > 1) throw requestError(409,"More than one currency schedule applies. Retire or supersede one before billing.");
        const schedule = candidates[0];
        const dueOn = new Date(Date.parse(`${period.startsOn}T00:00:00Z`) + schedule.dueDays * 86_400_000).toISOString().slice(0,10);
        const students = (await db.query("select id from student_programmes where intake_id = $1 and status = 'onboarded' order by id for update",[period.intakeId])).rows;
        const run = (await db.query("insert into billing_runs (registration_period_id,fee_schedule_id,reason,run_by,charges_created,amount_minor) values ($1,$2,$3,$4,0,0) returning id",
          [period.id,schedule.id,input.reason.trim(),actor.accountId])).rows[0];
        let created = 0,amount = 0;
        for (const student of students) {
          for (const line of schedule.lines) {
            const inserted = await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,charge_code,description,due_on,registration_period_id,billing_run_id,actor_id)
              values ($1,'charge',$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,[student.id,schedule.currency,line.amountMinor,line.chargeCode,`${line.description} - ${period.name}`,dueOn,period.id,run.id,actor.accountId]);
            created += inserted.rowCount; amount += inserted.rowCount * line.amountMinor;
          }
          // Approved sponsorships cover new charges straight away (a sponsor credit plus a sponsor receivable).
          await applyActiveSponsorships(db,student.id,actor.accountId);
          await allocateProgramme(db,student.id);
          const billed = schedule.lines.length && (await db.query("select coalesce(sum(amount_minor),0)::bigint as total from ledger_entries where billing_run_id = $1 and student_programme_id = $2",[run.id,student.id])).rows[0].total;
          if (Number(billed)) await notifyStudent(db,student.id,"finance.charges_billed",async () => ({amount:formatMoney(schedule.currency,billed),periodName:period.name,dueOn}));
        }
        await db.query("update billing_runs set charges_created = $2,amount_minor = $3 where id = $1",[run.id,created,amount]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.billing.run",subjectType:"BillingRun",subjectId:String(run.id),reason:input.reason,metadata:{registrationPeriodId:period.id,feeScheduleId:schedule.id,students:students.length,chargesCreated:created,amountMinor:amount,currency:schedule.currency}});
        return {id:run.id,feeScheduleId:schedule.id,currency:schedule.currency,students:students.length,chargesCreated:created,amountMinor:amount,dueOn};
      });
    },
    async recordStudentPayment(programmeId,input,actor) {
      const {receivedOn,externalRef} = validatePayment(input);
      return withTransaction(pool,async (db) => {
        const programme = await studentProgramme(db,programmeId,actor,false,true);
        await assertActiveReference(db,"currency",input.currency,"Select an active currency.");
        if (await paymentReferenceExists(db,input.method,externalRef)) throw requestError(409,"This payment reference has already been recorded.");
        const posted = await postPayment(db,programme,{...input,externalRef,receivedOn,reason:input.reason.trim()},actor.accountId);
        return {...posted,status:await financialStatus(db,programmeId)};
      });
    },
    async getStudentAccount(programmeId,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await studentProgramme(db,programmeId,actor,own);
        const summary = await financialStatus(db,programmeId);
        const {entries,allocations} = await ledgerFor(db,programmeId);
        const result = {programmeId,studentNumber:programme.studentNumber,...summary,allocations:allocations.filter((row) => entries.some((entry) => entry.id === row.chargeEntryId))};
        if (own) return result;
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        const schedules = (await db.query(`${scheduleSelect} where programme_id = $1 order by year_of_study,term,effective_from desc`,[programme.programmeId])).rows;
        const periods = (await db.query(`select rp.id,rp.year_of_study as "yearOfStudy",rp.term,rp.status,ap.name,to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",
          coalesce((select json_agg(json_build_object('id',b.id,'chargesCreated',b.charges_created,'amountMinor',b.amount_minor,'runAt',b.run_at) order by b.id desc) from billing_runs b where b.registration_period_id = rp.id),'[]'::json) as "billingRuns"
          from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id where rp.intake_id = $1 order by ap.starts_on`,[programme.intakeId])).rows;
        return {...result,catalogueProgrammeId:programme.programmeId,schedules,periods,accountId:actor.accountId,
          capabilities:{manageSchedules:can("finance.schedule.manage"),publishSchedules:can("finance.schedule.publish"),runBilling:can("finance.billing.run"),recordPayment:can("finance.payment.record")}};
      });
    }
  };
}
