import { randomUUID } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { onboardingReadiness } from "./registry.js";
import { creditEvidenceHash, loadCreditRecognitions } from "./credit-evidence.js";
import { intakeSeatsSql } from "./intake-capacity.js";

export function validateTransferRequest(input,today = todayIso()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["intakeId","programmeVersionId","revision","evidenceHash","reason","evidenceRef","expiresOn"].includes(key))
    || [input.intakeId,input.programmeVersionId].some((value) => typeof value !== "string" || !value || value.length > 200)
    || !Number.isInteger(input.revision) || input.revision < 0 || !/^[a-f0-9]{64}$/.test(input.evidenceHash || "")
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300 || !input.expiresOn) throw requestError(400,"Choose a destination and provide current revision/evidence, reason, evidence reference, and expiry.");
  const expiresOn = parseEffectiveDate(input.expiresOn);
  if (expiresOn < today) throw requestError(400,"Transfer request cannot already be expired.");
  return expiresOn;
}
export function transferBlockers(source,target,today = todayIso()) {
  const blockers = [];
  if (source.programme.status !== "onboarded") blockers.push("Only an onboarded active programme can transfer; inactive programmes require their own reviewed re-entry.");
  if (!source.profileComplete) blockers.push("A complete verified student profile is required.");
  if (source.registrations.some((row) => row.status === "confirmed" && (!row.endsOn || row.endsOn >= today))) blockers.push("Complete or formally resolve current/future confirmed source enrolments before transfer.");
  if (target) {
    if (source.programme.intakeId === target.intakeId && source.programme.programmeVersionId === target.programmeVersionId) blockers.push("The destination must change the programme, intake or curriculum.");
    if (target.intakeStatus !== "published" || target.versionStatus !== "published" || target.programmeStatus !== "active"
      || !target.effectiveFrom || target.effectiveFrom > today || target.effectiveTo && target.effectiveTo < today || !target.courseCount) blockers.push("Choose a published intake and curriculum currently effective for an active programme.");
  }
  return blockers;
}
export function transferEvidenceHash(source,target = null) {
  return creditEvidenceHash({source:{...source,registrations:[...source.registrations].sort((a,b) => a.id.localeCompare(b.id)),recognitions:[...source.recognitions].sort((a,b) => String(a.id).localeCompare(String(b.id)))},target});
}
const destinationSelect = `select i.id as "intakeId",i.label as "intakeLabel",i.status as "intakeStatus",p.code as "programmeCode",p.name as "programmeName",p.status as "programmeStatus",
  v.id as "programmeVersionId",v.version_label as "versionLabel",v.status as "versionStatus",to_char(v.effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(v.effective_to,'YYYY-MM-DD') as "effectiveTo",
  (select count(*)::int from curriculum_entries ce where ce.programme_version_id = v.id) as "courseCount"
  from intakes i join programmes p on p.id = i.programme_id join programme_versions v on v.programme_id = p.id`;
const requestSelect = `select r.id,r.source_programme_id as "sourceProgrammeId",r.target_intake_id as "intakeId",r.target_version_id as "programmeVersionId",r.target_programme_id as "targetProgrammeId",
  r.source_revision as revision,r.evidence_hash as "evidenceHash",r.status,r.reason,r.evidence_ref as "evidenceRef",to_char(r.expires_on,'YYYY-MM-DD') as "expiresOn",
  r.requested_by as "requestedBy",r.reviewed_by as "reviewedBy",r.review_reason as "reviewReason",r.requested_at as "requestedAt",r.reviewed_at as "reviewedAt",
  p.code as "programmeCode",i.label as "intakeLabel",v.version_label as "versionLabel"
  from programme_transfer_requests r join intakes i on i.id = r.target_intake_id join programmes p on p.id = i.programme_id join programme_versions v on v.id = r.target_version_id`;
async function sourceFor(db,id,actor,own = false,lock = false) {
  const programme = (await db.query(`select sp.id,sp.student_id as "studentId",sp.application_id as "applicationId",sp.status,sp.status_revision as revision,
    sp.intake_id as "intakeId",sp.programme_version_id as "programmeVersionId",s.account_id as "accountId",p.code as "programmeCode"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
    where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!programme || own && programme.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
  if (lock) await db.query("select id from students where id = $1 for update",[programme.studentId]);
  const profile = (await db.query('select revision,phone,address,next_of_kin as "nextOfKin" from student_profiles where student_id = $1',[programme.studentId])).rows[0];
  const registrations = (await db.query(`select sr.id,sr.status,sr.revision,sr.selected_courses as "selectedCourses",sr.reference_number as "referenceNumber",
    coalesce(sr.confirmation->>'endsOn',to_char(ap.ends_on,'YYYY-MM-DD')) as "endsOn" from student_registrations sr
    join registration_periods rp on rp.id = sr.period_id join academic_periods ap on ap.id = rp.academic_period_id where sr.student_programme_id = $1`,[id])).rows;
  return {programme,profileRevision:profile?.revision || 0,profileComplete:onboardingReadiness(profile).complete,registrations,recognitions:await loadCreditRecognitions(db,id)};
}
async function destinationFor(db,input,actor,lock = false) {
  const target = (await db.query(`${destinationSelect} where i.id = $1 and v.id = $2 ${lock ? "for share of i,p,v" : ""}`,[input.intakeId,input.programmeVersionId])).rows[0];
  if (!target) throw requestError(404,"Destination intake/curriculum was not found.");
  assertActorCanAccessScope(actor,{programmeCode:target.programmeCode,intakeId:target.intakeId});
  return target;
}
async function assertDestinationAvailable(db,source,target) {
  if ((await db.query(`select 1 from student_programmes where student_id = $1 and intake_id = $2 and programme_version_id = $3 and id <> $4 and status <> 'transferred'`,
    [source.programme.studentId,target.intakeId,target.programmeVersionId,source.programme.id])).rowCount) throw requestError(409,"An existing destination programme must use its own lifecycle, not a duplicate transfer record.");
  const alreadyOccupies = source.programme.intakeId === target.intakeId || (await db.query(`select 1 from student_programmes where student_id = $1 and intake_id = $2
    union all select 1 from applications a join workflow_instances w on w.id = a.workflow_instance_id where a.applicant_account_id = $3 and a.intake_id = $2 and w.state in ('Offer issued','Accepted')`,
    [source.programme.studentId,target.intakeId,source.programme.accountId])).rowCount > 0;
  const seats = (await db.query(intakeSeatsSql,[target.intakeId])).rows[0];
  if (!alreadyOccupies && seats.used >= seats.capacity) throw requestError(409,"The destination intake is full; transfer cannot override capacity.");
}
export function createProgrammeTransferModule(pool) {
  return {
    async getProgrammeTransfers(id,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const source = await sourceFor(db,id,actor,own);
        const capabilities = Object.fromEntries(["request","approve"].map((action) => [action,!own && actor.permissions.includes(`registry.transfer.${action}`)
          && actorCanAccessScope({...actor,authorizingPermission:`registry.transfer.${action}`},{programmeCode:source.programme.programmeCode,intakeId:source.programme.intakeId})]));
        const destinations = own ? [] : (await db.query(`${destinationSelect} where i.status = 'published' and v.status = 'published' and p.status = 'active' order by p.code,i.label,v.version_label`)).rows
          .filter((target) => !transferBlockers({...source,programme:{...source.programme,status:"onboarded"},profileComplete:true,registrations:[]},target).length
            && ["request","approve"].some((action) => capabilities[action] && actorCanAccessScope({...actor,authorizingPermission:`registry.transfer.${action}`},{programmeCode:target.programmeCode,intakeId:target.intakeId})));
        const requests = (await db.query(`${requestSelect} where r.source_programme_id = $1 or r.target_programme_id = $1 order by r.id desc`,[id])).rows;
        return {programmeId:id,revision:source.programme.revision,evidenceHash:transferEvidenceHash(source),blockers:transferBlockers(source),destinations,requests,capabilities,accountId:actor.accountId};
      });
    },
    async requestProgrammeTransfer(id,input,actor) {
      const expiresOn = validateTransferRequest(input);
      return withTransaction(pool,async (db) => {
        const source = await sourceFor(db,id,actor,false,true),target = await destinationFor(db,input,actor,true);
        if (input.revision !== source.programme.revision || input.evidenceHash !== transferEvidenceHash(source)) throw requestError(409,"Source evidence changed. Reload before requesting transfer.");
        const blockers = transferBlockers(source,target);
        if (blockers.length) throw requestError(409,blockers.join(" "));
        await assertDestinationAvailable(db,source,target);
        if ((await db.query("select 1 from programme_transfer_requests where source_programme_id = $1 and status = 'requested'",[id])).rowCount) throw requestError(409,"Review the pending transfer request before replacing it.");
        const evidenceHash = transferEvidenceHash(source,target);
        const row = (await db.query(`insert into programme_transfer_requests (source_programme_id,target_intake_id,target_version_id,source_revision,evidence_hash,source_snapshot,reason,evidence_ref,expires_on,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[id,input.intakeId,input.programmeVersionId,input.revision,evidenceHash,JSON.stringify({source,target}),input.reason.trim(),input.evidenceRef.trim(),expiresOn,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"registry.transfer.requested",subjectType:"ProgrammeTransferRequest",subjectId:String(row.id),reason:input.reason,metadata:{sourceProgrammeId:id,intakeId:input.intakeId,programmeVersionId:input.programmeVersionId,evidenceHash}});
        return row;
      });
    },
    async reviewProgrammeTransfer(id,requestId,input,actor) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["outcome","reason"].includes(key))
        || !["approved","rejected"].includes(input.outcome) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"Choose approve/reject and provide an independent review reason.");
      return withTransaction(pool,async (db) => {
        const source = await sourceFor(db,id,actor,false,true);
        const request = (await db.query(`${requestSelect} where r.id = $1 and r.source_programme_id = $2 for update of r`,[requestId,id])).rows[0];
        if (!request) throw requestError(404,"Transfer request was not found.");
        if (request.status !== "requested") throw requestError(409,"Reviewed transfers are immutable; use a new governed transfer for later changes.");
        assertSeparateApprover(request.requestedBy,actor);
        const target = await destinationFor(db,request,actor,true);
        let targetProgrammeId = null;
        if (input.outcome === "approved") {
          const blockers = transferBlockers(source,target);
          if (blockers.length || request.expiresOn < todayIso() || request.revision !== source.programme.revision || request.evidenceHash !== transferEvidenceHash(source,target)) throw requestError(409,"Transfer evidence is stale, expired or no longer eligible. Reject and request a fresh review.");
          await db.query("select pg_advisory_xact_lock(hashtext($1))",[`intake-seats:${target.intakeId}`]);
          await assertDestinationAvailable(db,source,target);
          targetProgrammeId = `spr_${randomUUID()}`;
          await db.query(`insert into student_programmes (id,student_id,application_id,programme_version_id,intake_id,status,origin_programme_id,transfer_request_id)
            values ($1,$2,$3,$4,$5,'onboarded',$6,$7)`,[targetProgrammeId,source.programme.studentId,source.programme.applicationId,target.programmeVersionId,target.intakeId,id,request.id]);
          await db.query("update student_programmes set status = 'transferred',status_revision = status_revision + 1 where id = $1",[id]);
          await db.query("update student_registrations set revision = revision + 1 where student_programme_id = $1 and status = 'draft'",[id]);
          for (const [programmeId,fromStatus,toStatus] of [[id,source.programme.status,"transferred"],[targetProgrammeId,null,"onboarded"]]) await db.query(`insert into student_programme_history (id,student_programme_id,from_status,to_status,reason,actor_id,transfer_request_id)
            values ($1,$2,$3,$4,$5,$6,$7)`,[`sph_${randomUUID()}`,programmeId,fromStatus,toStatus,input.reason.trim(),actor.accountId,request.id]);
        }
        await db.query("update programme_transfer_requests set status = $2,target_programme_id = $3,reviewed_by = $4,reviewed_at = now(),review_reason = $5 where id = $1",[request.id,input.outcome,targetProgrammeId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`registry.transfer.${input.outcome}`,subjectType:"ProgrammeTransferRequest",subjectId:String(request.id),reason:input.reason,metadata:{sourceProgrammeId:id,targetProgrammeId,intakeId:request.intakeId,programmeVersionId:request.programmeVersionId,evidenceHash:request.evidenceHash}});
        return {id:request.id,status:input.outcome,targetProgrammeId};
      });
    }
  };
}
