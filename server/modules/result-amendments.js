import { gradeForMark } from "./grading.js";
import { queueNotification } from "../notification-queue.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, requestError, withTransaction } from "../support.js";

export const amendmentCategories = ["marking_error","transcription_error","moderation","appeal","academic_misconduct"];
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function validateAmendment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["registrationId","courseId","revision","mark","category","reason","evidenceRef"].includes(key))
    || !text(input.registrationId,100) || !text(input.courseId,100) || !Number.isInteger(input.revision) || input.revision < 0 || !Number.isInteger(input.mark) || input.mark < 0 || input.mark > 100
    || !amendmentCategories.includes(input.category) || !text(input.reason,2000) || !text(input.evidenceRef,300)) {
    throw requestError(400,"Provide the result, its current revision, a whole-number mark from 0-100, an amendment category, a reason, and evidence.");
  }
}

// The amended snapshot keeps everything about the original result and regrades the new mark under the batch's own policy.
export function amendedSnapshot(current,mark,scheme) {
  const grade = gradeForMark(scheme,mark);
  return {...current,mark,grade:grade.grade,points:grade.points,passing:grade.passing};
}

async function programmeFor(db,id,actor) {
  const row = (await db.query(`select sp.id,sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[id])).rows[0];
  if (!row) throw requestError(404,"Student programme was not found.");
  assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}

async function resultFor(db,periodId,registrationId,courseId,lock = false) {
  const row = (await db.query(`select ar.registration_id as "registrationId",ar.course_id as "courseId",ar.result_snapshot as snapshot,ar.revision,ar.batch_id as "batchId",
    rb.policy_snapshot as policy,rb.status as "batchStatus",sr.student_programme_id as "studentProgrammeId",s.account_id as "accountId",s.student_number as "studentNumber",s.id as "studentId"
    from academic_results ar join result_batches rb on rb.id = ar.batch_id join student_registrations sr on sr.id = ar.registration_id join student_programmes sp on sp.id = sr.student_programme_id
    join students s on s.id = sp.student_id where ar.registration_id = $1 and ar.course_id = $2 and rb.period_id = $3 ${lock ? "for update of ar" : ""}`,[registrationId,courseId,periodId])).rows[0];
  if (!row || row.batchStatus !== "published") throw requestError(404,"Published result was not found in this period.");
  return row;
}

const amendmentSelect = `select a.id::int,a.batch_id as "batchId",a.registration_id as "registrationId",a.course_id as "courseId",a.result_revision as "resultRevision",a.category,
  a.from_snapshot as "from",a.to_snapshot as "to",a.reason,a.evidence_ref as "evidenceRef",a.requested_by as "requestedBy",a.requested_at as "requestedAt",a.status,
  a.reviewed_by as "reviewedBy",a.reviewed_at as "reviewedAt",a.review_reason as "reviewReason" from result_amendments a`;

export function createResultAmendmentsModule(pool) {
  return {
    async listResultAmendments(programmeId,periodId,actor) {
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,programmeId,actor);
        const amendments = (await db.query(`${amendmentSelect} join result_batches rb on rb.id = a.batch_id where rb.period_id = $1 order by a.id desc`,[periodId])).rows;
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        return {amendments,categories:amendmentCategories,accountId:actor.accountId,capabilities:{request:can("results.amend.request"),approve:can("results.amend.approve")}};
      });
    },
    async requestResultAmendment(programmeId,periodId,input,actor) {
      validateAmendment(input);
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor);
        const result = await resultFor(db,periodId,input.registrationId,input.courseId,true);
        if (result.revision !== input.revision) throw requestError(409,"This result changed. Reload before requesting an amendment.");
        if (result.snapshot.mark === input.mark) throw requestError(400,"The amended mark is the same as the published mark.");
        if ((await db.query("select 1 from result_amendments where registration_id = $1 and course_id = $2 and status = 'requested'",[input.registrationId,input.courseId])).rowCount) throw requestError(409,"An amendment to this result is already awaiting independent approval.");
        const to = amendedSnapshot(result.snapshot,input.mark,result.policy.scheme);
        const row = (await db.query(`insert into result_amendments (batch_id,registration_id,course_id,result_revision,category,from_snapshot,to_snapshot,reason,evidence_ref,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id::int`,[result.batchId,input.registrationId,input.courseId,result.revision,input.category,JSON.stringify(result.snapshot),JSON.stringify(to),input.reason.trim(),input.evidenceRef.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"results.amendment.requested",subjectType:"ResultAmendment",subjectId:String(row.id),reason:input.reason,
          metadata:{batchId:result.batchId,registrationId:input.registrationId,courseId:input.courseId,category:input.category,fromMark:result.snapshot.mark,toMark:input.mark,revision:result.revision}});
        return {id:row.id,status:"requested",to};
      });
    },
    async reviewResultAmendment(programmeId,periodId,amendmentId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor);
        const amendment = (await db.query(`${amendmentSelect} join result_batches rb on rb.id = a.batch_id where a.id = $1 and rb.period_id = $2`,[amendmentId,periodId])).rows[0];
        if (!amendment) throw requestError(404,"Amendment was not found in this period.");
        const result = await resultFor(db,periodId,amendment.registrationId,amendment.courseId,true);
        if ((await db.query("select status from result_amendments where id = $1 for update",[amendmentId])).rows[0].status !== "requested") throw requestError(409,"Reviewed amendments are immutable.");
        assertSeparateApprover(amendment.requestedBy,actor);
        let followUp = null;
        if (input.outcome === "approved") {
          if (result.revision !== amendment.resultRevision) throw requestError(409,"The result changed after this request. Reject it and request a fresh amendment.");
          const credits = (await db.query("select id::int from credit_recognitions where source_registration_id = $1 and source_course_id = $2 and status = 'approved'",[amendment.registrationId,amendment.courseId])).rows;
          if (credits.length && amendment.from.passing && !amendment.to.passing) throw requestError(409,"This passing result supports approved recognized credit. Revoke that credit before amending the result to a fail.");
          await db.query("update academic_results set result_snapshot = $3,revision = revision + 1,amended_at = now() where registration_id = $1 and course_id = $2",[amendment.registrationId,amendment.courseId,JSON.stringify(amendment.to)]);
          // Approved progression/repeat decisions are bound to evidence hashes, so they stop counting for new registrations; list them for follow-up.
          const decisions = (await db.query(`select d.id::int,d.kind from academic_decisions d join student_programmes sp on sp.id = d.student_programme_id where sp.student_id = $1 and d.status = 'approved'`,[result.studentId])).rows;
          followUp = {creditRecognitions:credits.map((row) => row.id),academicDecisions:decisions.map((row) => row.id)};
          await queueNotification(db,result.accountId,"results.amended",{studentNumber:result.studentNumber,courseCode:amendment.to.code,fromMark:amendment.from.mark,toMark:amendment.to.mark,grade:amendment.to.grade,reason:input.reason.trim()},{link:'#study/results'});
        }
        await db.query("update result_amendments set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[amendmentId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`results.amendment.${input.outcome}`,subjectType:"ResultAmendment",subjectId:String(amendmentId),reason:input.reason,
          metadata:{registrationId:amendment.registrationId,courseId:amendment.courseId,fromMark:amendment.from.mark,toMark:amendment.to.mark,followUp}});
        return {id:amendment.id,status:input.outcome,followUp};
      });
    }
  };
}
