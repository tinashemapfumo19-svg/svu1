import { randomUUID } from "node:crypto";
import { loadCurriculum } from "./curriculum.js";
import { assessAcademicDecision, currentAcademicDecision, loadAcademicContext } from "./academic-evidence.js";
import { applicableRegistrationException, exceptionHasTarget, exceptionKey, registrationExceptionEvidence, validateExceptionParameters } from "./registration-exceptions.js";
import { financialStatus } from "./student-finance.js";
import { applicableCreditRecognitions, hasPrerequisiteCredit, usedCreditRecognitions } from "./credit-evidence.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";

export function validateMeetings(delivery, meetings) {
  if (!["scheduled", "asynchronous"].includes(delivery) || !Array.isArray(meetings) || meetings.length > 20) throw requestError(400, "Choose scheduled or asynchronous delivery and valid meetings.");
  if (delivery === "asynchronous" && meetings.length || delivery === "scheduled" && !meetings.length) throw requestError(400, "Scheduled courses need meetings; asynchronous courses cannot have meetings.");
  for (const meeting of meetings) {
    if (!meeting || Object.keys(meeting).some((key) => !["day", "start", "end"].includes(key)) || !Number.isInteger(meeting.day) || meeting.day < 1 || meeting.day > 7 || !Number.isInteger(meeting.start) || !Number.isInteger(meeting.end) || meeting.start < 0 || meeting.end > 1440 || meeting.start >= meeting.end) throw requestError(400, "Meetings require day 1-7 and ordered minute-of-day times.");
  }
  for (let i = 0; i < meetings.length; i++) for (let j = i + 1; j < meetings.length; j++) {
    const a = meetings[i], b = meetings[j];
    if (a.day === b.day && a.start < b.end && b.start < a.end) throw requestError(400, "A course cannot have overlapping meeting slots.");
  }
}

export function registrationEligibility({ programme, period, offerings, selectedCourses, revision = 0, checks = [], existingCourses = [], priorCourses = [], academic = null, exceptions = [], exceptionEvidenceHash = null, financialHold = null, windowExtension = null, today = todayIso() }) {
  const blockers = [];
  const appliedExceptions = [];
  const applyException = (kind,parameters) => {
    if (!exceptionEvidenceHash) return null;
    const row = applicableRegistrationException(exceptions,kind,parameters,revision,exceptionEvidenceHash,today);
    if (row && !appliedExceptions.some((entry) => entry.id === row.id)) appliedExceptions.push(row);
    return row;
  };
  const add = (code, message) => blockers.push({ code, message });
  if (programme.status !== "onboarded") add("ONBOARDING", "Programme must be onboarded and not suspended, interrupted, or withdrawn.");
  if (programme.programmeVersionId !== period.programmeVersionId) add("CURRICULUM_VERSION", "The registration period uses a different curriculum version.");
  if (programme.transferEffectiveOn && period.startsOn < programme.transferEffectiveOn) add("TRANSFER_CHRONOLOGY","Destination enrolment cannot precede the approved transfer date.");
  const window = period.windows?.registration;
  // An approved late-registration extension keeps the window open for this student until its date; the period itself must still be open.
  const extended = Boolean(window && windowExtension && today > window[1] && today <= windowExtension.until);
  if (period.status !== "open" || !["published", "active"].includes(period.calendarStatus) || !window || today < window[0] || (today > window[1] && !extended)) add("WINDOW", "Registration is not open in the academic calendar.");
  const selected = offerings.filter((course) => selectedCourses.includes(course.courseId));
  const recognised = academic ? applicableCreditRecognitions(academic) : [];
  if (!selectedCourses.length) add("NO_COURSES", "Select at least one course.");
  if (new Set(selectedCourses).size !== selectedCourses.length || selected.length !== selectedCourses.length) add("COURSE_SELECTION", "Choose unique courses offered in this curriculum period.");
  for (const course of offerings.filter((entry) => entry.requirementType === "core")) {
    if (!selectedCourses.includes(course.courseId) && !recognised.some((row) => row.courseId === course.courseId)) add("CORE_COURSE", `Select required course ${course.code}.`);
  }
  const credits = selected.reduce((sum, course) => sum + Number(course.credits), 0);
  if (credits > Number(period.creditLimit)) {
    const exception = applyException("credit_limit",{});
    if (!exception || credits > exception.parameters.maxCredits) {
      appliedExceptions.length = 0;
      add("CREDIT_LIMIT", `${credits} credits exceed the ${period.creditLimit}-credit limit.`);
    }
  }
  if (period.yearOfStudy > 1 && (!academic || !assessAcademicDecision(academic,"progression").ready || !currentAcademicDecision(academic,"progression",null,null,today))) add("PROGRESSION_APPROVAL","This study year requires an eligible, current, independently approved progression decision.");
  for (const course of selected) {
    if (course.status !== "active" || course.effectiveFrom > period.startsOn || course.effectiveTo && course.effectiveTo < period.startsOn) add("COURSE_STATUS", `${course.code} is not active for this academic period.`);
    if (course.prerequisites?.some((id) => !hasPrerequisiteCredit(academic,id)) && !applyException("prerequisite_waiver",{courseId:course.courseId})) add("PREREQUISITE_EVIDENCE", `${course.code} requires a published passing result or approved recognized credit for every prerequisite.`);
    if (academic?.recognitions?.some((row) => row.courseId === course.courseId && row.status === "approved")) add("RECOGNISED_COURSE",`${course.code} already has approved recognized credit; a formal correction is required before re-enrolment.`);
    if (existingCourses.includes(course.courseId)) add("ALREADY_ENROLLED", `${course.code} is already enrolled in this academic period.`);
    if (priorCourses.includes(course.courseId) && (!academic || !assessAcademicDecision(academic,"repeat",course.courseId).ready || !currentAcademicDecision(academic,"repeat",course.courseId,revision,today))) add("REPEAT_EVIDENCE", `${course.code} was previously enrolled; eligible published results and a current approved repeat decision for this selection are required.`);
    if (course.delivery === "unconfigured") add("TIMETABLE", `${course.code} has no confirmed delivery schedule.`);
  }
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    if (selected[i].meetings.some((a) => selected[j].meetings.some((b) => a.day === b.day && a.start < b.end && b.start < a.end))
      && !applyException("timetable_clash",{courseIds:[selected[i].courseId,selected[j].courseId]})) add("CLASH", `${selected[i].code} and ${selected[j].code} have overlapping meetings.`);
  }
  for (const reason of financialHold?.held ? financialHold.reasons : []) add("FINANCIAL_HOLD", reason.message);
  for (const type of ["academic", "financial"]) {
    const check = checks.find((entry) => entry.checkType === type);
    if (!check || check.registrationRevision !== revision || check.outcome !== "eligible" || check.expiresOn < today) add(`${type.toUpperCase()}_CLEARANCE`, check ? `${type} clearance is ${check.registrationRevision !== revision ? "for an older course selection" : check.expiresOn < today ? "expired" : check.outcome}: ${check.reason}` : `${type} clearance has not been recorded.`);
  }
  return { ready: !blockers.length, credits, blockers, appliedExceptions };
}

async function programmeFor(client, id, actor, own, lock = false) {
  const row = (await client.query(`select sp.id,sp.student_id as "studentId",sp.status,sp.status_revision as "statusRevision",sp.intake_id as "intakeId",sp.programme_version_id as "programmeVersionId",
    s.account_id as "accountId",s.student_number as "studentNumber",p.code as "programmeCode",case when sp.origin_programme_id is not null then to_char(sp.created_at at time zone 'UTC','YYYY-MM-DD') end as "transferEffectiveOn"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
    where sp.id = $1 ${lock ? "for update of sp" : ""}`, [id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404, "Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor, { programmeCode: row.programmeCode, intakeId: row.intakeId });
  return row;
}

const periodSelect = `select rp.id,rp.intake_id as "intakeId",rp.academic_period_id as "academicPeriodId",rp.programme_version_id as "programmeVersionId",
  rp.year_of_study as "yearOfStudy",rp.term,rp.credit_limit::float as "creditLimit",rp.academic_policy_id as "academicPolicyId",rp.status,ap.name,
  ap.lifecycle_status as "calendarStatus",ap.windows,to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn"
  from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id`;

async function periodFor(client, id, programme, lock = false) {
  const period = (await client.query(`${periodSelect} where rp.id = $1 ${lock ? "for update of rp for share of ap" : ""}`, [id])).rows[0];
  if (!period || period.intakeId !== programme.intakeId || period.programmeVersionId !== programme.programmeVersionId) throw requestError(404, "Registration period was not found for this intake/curriculum.");
  return period;
}

async function contextFor(client, programme, period) {
  const offerings = (await client.query(`select o.course_id as "courseId",o.delivery,o.meetings,c.code,c.title,c.credits::float as credits,c.status,
    to_char(c.effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(c.effective_to,'YYYY-MM-DD') as "effectiveTo",case when o.offering_type = 'repeat' then 'repeat' else e.requirement_type end as "requirementType",
    coalesce((select json_agg(cp.prerequisite_course_id) from course_prerequisites cp where cp.course_id = c.id),'[]'::json) as prerequisites
    from registration_offerings o join courses c on c.id = o.course_id join curriculum_entries e on e.course_id = c.id and e.programme_version_id = $2
    where o.period_id = $1 order by c.code`, [period.id, period.programmeVersionId])).rows;
  const registration = (await client.query(`select id,revision,selected_courses as "selectedCourses",status,reference_number as "referenceNumber",confirmation
    from student_registrations where student_programme_id = $1 and period_id = $2`, [programme.id, period.id])).rows[0] || { revision: 0, selectedCourses: [], status: "draft" };
  const checks = registration.id ? (await client.query(`select distinct on (check_type) check_type as "checkType",outcome,reason,evidence_ref as "evidenceRef",registration_revision as "registrationRevision",to_char(expires_on,'YYYY-MM-DD') as "expiresOn",id
    from registration_checks where registration_id = $1 order by check_type,id desc`, [registration.id])).rows : [];
  const existingCourses = (await client.query(`select course_id from course_enrolments where student_id = $1 and academic_period_id = $2 and registration_id <> $3`, [programme.studentId, period.academicPeriodId, registration.id || ""])).rows.map((row) => row.course_id);
  const priorCourses = (await client.query("select distinct course_id from course_enrolments where student_id = $1 and academic_period_id <> $2 and withdrawn_at is null",[programme.studentId,period.academicPeriodId])).rows.map((row) => row.course_id);
  const academic = await loadAcademicContext(client,programme,period);
  const exceptions = registration.id ? (await client.query(`select id,kind,parameters,registration_revision as "registrationRevision",evidence_hash as "evidenceHash",status,reason,evidence_ref as "evidenceRef",
    requested_by as "requestedBy",reviewed_by as "reviewedBy",review_reason as "reviewReason",revoked_by as "revokedBy",revoke_reason as "revokeReason",to_char(expires_on,'YYYY-MM-DD') as "expiresOn"
    from registration_exceptions where registration_id = $1 order by id desc`,[registration.id])).rows : [];
  const {hash:exceptionEvidenceHash,source:exceptionSourceSnapshot} = registrationExceptionEvidence({programme,period,offerings,registration,academic,existingCourses,priorCourses});
  const finance = await financialStatus(client, programme.id);
  const extensions = (await client.query(`select id::int,to_char(until,'YYYY-MM-DD') as until,reason,evidence_ref as "evidenceRef",status,requested_by as "requestedBy",review_reason as "reviewReason"
    from registration_window_extensions where student_programme_id = $1 and period_id = $2 order by id desc`,[programme.id,period.id])).rows;
  const windowExtension = extensions.find((row) => row.status === "approved") || null;
  return { period, offerings, registration, checks, exceptions, exceptionEvidenceHash,exceptionSourceSnapshot,financialHold:finance.hold,academic,extensions,windowExtension,
    eligibility: registrationEligibility({ programme, period, offerings, selectedCourses: registration.selectedCourses, revision: registration.revision, checks, existingCourses, priorCourses, academic,exceptions,exceptionEvidenceHash,financialHold:finance.hold,windowExtension }) };
}

function reasonInput(input) {
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400, "A reason of 1-2000 characters is required.");
}

export function createCourseRegistrationModule(pool) {
  return {
    async requestRegistrationException(id,periodId,input,actor) {
      reasonInput(input);
      const parameters = validateExceptionParameters(input.kind,input.parameters);
      if (!Number.isInteger(input.revision) || input.revision < 1 || typeof input.evidenceHash !== "string" || !input.expiresOn
        || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"Provide the selection revision, evidence hash/reference, and expiry.");
      const expiresOn = parseEffectiveDate(input.expiresOn);
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false,true);
        const period = await periodFor(client,periodId,programme,true);
        const context = await contextFor(client,programme,period);
        if (period.status !== "open" || context.registration.status !== "draft" || !context.registration.id || context.eligibility.blockers.some((row) => row.code === "WINDOW")) throw requestError(409,"Exceptions require a saved draft in an open current registration window.");
        if (context.registration.revision !== input.revision || context.exceptionEvidenceHash !== input.evidenceHash) throw requestError(409,"Registration evidence changed. Reload before requesting an exception.");
        const windowEnd = context.windowExtension && context.windowExtension.until > period.windows.registration[1] ? context.windowExtension.until : period.windows.registration[1];
        if (expiresOn < todayIso() || expiresOn > windowEnd) throw requestError(400,"Exception expiry must be current and within the registration window (or its approved extension).");
        if (!exceptionHasTarget(context,input.kind,parameters)) throw requestError(409,"This exception does not address a current credit-limit, timetable-clash, or prerequisite blocker.");
        const previous = context.exceptions.find((row) => exceptionKey(row.kind,row.parameters) === exceptionKey(input.kind,parameters));
        if (previous?.status === "requested" && previous.evidenceHash === input.evidenceHash) throw requestError(409,"This exception is already awaiting independent review.");
        const result = (await client.query(`insert into registration_exceptions (registration_id,kind,parameters,registration_revision,evidence_hash,source_snapshot,reason,evidence_ref,expires_on,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[context.registration.id,input.kind,JSON.stringify(parameters),input.revision,input.evidenceHash,
          JSON.stringify(context.exceptionSourceSnapshot),input.reason.trim(),input.evidenceRef.trim(),expiresOn,actor.accountId])).rows[0];
        await insertAudit(client,{actorId:actor.accountId,action:"registry.exception.requested",subjectType:"RegistrationException",subjectId:String(result.id),reason:input.reason,metadata:{registrationId:context.registration.id,kind:input.kind,revision:input.revision,evidenceHash:input.evidenceHash}});
        return result;
      });
    },

    async reviewRegistrationException(id,periodId,exceptionId,input,actor) {
      reasonInput(input);
      if (!["approved","rejected","revoked"].includes(input.outcome)) throw requestError(400,"Choose approve, reject, or revoke.");
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false,true);
        const period = await periodFor(client,periodId,programme,true);
        const context = await contextFor(client,programme,period);
        if (!context.registration.id || context.registration.status !== "draft" || period.status === "closed") throw requestError(409,"Confirmed or closed registrations cannot change exceptions.");
        const row = context.exceptions.find((entry) => String(entry.id) === String(exceptionId));
        if (!row) throw requestError(404,"Registration exception was not found.");
        assertSeparateApprover(row.requestedBy,actor);
        if (input.outcome === "revoked") {
          if (row.status !== "approved") throw requestError(409,"Only an approved exception can be revoked.");
          await client.query("update registration_exceptions set status = 'revoked',revoked_by = $2,revoked_at = now(),revoke_reason = $3 where id = $1",[row.id,actor.accountId,input.reason.trim()]);
        } else {
          if (row.status !== "requested") throw requestError(409,"Reviewed exceptions cannot be rewritten.");
          if (input.outcome === "approved") {
            const latest = context.exceptions.find((entry) => exceptionKey(entry.kind,entry.parameters) === exceptionKey(row.kind,row.parameters));
            if (latest.id !== row.id || period.status !== "open" || context.eligibility.blockers.some((entry) => entry.code === "WINDOW")
              || row.registrationRevision !== context.registration.revision || row.evidenceHash !== context.exceptionEvidenceHash || row.expiresOn < todayIso()
              || !exceptionHasTarget(context,row.kind,row.parameters)) throw requestError(409,"Exception is superseded, stale, expired, or no longer addresses this registration. Request a fresh review.");
          }
          await client.query("update registration_exceptions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[row.id,input.outcome,actor.accountId,input.reason.trim()]);
        }
        await insertAudit(client,{actorId:actor.accountId,action:`registry.exception.${input.outcome}`,subjectType:"RegistrationException",subjectId:String(row.id),reason:input.reason,metadata:{registrationId:context.registration.id,evidenceHash:row.evidenceHash}});
        return {id:row.id,status:input.outcome};
      });
    },

    // Late registration: a dated extension of the calendar window for one student and period, up to 30 days after it
    // closes, approved by someone other than the requester. The period itself must still be open.
    async requestWindowExtension(id,periodId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["until","reason","evidenceRef"].includes(key)) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
        || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"Provide the extension date, a reason, and an evidence reference.");
      const until = parseEffectiveDate(input.until);
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false,true);
        const period = await periodFor(client,periodId,programme,true);
        const window = period.windows?.registration;
        if (period.status !== "open" || !window) throw requestError(409,"Late registration needs an open registration period with a calendar window.");
        const latest = new Date(Date.parse(`${window[1]}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0,10);
        if (until <= window[1] || until > latest || until < todayIso()) throw requestError(400,`The extension must end after the window closes (${window[1]}), no later than ${latest}, and not in the past.`);
        if ((await client.query("select 1 from registration_window_extensions where student_programme_id = $1 and period_id = $2 and status in ('requested','approved')",[id,periodId])).rowCount) throw requestError(409,"An extension is already requested or approved for this period.");
        const row = (await client.query("insert into registration_window_extensions (student_programme_id,period_id,until,reason,evidence_ref,requested_by) values ($1,$2,$3,$4,$5,$6) returning id::int",
          [id,periodId,until,input.reason.trim(),input.evidenceRef.trim(),actor.accountId])).rows[0];
        await insertAudit(client,{actorId:actor.accountId,action:"registry.window_extension.requested",subjectType:"RegistrationWindowExtension",subjectId:String(row.id),reason:input.reason,metadata:{programmeId:id,periodId,until}});
        return {id:row.id,until,status:"requested"};
      });
    },
    async reviewWindowExtension(id,periodId,extensionId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected","revoked"].includes(input.outcome) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) {
        throw requestError(400,"Choose approve, reject, or revoke and give a reason.");
      }
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,false,true);
        const period = await periodFor(client,periodId,programme,true);
        const row = (await client.query(`select id,status,requested_by as "requestedBy",to_char(until,'YYYY-MM-DD') as until from registration_window_extensions where id = $1 and student_programme_id = $2 and period_id = $3 for update`,[extensionId,id,periodId])).rows[0];
        if (!row) throw requestError(404,"Extension was not found.");
        if (row.requestedBy === actor.accountId) throw requestError(403,"An extension must be reviewed by someone other than its requester.");
        if (input.outcome === "revoked" ? row.status !== "approved" : row.status !== "requested") throw requestError(409,input.outcome === "revoked" ? "Only approved extensions can be revoked." : "Only requested extensions can be reviewed.");
        if (input.outcome === "approved" && (period.status !== "open" || row.until < todayIso())) throw requestError(409,"The period is no longer open or the extension date has passed.");
        await client.query("update registration_window_extensions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[extensionId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(client,{actorId:actor.accountId,action:`registry.window_extension.${input.outcome}`,subjectType:"RegistrationWindowExtension",subjectId:String(extensionId),reason:input.reason,metadata:{programmeId:id,periodId}});
        return {id:Number(extensionId),status:input.outcome};
      });
    },
    async listProgrammeRegistrations(id, actor, own = false) {
      return withTransaction(pool, async (client) => {
        const programme = await programmeFor(client, id, actor, own);
        const periods = (await client.query(`${periodSelect} where rp.intake_id = $1 and rp.programme_version_id = $2 order by ap.starts_on,rp.id`, [programme.intakeId,programme.programmeVersionId])).rows;
        const data = [];
        for (const period of periods) {
          const context = await contextFor(client, programme, period);
          context.capabilities = Object.fromEntries(["configure", "academic", "financial"].map((type) => {
            const permission = `registry.registration.${type}`;
            return [type, !own && actor.permissions.includes(permission) && actorCanAccessScope({ ...actor, authorizingPermission: permission }, { programmeCode: programme.programmeCode, intakeId: programme.intakeId })];
          }));
          for (const action of ["request","approve"]) context.capabilities[`exception.${action}`] = !own && actor.permissions.includes(`registry.exception.${action}`)
            && actorCanAccessScope({...actor,authorizingPermission:`registry.exception.${action}`},{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
          context.accountId = actor.accountId;
          // The academic evidence is used for checks only; it is not part of the registration response.
          const {academic,...visible} = context;
          data.push(visible);
        }
        return data;
      });
    },

    async createRegistrationPeriod(id, input, actor) {
      reasonInput(input);
      if (!Number.isInteger(input.yearOfStudy) || input.yearOfStudy < 1 || input.yearOfStudy > 8 || !["S1","S2","S3"].includes(input.term) || typeof input.creditLimit !== "number" || !Number.isFinite(input.creditLimit) || input.creditLimit <= 0 || input.creditLimit > 480 || input.creditLimit * 2 !== Math.round(input.creditLimit * 2)) throw requestError(400, "Choose year 1-8, term S1-S3, and a positive half-credit limit up to 480.");
      return withTransaction(pool, async (client) => {
        const programme = await programmeFor(client, id, actor, false, true);
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`registration-period:${programme.intakeId}:${input.academicPeriodId}`]);
        const academicPeriod = (await client.query("select period_type,starts_on,to_char(starts_on,'YYYY-MM-DD') as \"startsOn\" from academic_periods where id = $1 for share", [input.academicPeriodId])).rows[0];
        if (!academicPeriod || !["semester","term"].includes(academicPeriod.period_type)) throw requestError(400, "Choose an academic semester or term.");
        const intake = (await client.query("select starts_on from intakes where id = $1", [programme.intakeId])).rows[0];
        if (academicPeriod.starts_on < intake.starts_on) throw requestError(409, "Academic period cannot precede the intake entry date.");
        if (programme.transferEffectiveOn && academicPeriod.startsOn < programme.transferEffectiveOn) throw requestError(409,"Destination enrolment cannot precede the approved transfer date.");
        if ((await client.query("select 1 from registration_periods where intake_id = $1 and academic_period_id = $2 and programme_version_id = $3", [programme.intakeId,input.academicPeriodId,programme.programmeVersionId])).rowCount) throw requestError(409, "This intake/curriculum already has a registration period for that semester.");
        const entries = (await loadCurriculum(client, programme.programmeVersionId)).filter((entry) => entry.yearOfStudy === input.yearOfStudy && [input.term,"ANY"].includes(entry.term));
        if (!entries.length) throw requestError(409, "This curriculum has no courses in the selected year and term.");
        const periodId = `regp_${randomUUID()}`;
        await client.query(`insert into registration_periods (id,intake_id,academic_period_id,programme_version_id,year_of_study,term,credit_limit) values ($1,$2,$3,$4,$5,$6,$7)`, [periodId,programme.intakeId,input.academicPeriodId,programme.programmeVersionId,input.yearOfStudy,input.term,input.creditLimit]);
        for (const entry of entries) await client.query("insert into registration_offerings (period_id,course_id) values ($1,$2)", [periodId,entry.courseId]);
        await insertAudit(client, { actorId: actor.accountId, action: "registry.registration_period.created", subjectType: "RegistrationPeriod",subjectId: periodId,reason: input.reason,metadata: { academicPeriodId: input.academicPeriodId, curriculumVersion: programme.programmeVersionId } });
        return { id: periodId, status: "planning" };
      });
    },

    async configureRegistrationPeriod(id, periodId, input, actor) {
      reasonInput(input);
      return withTransaction(pool, async (client) => {
        const programme = await programmeFor(client, id, actor, false, true);
        const period = await periodFor(client, periodId, programme, true);
        if (period.status === "closed") throw requestError(409, "Closed registration periods are immutable.");
        if (input.academicPolicyId !== undefined || input.repeatCourseIds !== undefined) {
          if (period.status !== "planning") throw requestError(409,"Academic policy and repeat offerings can change only while planning.");
          if (input.academicPolicyId !== undefined) {
            const policy = (await client.query("select 1 from academic_policies where id = $1 and programme_version_id = $2 and status = 'published' and effective_from <= $3::date and (effective_to is null or effective_to >= $3::date) for share",[input.academicPolicyId,period.programmeVersionId,period.startsOn])).rows[0];
            if (!policy) throw requestError(409,"Choose a published academic policy effective for this curriculum and period.");
            await client.query("update registration_periods set academic_policy_id = $2 where id = $1",[periodId,input.academicPolicyId]);
          }
          if (input.repeatCourseIds !== undefined) {
            const ids = input.repeatCourseIds;
            if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw requestError(400,"Provide unique repeat-course IDs.");
            const entries = await loadCurriculum(client,period.programmeVersionId);
            if (ids.some((id) => !entries.some((row) => row.courseId === id && row.yearOfStudy <= period.yearOfStudy))) throw requestError(400,"Repeat offerings must belong to this curriculum at or below the target year.");
            await client.query("delete from registration_offerings where period_id = $1 and offering_type = 'repeat' and not (course_id = any($2::text[]))",[periodId,ids]);
            for (const courseId of ids) await client.query("insert into registration_offerings (period_id,course_id,offering_type) values ($1,$2,'repeat') on conflict do nothing",[periodId,courseId]);
          }
        }
        if (input.offerings !== undefined) {
          if (period.status !== "planning") throw requestError(409, "Only planning periods accept timetable changes.");
          if (!Array.isArray(input.offerings) || !input.offerings.length || input.offerings.length > 100 || new Set(input.offerings.map((entry) => entry.courseId)).size !== input.offerings.length) throw requestError(400, "Provide unique course offerings.");
          for (const offering of input.offerings) {
            validateMeetings(offering.delivery, offering.meetings);
            const updated = await client.query("update registration_offerings set delivery = $3,meetings = $4 where period_id = $1 and course_id = $2", [periodId,offering.courseId,offering.delivery,JSON.stringify(offering.meetings)]);
            if (!updated.rowCount) throw requestError(400, "Course is not offered in this curriculum period.");
          }
        }
        if (input.toStatus !== undefined) {
          if (!({ planning: ["open"], open: ["planning", "closed"] }[period.status] || []).includes(input.toStatus)) throw requestError(409, "Registration period transition is not allowed.");
          if (input.toStatus === "planning" && (await client.query("select 1 from student_registrations where period_id = $1 and status = 'confirmed'", [periodId])).rowCount) throw requestError(409, "A period with confirmed registrations cannot return to planning.");
          if (input.toStatus === "open") {
            if (!period.windows?.registration || !["published","active"].includes(period.calendarStatus)) throw requestError(409, "Publish the calendar period and configure its registration window first.");
            if ((await client.query("select 1 from registration_offerings where period_id = $1 and delivery = 'unconfigured'", [periodId])).rowCount) throw requestError(409, "Configure delivery for every offered course before opening.");
          }
          await client.query("update registration_periods set status = $2 where id = $1", [periodId,input.toStatus]);
        }
        await insertAudit(client, {actorId: actor.accountId,action: "registry.registration_period.configured",subjectType: "RegistrationPeriod",subjectId: periodId,reason: input.reason,metadata: { fromStatus: period.status,toStatus: input.toStatus || period.status,offerings: input.offerings || [] } });
        return { id: periodId,status: input.toStatus || period.status };
      });
    },

    async saveCourseSelection(id, periodId, input, actor) {
      if (!Number.isInteger(input.revision) || input.revision < 0 || !Array.isArray(input.courseIds) || input.courseIds.length > 100 || input.courseIds.some((value) => typeof value !== "string") || new Set(input.courseIds).size !== input.courseIds.length) throw requestError(400, "Provide a revision and unique course IDs.");
      return withTransaction(pool, async (client) => {
        const programme = await programmeFor(client, id, actor, true, true);
        const period = await periodFor(client, periodId, programme, true);
        const context = await contextFor(client, programme, period);
        if (context.registration.status === "confirmed") throw requestError(409, "Confirmed course selections are immutable.");
        if (context.registration.revision !== input.revision) throw requestError(409, "Course selection changed. Reload before saving.");
        if (programme.status !== "onboarded" || period.programmeVersionId !== programme.programmeVersionId || context.eligibility.blockers.some((blocker) => blocker.code === "WINDOW")) throw requestError(409, "Registration requires an onboarded student and an open matching curriculum period.");
        if (input.courseIds.some((courseId) => !context.offerings.some((course) => course.courseId === courseId))) throw requestError(400, "Course is not offered in this period.");
        const registrationId = context.registration.id || `reg_${randomUUID()}`;
        await client.query(`insert into student_registrations (id,student_programme_id,period_id,revision,selected_courses) values ($1,$2,$3,$4,$5)
          on conflict (student_programme_id,period_id) do update set revision = excluded.revision,selected_courses = excluded.selected_courses`, [registrationId,id,periodId,input.revision + 1,JSON.stringify(input.courseIds)]);
        await insertAudit(client, {actorId: actor.accountId,action: "registry.registration.selection_saved",subjectType: "StudentRegistration",subjectId: registrationId,reason: "Student saved course selection",metadata: { revision: input.revision + 1,courseIds: input.courseIds } });
        return { id: registrationId,revision: input.revision + 1 };
      });
    },

    async recordRegistrationCheck(id, periodId, input, actor) {
      reasonInput(input);
      if (!Number.isInteger(input.revision) || input.revision < 1 || !["academic","financial"].includes(input.checkType) || !["eligible","blocked"].includes(input.outcome) || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300 || !input.expiresOn) throw requestError(400, "A selection revision, check type, outcome, evidence reference, and expiry date are required.");
      const expiresOn = parseEffectiveDate(input.expiresOn);
      if (expiresOn < todayIso()) throw requestError(400, "A new clearance cannot already be expired.");
      return withTransaction(pool, async (client) => {
        const programme = await programmeFor(client,id,actor,false,true);
        const period = await periodFor(client,periodId,programme,true);
        if (period.status !== "open") throw requestError(409, "Clearances require an open registration period.");
        const registration = (await client.query("select id,status,revision from student_registrations where student_programme_id = $1 and period_id = $2",[id,periodId])).rows[0];
        if (!registration || registration.status !== "draft") throw requestError(409, "Clearances require a saved draft registration.");
        if (registration.revision !== input.revision) throw requestError(409, "Course selection changed. Reload before recording clearance.");
        if (input.checkType === "financial" && input.outcome === "eligible") {
          const { hold } = await financialStatus(client, id);
          if (hold.held) throw requestError(409, `Financial clearance is blocked by the student account: ${hold.reasons.map((reason) => reason.message).join(" ")}`);
        }
        const check = (await client.query(`insert into registration_checks (registration_id,check_type,outcome,reason,evidence_ref,expires_on,actor_id,registration_revision) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[registration.id,input.checkType,input.outcome,input.reason.trim(),input.evidenceRef.trim(),expiresOn,actor.accountId,registration.revision])).rows[0];
        await insertAudit(client,{actorId: actor.accountId,action: "registry.registration.clearance_recorded",subjectType: "StudentRegistration",subjectId: registration.id,reason: input.reason,metadata: {checkId: check.id,checkType: input.checkType,outcome: input.outcome,expiresOn} });
        return check;
      });
    },

    async confirmCourseRegistration(id,periodId,input,actor) {
      if (!Number.isInteger(input.revision) || input.revision < 1) throw requestError(400,"A saved registration revision is required.");
      return withTransaction(pool,async (client) => {
        const programme = await programmeFor(client,id,actor,true,true);
        const period = await periodFor(client,periodId,programme,true);
        await client.query("select pg_advisory_xact_lock(hashtext($1))",[`enrol:${programme.studentId}:${period.academicPeriodId}`]);
        await client.query("select c.id from courses c join registration_offerings o on o.course_id = c.id where o.period_id = $1 order by c.id for share of c",[periodId]);
        const context = await contextFor(client,programme,period);
        if (context.registration.revision !== input.revision) throw requestError(409,"Registration changed. Reload before confirming.");
        if (context.registration.status === "confirmed") return context.registration.confirmation;
        if (!context.eligibility.ready) throw requestError(409,context.eligibility.blockers.map((entry) => entry.message).join(" "));
        const sequence = (await client.query("select nextval('registration_reference_seq') as value")).rows[0].value;
        const referenceNumber = `REG-${period.startsOn.slice(0,4)}-${String(sequence).padStart(6,"0")}`;
        const courses = context.offerings.filter((course) => context.registration.selectedCourses.includes(course.courseId));
        const academic = await loadAcademicContext(client,programme,period);
        const academicEvidence = {evidenceHash:academic.evidenceHash,policy:academic.policy,
          prerequisites:academic.latestResults.filter((row) => courses.some((course) => course.prerequisites.includes(row.courseId))).map((row) => ({courseId:row.courseId,batchId:row.batchId,registrationId:row.registrationId,result:row.result})),
          progression:period.yearOfStudy > 1 ? currentAcademicDecision(academic,"progression",null,null) : null,
          repeats:courses.map((course) => currentAcademicDecision(academic,"repeat",course.courseId,input.revision)).filter(Boolean),recognitions:usedCreditRecognitions(academic,context.offerings,context.registration.selectedCourses)};
        const confirmation = { referenceNumber,studentNumber: programme.studentNumber,programmeVersionId: programme.programmeVersionId,academicPeriodId: period.academicPeriodId,periodName: period.name,startsOn:period.startsOn,endsOn:period.endsOn,yearOfStudy: period.yearOfStudy,term: period.term,credits: context.eligibility.credits,courses,checks: context.checks,academicEvidence,exceptions:context.eligibility.appliedExceptions,exceptionEvidenceHash:context.exceptionEvidenceHash,confirmedAt: new Date().toISOString() };
        for (const course of courses) await client.query("insert into course_enrolments (registration_id,student_id,academic_period_id,course_id,course_snapshot) values ($1,$2,$3,$4,$5)",[context.registration.id,programme.studentId,period.academicPeriodId,course.courseId,course]);
        await client.query("update student_registrations set status = 'confirmed',reference_number = $2,confirmed_at = now(),confirmation = $3 where id = $1",[context.registration.id,referenceNumber,confirmation]);
        await insertAudit(client,{actorId: actor.accountId,action: "registry.registration.confirmed",subjectType: "StudentRegistration",subjectId: context.registration.id,reason: "Student confirmed eligible course registration",metadata: {referenceNumber,courseIds: context.registration.selectedCourses,credits: context.eligibility.credits,exceptionIds:context.eligibility.appliedExceptions.map((row) => row.id),exceptionEvidenceHash:context.exceptionEvidenceHash} });
        return confirmation;
      });
    }
  };
}
