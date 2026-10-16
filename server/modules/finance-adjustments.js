import { createHash } from "node:crypto";
import { actorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { accountSummary, allocateProgramme, assertActiveReference, formatMoney, ledgerFor, notifyStudent, studentProgramme } from "./student-finance.js";

export const creditKinds = ["waiver","scholarship","write_off"];
const kinds = [...creditKinds,"debit","refund","hold_exemption"];
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const addDays = (date,days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0,10);

export function validateAdjustment(input,today = todayIso()) {
  const allowed = ["kind","currency","amountMinor","targetEntryId","description","dueOn","expiresOn","evidenceHash","reason","evidenceRef"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key)) || !kinds.includes(input.kind)
    || !/^[0-9a-f]{64}$/.test(input.evidenceHash ?? "") || !text(input.reason,2000) || !text(input.evidenceRef,300)) throw requestError(400,"Choose an adjustment type and provide current ledger evidence, a reason, and an evidence reference.");
  const present = (key) => input[key] !== undefined && input[key] !== null && input[key] !== "";
  if (input.kind === "hold_exemption") {
    if (["currency","amountMinor","targetEntryId","description","dueOn"].some(present) || !input.expiresOn) throw requestError(400,"A hold exemption needs only an expiry date.");
    const expiresOn = parseEffectiveDate(input.expiresOn);
    if (expiresOn < today || expiresOn > addDays(today,180)) throw requestError(400,"A hold exemption must expire within 180 days.");
    return {expiresOn};
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 10_000_000_000 || present("expiresOn")) throw requestError(400,"Provide a positive whole minor-unit amount.");
  if (creditKinds.includes(input.kind)) {
    if (!Number.isInteger(input.targetEntryId) || ["currency","description","dueOn"].some(present)) throw requestError(400,"A credit adjustment applies to one charge and takes its currency.");
    return {};
  }
  if (!/^[A-Z]{3}$/.test(input.currency ?? "") || present("targetEntryId")) throw requestError(400,"Provide the adjustment currency.");
  if (input.kind === "debit") {
    if (!text(input.description,200) || !input.dueOn) throw requestError(400,"A manual debit needs a description and due date.");
    return {dueOn:parseEffectiveDate(input.dueOn),description:input.description.trim()};
  }
  if (present("description") || present("dueOn")) throw requestError(400,"A refund takes only an amount and currency.");
  return {};
}

export function validateAdjustmentReview(input) {
  if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected","revoked"].includes(input.outcome)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"Choose approve, reject, or revoke and provide a reason.");
}

// Binds the request to the exact ledger state: every entry and its outstanding or unallocated amount.
export function ledgerEvidenceHash(summary) {
  return createHash("sha256").update(JSON.stringify(summary.entries.map((row) => [row.id,row.entryType,row.amountMinor,row.outstanding ?? row.unallocated]).sort((a,b) => a[0] - b[0]))).digest("hex");
}

// Checks the adjustment against the current ledger and returns its effect, or throws a plain-language 409.
export function adjustmentEffect(adjustment,summary) {
  if (creditKinds.includes(adjustment.kind)) {
    const target = summary.entries.find((row) => row.id === Number(adjustment.targetEntryId) && row.entryType === "charge");
    if (!target) throw requestError(404,"Charge to adjust was not found on this account.");
    if (["REFUND","ADJUSTMENT"].includes(target.chargeCode)) throw requestError(409,"Refunds and manual debits cannot be waived; reject them instead.");
    if (adjustment.amountMinor > target.outstanding) throw requestError(409,`The credit exceeds the ${target.currency} ${(target.outstanding / 100).toFixed(2)} outstanding on this charge.`);
    return {currency:target.currency,target};
  }
  if (adjustment.kind === "refund") {
    const credit = summary.currencies.find((row) => row.currency === adjustment.currency)?.credit || 0;
    if (adjustment.amountMinor > credit) throw requestError(409,`A refund cannot exceed the ${adjustment.currency} ${(credit / 100).toFixed(2)} unallocated credit.`);
  }
  if (adjustment.kind === "hold_exemption" && !summary.hold.reasons.length) throw requestError(409,"There is no financial hold to exempt.");
  return {currency:adjustment.currency};
}

const adjustmentSelect = `select id::int,kind,currency,amount_minor as "amountMinor",target_entry_id::int as "targetEntryId",description,to_char(due_on,'YYYY-MM-DD') as "dueOn",
  to_char(expires_on,'YYYY-MM-DD') as "expiresOn",evidence_hash as "evidenceHash",reason,evidence_ref as "evidenceRef",requested_by as "requestedBy",requested_at as "requestedAt",
  status,reviewed_by as "reviewedBy",reviewed_at as "reviewedAt",review_reason as "reviewReason",revoked_by as "revokedBy",revoke_reason as "revokeReason",ledger_entry_id::int as "ledgerEntryId"
  from finance_adjustments`;

async function currentSummary(db,programmeId,today = todayIso()) {
  const {entries,allocations} = await ledgerFor(db,programmeId);
  return accountSummary(entries,allocations,today);
}

export function createFinanceAdjustmentsModule(pool) {
  return {
    async listFinanceAdjustments(programmeId,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await studentProgramme(db,programmeId,actor,own);
        const summary = await currentSummary(db,programmeId);
        const adjustments = (await db.query(`${adjustmentSelect} where student_programme_id = $1 order by id desc`,[programmeId])).rows.map((row) => ({...row,amountMinor:row.amountMinor === null ? null : Number(row.amountMinor)}));
        if (own) return {adjustments:adjustments.filter((row) => row.status !== "requested").map(({id,kind,currency,amountMinor,status,expiresOn,reviewReason,revokeReason}) => ({id,kind,currency,amountMinor,status,expiresOn,reviewReason,revokeReason}))};
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        return {evidenceHash:ledgerEvidenceHash(summary),adjustments,accountId:actor.accountId,capabilities:{request:can("finance.adjustment.request"),approve:can("finance.adjustment.approve")}};
      });
    },
    async requestFinanceAdjustment(programmeId,input,actor) {
      const extra = validateAdjustment(input);
      return withTransaction(pool,async (db) => {
        await studentProgramme(db,programmeId,actor,false,true);
        const summary = await currentSummary(db,programmeId);
        if (input.evidenceHash !== ledgerEvidenceHash(summary)) throw requestError(409,"The student account changed. Reload before requesting an adjustment.");
        if (input.currency) await assertActiveReference(db,"currency",input.currency,"Select an active currency.");
        const {currency} = adjustmentEffect(input,summary);
        if ((await db.query("select 1 from finance_adjustments where student_programme_id = $1 and status = 'requested'",[programmeId])).rowCount) throw requestError(409,"An adjustment for this account is already awaiting independent review.");
        const row = (await db.query(`insert into finance_adjustments (student_programme_id,kind,currency,amount_minor,target_entry_id,description,due_on,expires_on,evidence_hash,reason,evidence_ref,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,[programmeId,input.kind,currency ?? null,input.amountMinor ?? null,input.targetEntryId ?? null,extra.description ?? null,extra.dueOn ?? null,extra.expiresOn ?? null,
          input.evidenceHash,input.reason.trim(),input.evidenceRef.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"finance.adjustment.requested",subjectType:"FinanceAdjustment",subjectId:String(row.id),reason:input.reason,
          metadata:{programmeId,kind:input.kind,currency:currency ?? null,amountMinor:input.amountMinor ?? null,targetEntryId:input.targetEntryId ?? null,expiresOn:extra.expiresOn ?? null,evidenceHash:input.evidenceHash}});
        return {id:row.id,status:"requested"};
      });
    },
    async reviewFinanceAdjustment(programmeId,adjustmentId,input,actor) {
      validateAdjustmentReview(input);
      return withTransaction(pool,async (db) => {
        await studentProgramme(db,programmeId,actor,false,true);
        const adjustment = (await db.query(`${adjustmentSelect} where id = $1 and student_programme_id = $2 for update`,[adjustmentId,programmeId])).rows[0];
        if (!adjustment) throw requestError(404,"Adjustment was not found.");
        adjustment.amountMinor = adjustment.amountMinor === null ? null : Number(adjustment.amountMinor);
        if (input.outcome === "revoked") {
          if (adjustment.kind !== "hold_exemption" || adjustment.status !== "approved") throw requestError(409,"Only approved hold exemptions can be revoked; ledger adjustments need a new reviewed adjustment.");
          await db.query("update finance_adjustments set status = 'revoked',revoked_by = $2,revoked_at = now(),revoke_reason = $3 where id = $1",[adjustment.id,actor.accountId,input.reason.trim()]);
          await notifyStudent(db,programmeId,"finance.adjustment_decided",async () => ({kind:"hold exemption",amountText:"",outcome:"revoked",reason:input.reason.trim()}));
          await insertAudit(db,{actorId:actor.accountId,action:"finance.adjustment.revoked",subjectType:"FinanceAdjustment",subjectId:String(adjustment.id),reason:input.reason,metadata:{programmeId,kind:adjustment.kind}});
          return {id:adjustment.id,status:"revoked"};
        }
        if (adjustment.status !== "requested") throw requestError(409,"Reviewed adjustments are immutable.");
        assertSeparateApprover(adjustment.requestedBy,actor);
        let ledgerEntryId = null;
        if (input.outcome === "approved") {
          const summary = await currentSummary(db,programmeId);
          if (ledgerEvidenceHash(summary) !== adjustment.evidenceHash) throw requestError(409,"The student account changed after this request. Reject it and request a fresh adjustment.");
          if (adjustment.kind === "hold_exemption" && adjustment.expiresOn < todayIso()) throw requestError(409,"This hold exemption has already expired. Reject it and request a fresh one.");
          const {target} = adjustmentEffect(adjustment,summary);
          const label = {waiver:"Fee waiver",scholarship:"Scholarship",write_off:"Write-off",refund:"Refund paid out"}[adjustment.kind];
          if (target) {
            ledgerEntryId = (await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,description,adjustment_id,actor_id) values ($1,'credit',$2,$3,$4,$5,$6) returning id`,
              [programmeId,adjustment.currency,adjustment.amountMinor,`${label} - ${target.description}`,adjustment.id,actor.accountId])).rows[0].id;
            await db.query("insert into ledger_allocations (payment_entry_id,charge_entry_id,amount_minor) values ($1,$2,$3)",[ledgerEntryId,target.id,adjustment.amountMinor]);
          } else if (adjustment.kind !== "hold_exemption") {
            ledgerEntryId = (await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,charge_code,description,due_on,adjustment_id,actor_id) values ($1,'charge',$2,$3,$4,$5,$6,$7,$8) returning id`,
              [programmeId,adjustment.currency,adjustment.amountMinor,adjustment.kind === "refund" ? "REFUND" : "ADJUSTMENT",adjustment.kind === "refund" ? label : adjustment.description,
                adjustment.kind === "refund" ? todayIso() : adjustment.dueOn,adjustment.id,actor.accountId])).rows[0].id;
            await allocateProgramme(db,programmeId);
          }
        }
        await notifyStudent(db,programmeId,"finance.adjustment_decided",async () => ({kind:adjustment.kind.replace("_"," "),amountText:adjustment.amountMinor ? ` of ${formatMoney(adjustment.currency,adjustment.amountMinor)}` : "",outcome:input.outcome,reason:input.reason.trim()}));
        await db.query("update finance_adjustments set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4,ledger_entry_id = $5 where id = $1",[adjustment.id,input.outcome,actor.accountId,input.reason.trim(),ledgerEntryId]);
        await insertAudit(db,{actorId:actor.accountId,action:`finance.adjustment.${input.outcome}`,subjectType:"FinanceAdjustment",subjectId:String(adjustment.id),reason:input.reason,
          metadata:{programmeId,kind:adjustment.kind,currency:adjustment.currency,amountMinor:adjustment.amountMinor,ledgerEntryId,evidenceHash:adjustment.evidenceHash}});
        return {id:adjustment.id,status:input.outcome,ledgerEntryId};
      });
    }
  };
}
