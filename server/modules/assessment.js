import { createHash, randomUUID } from "node:crypto";
import { actorCanAccessScope, assertSeparateApprover, insertAudit, requestError, todayIso, withTransaction } from "../support.js";
import { examOrderSelect, validateExamOrder } from "./exam-orders.js";
import { assertDeferredSittingReady, deferredCandidatesFor, deferredCompletionSelect, validateDeferredEntries } from "./deferred-assessment.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const states = ["mark","absent","deferred","exempt"];

export function validateComponents(components) {
  if (!Array.isArray(components) || !components.length || components.length > 10) throw requestError(400,"An assessment plan needs 1-10 components.");
  const codes = new Set();
  for (const component of components) {
    if (!component || Object.keys(component).some((key) => !["code","name","weight","maxMark"].includes(key)) || !/^[A-Z0-9_]{1,20}$/.test(component.code ?? "") || !text(component.name,100)
      || !Number.isInteger(component.weight) || component.weight < 1 || component.weight > 100 || !Number.isInteger(component.maxMark) || component.maxMark < 1 || component.maxMark > 1000) {
      throw requestError(400,"Each component needs an upper-case code, a name, a whole-number weight from 1-100, and a whole-number maximum mark.");
    }
    if (codes.has(component.code)) throw requestError(400,`Component ${component.code} appears more than once.`);
    codes.add(component.code);
  }
  const total = components.reduce((sum,component) => sum + component.weight,0);
  if (total !== 100) throw requestError(400,`Component weights must total 100 (currently ${total}).`);
  return components.map(({code,name,weight,maxMark}) => ({code,name:name.trim(),weight,maxMark}));
}

// Absent scores zero; exempt components are left out and the remaining weights rescaled; any deferral withholds the final mark.
export function finalMark(components,entries) {
  if (components.some((component) => !entries[component.code])) return {state:"missing",mark:null};
  if (components.some((component) => entries[component.code].state === "deferred")) return {state:"deferred",mark:null};
  const included = components.filter((component) => entries[component.code].state !== "exempt");
  if (!included.length) return {state:"exempt",mark:null};
  const weight = included.reduce((sum,component) => sum + component.weight,0);
  const score = included.reduce((sum,component) => sum + (entries[component.code].state === "mark" ? entries[component.code].mark / component.maxMark * component.weight : 0),0);
  return {state:"final",mark:Math.floor(score / weight * 100 + 0.5 + 1e-9)};
}

export function marksHash(rows) {
  return createHash("sha256").update(JSON.stringify([...rows].map((row) => [row.registrationId,row.componentCode,row.state,row.mark,row.revision]).sort((a,b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`)))).digest("hex");
}

export function moderationStages(mode) {
  if (mode === 'internal') return ['internal'];
  if (mode === 'internal_external') return ['internal','external'];
  if (mode === 'none') return [];
  throw requestError(400,"Choose no moderation, internal moderation, or internal and external moderation.");
}

export function moderationComplete(mode,reviews,hash) {
  return moderationStages(mode).every((stage) => reviews.some((row) => row.stage === stage && row.outcome === 'signed' && row.marksHash === hash));
}

export function submissionMatchesSheet(submission,sheet) {
  const expected = submission.finals.map((row) => row.registrationId).sort();
  const current = sheet.students.map((row) => row.registrationId).sort();
  return marksHash(sheet.marks) === submission.marksHash && JSON.stringify(expected) === JSON.stringify(current) && !sheet.missing.length;
}

export function importChecksum(rows) {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => [row.studentNumber,row.componentCode,row.value,row.reason ?? ""]))).digest("hex");
}

// Validates an uploaded mark file row by row against the plan, roster, and current marks. Nothing is thrown for row
// problems: every problem is reported against its 1-based row so the whole file can be corrected in one pass.
export function validateMarkImport(components,roster,current,rows) {
  const accepted = [],rejected = [],seen = new Map();
  rows.forEach((row,index) => {
    const at = index + 1,studentNumber = String(row?.studentNumber ?? "").trim(),componentCode = String(row?.componentCode ?? "").trim().toUpperCase();
    const raw = String(row?.value ?? "").trim(),reason = String(row?.reason ?? "").trim(),key = `${studentNumber}|${componentCode}`;
    const reject = (problem) => rejected.push({row:at,studentNumber,componentCode,problem});
    const student = roster.find((entry) => entry.studentNumber === studentNumber),component = components.find((entry) => entry.code === componentCode);
    if (!student) return reject("Student is not on the confirmed class list.");
    if (!component) return reject("Component is not in the approved plan.");
    if (seen.has(key)) {
      const first = seen.get(key);
      if (first.ok) {accepted.splice(accepted.indexOf(first.entry),1); first.ok = false; rejected.push({row:first.row,studentNumber,componentCode,problem:"Appears more than once in the file."});}
      return reject("Appears more than once in the file.");
    }
    const mark = /^\d+$/.test(raw) ? Number(raw) : null,state = mark !== null ? "mark" : raw.toLowerCase();
    let problem = null;
    if (mark !== null && mark > component.maxMark) problem = `Mark is above the component maximum of ${component.maxMark}.`;
    else if (mark === null && !["absent","deferred","exempt"].includes(state)) problem = "Value must be a whole-number mark or ABSENT, DEFERRED, or EXEMPT.";
    else if (mark === null && !reason) problem = `${raw.toUpperCase()} needs a reason.`;
    else if (reason.length > 500) problem = "Reason is longer than 500 characters.";
    if (problem) {seen.set(key,{ok:false,row:at}); return reject(problem);}
    const existing = current.find((entry) => entry.registrationId === student.registrationId && entry.componentCode === componentCode);
    const entry = {row:at,studentNumber,registrationId:student.registrationId,componentCode,state,mark,reason:state === "mark" ? null : reason,revision:existing?.revision ?? 0};
    entry.change = !existing ? "new" : existing.state === entry.state && (existing.mark ?? null) === entry.mark && (existing.reason ?? null) === entry.reason ? "unchanged" : "changed";
    accepted.push(entry);
    seen.set(key,{ok:true,row:at,entry});
  });
  rejected.sort((a,b) => a.row - b.row);
  const count = (change) => accepted.filter((row) => row.change === change).length;
  return {accepted,rejected,summary:{rows:rows.length,new:count("new"),changed:count("changed"),unchanged:count("unchanged"),rejected:rejected.length}};
}

export async function offeringFor(db,periodId,courseId) {
  const row = (await db.query(`select o.period_id as "periodId",o.course_id as "courseId",c.code,c.title,rp.intake_id as "intakeId",rp.status as "periodStatus",p.code as "programmeCode",ap.name as "periodName"
    from registration_offerings o join courses c on c.id = o.course_id join registration_periods rp on rp.id = o.period_id join academic_periods ap on ap.id = rp.academic_period_id
    join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id where o.period_id = $1 and o.course_id = $2`,[periodId,courseId])).rows[0];
  if (!row) throw requestError(404,"Course offering was not found.");
  return row;
}

// Authority comes from scoped permission, or for lecturers from an approved allocation on this offering that is in force today.
export async function authority(db,offering,actor) {
  const scope = {programmeCode:offering.programmeCode,intakeId:offering.intakeId};
  const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
  const today = todayIso();
  const allocations = actor.permissions.includes("teaching.self") ? (await db.query(`select a.role from teaching_allocations a join staff_members m on m.id = a.staff_id
    where a.period_id = $1 and a.course_id = $2 and m.account_id = $3 and m.status = 'active' and a.status = 'active' and a.effective_from <= $4::date and (a.effective_to is null or a.effective_to >= $4::date)`,
    [offering.periodId,offering.courseId,actor.accountId,today])).rows.map((row) => row.role) : [];
  const teaching = allocations.some((role) => ["lead","co_lecturer","tutor"].includes(role));
  return {view:teaching || allocations.length > 0 || can("teaching.view") || can("results.view") || can("assessment.marks") || can("assessment.review") || can("assessment.moderate") || can("assessment.external") || can("assessment.plan.manage"),
    managePlan:can("assessment.plan.manage") || allocations.includes("lead"),approvePlan:can("assessment.plan.approve"),
    enterMarks:teaching || can("assessment.marks"),submit:allocations.includes("lead") || can("assessment.marks"),review:can("assessment.review"),
    moderate:can("assessment.moderate"),external:can("assessment.external")};
}

// Actors with no standing on the offering get the same 404 as a read, so writes do not reveal which offerings exist.
async function requireAuthority(db,offering,actor,action,message) {
  const can = await authority(db,offering,actor);
  if (can[action]) return can;
  throw can.view ? requestError(403,message) : requestError(404,"Course offering was not found.");
}

async function rosterFor(db,periodId,courseId) {
  return (await db.query(`select ce.registration_id as "registrationId",s.student_number as "studentNumber",pe.legal_name as "legalName" from course_enrolments ce
    join student_registrations sr on sr.id = ce.registration_id join students s on s.id = ce.student_id join people pe on pe.id = s.person_id
    where sr.period_id = $1 and ce.course_id = $2 and sr.status = 'confirmed' and ce.withdrawn_at is null order by s.student_number`,[periodId,courseId])).rows;
}

const planSelect = `select id,period_id as "periodId",course_id as "courseId",version,components,moderation,status,reason,created_by as "createdBy",approved_by as "approvedBy",approval_reason as "approvalReason" from assessment_plans`;
const submissionSelect = `select id::int,plan_id as "planId",status,marks_hash as "marksHash",finals,submitted_by as "submittedBy",submitted_at as "submittedAt",submit_reason as "submitReason",
  reviewed_by as "reviewedBy",review_reason as "reviewReason",result_batch_id as "resultBatchId" from assessment_submissions`;
const moderationSelect = `select id::int,submission_id::int as "submissionId",stage,outcome,marks_hash as "marksHash",evidence_ref as "evidenceRef",reason,reviewed_by as "reviewedBy",reviewed_at as "reviewedAt" from assessment_moderations`;

async function sheetFor(db,plan,periodId,courseId) {
  const roster = await rosterFor(db,periodId,courseId);
  const marks = plan ? (await db.query(`select registration_id as "registrationId",component_code as "componentCode",state,mark,reason,revision from assessment_marks where plan_id = $1`,[plan.id])).rows : [];
  const students = roster.map((student) => {
    const entries = Object.fromEntries(marks.filter((row) => row.registrationId === student.registrationId).map((row) => [row.componentCode,row]));
    return {...student,entries,final:plan ? finalMark(plan.components,entries) : {state:"missing",mark:null}};
  });
  const missing = plan ? students.flatMap((student) => plan.components.filter((component) => !student.entries[component.code]).map((component) => ({studentNumber:student.studentNumber,componentCode:component.code}))) : [];
  return {students,marks,missing};
}

// Stores one mark at the next revision and copies it to the append-only history.
async function writeMark(db,plan,entry,actor,deferredCompletionId = null) {
  const values = [plan.id,entry.registrationId,entry.componentCode,entry.state,entry.state === "mark" ? entry.mark : null,entry.state === "mark" ? null : entry.reason.trim(),entry.revision + 1,actor.accountId];
  await db.query(`insert into assessment_marks (plan_id,registration_id,component_code,state,mark,reason,revision,entered_by) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (plan_id,registration_id,component_code) do update set state = excluded.state,mark = excluded.mark,reason = excluded.reason,revision = excluded.revision,entered_by = excluded.entered_by,entered_at = now()`,values);
  await db.query("insert into assessment_mark_history (plan_id,registration_id,component_code,state,mark,reason,revision,entered_by,deferred_completion_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",[...values,deferredCompletionId]);
}

export function createAssessmentModule(pool) {
  async function context(db,periodId,courseId,actor) {
    const offering = await offeringFor(db,periodId,courseId);
    const can = await authority(db,offering,actor);
    if (!can.view) throw requestError(404,"Course offering was not found.");
    const plans = (await db.query(`${planSelect} where period_id = $1 and course_id = $2 order by version desc`,[periodId,courseId])).rows;
    const plan = plans.find((row) => row.status === "approved") || null;
    const sheet = await sheetFor(db,plan,periodId,courseId);
    const submissions = plan ? (await db.query(`${submissionSelect} where plan_id = $1 order by id desc`,[plan.id])).rows : [];
    const reviews = plan ? (await db.query(`${moderationSelect} where submission_id in (select id from assessment_submissions where plan_id = $1) order by id`,[plan.id])).rows : [];
    const editors = plan ? (await db.query("select distinct entered_by from assessment_mark_history where plan_id = $1",[plan.id])).rows.map((row) => row.entered_by) : [];
    for (const submission of submissions) {
      submission.moderations = reviews.filter((row) => row.submissionId === submission.id);
      submission.moderationComplete = moderationComplete(plan.moderation,submission.moderations,submission.marksHash);
      submission.canModerate = submission.status === 'submitted' && submission.submittedBy !== actor.accountId && !editors.includes(actor.accountId);
    }
    const live = submissions.find((row) => ['submitted','approved','transferred'].includes(row.status)) || null;
    const examOrders = (await db.query(`${examOrderSelect} where eo.period_id = $1 and eo.course_id = $2 order by eo.submitted_at desc,eo.id`,[periodId,courseId])).rows;
    const deferredSittings = plan ? (await db.query(`select s.id,s.assessment_plan_id as "planId",s.component_code as "componentCode",s.paper,s.starts_at as "startsAt",s.duration_minutes as "durationMinutes",s.status,s.revision,
      et.published_snapshot as snapshot from exam_sittings s left join exam_timetables et on et.period_id = s.period_id where s.assessment_plan_id = $1 order by s.starts_at`,[plan.id])).rows : [];
    for (const sitting of deferredSittings) {
      sitting.candidates = await deferredCandidatesFor(db,sitting.id);
      sitting.completions = (await db.query(`${deferredCompletionSelect} where sitting_id = $1 order by id desc`,[sitting.id])).rows;
      try {
        assertDeferredSittingReady(sitting,sitting.snapshot);
        if (sitting.candidates.some((candidate) => {
          const student = sheet.students.find((row) => row.registrationId === candidate.registrationId),mark = student?.entries[sitting.componentCode];
          return !mark || mark.state !== 'deferred' || mark.revision !== candidate.markRevision;
        })) throw requestError(409,'Deferred candidates or their marks changed. Cancel and rebook this sitting.');
        sitting.ready = true;
      } catch (error) {sitting.ready = false; sitting.blockedReason = error.message;}
      delete sitting.snapshot;
    }
    return {offering,plans,plan,...sheet,submissions,live,examOrders,deferredSittings,capabilities:can,accountId:actor.accountId};
  }
  async function deferredWork(db,sittingId,actor,action,validate = true) {
    const select = `select id,period_id as "periodId",course_id as "courseId",assessment_plan_id as "planId",component_code as "componentCode",starts_at as "startsAt",duration_minutes as "durationMinutes",status,revision from exam_sittings where id = $1`;
    let sitting = (await db.query(select,[sittingId])).rows[0];
    if (!sitting || !sitting.planId) throw requestError(404,'Deferred sitting was not found.');
    const offering = await offeringFor(db,sitting.periodId,sitting.courseId);
    await requireAuthority(db,offering,actor,action,'Scoped deferred-assessment authority is required.');
    await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${sitting.periodId}`]);
    sitting = (await db.query(select,[sittingId])).rows[0];
    const plan = (await db.query(`${planSelect} where id = $1 for update`,[sitting.planId])).rows[0];
    await db.query('select id from registration_periods where id = $1 for update',[sitting.periodId]);
    if (validate) {
      if (plan.status !== 'approved') throw requestError(409,'The sitting no longer uses the approved assessment plan.');
      const snapshot = (await db.query('select published_snapshot from exam_timetables where period_id = $1',[sitting.periodId])).rows[0]?.published_snapshot;
      assertDeferredSittingReady(sitting,snapshot);
      if ((await db.query("select 1 from result_batches where period_id = $1 and status <> 'rejected'",[sitting.periodId])).rowCount) throw requestError(409,'An official results batch already exists. Resolve that batch before deferred completion.');
    }
    const sheet = await sheetFor(db,plan,sitting.periodId,sitting.courseId);
    const candidates = await deferredCandidatesFor(db,sitting.id);
    if (validate && candidates.some((row) => !sheet.students.some((student) => student.registrationId === row.registrationId))) throw requestError(409,'A deferred candidate is no longer on the confirmed class list.');
    const live = (await db.query(`${submissionSelect} where plan_id = $1 and status in ('submitted','approved','transferred') for update`,[plan.id])).rows[0] || null;
    return {sitting,plan,sheet,candidates,live};
  }
  return {
    async getAssessment(periodId,courseId,actor) {
      return withTransaction(pool,async (db) => context(db,periodId,courseId,actor));
    },
    async recordDeferredCompletion(sittingId,input,actor) {
      if (!input || Object.keys(input).some((key) => !['entries','evidenceRef','reason'].includes(key)) || !text(input.evidenceRef,200) || !text(input.reason,2000)) throw requestError(400,'Provide deferred outcomes, an evidence reference, and a reason.');
      return withTransaction(pool,async (db) => {
        const {sitting,plan,sheet,candidates,live} = await deferredWork(db,sittingId,actor,'enterMarks');
        if ((await db.query("select 1 from assessment_deferred_completions where sitting_id = $1 and status in ('submitted','approved')",[sittingId])).rowCount) throw requestError(409,'This sitting already has completion marks awaiting review or approved.');
        const component = plan.components.find((row) => row.code === sitting.componentCode);
        const entries = validateDeferredEntries(component,candidates,sheet.marks,input.entries);
        const row = (await db.query(`insert into assessment_deferred_completions (sitting_id,sitting_revision,plan_id,marks_hash,source_submission_id,entries,evidence_ref,reason,submitted_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id::int`,[sittingId,sitting.revision,plan.id,marksHash(sheet.marks),live?.id || null,JSON.stringify(entries),input.evidenceRef.trim(),input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:'assessment.deferred.submitted',subjectType:'DeferredCompletion',subjectId:String(row.id),reason:input.reason,
          metadata:{sittingId,planId:plan.id,periodId:sitting.periodId,courseId:sitting.courseId,evidenceRef:input.evidenceRef.trim(),students:entries.length,sourceSubmissionId:live?.id || null}});
        return context(db,sitting.periodId,sitting.courseId,actor);
      });
    },
    async reviewDeferredCompletion(completionId,input,actor) {
      if (!input || Object.keys(input).some((key) => !['outcome','reason'].includes(key)) || !['approved','returned'].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,'Choose approve or return and provide a review reason.');
      return withTransaction(pool,async (db) => {
        const initial = (await db.query(`${deferredCompletionSelect} where id = $1`,[completionId])).rows[0];
        if (!initial) throw requestError(404,'Deferred completion was not found.');
        const {sitting,plan,sheet,candidates,live} = await deferredWork(db,initial.sittingId,actor,'review',input.outcome === 'approved');
        const completion = (await db.query(`${deferredCompletionSelect} where id = $1 for update`,[completionId])).rows[0];
        if (completion.status !== 'submitted') throw requestError(409,'Only submitted deferred completions can be reviewed.');
        assertSeparateApprover(completion.submittedBy,actor);
        if (input.outcome === 'approved') {
          if (marksHash(sheet.marks) !== completion.marksHash || sitting.revision !== completion.sittingRevision || (live?.id || null) !== completion.sourceSubmissionId) throw requestError(409,'The marks, sitting or source submission changed. Return and resubmit the completion.');
          const component = plan.components.find((row) => row.code === sitting.componentCode);
          validateDeferredEntries(component,candidates,sheet.marks,completion.entries.map(({componentCode,...entry}) => entry));
          if (live?.status === 'transferred') throw requestError(409,'Transferred results require the official amendment process.');
          for (const entry of completion.entries) await writeMark(db,plan,entry,{accountId:completion.submittedBy},completion.id);
          if (live) {
            if (live.status === 'transferred') throw requestError(409,'Transferred results require the official amendment process.');
            await db.query('insert into assessment_submission_supersessions (submission_id,completion_id,previous_status,actor_id,reason) values ($1,$2,$3,$4,$5)',[live.id,completion.id,live.status,actor.accountId,input.reason.trim()]);
            await db.query("update assessment_submissions set status = 'superseded' where id = $1",[live.id]);
          }
        }
        await db.query('update assessment_deferred_completions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1',[completionId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`assessment.deferred.${input.outcome}`,subjectType:'DeferredCompletion',subjectId:String(completionId),reason:input.reason,
          metadata:{sittingId:sitting.id,planId:plan.id,periodId:sitting.periodId,courseId:sitting.courseId,evidenceRef:completion.evidenceRef,supersededSubmissionId:input.outcome === 'approved' ? live?.id || null : null,students:completion.entries.length}});
        return context(db,sitting.periodId,sitting.courseId,actor);
      });
    },
    async submitExamOrder(periodId,courseId,input,actor) {
      const order = validateExamOrder(input);
      return withTransaction(pool,async (db) => {
        const offering = await offeringFor(db,periodId,courseId);
        await requireAuthority(db,offering,actor,"managePlan","Only the lead lecturer or scoped academic staff can submit an exam order.");
        if (offering.periodStatus !== 'open') throw requestError(409,"Exam orders require an open registration period.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`exam-timetable:${periodId}`]);
        if ((await db.query("select 1 from exam_orders where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status in ('submitted','approved')",[periodId,courseId,order.paper])).rowCount) throw requestError(409,"An order for this paper already awaits review or is approved.");
        if ((await db.query("select 1 from exam_sittings where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status = 'scheduled'",[periodId,courseId,order.paper])).rowCount) throw requestError(409,"This paper already has a sitting. Cancel it before ordering a replacement.");
        const id = `exo_${randomUUID()}`;
        await db.query(`insert into exam_orders (id,period_id,course_id,paper,duration_minutes,paper_reference,materials_allowed,requirements,reason,submitted_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,periodId,courseId,order.paper,order.durationMinutes,order.paperReference,order.materialsAllowed,order.requirements,order.reason,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"exams.order.submitted",subjectType:"ExamOrder",subjectId:id,reason:order.reason,metadata:{periodId,courseId,paper:order.paper,durationMinutes:order.durationMinutes,paperReference:order.paperReference}});
        return context(db,periodId,courseId,actor);
      });
    },
    async draftAssessmentPlan(periodId,courseId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["components","reason","moderation"].includes(key)) || !text(input.reason,2000)) throw requestError(400,"Provide plan components and a reason.");
      const components = validateComponents(input.components);
      const moderation = input.moderation === undefined ? 'none' : input.moderation;
      moderationStages(moderation);
      return withTransaction(pool,async (db) => {
        const offering = await offeringFor(db,periodId,courseId);
        await requireAuthority(db,offering,actor,"managePlan","Only the lead lecturer or scoped academic staff can draft this plan.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`assessment-plan:${periodId}:${courseId}`]);
        if ((await db.query("select 1 from assessment_plans where period_id = $1 and course_id = $2 and status = 'draft'",[periodId,courseId])).rowCount) throw requestError(409,"A draft plan already awaits approval.");
        const version = (await db.query("select coalesce(max(version),0) + 1 as next from assessment_plans where period_id = $1 and course_id = $2",[periodId,courseId])).rows[0].next;
        const id = `asp_${randomUUID()}`;
        await db.query("insert into assessment_plans (id,period_id,course_id,version,components,reason,created_by,moderation) values ($1,$2,$3,$4,$5,$6,$7,$8)",[id,periodId,courseId,version,JSON.stringify(components),input.reason.trim(),actor.accountId,moderation]);
        await insertAudit(db,{actorId:actor.accountId,action:"assessment.plan.drafted",subjectType:"AssessmentPlan",subjectId:id,reason:input.reason,metadata:{periodId,courseId,version,components,moderation}});
        return context(db,periodId,courseId,actor);
      });
    },
    async approveAssessmentPlan(planId,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"An approval reason is required.");
      return withTransaction(pool,async (db) => {
        const plan = (await db.query(`${planSelect} where id = $1 for update`,[planId])).rows[0];
        if (!plan) throw requestError(404,"Assessment plan was not found.");
        const offering = await offeringFor(db,plan.periodId,plan.courseId);
        await requireAuthority(db,offering,actor,"approvePlan","Scoped plan-approval authority is required.");
        if (plan.status !== "draft") throw requestError(409,"Only draft plans can be approved.");
        assertSeparateApprover(plan.createdBy,actor);
        const current = (await db.query(`${planSelect} where period_id = $1 and course_id = $2 and status = 'approved' for update`,[plan.periodId,plan.courseId])).rows[0];
        if (current && (await db.query("select 1 from assessment_submissions where plan_id = $1 and status in ('submitted','approved','transferred')",[current.id])).rowCount) {
          throw requestError(409,"Marks under the current plan have been submitted. Return that submission before replacing the plan.");
        }
        if (current && (await db.query("select 1 from assessment_deferred_completions where plan_id = $1 and status = 'submitted'",[current.id])).rowCount) throw requestError(409,"Review or return pending deferred completions before replacing the plan.");
        if (current) await db.query("update assessment_plans set status = 'superseded' where id = $1",[current.id]);
        await db.query("update assessment_plans set status = 'approved',approved_by = $2,approved_at = now(),approval_reason = $3 where id = $1",[planId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"assessment.plan.approved",subjectType:"AssessmentPlan",subjectId:planId,reason:input.reason,metadata:{periodId:plan.periodId,courseId:plan.courseId,version:plan.version,superseded:current?.id || null}});
        return context(db,plan.periodId,plan.courseId,actor);
      });
    },
    async saveAssessmentMarks(periodId,courseId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["planId","entries"].includes(key)) || !text(input.planId,100) || !Array.isArray(input.entries) || !input.entries.length || input.entries.length > 5000) {
        throw requestError(400,"Provide the approved plan and 1-5000 mark entries.");
      }
      return withTransaction(pool,async (db) => {
        const offering = await offeringFor(db,periodId,courseId);
        await requireAuthority(db,offering,actor,"enterMarks","Only lecturers allocated to this offering or examinations staff can enter marks.");
        const plan = (await db.query(`${planSelect} where id = $1 and period_id = $2 and course_id = $3 for update`,[input.planId,periodId,courseId])).rows[0];
        if (!plan || plan.status !== "approved") throw requestError(409,"Marks can only be entered against the approved plan.");
        if ((await db.query("select 1 from assessment_submissions where plan_id = $1 and status in ('submitted','approved','transferred')",[plan.id])).rowCount) throw requestError(409,"These marks have been submitted and are locked. Ask the reviewer to return them for changes.");
        const roster = new Set((await rosterFor(db,periodId,courseId)).map((row) => row.registrationId));
        let saved = 0;
        for (const entry of input.entries) {
          const component = plan.components.find((row) => row.code === entry?.componentCode);
          if (!entry || Object.keys(entry).some((key) => !["registrationId","componentCode","state","mark","reason","revision"].includes(key)) || !roster.has(entry.registrationId) || !component
            || !states.includes(entry.state) || !Number.isInteger(entry.revision) || entry.revision < 0
            || (entry.state === "mark" ? !Number.isInteger(entry.mark) || entry.mark < 0 || entry.mark > component.maxMark || entry.reason !== undefined && entry.reason !== null && entry.reason !== "" : entry.mark !== undefined && entry.mark !== null || !text(entry.reason,500))) {
            throw requestError(400,`Each entry needs an enrolled student, a plan component, a whole mark up to the component maximum, or an absent/deferred/exempt state with a reason.`);
          }
          const existing = (await db.query("select revision from assessment_marks where plan_id = $1 and registration_id = $2 and component_code = $3 for update",[plan.id,entry.registrationId,entry.componentCode])).rows[0];
          if ((existing?.revision ?? 0) !== entry.revision) throw requestError(409,"Another change was saved for one of these marks. Reload before saving.");
          await writeMark(db,plan,entry,actor);
          saved++;
        }
        await insertAudit(db,{actorId:actor.accountId,action:"assessment.marks.saved",subjectType:"AssessmentPlan",subjectId:plan.id,reason:"Assessment marks saved",metadata:{periodId,courseId,entries:saved}});
        return context(db,periodId,courseId,actor);
      });
    },
    // Preview writes nothing. Apply needs a clean preview's baseline: any rejected row, or any mark changed since the
    // preview, refuses the whole file. A source reference applies once per plan and replays its original outcome.
    async importAssessmentMarks(periodId,courseId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["mode","planId","sourceRef","rows","baseline"].includes(key)) || !["preview","apply"].includes(input.mode)
        || !text(input.planId,100) || !text(input.sourceRef,200) || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 5000
        || input.rows.some((row) => !row || typeof row !== "object" || Object.keys(row).some((key) => !["studentNumber","componentCode","value","reason"].includes(key)))
        || input.mode === "apply" && !text(input.baseline,100)) {
        throw requestError(400,"Provide the mode, approved plan, a source reference, 1-5000 rows of studentNumber, componentCode, value, and reason, and the preview baseline to apply.");
      }
      return withTransaction(pool,async (db) => {
        const offering = await offeringFor(db,periodId,courseId);
        await requireAuthority(db,offering,actor,"enterMarks","Only lecturers allocated to this offering or examinations staff can upload marks.");
        const plan = (await db.query(`${planSelect} where id = $1 and period_id = $2 and course_id = $3 for update`,[input.planId,periodId,courseId])).rows[0];
        if (!plan || plan.status !== "approved") throw requestError(409,"Marks can only be uploaded against the approved plan.");
        if (input.mode === "apply") await db.query("select pg_advisory_xact_lock(hashtext($1))",[`assessment-import:${plan.id}`]);
        const sourceRef = input.sourceRef.trim(),checksum = importChecksum(input.rows);
        const previous = (await db.query(`select id::int,checksum,row_count as "rowCount",applied_count as "applied",unchanged_count as "unchanged",imported_at as "importedAt" from assessment_mark_imports
          where plan_id = $1 and source_ref = $2`,[plan.id,sourceRef])).rows[0];
        if (previous && previous.checksum !== checksum) throw requestError(409,"This source reference was already used for a different file. Use a new reference.");
        if (previous) return {mode:input.mode,replayed:true,import:previous,context:await context(db,periodId,courseId,actor)};
        if ((await db.query("select 1 from assessment_submissions where plan_id = $1 and status in ('submitted','approved','transferred')",[plan.id])).rowCount) throw requestError(409,"These marks have been submitted and are locked. Ask the reviewer to return them for changes.");
        const sheet = await sheetFor(db,plan,periodId,courseId);
        const report = validateMarkImport(plan.components,sheet.students,sheet.marks,input.rows);
        const baseline = marksHash(sheet.marks);
        if (input.mode === "preview") return {mode:"preview",sourceRef,checksum,baseline,...report};
        if (report.rejected.length) throw requestError(409,`${report.rejected.length} row(s) were rejected. Correct the file and preview it again.`);
        if (input.baseline !== baseline) throw requestError(409,"Marks changed after this preview. Preview the file again before applying it.");
        const changes = report.accepted.filter((row) => row.change !== "unchanged");
        for (const entry of changes) await writeMark(db,plan,entry,actor);
        const row = (await db.query(`insert into assessment_mark_imports (plan_id,source_ref,checksum,row_count,applied_count,unchanged_count,imported_by) values ($1,$2,$3,$4,$5,$6,$7)
          returning id::int,checksum,row_count as "rowCount",applied_count as "applied",unchanged_count as "unchanged",imported_at as "importedAt"`,
          [plan.id,sourceRef,checksum,input.rows.length,changes.length,input.rows.length - changes.length,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"assessment.marks.imported",subjectType:"AssessmentPlan",subjectId:plan.id,reason:`Mark file ${sourceRef} applied`,
          metadata:{periodId,courseId,importId:row.id,sourceRef,checksum,...report.summary}});
        return {mode:"apply",replayed:false,import:row,context:await context(db,periodId,courseId,actor)};
      });
    },
    async submitAssessmentMarks(periodId,courseId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["planId","reason"].includes(key)) || !text(input.planId,100) || !text(input.reason,2000)) throw requestError(400,"Provide the plan and a submission reason.");
      return withTransaction(pool,async (db) => {
        const offering = await offeringFor(db,periodId,courseId);
        await requireAuthority(db,offering,actor,"submit","Only the lead lecturer or examinations staff can submit marks.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`assessment-submit:${input.planId}`]);
        const plan = (await db.query(`${planSelect} where id = $1 and period_id = $2 and course_id = $3 for update`,[input.planId,periodId,courseId])).rows[0];
        if (!plan || plan.status !== "approved") throw requestError(409,"Only marks under the approved plan can be submitted.");
        if ((await db.query("select 1 from assessment_submissions where plan_id = $1 and status in ('submitted','approved','transferred')",[plan.id])).rowCount) throw requestError(409,"These marks are already submitted.");
        const sheet = await sheetFor(db,plan,periodId,courseId);
        if (!sheet.students.length) throw requestError(409,"There are no confirmed enrolments to submit.");
        if (sheet.missing.length) throw requestError(409,`${sheet.missing.length} mark(s) are missing, for example ${sheet.missing.slice(0,3).map((row) => `${row.studentNumber} ${row.componentCode}`).join(", ")}.`);
        const finals = sheet.students.map((student) => ({registrationId:student.registrationId,studentNumber:student.studentNumber,...student.final}));
        const row = (await db.query(`insert into assessment_submissions (plan_id,marks_hash,finals,submitted_by,submit_reason) values ($1,$2,$3,$4,$5) returning id::int`,
          [plan.id,marksHash(sheet.marks),JSON.stringify(finals),actor.accountId,input.reason.trim()])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"assessment.marks.submitted",subjectType:"AssessmentSubmission",subjectId:String(row.id),reason:input.reason,
          metadata:{planId:plan.id,periodId,courseId,students:finals.length,deferred:finals.filter((entry) => entry.state === "deferred").length}});
        return context(db,periodId,courseId,actor);
      });
    },
    async moderateAssessmentSubmission(submissionId,input,actor) {
      if (!input || Object.keys(input).some((key) => !['stage','outcome','evidenceRef','reason'].includes(key)) || !['internal','external'].includes(input.stage)
        || !['signed','changes_requested'].includes(input.outcome) || !text(input.evidenceRef,200) || !text(input.reason,2000)) throw requestError(400,"Choose a moderation stage and outcome, and provide an evidence reference and reason.");
      return withTransaction(pool,async (db) => {
        const submission = (await db.query(`${submissionSelect} where id = $1 for update`,[submissionId])).rows[0];
        if (!submission) throw requestError(404,"Submission was not found.");
        const plan = (await db.query(`${planSelect} where id = $1`,[submission.planId])).rows[0];
        const offering = await offeringFor(db,plan.periodId,plan.courseId);
        await requireAuthority(db,offering,actor,input.stage === 'internal' ? 'moderate' : 'external',"Scoped moderation authority is required for this stage.");
        if (submission.status !== 'submitted') throw requestError(409,"Only submitted marks can be moderated.");
        if (!moderationStages(plan.moderation).includes(input.stage)) throw requestError(409,"This stage is not required by the approved plan.");
        assertSeparateApprover(submission.submittedBy,actor);
        if ((await db.query("select 1 from assessment_mark_history where plan_id = $1 and entered_by = $2",[plan.id,actor.accountId])).rowCount) throw requestError(403,"A mark editor cannot moderate this sheet.");
        const reviews = (await db.query(`${moderationSelect} where submission_id = $1`,[submissionId])).rows;
        if (reviews.some((row) => row.stage === input.stage)) throw requestError(409,"This moderation stage already has a decision. Return the sheet and resubmit for a fresh review.");
        if (reviews.some((row) => row.reviewedBy === actor.accountId)) throw requestError(403,"Internal and external sign-offs must come from different people.");
        if (reviews.some((row) => row.outcome === 'changes_requested')) throw requestError(409,"Changes were requested. Return and resubmit the sheet.");
        if (input.stage === 'external' && !moderationComplete('internal',reviews,submission.marksHash)) throw requestError(409,"Internal moderation must be signed before external review.");
        const sheet = await sheetFor(db,plan,plan.periodId,plan.courseId);
        if (!submissionMatchesSheet(submission,sheet)) throw requestError(409,"Marks or enrolments changed after submission. Return it for resubmission.");
        const row = (await db.query(`insert into assessment_moderations (submission_id,stage,outcome,marks_hash,evidence_ref,reason,reviewed_by)
          values ($1,$2,$3,$4,$5,$6,$7) returning id::int`,[submissionId,input.stage,input.outcome,submission.marksHash,input.evidenceRef.trim(),input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:`assessment.moderation.${input.outcome}`,subjectType:"AssessmentSubmission",subjectId:String(submissionId),reason:input.reason,
          metadata:{planId:plan.id,periodId:plan.periodId,courseId:plan.courseId,moderationId:row.id,stage:input.stage,evidenceRef:input.evidenceRef.trim(),marksHash:submission.marksHash}});
        return context(db,plan.periodId,plan.courseId,actor);
      });
    },
    async reviewAssessmentSubmission(submissionId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","returned"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or return and give a reason.");
      return withTransaction(pool,async (db) => {
        const submission = (await db.query(`${submissionSelect} where id = $1 for update`,[submissionId])).rows[0];
        if (!submission) throw requestError(404,"Submission was not found.");
        const plan = (await db.query(`${planSelect} where id = $1`,[submission.planId])).rows[0];
        const offering = await offeringFor(db,plan.periodId,plan.courseId);
        await requireAuthority(db,offering,actor,"review","Scoped assessment-review authority is required.");
        if (submission.status !== "submitted") throw requestError(409,"Only submitted marks can be reviewed.");
        assertSeparateApprover(submission.submittedBy,actor);
        if (input.outcome === "approved") {
          const sheet = await sheetFor(db,plan,plan.periodId,plan.courseId);
          if (!submissionMatchesSheet(submission,sheet)) throw requestError(409,"Marks or enrolments changed after submission. Return it for resubmission.");
          const reviews = (await db.query(`${moderationSelect} where submission_id = $1`,[submissionId])).rows;
          if (!moderationComplete(plan.moderation,reviews,submission.marksHash)) throw requestError(409,"Required moderation sign-offs are incomplete. Return the sheet if changes were requested.");
        }
        await db.query("update assessment_submissions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[submissionId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`assessment.marks.${input.outcome}`,subjectType:"AssessmentSubmission",subjectId:String(submissionId),reason:input.reason,metadata:{planId:plan.id,periodId:plan.periodId,courseId:plan.courseId}});
        return context(db,plan.periodId,plan.courseId,actor);
      });
    }
  };
}
