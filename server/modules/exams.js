import { randomUUID } from "node:crypto";
import { queueNotification } from "../notification-queue.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, requestError, withTransaction } from "../support.js";
import { assertOrderMatchesSitting, examOrderSelect } from "./exam-orders.js";
import { deferredCandidatesFor } from "./deferred-assessment.js";
import { examResourceIssues, examsOverlap, invigilatorSelect, lockExamResources, publishedExamCommitments, resolveSittingVenue, validateInvigilators, venueSelect } from './exam-resources.js';
import { arrangementSelect, arrangementSittingHash, examCandidatesForSittings, examResourceSegments, operationalArrangement, personalExamSitting } from './exam-arrangements.js';
import { freezeExamManifests } from './exam-manifests.js';
import { currentSeatPlan } from './exam-seating-core.js';

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const isoWithOffset = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?(Z|[+-]\d{2}:[0-5]\d)$/;

// Normalises a sitting. The start must carry an explicit offset, so its local date (the date as entered) is unambiguous
// for the calendar-window check while the instant itself is stored in UTC.
export function validateSitting(input,{partial = false} = {}) {
  const keys = ["paper","startsAt","durationMinutes","venue","capacity","venueId"];
  const out = {};
  if (input.venueId !== undefined) {
    if (input.venueId !== null && !text(input.venueId,100)) throw requestError(400,'Select a managed venue or use a manual venue.');
    if (input.venueId === null && !text(input.venue,120)) throw requestError(400,'Provide the manual venue when removing a managed venue.');
    out.venueId = input.venueId;
  }
  if (!partial || input.paper !== undefined) {
    if (!text(input.paper,60)) throw requestError(400,"A paper name of 1-60 characters is required.");
    out.paper = input.paper.trim();
  }
  if (!partial || input.startsAt !== undefined) {
    const match = typeof input.startsAt === "string" && input.startsAt.match(isoWithOffset);
    const at = match ? new Date(input.startsAt) : null;
    const localDay = match ? new Date(`${match[1]}T00:00:00Z`) : null;
    if (!at || Number.isNaN(at.getTime()) || Number.isNaN(localDay.getTime()) || localDay.toISOString().slice(0,10) !== match[1]) throw requestError(400,"The start needs a real date, time, and UTC offset, for example 2025-06-02T09:00+02:00.");
    out.startsAt = at.toISOString(); out.localDate = match[1];
  }
  if (!partial || input.durationMinutes !== undefined) {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 480 || input.durationMinutes % 15) throw requestError(400,"Duration must be 15-480 minutes in steps of 15.");
    out.durationMinutes = input.durationMinutes;
  }
  if ((!partial && !input.venueId) || input.venue !== undefined) {
    if (!text(input.venue,120)) throw requestError(400,"A venue of 1-120 characters is required.");
    out.venue = input.venue.trim();
  }
  if (input.capacity !== undefined) {
    if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 5000)) throw requestError(400,"Capacity must be a whole number from 1-5000, or null.");
    out.capacity = input.capacity;
  }
  if (partial && !keys.some((key) => key in out || (key === "startsAt" && "localDate" in out))) throw requestError(400,"Change at least one sitting detail.");
  return out;
}

const ends = (sitting) => new Date(sitting.startsAt).getTime() + sitting.durationMinutes * 60000;
const overlaps = (a,b) => new Date(a.startsAt).getTime() < ends(b) && new Date(b.startsAt).getTime() < ends(a);

// Clashes are pairs of overlapping sittings that share at least one candidate. Venue problems are a sitting with more
// candidates than its capacity, or overlapping sittings in the same venue whose candidates together exceed the smaller
// declared capacity.
export function timetableIssues(sittings,candidatesByCourse,candidatesBySitting = {}) {
  const live = sittings.filter((row) => row.status === "scheduled").sort((a,b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const candidates = (sitting) => candidatesBySitting[sitting.id] ?? candidatesByCourse[sitting.courseId] ?? [];
  const count = (sitting) => candidates(sitting).length;
  const clashes = [],capacity = [];
  const groups = live.flatMap((row) => examResourceSegments({...row,invigilators:row.invigilators || []},candidates(row)));
  for (const group of groups) if (group.capacity && group.candidates.length > group.capacity) capacity.push({sittingIds:[group.id],venue:group.venue,candidates:group.candidates.length,capacity:group.capacity});
  for (let i = 0;i < live.length;i++) for (let j = i + 1;j < live.length;j++) {
    const [a,b] = [live[i],live[j]];
    const inA = new Set(candidates(a).map((row) => row.studentNumber));
    const extra = (sitting,number) => sitting.arrangements?.find((row) => row.studentNumber === number)?.extraMinutes || 0;
    const students = candidates(b).map((row) => row.studentNumber).filter((number) => inA.has(number) && overlaps({...a,durationMinutes:a.durationMinutes+extra(a,number)},{...b,durationMinutes:b.durationMinutes+extra(b,number)}));
    if (students.length) clashes.push({sittingIds:[a.id,b.id],students:students.sort()});
  }
  for (let i = 0;i < groups.length;i++) for (let j = i + 1;j < groups.length;j++) {
    const [a,b] = [groups[i],groups[j]],limits = [a.capacity,b.capacity].filter(Boolean);
    if (a.id !== b.id && overlaps(a,b) && a.venue.toLowerCase() === b.venue.toLowerCase() && limits.length && a.candidates.length + b.candidates.length > Math.min(...limits)) {
      capacity.push({sittingIds:[a.id,b.id],venue:a.venue,candidates:a.candidates.length + b.candidates.length,capacity:Math.min(...limits)});
    }
  }
  return {clashes,capacity};
}

const sittingSelect = `select s.id,s.period_id as "periodId",s.course_id as "courseId",c.code,c.title,s.paper,s.starts_at as "startsAt",to_char(s.local_date,'YYYY-MM-DD') as "localDate",
  s.duration_minutes as "durationMinutes",s.venue,s.capacity,s.venue_id as "venueId",s.venue_revision as "venueRevision",s.venue_location as "venueLocation",s.status,s.revision,s.order_id as "orderId",s.assessment_plan_id as "planId",s.component_code as "componentCode",s.updated_by as "updatedBy",s.updated_at as "updatedAt" from exam_sittings s join courses c on c.id = s.course_id`;
const iso = (row) => ({...row,startsAt:new Date(row.startsAt).toISOString()});

async function periodFor(db,periodId,actor,permissions) {
  const period = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.status,ap.name,ap.windows,p.code as "programmeCode",i.label as "intakeLabel"
    from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id where rp.id = $1`,[periodId])).rows[0];
  const scope = period && {programmeCode:period.programmeCode,intakeId:period.intakeId};
  if (!period || !permissions.some((permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope))) throw requestError(404,"Registration period was not found.");
  return period;
}

async function candidatesFor(db,periodId) {
  const rows = (await db.query(`select ce.course_id as "courseId",sr.id as "registrationId",s.student_number as "studentNumber",s.account_id as "accountId" from course_enrolments ce
    join student_registrations sr on sr.id = ce.registration_id join students s on s.id = ce.student_id where sr.period_id = $1 and sr.status = 'confirmed' order by s.student_number`,[periodId])).rows;
  return rows.reduce((map,row) => ({...map,[row.courseId]:[...(map[row.courseId] || []),row]}),{});
}

export function examCandidateChanges(sittings,candidatesByCourse,snapshot) {
  return sittings.filter((row) => row.status === 'scheduled' && !row.planId).flatMap((row) => {
    const published = snapshot?.sittings?.find((entry) => entry.id === row.id);
    if (!Array.isArray(published?.candidates)) return [];
    const before = new Set(published.candidates),after = new Set((candidatesByCourse[row.courseId] || []).map((entry) => entry.studentNumber));
    const added = [...after].filter((number) => !before.has(number)).length,removed = [...before].filter((number) => !after.has(number)).length;
    return added || removed ? [{sittingId:row.id,added,removed,published:before.size,current:after.size,started:Date.parse(row.startsAt) <= Date.now()}] : [];
  });
}

export function createExamsModule(pool) {
  const viewers = ["exams.schedule","exams.publish","results.view"];
  async function context(db,period,actor) {
    const timetable = (await db.query(`select status,revision,prepared_by as "preparedBy",prepared_at as "preparedAt",published_revision as "publishedRevision",published_snapshot as "publishedSnapshot",
      published_by as "publishedBy",published_at as "publishedAt",publication_reason as "publicationReason" from exam_timetables where period_id = $1`,[period.id])).rows[0] || null;
    const sittings = (await db.query(`${sittingSelect} where s.period_id = $1 order by s.starts_at,c.code,s.paper`,[period.id])).rows.map(iso);
    const venues = (await db.query(`${venueSelect} order by campus,code`)).rows;
    const assigned = (await db.query(`${invigilatorSelect} where i.sitting_id = any($1::text[]) order by i.role,m.employee_number`,[sittings.map((row) => row.id)])).rows;
    for (const sitting of sittings) sitting.invigilators = assigned.filter((row) => row.sittingId === sitting.id);
    const live = sittings.filter((row) => row.status === 'scheduled');
    const others = live.length ? (await db.query(`${sittingSelect} where s.status = 'scheduled' and s.starts_at < $1 and s.starts_at + (s.duration_minutes + 240) * interval '1 minute' > $2`,
      [new Date(Math.max(...live.map(ends))+240*60000),new Date(Math.min(...live.map((row) => Date.parse(row.startsAt))))])).rows.map(iso) : [];
    const otherStaff = (await db.query(`${invigilatorSelect} where i.sitting_id = any($1::text[])`,[others.map((row) => row.id)])).rows;
    for (const sitting of others) sitting.invigilators = otherStaff.filter((row) => row.sittingId === sitting.id);
    const candidates = await candidatesFor(db,period.id);
    const candidatesBySitting = {},deferredIssues = [];
    for (const sitting of sittings.filter((row) => row.planId)) {
      const assigned = await deferredCandidatesFor(db,sitting.id);
      candidatesBySitting[sitting.id] = assigned;
      sitting.candidates = assigned;
      sitting.completed = Boolean((await db.query("select 1 from assessment_deferred_completions where sitting_id = $1 and status = 'approved'",[sitting.id])).rowCount);
      if (sitting.status === 'scheduled' && !sitting.completed) {
        const valid = (await db.query(`select dc.registration_id from exam_deferred_candidates dc join assessment_marks m on m.plan_id = $2 and m.registration_id = dc.registration_id and m.component_code = $3
          join assessment_plans p on p.id = m.plan_id where dc.sitting_id = $1 and p.status = 'approved' and m.state = 'deferred' and m.revision = dc.mark_revision`,[sitting.id,sitting.planId,sitting.componentCode])).rows;
        if (valid.length !== assigned.length || assigned.some((row) => !(candidates[sitting.courseId] || []).some((entry) => entry.registrationId === row.registrationId))) deferredIssues.push({sittingId:sitting.id,problem:'Deferred candidates or their marks changed. Cancel and rebook this sitting.'});
      }
    }
    const deferrals = (await db.query(`select p.id as "planId",p.course_id as "courseId",p.components,m.component_code as "componentCode",m.registration_id as "registrationId",m.revision as "markRevision",s.student_number as "studentNumber"
      from assessment_plans p join assessment_marks m on m.plan_id = p.id join student_registrations sr on sr.id = m.registration_id and sr.status = 'confirmed'
      join course_enrolments ce on ce.registration_id = sr.id and ce.course_id = p.course_id join students s on s.id = ce.student_id where p.period_id = $1 and sr.period_id = p.period_id and p.status = 'approved' and m.state = 'deferred'`,[period.id])).rows;
    const deferredGroups = [];
    for (const row of deferrals) {
      let group = deferredGroups.find((entry) => entry.planId === row.planId && entry.componentCode === row.componentCode);
      if (!group) {group = {planId:row.planId,courseId:row.courseId,componentCode:row.componentCode,component:row.components.find((entry) => entry.code === row.componentCode),candidates:[]}; deferredGroups.push(group);}
      const booked = sittings.some((entry) => entry.status === 'scheduled' && !entry.completed && entry.planId === row.planId && entry.componentCode === row.componentCode && entry.candidates.some((candidate) => candidate.registrationId === row.registrationId));
      if (!booked) group.candidates.push({registrationId:row.registrationId,studentNumber:row.studentNumber,markRevision:row.markRevision});
    }
    const offerings = (await db.query(`select o.course_id as "courseId",c.code,c.title from registration_offerings o join courses c on c.id = o.course_id where o.period_id = $1 order by c.code`,[period.id])).rows
      .map((row) => ({...row,candidates:(candidates[row.courseId] || []).length,sittings:sittings.filter((sitting) => sitting.courseId === row.courseId && sitting.status === "scheduled").length}));
    const arrangementRows = (await db.query(`${arrangementSelect} where a.sitting_id = any($1::text[]) and a.status in ('requested','approved')`,[[...sittings,...others].map((row) => row.id)])).rows;
    const arrangementIssues = [];
    for (const row of [...sittings,...others]) {
      const approved = arrangementRows.filter((entry) => entry.sittingId === row.id && entry.status === 'approved');
      row.arrangements = approved.map(operationalArrangement);
      if (!sittings.some((entry) => entry.id === row.id) || row.status !== 'scheduled' || ends(row)+Math.max(0,...approved.map((entry) => entry.extraMinutes))*60000 <= Date.now()) continue;
      if (arrangementRows.some((entry) => entry.sittingId === row.id && entry.status === 'requested')) arrangementIssues.push({sittingId:row.id,problem:'A candidate arrangement request awaits independent review.'});
      const numbers = new Set((candidatesBySitting[row.id] || candidates[row.courseId] || []).map((entry) => entry.studentNumber));
      if (approved.some((entry) => entry.sittingHash !== arrangementSittingHash(row) || !numbers.has(entry.studentNumber))) arrangementIssues.push({sittingId:row.id,problem:'An approved candidate arrangement no longer matches this sitting or candidate. Revoke it and review a fresh request.'});
      if (approved.some((entry) => entry.venueId && !row.invigilators.some((staff) => staff.staffId === entry.invigilatorStaffId && staff.status === 'active' && staff.engagedOn <= row.localDate))) arrangementIssues.push({sittingId:row.id,problem:'A separate-room arrangement needs its active allocated invigilator.'});
    }
    const groups = sittings.flatMap((row) => examResourceSegments(row,candidatesBySitting[row.id] || candidates[row.courseId] || []));
    for (const row of live) {
      const own = groups.filter((group) => group.id === row.id),staffIds = own.flatMap((group) => group.invigilators.map((entry) => entry.staffId));
      if (new Set(staffIds).size !== staffIds.length) arrangementIssues.push({sittingId:row.id,problem:'An invigilator cannot supervise separate concurrent rooms.'});
      if (row.arrangements.some((entry) => entry.venueId) && own.some((group) => group.candidates.length && !group.invigilators.length)) arrangementIssues.push({sittingId:row.id,problem:'Each occupied arrangement room needs a dedicated allocated invigilator.'});
    }
    const otherCandidates = await examCandidatesForSittings(db,others.map((row) => row.id));
    const otherGroups = others.flatMap((row) => examResourceSegments(row,otherCandidates.filter((entry) => entry.sittingId === row.id)));
    const resourceIssues = examResourceIssues(groups,[...otherGroups,...await publishedExamCommitments(db,period.id)],venues);
    const issues = timetableIssues(sittings,candidates,candidatesBySitting);
    const orders = (await db.query(`${examOrderSelect} where eo.period_id = $1 order by eo.submitted_at desc,eo.id`,[period.id])).rows;
    const scope = {programmeCode:period.programmeCode,intakeId:period.intakeId};
    const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
    const staff = can('exams.schedule') ? (await db.query(`select m.id,m.employee_number as "employeeNumber",coalesce(p.legal_name,m.legal_name) as "legalName" from staff_members m
      left join accounts a on a.id = m.account_id left join people p on p.id = a.person_id where m.status = 'active' order by m.employee_number`)).rows : [];
    return {period:{id:period.id,name:period.name,status:period.status,programmeCode:period.programmeCode,intakeLabel:period.intakeLabel,assessmentWindow:period.windows?.assessment || null},
      timetable,sittings,offerings,orders,venues,staff,candidateChanges:examCandidateChanges(sittings,candidates,timetable?.publishedSnapshot),resourceIssues,arrangementIssues:arrangementIssues.filter((row,index) => arrangementIssues.findIndex((entry) => entry.sittingId === row.sittingId && entry.problem === row.problem) === index),resourceSegments:groups.map(({candidates,arrangements,...row}) => row),deferredIssues,deferredGroups:deferredGroups.filter((row) => row.candidates.length),...issues,capabilities:{schedule:can("exams.schedule"),publish:can("exams.publish"),arrangements:['exams.arrangements.manage','exams.arrangements.review'].some(can),papers:['exams.papers.manage','exams.papers.review','exams.papers.scan','exams.papers.release'].some(can)},accountId:actor.accountId};
  }
  // Every change bumps the timetable revision and returns it to draft under the editor's name, so publication always
  // comes from someone other than the last editor and always covers the latest state.
  async function touch(db,periodId,actor) {
    await db.query(`insert into exam_timetables (period_id,prepared_by) values ($1,$2)
      on conflict (period_id) do update set status = 'draft',revision = exam_timetables.revision + 1,prepared_by = $2,prepared_at = now()`,[periodId,actor.accountId]);
  }
  function assertInWindow(period,localDate) {
    const window = period.windows?.assessment;
    if (!window) throw requestError(409,"Define the assessment window in the academic calendar before scheduling examinations.");
    if (localDate < window[0] || localDate > window[1]) throw requestError(409,`Sittings must fall within the assessment window (${window[0]} to ${window[1]}).`);
  }
  return {
    async listExamPeriods(actor) {
      return withTransaction(pool,async (db) => {
        const rows = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.status,ap.name,p.code as "programmeCode",i.label as "intakeLabel",et.status as "timetableStatus",et.published_at as "publishedAt"
          from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id
          left join exam_timetables et on et.period_id = rp.id where rp.status in ('open','closed') order by ap.starts_on desc,p.code`)).rows;
        return rows.filter((row) => viewers.some((permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId})))
          .map(({intakeId,...row}) => row);
      });
    },
    async getExamTimetable(periodId,actor) {
      return withTransaction(pool,async (db) => context(db,await periodFor(db,periodId,actor,viewers),actor));
    },
    async refreshExamCandidates(periodId,input,actor) {
      if (!input || Object.keys(input).some((key) => !['revision','reason'].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000)) throw requestError(400,'Provide the timetable revision and a refresh reason.');
      return withTransaction(pool,async (db) => {
        const period = await periodFor(db,periodId,actor,['exams.schedule']);
        await lockExamResources(db);
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${periodId}`]);
        await db.query('select id from registration_periods where id = $1 for share',[periodId]);
        const timetable = (await db.query('select status,revision from exam_timetables where period_id = $1 for update',[periodId])).rows[0];
        if (!timetable || timetable.revision !== input.revision || timetable.status !== 'published') throw requestError(409,'Reload the current published timetable before refreshing candidates.');
        const current = await context(db,period,actor),changes = current.candidateChanges;
        if (!changes.length) throw requestError(409,'There are no candidate changes to prepare.');
        if (changes.some((row) => row.started)) throw requestError(409,'Candidate refresh cannot revise a sitting that has already started.');
        await touch(db,periodId,actor);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.candidates.refreshed',subjectType:'ExamTimetable',subjectId:periodId,reason:input.reason,metadata:{revision:timetable.revision+1,changes}});
        return context(db,period,actor);
      });
    },
    async reviewExamOrder(orderId,input,actor) {
      if (!input || Object.keys(input).some((key) => !['outcome','reason'].includes(key)) || !['approved','returned'].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or return and provide a reason.");
      return withTransaction(pool,async (db) => {
        const order = (await db.query(`${examOrderSelect} where eo.id = $1 for update of eo`,[orderId])).rows[0];
        if (!order) throw requestError(404,"Exam order was not found.");
        const period = await periodFor(db,order.periodId,actor,viewers);
        assertActorCanAccessScope({...actor,authorizingPermission:'exams.schedule'},{programmeCode:period.programmeCode,intakeId:period.intakeId});
        if (order.status !== 'submitted') throw requestError(409,"Only submitted exam orders can be reviewed.");
        assertSeparateApprover(order.submittedBy,actor);
        await db.query("update exam_orders set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[orderId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`exams.order.${input.outcome}`,subjectType:'ExamOrder',subjectId:orderId,reason:input.reason,metadata:{periodId:order.periodId,courseId:order.courseId,paper:order.paper}});
        return context(db,period,actor);
      });
    },
    async scheduleSitting(periodId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["courseId","paper","startsAt","durationMinutes","venue","capacity","venueId","reason","orderId","deferred"].includes(key)) || !text(input.courseId,100) || !text(input.reason,2000) || input.orderId !== undefined && !text(input.orderId,100)) {
        throw requestError(400,"Provide the course, paper, start, duration, venue, optional capacity, and a reason.");
      }
      const fields = validateSitting(input);
      return withTransaction(pool,async (db) => {
        const period = await periodFor(db,periodId,actor,viewers);
        assertActorCanAccessScope({...actor,authorizingPermission:"exams.schedule"},{programmeCode:period.programmeCode,intakeId:period.intakeId});
        if (!(await db.query("select 1 from registration_offerings where period_id = $1 and course_id = $2",[periodId,input.courseId])).rowCount) throw requestError(404,"The course is not offered in this period.");
        assertInWindow(period,fields.localDate);
        await lockExamResources(db);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`exam-timetable:${periodId}`]);
        const sitting = await resolveSittingVenue(db,fields);
        let deferredCandidates = [];
        if (input.deferred !== undefined) {
          const deferred = input.deferred;
          if (!deferred || Object.keys(deferred).some((key) => !['planId','componentCode','registrationIds'].includes(key)) || !text(deferred.planId,100) || !text(deferred.componentCode,20)
            || !Array.isArray(deferred.registrationIds) || !deferred.registrationIds.length || deferred.registrationIds.length > 5000 || deferred.registrationIds.some((id) => !text(id,100)) || new Set(deferred.registrationIds).size !== deferred.registrationIds.length) throw requestError(400,'Choose the approved plan, component and distinct deferred candidates.');
          const plan = (await db.query("select status,components from assessment_plans where id = $1 and period_id = $2 and course_id = $3 for share",[deferred.planId,periodId,input.courseId])).rows[0];
          if (!plan || plan.status !== 'approved' || !plan.components.some((row) => row.code === deferred.componentCode)) throw requestError(409,'Choose a component of the approved assessment plan.');
          deferredCandidates = (await db.query(`select m.registration_id as "registrationId",m.revision as "markRevision" from assessment_marks m join student_registrations sr on sr.id = m.registration_id
            join course_enrolments ce on ce.registration_id = sr.id and ce.course_id = $4 where m.plan_id = $1 and m.component_code = $2 and m.state = 'deferred' and sr.period_id = $3 and sr.status = 'confirmed'
            and m.registration_id = any($5::text[])`,[deferred.planId,deferred.componentCode,periodId,input.courseId,deferred.registrationIds])).rows;
          if (deferredCandidates.length !== deferred.registrationIds.length) throw requestError(409,'Every selected candidate must have a current deferral for this component.');
          if ((await db.query(`select 1 from exam_deferred_candidates dc join exam_sittings s on s.id = dc.sitting_id where s.assessment_plan_id = $1 and s.component_code = $2 and s.status = 'scheduled'
            and dc.registration_id = any($3::text[]) and not exists (select 1 from assessment_deferred_completions completion where completion.sitting_id = s.id and completion.status = 'approved')`,[deferred.planId,deferred.componentCode,deferred.registrationIds])).rowCount) throw requestError(409,'A selected candidate already has an active deferred sitting. Cancel it before rebooking.');
        }
        if (input.orderId) {
          const order = (await db.query(`${examOrderSelect} where eo.id = $1 and eo.period_id = $2 for share of eo`,[input.orderId,periodId])).rows[0];
          if (!order) throw requestError(404,"Exam order was not found in this period.");
          assertOrderMatchesSitting(order,input.courseId,sitting);
          if (order.sittingId) throw requestError(409,"This exam order already has an active sitting.");
        } else if ((await db.query("select 1 from exam_orders where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status in ('submitted','approved')",[periodId,input.courseId,sitting.paper])).rowCount) {
          throw requestError(409,"This paper has an exam order. Approve and link it before scheduling.");
        }
        if ((await db.query("select 1 from exam_sittings where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status = 'scheduled'",[periodId,input.courseId,sitting.paper])).rowCount) {
          throw requestError(409,`${sitting.paper} is already scheduled for this course.`);
        }
        const id = `exs_${randomUUID()}`;
        await db.query(`insert into exam_sittings (id,period_id,course_id,paper,starts_at,local_date,duration_minutes,venue,capacity,updated_by,order_id,assessment_plan_id,component_code,venue_id,venue_revision,venue_location) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [id,periodId,input.courseId,sitting.paper,sitting.startsAt,sitting.localDate,sitting.durationMinutes,sitting.venue,sitting.capacity ?? null,actor.accountId,input.orderId || null,input.deferred?.planId || null,input.deferred?.componentCode || null,sitting.venueId,sitting.venueRevision,sitting.venueLocation]);
        for (const candidate of deferredCandidates) await db.query('insert into exam_deferred_candidates (sitting_id,registration_id,mark_revision) values ($1,$2,$3)',[id,candidate.registrationId,candidate.markRevision]);
        const row = {...iso((await db.query(`${sittingSelect} where s.id = $1`,[id])).rows[0]),invigilators:[]};
        await db.query("insert into exam_sitting_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,1,'scheduled',$2,$3,$4)",[id,row,input.reason.trim(),actor.accountId]);
        await touch(db,periodId,actor);
        await insertAudit(db,{actorId:actor.accountId,action:"exams.sitting.scheduled",subjectType:"ExamSitting",subjectId:id,reason:input.reason,metadata:{periodId,courseId:input.courseId,paper:sitting.paper,startsAt:sitting.startsAt,orderId:input.orderId || null}});
        return context(db,period,actor);
      });
    },
    async changeSitting(sittingId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["revision","paper","startsAt","durationMinutes","venue","capacity","venueId","cancel","reason"].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000)
        || input.cancel !== undefined && input.cancel !== true) throw requestError(400,"Provide the sitting revision, the changes or cancel: true, and a reason.");
      const {revision,cancel,reason,...fields} = input;
      if (cancel && Object.keys(fields).length) throw requestError(400,"Cancel a sitting without other changes.");
      const changes = cancel ? {} : validateSitting(fields,{partial:true});
      return withTransaction(pool,async (db) => {
        let current = (await db.query(`${sittingSelect} where s.id = $1`,[sittingId])).rows[0];
        if (!current) throw requestError(404,"Sitting was not found.");
        const period = await periodFor(db,current.periodId,actor,viewers);
        assertActorCanAccessScope({...actor,authorizingPermission:"exams.schedule"},{programmeCode:period.programmeCode,intakeId:period.intakeId});
        await lockExamResources(db);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`exam-timetable:${current.periodId}`]);
        current = (await db.query(`${sittingSelect} where s.id = $1 for update of s`,[sittingId])).rows[0];
        if ((await db.query("select 1 from assessment_deferred_completions where sitting_id = $1 and status in ('submitted','approved')",[sittingId])).rowCount) throw requestError(409,'This sitting has completion marks awaiting review or already approved.');
        if (current.status !== "scheduled") throw requestError(409,"Cancelled sittings cannot be changed.");
        if (current.revision !== revision) throw requestError(409,"This sitting changed since you loaded it. Reload before changing it.");
        if (changes.localDate) assertInWindow(period,changes.localDate);
        if (changes.paper && changes.paper.toLowerCase() !== current.paper.toLowerCase()
          && (await db.query("select 1 from exam_sittings where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status = 'scheduled' and id <> $4",[current.periodId,current.courseId,changes.paper,sittingId])).rowCount) {
          throw requestError(409,`${changes.paper} is already scheduled for this course.`);
        }
        const next = {...current,startsAt:new Date(current.startsAt).toISOString(),...(cancel ? {} : await resolveSittingVenue(db,changes,current))};
        if (current.orderId && !cancel) {
          const order = (await db.query(`${examOrderSelect} where eo.id = $1`,[current.orderId])).rows[0];
          assertOrderMatchesSitting(order,current.courseId,next);
        } else if (!cancel && (await db.query("select 1 from exam_orders where period_id = $1 and course_id = $2 and lower(paper) = lower($3) and status in ('submitted','approved')",[current.periodId,current.courseId,next.paper])).rowCount) {
          throw requestError(409,"This paper has an exam order. Cancel the direct sitting and schedule a sitting linked to the approved order.");
        }
        await db.query(`update exam_sittings set paper = $2,starts_at = $3,local_date = $4,duration_minutes = $5,venue = $6,capacity = $7,status = $8,revision = revision + 1,updated_by = $9,updated_at = now(),venue_id = $10,venue_revision = $11,venue_location = $12 where id = $1`,
          [sittingId,next.paper,next.startsAt,next.localDate,next.durationMinutes,next.venue,next.capacity ?? null,cancel ? "cancelled" : "scheduled",actor.accountId,next.venueId,next.venueRevision,next.venueLocation]);
        const row = {...iso((await db.query(`${sittingSelect} where s.id = $1`,[sittingId])).rows[0]),invigilators:(await db.query(`${invigilatorSelect} where i.sitting_id = $1`,[sittingId])).rows};
        await db.query("insert into exam_sitting_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,$2,$3,$4,$5,$6)",[sittingId,row.revision,cancel ? "cancelled" : "changed",row,reason.trim(),actor.accountId]);
        await touch(db,current.periodId,actor);
        await insertAudit(db,{actorId:actor.accountId,action:cancel ? "exams.sitting.cancelled" : "exams.sitting.changed",subjectType:"ExamSitting",subjectId:sittingId,reason,metadata:{periodId:current.periodId,changes:Object.keys(changes)}});
        return context(db,period,actor);
      });
    },
    async replaceExamInvigilators(sittingId,input,actor) {
      validateInvigilators(input);
      return withTransaction(pool,async (db) => {
        let sitting = (await db.query(`${sittingSelect} where s.id = $1`,[sittingId])).rows[0];
        if (!sitting) throw requestError(404,'Sitting was not found.');
        const period = await periodFor(db,sitting.periodId,actor,viewers);
        assertActorCanAccessScope({...actor,authorizingPermission:'exams.schedule'},{programmeCode:period.programmeCode,intakeId:period.intakeId});
        await lockExamResources(db);
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${sitting.periodId}`]);
        sitting = iso((await db.query(`${sittingSelect} where s.id = $1 for update of s`,[sittingId])).rows[0]);
        if (sitting.status !== 'scheduled' || sitting.revision !== input.revision) throw requestError(409,'This sitting changed or was cancelled. Reload before assigning invigilators.');
        if ((await db.query("select 1 from assessment_deferred_completions where sitting_id = $1 and status in ('submitted','approved')",[sittingId])).rowCount) throw requestError(409,'A sitting with live completion marks cannot change its invigilators.');
        const ids = input.entries.map((row) => row.staffId);
        const staff = (await db.query("select id,status,to_char(engaged_on,'YYYY-MM-DD') as engaged from staff_members where id = any($1::text[]) order by id for share",[ids])).rows;
        if (staff.length !== ids.length) throw requestError(404,'An invigilator staff record was not found.');
        if (staff.some((row) => row.status !== 'active' || row.engaged > sitting.localDate)) throw requestError(409,'Invigilators must be active and engaged by the sitting date.');
        const others = (await db.query(`${sittingSelect} where s.id <> $1 and s.status = 'scheduled' and s.id in (select sitting_id from exam_sitting_invigilators where staff_id = any($2::text[]))
          and s.starts_at < $3 and s.starts_at + (s.duration_minutes + 240) * interval '1 minute' > $4`,[sittingId,ids,new Date(ends(sitting)+240*60000),sitting.startsAt])).rows.map(iso);
        const otherStaff = (await db.query(`${invigilatorSelect} where i.sitting_id = any($1::text[])`,[others.map((row) => row.id)])).rows;
        const arranged = (await db.query(`${arrangementSelect} where a.sitting_id = any($1::text[]) and a.status = 'approved'`,[[sittingId,...others.map((row) => row.id)]])).rows;
        sitting.invigilators = input.entries;sitting.arrangements = arranged.filter((row) => row.sittingId === sittingId).map(operationalArrangement);
        const candidates = await examCandidatesForSittings(db,[sittingId,...others.map((row) => row.id)]);
        const ownGroups = examResourceSegments(sitting,candidates.filter((row) => row.sittingId === sittingId));
        for (const row of others) {row.invigilators = otherStaff.filter((entry) => entry.sittingId === row.id);row.arrangements = arranged.filter((entry) => entry.sittingId === row.id).map(operationalArrangement);}
        const otherGroups = others.flatMap((row) => examResourceSegments(row,candidates.filter((entry) => entry.sittingId === row.id)));
        if (ownGroups.some((own) => otherGroups.some((row) => examsOverlap(own,row) && own.invigilators.some((entry) => row.invigilators.some((other) => other.staffId === entry.staffId))))) throw requestError(409,'An invigilator is already allocated to an overlapping sitting.');
        const published = await publishedExamCommitments(db,sitting.periodId);
        if (ownGroups.some((own) => published.some((row) => examsOverlap(own,row) && own.invigilators.some((entry) => row.invigilators.some((other) => other.staffId === entry.staffId))))) throw requestError(409,'An invigilator still has an overlapping published duty. Publish the changed timetable before reallocating staff.');
        await db.query('delete from exam_sitting_invigilators where sitting_id = $1',[sittingId]);
        for (const entry of input.entries) await db.query('insert into exam_sitting_invigilators (sitting_id,staff_id,role) values ($1,$2,$3)',[sittingId,entry.staffId,entry.role]);
        await db.query('update exam_sittings set revision = revision + 1,updated_by = $2,updated_at = now() where id = $1',[sittingId,actor.accountId]);
        const row = {...iso((await db.query(`${sittingSelect} where s.id = $1`,[sittingId])).rows[0]),invigilators:(await db.query(`${invigilatorSelect} where i.sitting_id = $1`,[sittingId])).rows};
        await db.query("insert into exam_sitting_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,$2,'changed',$3,$4,$5)",[sittingId,row.revision,row,input.reason.trim(),actor.accountId]);
        await touch(db,sitting.periodId,actor);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.invigilators.changed',subjectType:'ExamSitting',subjectId:sittingId,reason:input.reason,metadata:{periodId:sitting.periodId,revision:row.revision,entries:input.entries}});
        return context(db,period,actor);
      });
    },
    // Publication freezes the reviewed revision into the snapshot students read. It is refused while any candidate has a
    // clash or a venue is over capacity, and when the publisher made the latest change.
    async publishExamTimetable(periodId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["revision","reason"].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000)) throw requestError(400,"Provide the timetable revision and a reason.");
      return withTransaction(pool,async (db) => {
        const period = await periodFor(db,periodId,actor,viewers);
        assertActorCanAccessScope({...actor,authorizingPermission:"exams.publish"},{programmeCode:period.programmeCode,intakeId:period.intakeId});
        await lockExamResources(db);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`exam-timetable:${periodId}`]);
        // Confirmation locks this row for update; keep validation and frozen cohorts on one committed roster.
        await db.query('select id from registration_periods where id = $1 for share',[periodId]);
        const timetable = (await db.query("select status,revision,prepared_by as \"preparedBy\" from exam_timetables where period_id = $1 for update",[periodId])).rows[0];
        if (!timetable) throw requestError(409,"There is no timetable to publish yet.");
        if (timetable.revision !== input.revision) throw requestError(409,"The timetable changed since you reviewed it. Review the current version before publishing.");
        if (timetable.status === "published") throw requestError(409,"This revision is already published.");
        if (timetable.preparedBy === actor.accountId) throw requestError(403,"The timetable must be published by someone other than its last editor.");
        await db.query(`select m.id from staff_members m where m.id in (select i.staff_id from exam_sitting_invigilators i join exam_sittings s on s.id = i.sitting_id where s.period_id = $1) order by m.id for share`,[periodId]);
        const view = await context(db,period,actor);
        const live = view.sittings.filter((row) => row.status === "scheduled");
        const previous = (await db.query('select published_snapshot as snapshot,published_staff_snapshot as staff from exam_timetables where period_id = $1',[periodId])).rows[0];
        if (!live.length && !previous.snapshot) throw requestError(409,"Schedule at least one sitting before publishing.");
        if (view.clashes.length) throw requestError(409,`${view.clashes.length} clash(es) must be resolved before publishing.`);
        if (view.capacity.length) throw requestError(409,`${view.capacity.length} venue capacity problem(s) must be resolved before publishing.`);
        if (view.deferredIssues.length) throw requestError(409,view.deferredIssues[0].problem);
        if (view.resourceIssues.length) throw requestError(409,view.resourceIssues[0].problem);
        if (view.arrangementIssues.length) throw requestError(409,view.arrangementIssues[0].problem);
        const candidates = await candidatesFor(db,periodId);
        const snapshot = {revision:timetable.revision,sittings:live.map(({id,courseId,code,title,paper,startsAt,durationMinutes,venue,venueLocation,revision,planId,candidates:assigned,arrangements}) =>
          ({id,courseId,code,title,paper,startsAt,durationMinutes,venue,venueLocation,revision,arrangements,candidates:(planId ? assigned : candidates[courseId] || []).map((row) => row.studentNumber),...(planId ? {deferred:true} : {})}))};
        const staffSnapshot = {revision:timetable.revision,sittings:live.map(({id,courseId,code,title,paper,startsAt,durationMinutes,venue,venueId,venueLocation,revision,invigilators}) =>
          ({id,courseId,code,title,paper,startsAt,durationMinutes,venue,venueId,venueLocation,revision,invigilators:invigilators.map(({staffId,accountId,employeeNumber,legalName,role}) => ({staffId,accountId,employeeNumber,legalName,role}))}))};
        for (const row of staffSnapshot.sittings) {row.arrangements = live.find((entry) => entry.id === row.id).arrangements;row.resourceSegments = view.resourceSegments.filter((entry) => entry.id === row.id).map(({id,startsAt,durationMinutes,venue,venueId,venueRevision,venueLocation,invigilators}) => ({id,startsAt,durationMinutes,venue,venueId,venueRevision,venueLocation,invigilators:invigilators.map(({staffId,accountId,role}) => ({staffId,accountId,role}))}));row.invigilators = row.invigilators.filter((entry) => row.resourceSegments.some((segment) => segment.invigilators.some((staff) => staff.staffId === entry.staffId)));}
        const previousStaff = (await db.query('select published_staff_snapshot from exam_timetables where period_id = $1',[periodId])).rows[0]?.published_staff_snapshot;
        const first = !(await db.query("select 1 from exam_timetables where period_id = $1 and published_at is not null",[periodId])).rowCount;
        await db.query(`update exam_timetables set status = 'published',published_revision = revision,published_snapshot = $2,published_by = $3,published_at = now(),publication_reason = $4,published_staff_snapshot = $5 where period_id = $1`,
          [periodId,JSON.stringify(snapshot),actor.accountId,input.reason.trim(),JSON.stringify(staffSnapshot)]);
        const students = new Map();
        staffSnapshot.manifests = freezeExamManifests(live,candidates);
        for (const student of previous.staff?.candidateAccounts || []) students.set(student.accountId,{...student,count:0});
        for (const sitting of previous.snapshot?.sittings || []) for (const row of candidates[sitting.courseId] || []) {
          if (!sitting.candidates || sitting.candidates.includes(row.studentNumber)) students.set(row.accountId,{...row,count:0});
        }
        for (const sitting of snapshot.sittings) for (const row of candidates[sitting.courseId] || []) {
          if (sitting.candidates && !sitting.candidates.includes(row.studentNumber)) continue;
          students.set(row.accountId,{...row,count:(students.get(row.accountId)?.count || 0) + 1});
        }
        staffSnapshot.candidateAccounts = [...students.values()].filter((row) => row.count > 0).map(({accountId,studentNumber}) => ({accountId,studentNumber}));
        await db.query('update exam_timetables set published_staff_snapshot = $2 where period_id = $1',[periodId,JSON.stringify(staffSnapshot)]);
        await db.query(`insert into exam_publications (period_id,revision,snapshot,staff_snapshot,prepared_by,published_by,published_at,reason,origin,period_name,programme_code,intake_label)
          select period_id,published_revision,published_snapshot,published_staff_snapshot,prepared_by,published_by,published_at,publication_reason,'published',$2,$3,$4
          from exam_timetables where period_id = $1`,[periodId,period.name,period.programmeCode,period.intakeLabel]);
        for (const student of students.values()) await queueNotification(db,student.accountId,"exams.timetable",{studentNumber:student.studentNumber,periodName:period.name,action:first ? "published" : "updated",count:student.count},{link:'#study/timetable'});
        const staffRecipients = new Set([...(previousStaff?.sittings || []),...staffSnapshot.sittings].flatMap((row) => row.invigilators.map((entry) => entry.accountId)).filter(Boolean));
        for (const accountId of staffRecipients) await queueNotification(db,accountId,'exams.duties',{periodName:period.name,action:first ? 'published' : 'updated',count:staffSnapshot.sittings.filter((row) => row.invigilators.some((entry) => entry.accountId === accountId)).length},{link:'#registry/exams'});
        await insertAudit(db,{actorId:actor.accountId,action:"exams.timetable.published",subjectType:"ExamTimetable",subjectId:periodId,reason:input.reason,metadata:{revision:timetable.revision,sittings:snapshot.sittings.length,notified:students.size}});
        return context(db,period,actor);
      });
    },
    // Students read only the published snapshot, limited to courses they hold a confirmed enrolment for.
    async listOwnExams(programmeId,actor) {
      return withTransaction(pool,async (db) => {
        const owner = (await db.query("select s.account_id as \"accountId\",s.student_number as \"studentNumber\" from student_programmes sp join students s on s.id = sp.student_id where sp.id = $1",[programmeId])).rows[0];
        if (!owner || owner.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
        const rows = (await db.query(`select et.period_id as "periodId",ap.name,et.published_snapshot as snapshot,et.published_at as "publishedAt",
          et.status,et.revision,et.published_revision as "publishedRevision",et.published_staff_snapshot as "staffSnapshot",
          (select coalesce(jsonb_agg(jsonb_build_object('sittingId',sp.sitting_id,'snapshot',sp.published_snapshot)),'[]'::jsonb)
            from exam_seating_plans sp join exam_sittings es on es.id = sp.sitting_id where es.period_id = et.period_id) as "seatPlans",
          array_agg(ce.course_id) as courses from exam_timetables et join registration_periods rp on rp.id = et.period_id join academic_periods ap on ap.id = rp.academic_period_id
          join student_registrations sr on sr.period_id = et.period_id and sr.student_programme_id = $1 and sr.status = 'confirmed' join course_enrolments ce on ce.registration_id = sr.id
          where et.published_snapshot is not null group by et.period_id,ap.name,et.published_snapshot,et.published_at,ap.starts_on order by ap.starts_on desc`,[programmeId])).rows;
        return rows.map((row) => ({periodId:row.periodId,name:row.name,publishedAt:row.publishedAt,
          sittings:row.snapshot.sittings.filter((sitting) => row.courses.includes(sitting.courseId) && (!sitting.candidates || sitting.candidates.includes(owner.studentNumber)))
            .map((sitting) => {
              const own = personalExamSitting(sitting,owner.studentNumber),manifest = row.staffSnapshot?.manifests?.find((entry) => entry.sittingId === sitting.id);
              const seating = currentSeatPlan(row.seatPlans?.find((entry) => entry.sittingId === sitting.id)?.snapshot,row,manifest);
              const seat = seating?.entries.find((entry) => entry.studentNumber === owner.studentNumber);
              return {...own,...(seat ? {seat:seat.seat,seatingRevision:seating.revision} : {})};
            }).sort((a,b) => a.startsAt.localeCompare(b.startsAt))}))
          .filter((row) => row.sittings.length);
      });
    }
  };
}
