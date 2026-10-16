import { randomUUID } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { allocateProgramme, financialStatus, formatMoney, notifyStudent } from "./student-finance.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

// Which charges a sponsorship covers and by how much: charges in its currency, with a covered charge code (none listed
// means all codes), due within the validity window, not already sponsored. Each gets the coverage percentage, rounded
// down to whole minor units, until the cap (if any) is used up.
export function computeSponsorTransfers(sponsorship,charges,alreadySponsoredIds,usedMinor = 0) {
  let remaining = sponsorship.capMinor == null ? Infinity : Math.max(sponsorship.capMinor - usedMinor,0);
  const transfers = [];
  for (const charge of [...charges].sort((a,b) => a.dueOn.localeCompare(b.dueOn) || a.id - b.id)) {
    if (charge.currency !== sponsorship.currency || alreadySponsoredIds.has(charge.id)) continue;
    if (sponsorship.chargeCodes.length && !sponsorship.chargeCodes.includes(charge.chargeCode)) continue;
    if (charge.dueOn < sponsorship.validFrom || charge.dueOn > sponsorship.validTo) continue;
    const amount = Math.min(Math.floor(charge.amountMinor * sponsorship.coveragePercent / 100),remaining);
    if (amount <= 0) continue;
    transfers.push({chargeEntryId:charge.id,amountMinor:amount,chargeCode:charge.chargeCode});
    remaining -= amount;
  }
  return transfers;
}

const sponsorshipSelect = `select s.id::int,s.sponsor_id as "sponsorId",sp.code as "sponsorCode",sp.name as "sponsorName",s.student_programme_id as "programmeId",s.currency,
  s.coverage_percent as "coveragePercent",s.charge_codes as "chargeCodes",s.cap_minor as "capMinor",to_char(s.valid_from,'YYYY-MM-DD') as "validFrom",to_char(s.valid_to,'YYYY-MM-DD') as "validTo",
  s.status,s.reason,s.requested_by as "requestedBy",s.reviewed_by as "reviewedBy",s.review_reason as "reviewReason",s.end_reason as "endReason",
  coalesce((select sum(t.amount_minor) from sponsor_transfers t where t.sponsorship_id = s.id),0)::bigint as "transferredMinor"
  from sponsorships s join sponsors sp on sp.id = s.sponsor_id`;
const shape = (row) => ({...row,capMinor:row.capMinor == null ? null : Number(row.capMinor),transferredMinor:Number(row.transferredMinor)});

// Creates the transfers an approved sponsorship is owed on the programme's current charges: each is a sponsor receivable
// and a matching credit on the student's ledger, then the ledger is re-allocated. Safe to repeat.
export async function applySponsorship(db,sponsorship,actorId) {
  const charges = (await db.query(`select id::int,currency,amount_minor as "amountMinor",charge_code as "chargeCode",to_char(due_on,'YYYY-MM-DD') as "dueOn"
    from ledger_entries where student_programme_id = $1 and entry_type = 'charge' and currency = $2`,[sponsorship.programmeId,sponsorship.currency])).rows.map((row) => ({...row,amountMinor:Number(row.amountMinor)}));
  const sponsored = new Set((await db.query(`select t.charge_entry_id::int as id from sponsor_transfers t join ledger_entries e on e.id = t.charge_entry_id where e.student_programme_id = $1`,[sponsorship.programmeId])).rows.map((row) => row.id));
  const transfers = computeSponsorTransfers(sponsorship,charges,sponsored,sponsorship.transferredMinor);
  for (const transfer of transfers) {
    const row = (await db.query("insert into sponsor_transfers (sponsorship_id,charge_entry_id,amount_minor,created_by) values ($1,$2,$3,$4) returning id::int",
      [sponsorship.id,transfer.chargeEntryId,transfer.amountMinor,actorId])).rows[0];
    await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,description,actor_id,sponsor_transfer_id) values ($1,'credit',$2,$3,$4,$5,$6)`,
      [sponsorship.programmeId,sponsorship.currency,transfer.amountMinor,`Sponsored by ${sponsorship.sponsorName} (${transfer.chargeCode})`,actorId,row.id]);
  }
  if (transfers.length) await allocateProgramme(db,sponsorship.programmeId);
  return transfers;
}

// Billing calls this after posting new charges, so approved sponsorships cover them straight away.
export async function applyActiveSponsorships(db,programmeId,actorId) {
  const active = (await db.query(`${sponsorshipSelect} where s.student_programme_id = $1 and s.status = 'approved' order by s.id`,[programmeId])).rows.map(shape);
  let created = 0;
  for (const sponsorship of active) created += (await applySponsorship(db,sponsorship,actorId)).length;
  return created;
}

// Sponsors are institution-wide records, so managing them and their payments needs a globally scoped finance role.
function requireGlobal(actor,permission) {
  if (!actor.roles.some((role) => (role.permissions || []).includes(permission) && (role.code === "system_administrator" || isGlobalScope(role.scope)))) {
    throw requestError(403,"Sponsor accounts need institution-wide finance authority.");
  }
}

async function sponsorStatement(db,sponsorId) {
  const owed = (await db.query(`select s.currency,sum(t.amount_minor)::bigint as owed from sponsor_transfers t join sponsorships s on s.id = t.sponsorship_id where s.sponsor_id = $1 group by s.currency`,[sponsorId])).rows;
  const paid = (await db.query("select currency,sum(amount_minor)::bigint as paid from sponsor_payments where sponsor_id = $1 group by currency",[sponsorId])).rows;
  const currencies = [...new Set([...owed,...paid].map((row) => row.currency))].sort();
  return currencies.map((currency) => {
    const charged = Number(owed.find((row) => row.currency === currency)?.owed || 0),received = Number(paid.find((row) => row.currency === currency)?.paid || 0);
    return {currency,charged,paid:received,balance:charged - received};
  });
}

export function createSponsorshipsModule(pool) {
  async function programmeFor(db,id,actor,permission) {
    const row = (await db.query(`select sp.id,sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 for update of sp`,[id])).rows[0];
    if (!row) throw requestError(404,"Student programme was not found.");
    assertActorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId});
    return row;
  }
  return {
    async listSponsors(actor) {
      return withTransaction(pool,async (db) => {
        const sponsors = (await db.query(`select id,code,name,contact_email as "contactEmail",status from sponsors order by name`)).rows;
        for (const sponsor of sponsors) sponsor.statement = await sponsorStatement(db,sponsor.id);
        return {sponsors,capabilities:{manage:actor.roles.some((role) => (role.permissions || []).includes("finance.adjustment.request") && (role.code === "system_administrator" || isGlobalScope(role.scope))),
          recordPayment:actor.roles.some((role) => (role.permissions || []).includes("finance.payment.record") && (role.code === "system_administrator" || isGlobalScope(role.scope)))}};
      });
    },
    async createSponsor(input,actor) {
      requireGlobal(actor,"finance.adjustment.request");
      if (!input || Object.keys(input).some((key) => !["code","name","contactEmail","reason"].includes(key)) || typeof input.code !== "string" || !/^[a-z0-9_]{3,40}$/.test(input.code)
        || !text(input.name,200) || (input.contactEmail !== undefined && input.contactEmail !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contactEmail)) || !text(input.reason,2000)) {
        throw requestError(400,"Provide a sponsor code (3-40 lower-case letters, digits, underscores), a name, an optional contact email, and a reason.");
      }
      return withTransaction(pool,async (db) => {
        if ((await db.query("select 1 from sponsors where code = $1",[input.code])).rowCount) throw requestError(409,"That sponsor code is already used.");
        const id = `spn_${randomUUID()}`;
        await db.query("insert into sponsors (id,code,name,contact_email,created_by) values ($1,$2,$3,$4,$5)",[id,input.code,input.name.trim(),input.contactEmail || null,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.sponsor.created",subjectType:"Sponsor",subjectId:id,reason:input.reason});
        return {id,code:input.code,name:input.name.trim(),contactEmail:input.contactEmail || null,status:"active",statement:[]};
      });
    },
    async recordSponsorPayment(sponsorId,input,actor) {
      requireGlobal(actor,"finance.payment.record");
      if (!input || Object.keys(input).some((key) => !["currency","amountMinor","externalRef","receivedOn","reason"].includes(key)) || !/^[A-Z]{3}$/.test(input.currency ?? "")
        || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !text(input.externalRef,120) || !text(input.reason,2000)) throw requestError(400,"Provide currency, a positive whole minor-unit amount, an external reference, the received date, and a reason.");
      const receivedOn = parseEffectiveDate(input.receivedOn);
      if (receivedOn > todayIso()) throw requestError(400,"A payment cannot be received in the future.");
      return withTransaction(pool,async (db) => {
        if (!(await db.query("select 1 from sponsors where id = $1",[sponsorId])).rowCount) throw requestError(404,"Sponsor was not found.");
        const inserted = await db.query(`insert into sponsor_payments (sponsor_id,currency,amount_minor,external_ref,received_on,reason,recorded_by) values ($1,$2,$3,$4,$5,$6,$7)
          on conflict (sponsor_id,external_ref) do nothing returning id::int`,[sponsorId,input.currency,input.amountMinor,input.externalRef.trim(),receivedOn,input.reason.trim(),actor.accountId]);
        if (!inserted.rowCount) throw requestError(409,"This sponsor payment reference is already recorded.");
        await insertAudit(db,{actorId:actor.accountId,action:"finance.sponsor.payment",subjectType:"Sponsor",subjectId:sponsorId,reason:input.reason,metadata:{currency:input.currency,amountMinor:input.amountMinor,externalRef:input.externalRef.trim()}});
        return {sponsorId,statement:await sponsorStatement(db,sponsorId)};
      });
    },
    async listProgrammeSponsorships(programmeId,actor) {
      return withTransaction(pool,async (db) => {
        const programme = (await db.query(`select sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[programmeId])).rows[0];
        if (!programme) throw requestError(404,"Student programme was not found.");
        assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
        const sponsorships = (await db.query(`${sponsorshipSelect} where s.student_programme_id = $1 order by s.id desc`,[programmeId])).rows.map(shape);
        const sponsors = (await db.query("select id,code,name from sponsors where status = 'active' order by name")).rows;
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        return {sponsorships,sponsors,accountId:actor.accountId,capabilities:{request:can("finance.adjustment.request"),approve:can("finance.adjustment.approve")}};
      });
    },
    async requestSponsorship(programmeId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["sponsorId","currency","coveragePercent","chargeCodes","capMinor","validFrom","validTo","reason"].includes(key))
        || !text(input.sponsorId,100) || !/^[A-Z]{3}$/.test(input.currency ?? "") || !Number.isInteger(input.coveragePercent) || input.coveragePercent < 1 || input.coveragePercent > 100
        || (input.chargeCodes !== undefined && (!Array.isArray(input.chargeCodes) || input.chargeCodes.length > 20 || input.chargeCodes.some((code) => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,39}$/.test(code))))
        || (input.capMinor !== undefined && input.capMinor !== null && (!Number.isSafeInteger(input.capMinor) || input.capMinor <= 0)) || !text(input.reason,2000)) {
        throw requestError(400,"Provide the sponsor, currency, coverage percentage (1-100), optional charge codes and cap, the validity dates, and a reason.");
      }
      const validFrom = parseEffectiveDate(input.validFrom),validTo = parseEffectiveDate(input.validTo);
      if (validTo < validFrom) throw requestError(400,"The validity must end on or after it starts.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.request");
        if (!(await db.query("select 1 from sponsors where id = $1 and status = 'active'",[input.sponsorId])).rowCount) throw requestError(404,"Active sponsor was not found.");
        if ((await db.query("select 1 from sponsorships where sponsor_id = $1 and student_programme_id = $2 and currency = $3 and status in ('requested','approved')",[input.sponsorId,programmeId,input.currency])).rowCount) {
          throw requestError(409,"This sponsor already has a requested or approved sponsorship for this programme and currency.");
        }
        const row = (await db.query(`insert into sponsorships (sponsor_id,student_programme_id,currency,coverage_percent,charge_codes,cap_minor,valid_from,valid_to,reason,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id::int`,[input.sponsorId,programmeId,input.currency,input.coveragePercent,[...new Set(input.chargeCodes || [])].sort(),input.capMinor ?? null,validFrom,validTo,input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"finance.sponsorship.requested",subjectType:"Sponsorship",subjectId:String(row.id),reason:input.reason,metadata:{programmeId,sponsorId:input.sponsorId,coveragePercent:input.coveragePercent}});
        return shape((await db.query(`${sponsorshipSelect} where s.id = $1`,[row.id])).rows[0]);
      });
    },
    async reviewSponsorship(programmeId,sponsorshipId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.approve");
        const sponsorship = (await db.query(`${sponsorshipSelect} where s.id = $1 and s.student_programme_id = $2 for update of s`,[sponsorshipId,programmeId])).rows.map(shape)[0];
        if (!sponsorship) throw requestError(404,"Sponsorship was not found.");
        if (sponsorship.status !== "requested") throw requestError(409,"Only requested sponsorships can be reviewed.");
        if (sponsorship.requestedBy === actor.accountId) throw requestError(403,"A sponsorship must be approved by someone other than its requester.");
        await db.query("update sponsorships set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[sponsorshipId,input.outcome,actor.accountId,input.reason.trim()]);
        let transfers = [];
        if (input.outcome === "approved") {
          transfers = await applySponsorship(db,{...sponsorship,status:"approved"},actor.accountId);
          const total = transfers.reduce((sum,row) => sum + row.amountMinor,0);
          await notifyStudent(db,programmeId,"finance.sponsorship",async () => ({sponsor:sponsorship.sponsorName,percent:sponsorship.coveragePercent,covered:formatMoney(sponsorship.currency,total)}));
        }
        await insertAudit(db,{actorId:actor.accountId,action:`finance.sponsorship.${input.outcome}`,subjectType:"Sponsorship",subjectId:String(sponsorshipId),reason:input.reason,metadata:{programmeId,transfers:transfers.length}});
        return {...shape((await db.query(`${sponsorshipSelect} where s.id = $1`,[sponsorshipId])).rows[0]),transfers,status:(await financialStatus(db,programmeId)).hold};
      });
    },
    // Ending stops future coverage; transfers already made stand, since the sponsor has accepted those charges.
    async endSponsorship(programmeId,sponsorshipId,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,"finance.adjustment.request");
        const row = (await db.query("select status from sponsorships where id = $1 and student_programme_id = $2 for update",[sponsorshipId,programmeId])).rows[0];
        if (!row) throw requestError(404,"Sponsorship was not found.");
        if (!["requested","approved"].includes(row.status)) throw requestError(409,"Only requested or approved sponsorships can be ended.");
        await db.query("update sponsorships set status = 'ended',ended_by = $2,ended_at = now(),end_reason = $3 where id = $1",[sponsorshipId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"finance.sponsorship.ended",subjectType:"Sponsorship",subjectId:String(sponsorshipId),reason:input.reason,metadata:{programmeId,fromStatus:row.status}});
        return shape((await db.query(`${sponsorshipSelect} where s.id = $1`,[sponsorshipId])).rows[0]);
      });
    }
  };
}
