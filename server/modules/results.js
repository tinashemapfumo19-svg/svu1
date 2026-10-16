import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from 'node:util';
import { queueNotification } from '../notification-queue.js';
import { calculateGpa, gradeForMark } from "./grading.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, requestError, todayIso, withTransaction } from "../support.js";

export function resultsChecksum(rows) {
  const canonical = rows.map(({ registrationId, courseId, mark }) => ({ registrationId, courseId, mark }))
    .sort((a,b) => a.registrationId.localeCompare(b.registrationId) || a.courseId.localeCompare(b.courseId));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateResultsExport(input) {
  if (!input || typeof input.sourceRef !== "string" || !input.sourceRef.trim() || input.sourceRef.length > 200
    || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 5000) throw requestError(400,"Provide a source reference and 1-5000 result rows.");
  const keys = new Set();
  for (const row of input.rows) {
    if (!row || Object.keys(row).some((key) => !["registrationId","courseId","mark"].includes(key))
      || typeof row.registrationId !== "string" || !row.registrationId || typeof row.courseId !== "string" || !row.courseId
      || !Number.isInteger(row.mark) || row.mark < 0 || row.mark > 100) throw requestError(400,"Results require enrolment identifiers and a whole-number mark from 0-100.");
    const key = JSON.stringify([row.registrationId,row.courseId]);
    if (keys.has(key)) throw requestError(400,"Duplicate course result in the source export.");
    keys.add(key);
  }
  const markTotal = input.rows.reduce((sum,row) => sum + row.mark,0);
  const checksum = resultsChecksum(input.rows);
  if (input.expectedRowCount !== input.rows.length || input.expectedMarkTotal !== markTotal || input.checksum !== checksum) throw requestError(400,"Result source totals or checksum do not reconcile.");
  return { rowCount: input.rows.length,markTotal,checksum };
}

export function reconcileResultRoster(rows, roster) {
  const key = (row) => JSON.stringify([row.registrationId,row.courseId]);
  const expected = new Set(roster.map(key));
  const actual = new Set(rows.map(key));
  if (rows.length !== roster.length || actual.size !== rows.length || rows.some((row) => !expected.has(key(row))))
    throw requestError(409,"Results must cover the complete current confirmed-enrolment roster exactly once.");
}

export function assertResultSourceCustody(batch,roster,policy,origin) {
  const fault = () => {throw requestError(409,'Result source custody requires reconciliation.');};
  try {
    validateResultsExport({sourceRef:batch.sourceRef,rows:batch.rows.map(({registrationId,courseId,mark}) => ({registrationId,courseId,mark})),expectedRowCount:batch.rowCount,expectedMarkTotal:batch.markTotal,checksum:batch.checksum});
    reconcileResultRoster(batch.rows,roster);
    if (!origin || origin.actorId !== batch.createdBy || origin.timeMatches !== true || origin.reason?.trim() !== batch.importReason
      || origin.metadata?.periodId !== batch.periodId || origin.metadata?.sourceRef !== batch.sourceRef
      || origin.metadata?.checksum !== batch.checksum || origin.metadata?.rowCount !== batch.rowCount || origin.metadata?.markTotal !== batch.markTotal) fault();
    const pinned = value => ({rule:{id:value.rule.id,code:value.rule.code,version:value.rule.version,gradingSchemeId:value.rule.gradingSchemeId,rules:value.rule.rules},scheme:{id:value.scheme.id,code:value.scheme.code,version:value.scheme.version,bands:value.scheme.bands,classifications:value.scheme.classifications}});
    if (!isDeepStrictEqual(pinned(batch.policy),pinned(policy)) || policy.rule.gradingSchemeId !== policy.scheme.id) fault();
    const enrolments = new Map(roster.map(row => [JSON.stringify([row.registrationId,row.courseId]),row]));
    for (const row of batch.rows) {
      const enrolled = enrolments.get(JSON.stringify([row.registrationId,row.courseId])),course = enrolled.courseSnapshot,grade = gradeForMark(policy.scheme,row.mark);
      const expected = {registrationId:row.registrationId,courseId:row.courseId,mark:row.mark,studentNumber:enrolled.studentNumber,programmeId:enrolled.programmeId,code:course.code,title:course.title,credits:Number(course.credits),grade:grade.grade,points:grade.points,passing:grade.passing};
      if (!Number.isFinite(expected.credits) || !isDeepStrictEqual(row,expected)) fault();
    }
  } catch { fault(); }
}

export function assertResultReviewCustody(batch,review) {
  if (!review || !batch.reviewedBy || batch.reviewedBy === batch.createdBy || review.actorId !== batch.reviewedBy || review.timeMatches !== true
    || !batch.evidenceRef || review.metadata?.evidenceRef !== batch.evidenceRef || review.metadata?.checksum !== batch.checksum || review.reason?.trim() !== batch.reviewReason)
    throw requestError(409,'Result review custody requires reconciliation.');
}

async function resultReceipt(client,batchId,action) {
  const rows = (await client.query(`select a.actor_id as "actorId",a.reason,a.metadata,(a.occurred_at = case when $2 = 'results.batch.imported' then rb.created_at else rb.reviewed_at end) as "timeMatches"
    from audit_events a join result_batches rb on rb.id = a.subject_id
    where a.subject_type = 'ResultBatch' and a.subject_id = $1 and a.action = $2`,[batchId,`results.batch.${action}`])).rows;
  if (rows.length !== 1) throw requestError(409,`Result ${action === 'imported' ? 'source' : 'review'} custody requires reconciliation.`);
  return rows[0];
}

async function assertStoredResultSource(client,batch,roster,period) {
  if (typeof batch.policy?.rule?.id !== 'string' || !batch.policy.rule.id) throw requestError(409,'Result source custody requires reconciliation.');
  let policy;
  try {policy = await policyFor(client,batch.policy.rule.id,period.startsOn);} catch(error) {
    if (error.statusCode === 404) throw requestError(409,'Result source custody requires reconciliation.');
    throw error;
  }
  assertResultSourceCustody(batch,roster,policy,await resultReceipt(client,batch.id,'imported'));
}

export const resultCompletionVersion = 'result-period-completion-v1';
export function resultPublicationRecipients(rows,recipients) {
  const fault = () => {throw requestError(409,'Result publication recipients require reconciliation.');};
  const key = row => JSON.stringify([row.registrationId,row.courseId]);
  const valid = row => row && ['registrationId','courseId','programmeId','studentNumber'].every(field => typeof row[field] === 'string' && row[field]);
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(recipients) || rows.some(row => !valid(row)) || recipients.some(row => !valid(row) || typeof row.accountId !== 'string' || !row.accountId)) fault();
  const expected = new Set(rows.map(key)),byKey = new Map(recipients.map(row => [key(row),row]));
  if (expected.size !== rows.length || byKey.size !== recipients.length || byKey.size !== expected.size) fault();
  for (const row of rows) {
    const recipient = byKey.get(key(row));
    if (!recipient || recipient.programmeId !== row.programmeId || recipient.studentNumber !== row.studentNumber) fault();
  }
  return [...new Set(recipients.map(row => row.accountId))].sort();
}
export function resultPeriodCompletion(roster,batches,official) {
  const fault = () => {throw requestError(409,'Result completion source evidence requires reconciliation.');};
  const key = (row) => JSON.stringify([row.registrationId,row.courseId]);
  const validKey = (row) => row && typeof row.registrationId === 'string' && row.registrationId && typeof row.courseId === 'string' && row.courseId;
  if (![roster,batches,official].every(Array.isArray) || roster.some(row => !validKey(row))) fault();
  const expected = new Set(roster.map(key));
  if (expected.size !== roster.length) fault();
  const ids = new Set();
  for (const batch of batches) {
    if (!batch || typeof batch.id !== 'string' || !batch.id || ids.has(batch.id) || !['draft','reviewed','rejected','published'].includes(batch.status) || !Array.isArray(batch.rows)) fault();
    ids.add(batch.id);
    try {
      validateResultsExport({sourceRef:batch.sourceRef,rows:batch.rows.map(row => ({registrationId:row?.registrationId,courseId:row?.courseId,mark:row?.mark})),expectedRowCount:batch.rowCount,expectedMarkTotal:batch.markTotal,checksum:batch.checksum});
    } catch { fault(); }
  }
  const active = batches.filter(batch => batch.status !== 'rejected');
  if (active.length > 1) fault();
  const batch = active[0],recorded = new Set((batch?.rows || []).map(key)),published = new Set();
  for (const row of official) {
    if (!validKey(row) || published.has(key(row)) || !batch || batch.status !== 'published' || row.batchId !== batch.id || !recorded.has(key(row))
      || !Number.isInteger(row.revision) || row.revision < 0 || !validKey(row.snapshot) || key(row.snapshot) !== key(row)) fault();
    published.add(key(row));
  }
  if (batch?.status === 'published' && published.size !== recorded.size) fault();
  const covered = [...expected].filter(value => recorded.has(value)).length;
  const counts = {
    expectedRecords:expected.size,
    recordedRecords:covered,
    awaitingRecording:expected.size-covered,
    awaitingReview:batch?.status === 'draft' ? covered : 0,
    awaitingPublication:batch?.status === 'reviewed' ? covered : 0,
    publishedRecords:batch?.status === 'published' ? covered : 0,
    outsideRosterRecords:recorded.size-covered,
    rejectedBatches:batches.filter(entry => entry.status === 'rejected').length
  };
  const controls = {
    completionPartition:counts.awaitingRecording+counts.awaitingReview+counts.awaitingPublication+counts.publishedRecords === counts.expectedRecords,
    recordingPartition:counts.recordedRecords+counts.awaitingRecording === counts.expectedRecords,
    officialCustody:published.size === (batch?.status === 'published' ? recorded.size : 0)
  };
  if (Object.values(controls).some(value => !value)) fault();
  return {definitionVersion:resultCompletionVersion,counts,controls,sourceCurrent:!batch || covered === expected.size && recorded.size === expected.size};
}

export function assertResultPublicationWindow(period,today = todayIso()) {
  const window = period.windows?.results_publication;
  if (period.status !== "closed" || !["published","active","closed"].includes(period.calendarStatus) || !window || today < window[0] || today > window[1])
    throw requestError(409,"Results publication is closed in the academic calendar.");
}

function reason(input) {
  if (typeof input?.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"A reason of 1-2000 characters is required.");
}

async function programmeFor(client,id,actor,own) {
  const row = (await client.query(`select sp.id,sp.intake_id as "intakeId",sp.programme_version_id as "programmeVersionId",sp.student_id as "studentId",s.account_id as "accountId",p.code as "programmeCode"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}

async function periodFor(client,id,programme,lock = false) {
  const period = (await client.query(`select rp.id,rp.intake_id as "intakeId",rp.programme_version_id as "programmeVersionId",rp.status,ap.name,
    to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",ap.lifecycle_status as "calendarStatus",ap.windows
    from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id where rp.id = $1
    ${lock ? "for update of rp for share of ap" : ""}`,[id])).rows[0];
  if (!period || period.intakeId !== programme.intakeId || period.programmeVersionId !== programme.programmeVersionId) throw requestError(404,"Registration period was not found for this intake/curriculum.");
  return period;
}

async function rosterFor(client,periodId) {
  return (await client.query(`select ce.registration_id as "registrationId",ce.course_id as "courseId",ce.course_snapshot as "courseSnapshot",
    s.student_number as "studentNumber",sr.student_programme_id as "programmeId"
    from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join students s on s.id = ce.student_id
    where sr.period_id = $1 and sr.status = 'confirmed' and ce.withdrawn_at is null order by s.student_number,ce.course_id`,[periodId])).rows;
}

async function policyFor(client,id,date) {
  const rule = (await client.query(`select id,code,version,rules,grading_scheme_id as "gradingSchemeId",status,
    to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(effective_to,'YYYY-MM-DD') as "effectiveTo" from gpa_rule_sets where id = $1 for share`,[id])).rows[0];
  if (!rule) throw requestError(404,"GPA rule set was not found.");
  const scheme = (await client.query(`select id,code,version,bands,classifications,status,
    to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(effective_to,'YYYY-MM-DD') as "effectiveTo" from grading_schemes where id = $1 for share`,[rule.gradingSchemeId])).rows[0];
  for (const policy of [rule,scheme]) {
    if (!policy || policy.status !== "published" || !policy.effectiveFrom || policy.effectiveFrom > date || policy.effectiveTo && policy.effectiveTo < date)
      throw requestError(409,"Grading and GPA policies must be published and effective for this academic period.");
  }
  return {rule,scheme};
}

const batchSelect = `select id,period_id as "periodId",source_ref as "sourceRef",checksum,row_count as "rowCount",mark_total as "markTotal",
  rows,policy_snapshot as policy,status,created_by as "createdBy",reviewed_by as "reviewedBy",evidence_ref as "evidenceRef",
  import_reason as "importReason",review_reason as "reviewReason",publication_reason as "publicationReason",published_at as "publishedAt" from result_batches`;

async function batchFor(client,id,periodId,lock = false) {
  const batch = (await client.query(`${batchSelect} where id = $1 and period_id = $2 ${lock ? "for update" : ""}`,[id,periodId])).rows[0];
  if (!batch) throw requestError(404,"Result batch was not found in this period.");
  return batch;
}

export async function publishedStudentResultRows(client,id) {
  const batches=(await client.query(`${batchSelect} where status = 'published' and period_id in (select period_id from student_registrations where student_programme_id = $1) order by published_at,id`,[id])).rows;
  const amended=(await client.query(`select registration_id as "registrationId",course_id as "courseId",result_snapshot as snapshot from academic_results
    where batch_id=any($1) and revision>0 and registration_id in (select id from student_registrations where student_programme_id=$2)`,[batches.map(batch => batch.id),id])).rows;
  return batches.flatMap(batch => {
    const rows=batch.rows.filter(row => row.programmeId===id).map(row => {
      const current=amended.find(entry => entry.registrationId===row.registrationId && entry.courseId===row.courseId);
      return current ? {...current.snapshot,amended:true,publishedMark:row.mark} : row;
    });
    return rows.length ? [{batch,rows}] : [];
  });
}

export function createResultsModule(pool) {
  return {
    async listProgrammeResults(id,actor,own = false) {
      return withTransaction(pool,async (client) => {
        await client.query('set transaction isolation level repeatable read');
        const programme = await programmeFor(client,id,actor,own);
        if (own) {
          return (await publishedStudentResultRows(client,id)).flatMap(({batch,rows}) => {
            return [{batchId:batch.id,sourceRef:batch.sourceRef,publishedAt:batch.publishedAt,results:rows,
              policy:{ruleSetId:batch.policy.rule.id,ruleSetVersion:batch.policy.rule.version,gradingSchemeId:batch.policy.scheme.id,gradingSchemeVersion:batch.policy.scheme.version},
              ...calculateGpa(rows.map((row) => ({courseCode:row.code,credits:row.credits,mark:row.mark})),batch.policy.rule.rules,batch.policy.scheme)}];
          });
        }
        const ids = (await client.query("select id from registration_periods where intake_id = $1 and programme_version_id = $2 order by id",[programme.intakeId,programme.programmeVersionId])).rows;
        const periods = [];
        for (const {id:periodId} of ids) {
          const batches = (await client.query(`${batchSelect} where period_id = $1 order by created_at,id`,[periodId])).rows;
          const official = (await client.query(`select registration_id as "registrationId",course_id as "courseId",batch_id as "batchId",result_snapshot as snapshot,revision from academic_results where batch_id = any($1)`,[batches.map((batch) => batch.id)])).rows;
          const amendments = (await client.query(`select a.id::int,a.batch_id as "batchId",a.registration_id as "registrationId",a.course_id as "courseId",a.category,a.from_snapshot as "from",a.to_snapshot as "to",
            a.reason,a.evidence_ref as "evidenceRef",a.status,a.requested_by as "requestedBy",a.review_reason as "reviewReason" from result_amendments a join result_batches rb on rb.id = a.batch_id
            where rb.period_id = $1 order by a.id desc`,[periodId])).rows;
          const period = await periodFor(client,periodId,programme),roster = await rosterFor(client,periodId);
          periods.push({period,roster,batches,official,amendments,completion:resultPeriodCompletion(roster,batches,official)});
        }
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const capabilities = Object.fromEntries(["import","review","publish","amend.request","amend.approve"].map((action) => [action,actor.permissions.includes(`results.${action}`)
          && actorCanAccessScope({...actor,authorizingPermission:`results.${action}`},scope)]));
        const policies = (await client.query("select id,name,version from gpa_rule_sets where status = 'published' order by code,version desc")).rows;
        await insertAudit(client,{actorId:actor.accountId,action:'results.completion.viewed',subjectType:'StudentProgramme',subjectId:id,reason:'Scoped result completion view',metadata:{definitionVersion:resultCompletionVersion,periodCount:periods.length,changedSourcePeriods:periods.filter(row => !row.completion.sourceCurrent).length}});
        return {periods,capabilities,policies,accountId:actor.accountId};
      });
    },

    async importResultBatch(id,periodId,input,actor) {
      reason(input);
      const controls = validateResultsExport(input);
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false);
        const period = await periodFor(client,periodId,programme,true);
        if (period.status !== "closed") throw requestError(409,"Close registration before importing final results.");
        if ((await client.query("select 1 from result_batches where source_ref = $1 or (period_id = $2 and status <> 'rejected')",[input.sourceRef.trim(),periodId])).rowCount) throw requestError(409,"Source already imported or this period has an active result batch.");
        const roster = await rosterFor(client,periodId);
        reconcileResultRoster(input.rows,roster);
        const policy = await policyFor(client,input.gpaRuleSetId,period.startsOn);
        const rows = input.rows.map((row) => {
          const enrolled = roster.find((entry) => entry.registrationId === row.registrationId && entry.courseId === row.courseId);
          const course = enrolled.courseSnapshot;
          const grade = gradeForMark(policy.scheme,row.mark);
          return {...row,studentNumber:enrolled.studentNumber,programmeId:enrolled.programmeId,code:course.code,title:course.title,credits:Number(course.credits),grade:grade.grade,points:grade.points,passing:grade.passing};
        });
        const batchId = `rb_${randomUUID()}`;
        const inserted = await client.query(`insert into result_batches (id,period_id,source_ref,checksum,row_count,mark_total,rows,policy_snapshot,created_by,import_reason)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`,[batchId,periodId,input.sourceRef.trim(),controls.checksum,controls.rowCount,controls.markTotal,JSON.stringify(rows),JSON.stringify(policy),actor.accountId,input.reason.trim()]);
        if (!inserted.rowCount) throw requestError(409,"Source already imported or this period has an active result batch.");
        await insertAudit(client,{actorId:actor.accountId,action:"results.batch.imported",subjectType:"ResultBatch",subjectId:batchId,reason:input.reason,
          metadata:{periodId,sourceRef:input.sourceRef.trim(),...controls}});
        return batchFor(client,batchId,periodId);
      });
    },

    async reviewResultBatch(id,periodId,batchId,input,actor) {
      reason(input);
      if (!["reviewed","rejected"].includes(input.outcome) || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"Choose reviewed or rejected and provide an evidence reference.");
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false);
        const period = await periodFor(client,periodId,programme,true);
        const batch = await batchFor(client,batchId,periodId,true);
        assertSeparateApprover(batch.createdBy,actor);
        if (batch.status !== "draft") throw requestError(409,"Only draft results can be reviewed.");
        const roster = await rosterFor(client,periodId);
        if (input.outcome === 'reviewed') await assertStoredResultSource(client,batch,roster,period);
        else reconcileResultRoster(batch.rows,roster);
        await client.query("update result_batches set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4,evidence_ref = $5 where id = $1",[batchId,input.outcome,actor.accountId,input.reason.trim(),input.evidenceRef.trim()]);
        // A rejected assembled batch releases its approved marks and accepted LMS outcomes so the period can be assembled again.
        const released = input.outcome === "rejected" ? {
          assessmentSubmissionIds:(await client.query("update assessment_submissions set status = 'approved',result_batch_id = null where result_batch_id = $1 returning id::int",[batchId])).rows.map((row) => row.id),
          lmsBatchIds:(await client.query("update lms_outcome_batches set status = 'accepted',result_batch_id = null,transferred_at = null where result_batch_id = $1 returning id::int",[batchId])).rows.map((row) => row.id)
        } : {};
        await insertAudit(client,{actorId:actor.accountId,action:`results.batch.${input.outcome}`,subjectType:"ResultBatch",subjectId:batchId,reason:input.reason,metadata:{evidenceRef:input.evidenceRef.trim(),checksum:batch.checksum,...released}});
        return batchFor(client,batchId,periodId);
      });
    },

    async publishResultBatch(id,periodId,batchId,input,actor) {
      reason(input);
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false);
        const period = await periodFor(client,periodId,programme,true);
        const batch = await batchFor(client,batchId,periodId,true);
        assertSeparateApprover(batch.createdBy,actor);
        if (batch.status === "published") return batch;
        if (batch.status !== "reviewed") throw requestError(409,"Independent review is required before publication.");
        assertResultPublicationWindow(period);
        await assertStoredResultSource(client,batch,await rosterFor(client,periodId),period);
        assertResultReviewCustody(batch,await resultReceipt(client,batch.id,'reviewed'));
        for (const row of batch.rows) await client.query("insert into academic_results (registration_id,course_id,batch_id,result_snapshot) values ($1,$2,$3,$4)",[row.registrationId,row.courseId,batchId,row]);
        const recipientRows = (await client.query(`select ar.registration_id as "registrationId",ar.course_id as "courseId",sr.student_programme_id as "programmeId",s.student_number as "studentNumber",s.account_id as "accountId"
          from academic_results ar join course_enrolments ce on ce.registration_id = ar.registration_id and ce.course_id = ar.course_id
          join student_registrations sr on sr.id = ce.registration_id
          join student_programmes sp on sp.id = sr.student_programme_id and sp.student_id = ce.student_id
          join students s on s.id = sp.student_id
          where ar.batch_id = $1 and sr.period_id = $2 and sr.status = 'confirmed'`,[batchId,periodId])).rows;
        const recipients = resultPublicationRecipients(batch.rows,recipientRows);
        for (const accountId of recipients) await queueNotification(client,accountId,'results.published',{}, {link:'#study/results',activeOnly:true});
        await client.query("update result_batches set status = 'published',published_by = $2,published_at = now(),publication_reason = $3 where id = $1",[batchId,actor.accountId,input.reason.trim()]);
        await insertAudit(client,{actorId:actor.accountId,action:"results.batch.published",subjectType:"ResultBatch",subjectId:batchId,reason:input.reason,metadata:{checksum:batch.checksum,rowCount:batch.rowCount,markTotal:batch.markTotal,queuedNotices:recipients.length}});
        return batchFor(client,batchId,periodId);
      });
    }
  };
}
