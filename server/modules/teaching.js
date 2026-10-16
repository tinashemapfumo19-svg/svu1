import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";

export const teachingRoles = ["lead","co_lecturer","tutor"];
const roles = [...teachingRoles,"moderator","examiner"];
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const dayBefore = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0,10);

export function validateAllocation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["courseId","staffId","role","workloadUnits","effectiveFrom","reason","replacesAllocationId"].includes(key))
    || !text(input.courseId,100) || !text(input.staffId,100) || !roles.includes(input.role) || typeof input.workloadUnits !== "number" || !Number.isFinite(input.workloadUnits)
    || input.workloadUnits < 0 || input.workloadUnits > 1000 || Math.round(input.workloadUnits * 100) !== input.workloadUnits * 100 || !text(input.reason,2000) || !input.effectiveFrom
    || input.replacesAllocationId !== undefined && !Number.isInteger(input.replacesAllocationId)) {
    throw requestError(400,"Provide course, staff member, allocation role, workload units (up to 2 decimals), start date, and reason.");
  }
  return {effectiveFrom:parseEffectiveDate(input.effectiveFrom)};
}

export function meetingsClash(a = [],b = []) {
  return a.some((x) => b.some((y) => x.day === y.day && x.start < y.end && y.start < x.end));
}

const overlaps = (a,b) => (a.effectiveFrom || "0000-01-01") <= (b.effectiveTo || "9999-12-31") && (b.effectiveFrom || "0000-01-01") <= (a.effectiveTo || "9999-12-31");

// Teaching roles cannot be double-booked into overlapping meetings while both allocations are in force, and moderators/examiners
// must be independent of the teaching. Ended allocations still count for the dates they covered.
export function allocationConflicts(candidate,others) {
  const conflicts = [];
  for (const other of others) {
    if (other.id === candidate.id || other.id === candidate.replacesAllocationId || other.staffId !== candidate.staffId || !overlaps(candidate,other)
      || !(other.status === "proposed" || other.status === "active" || other.status === "ended" && other.effectiveTo)) continue;
    const sameOffering = other.periodId === candidate.periodId && other.courseId === candidate.courseId;
    if (sameOffering && teachingRoles.includes(candidate.role) !== teachingRoles.includes(other.role)) conflicts.push(`${other.code || other.courseId}: a moderator or examiner cannot also teach the same offering.`);
    else if (!sameOffering && teachingRoles.includes(candidate.role) && teachingRoles.includes(other.role) && other.academicPeriodId === candidate.academicPeriodId && meetingsClash(candidate.meetings,other.meetings)) {
      conflicts.push(`${other.code || other.courseId} meets at the same time for this staff member.`);
    }
  }
  return conflicts;
}

export function offeringCoverage(allocations) {
  const lead = allocations.find((row) => row.role === "lead" && row.status === "active");
  if (!lead) return {covered:false,reason:allocations.some((row) => row.role === "lead" && row.status === "proposed") ? "Lead lecturer awaiting approval." : "No lead lecturer allocated."};
  if (lead.staffStatus !== "active") return {covered:false,reason:`Lead lecturer is ${lead.staffStatus}.`};
  return {covered:true,reason:null};
}

const allocationSelect = `select a.id::int,a.period_id as "periodId",a.course_id as "courseId",a.staff_id as "staffId",a.role,a.workload_units::float as "workloadUnits",
  to_char(a.effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(a.effective_to,'YYYY-MM-DD') as "effectiveTo",a.status,a.reason,a.proposed_by as "proposedBy",a.reviewed_by as "reviewedBy",
  a.review_reason as "reviewReason",a.end_reason as "endReason",a.replaces_allocation_id::int as "replacesAllocationId",m.employee_number as "employeeNumber",m.status as "staffStatus",
  coalesce(pe.legal_name,m.legal_name) as "staffName",c.code,c.title,o.meetings,rp.academic_period_id as "academicPeriodId"
  from teaching_allocations a join staff_members m on m.id = a.staff_id left join accounts ac on ac.id = m.account_id left join people pe on pe.id = ac.person_id
  join courses c on c.id = a.course_id join registration_offerings o on o.period_id = a.period_id and o.course_id = a.course_id join registration_periods rp on rp.id = a.period_id`;

async function periodFor(db,periodId,actor,permission) {
  const period = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.academic_period_id as "academicPeriodId",rp.year_of_study as "yearOfStudy",rp.term,rp.status,ap.name,
    to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn",p.code as "programmeCode",i.label as "intakeLabel"
    from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id where rp.id = $1`,[periodId])).rows[0];
  if (!period) throw requestError(404,"Registration period was not found.");
  assertActorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:period.programmeCode,intakeId:period.intakeId});
  return period;
}

async function offeringsFor(db,period) {
  const offerings = (await db.query(`select o.course_id as "courseId",o.delivery,o.meetings,o.offering_type as "offeringType",c.code,c.title,c.credits::float as credits,
    (select count(*)::int from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id where sr.period_id = o.period_id and ce.course_id = o.course_id and ce.withdrawn_at is null) as enrolled
    from registration_offerings o join courses c on c.id = o.course_id where o.period_id = $1 order by c.code`,[period.id])).rows;
  const allocations = (await db.query(`${allocationSelect} where a.period_id = $1 order by a.id desc`,[period.id])).rows;
  return offerings.map((offering) => {
    const own = allocations.filter((row) => row.courseId === offering.courseId);
    return {...offering,allocations:own,...offeringCoverage(own)};
  });
}

async function conflictsFor(db,candidate) {
  const others = (await db.query(`${allocationSelect} where a.staff_id = $1 and a.status in ('proposed','active','ended')`,[candidate.staffId])).rows;
  return allocationConflicts(candidate,others);
}

export function createTeachingModule(pool) {
  return {
    async getPeriodTeaching(periodId,actor) {
      return withTransaction(pool,async (db) => {
        const period = await periodFor(db,periodId,actor,"teaching.view");
        const offerings = await offeringsFor(db,period);
        const scope = {programmeCode:period.programmeCode,intakeId:period.intakeId};
        const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        const staff = can("teaching.allocate") ? (await db.query(`select m.id,m.employee_number as "employeeNumber",coalesce(pe.legal_name,m.legal_name) as "legalName" from staff_members m
          left join accounts a on a.id = m.account_id left join people pe on pe.id = a.person_id where m.status = 'active' order by 3`)).rows : [];
        return {period,offerings,staff,accountId:actor.accountId,capabilities:{allocate:can("teaching.allocate"),approve:can("teaching.approve")}};
      });
    },
    async proposeAllocation(periodId,input,actor) {
      const {effectiveFrom} = validateAllocation(input);
      return withTransaction(pool,async (db) => {
        const period = await periodFor(db,periodId,actor,"teaching.allocate");
        if (period.status === "closed") throw requestError(409,"Closed registration periods cannot take new allocations.");
        const offering = (await db.query("select meetings from registration_offerings where period_id = $1 and course_id = $2",[periodId,input.courseId])).rows[0];
        if (!offering) throw requestError(404,"This course is not offered in the registration period.");
        const staff = (await db.query("select status from staff_members where id = $1 for share",[input.staffId])).rows[0];
        if (!staff) throw requestError(404,"Staff record was not found.");
        if (staff.status !== "active") throw requestError(409,`A ${staff.status} staff member cannot be allocated.`);
        if (effectiveFrom > period.endsOn) throw requestError(400,"An allocation must start before the academic period ends.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`offering:${periodId}:${input.courseId}`]);
        let replaced = null;
        if (input.replacesAllocationId) {
          replaced = (await db.query(`${allocationSelect} where a.id = $1`,[input.replacesAllocationId])).rows[0];
          if (!replaced || replaced.periodId !== periodId || replaced.courseId !== input.courseId || replaced.status !== "active" || replaced.role !== input.role) throw requestError(409,"Only an active allocation in the same offering and role can be substituted.");
          if (effectiveFrom <= replaced.effectiveFrom) throw requestError(409,"A substitute must start after the allocation it replaces.");
        }
        if (input.role === "lead" && !replaced && (await db.query("select 1 from teaching_allocations where period_id = $1 and course_id = $2 and role = 'lead' and status in ('proposed','active')",[periodId,input.courseId])).rowCount) {
          throw requestError(409,"This offering already has a lead lecturer. Substitute the current lead instead.");
        }
        if ((await db.query("select 1 from teaching_allocations where period_id = $1 and course_id = $2 and staff_id = $3 and role = $4 and status in ('proposed','active') and id is distinct from $5",[periodId,input.courseId,input.staffId,input.role,input.replacesAllocationId ?? null])).rowCount) {
          throw requestError(409,"This staff member already holds or is proposed for this role on the offering.");
        }
        const conflicts = await conflictsFor(db,{...input,effectiveFrom,periodId,academicPeriodId:period.academicPeriodId,meetings:offering.meetings});
        if (conflicts.length) throw requestError(409,conflicts.join(" "));
        const row = (await db.query(`insert into teaching_allocations (period_id,course_id,staff_id,role,workload_units,effective_from,reason,proposed_by,replaces_allocation_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [periodId,input.courseId,input.staffId,input.role,input.workloadUnits,effectiveFrom,input.reason.trim(),actor.accountId,input.replacesAllocationId ?? null])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"teaching.allocation.proposed",subjectType:"TeachingAllocation",subjectId:String(row.id),reason:input.reason,
          metadata:{periodId,courseId:input.courseId,staffId:input.staffId,role:input.role,workloadUnits:input.workloadUnits,effectiveFrom,replacesAllocationId:input.replacesAllocationId ?? null}});
        return {id:row.id,status:"proposed"};
      });
    },
    async reviewAllocation(allocationId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        const allocation = (await db.query(`${allocationSelect} where a.id = $1`,[allocationId])).rows[0];
        if (!allocation) throw requestError(404,"Allocation was not found.");
        const period = await periodFor(db,allocation.periodId,actor,"teaching.approve");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`offering:${allocation.periodId}:${allocation.courseId}`]);
        const current = (await db.query("select status from teaching_allocations where id = $1 for update",[allocationId])).rows[0];
        if (current.status !== "proposed") throw requestError(409,"Reviewed allocations are immutable.");
        assertSeparateApprover(allocation.proposedBy,actor);
        if (input.outcome === "approved") {
          if (allocation.staffStatus !== "active") throw requestError(409,`The staff member is now ${allocation.staffStatus}. Reject this allocation.`);
          const conflicts = await conflictsFor(db,{...allocation,academicPeriodId:period.academicPeriodId});
          if (conflicts.length) throw requestError(409,conflicts.join(" "));
          if (allocation.replacesAllocationId) {
            const ended = await db.query("update teaching_allocations set status = 'ended',effective_to = $2,ended_by = $3,ended_at = now(),end_reason = $4 where id = $1 and status = 'active'",
              [allocation.replacesAllocationId,dayBefore(allocation.effectiveFrom),actor.accountId,`Substituted by allocation ${allocation.id}`]);
            if (!ended.rowCount) throw requestError(409,"The allocation being substituted is no longer active. Reject this substitution.");
          }
        }
        await db.query("update teaching_allocations set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[allocationId,input.outcome === "approved" ? "active" : "rejected",actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`teaching.allocation.${input.outcome}`,subjectType:"TeachingAllocation",subjectId:String(allocationId),reason:input.reason,
          metadata:{periodId:allocation.periodId,courseId:allocation.courseId,staffId:allocation.staffId,role:allocation.role,replacesAllocationId:allocation.replacesAllocationId}});
        return {id:allocation.id,status:input.outcome === "approved" ? "active" : "rejected"};
      });
    },
    async endAllocation(allocationId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["effectiveTo","reason"].includes(key)) || !text(input.reason,2000) || !input.effectiveTo) throw requestError(400,"Provide the last teaching date and a reason.");
      const effectiveTo = parseEffectiveDate(input.effectiveTo);
      return withTransaction(pool,async (db) => {
        const allocation = (await db.query(`${allocationSelect} where a.id = $1`,[allocationId])).rows[0];
        if (!allocation) throw requestError(404,"Allocation was not found.");
        await periodFor(db,allocation.periodId,actor,"teaching.allocate");
        if (allocation.status !== "active") throw requestError(409,"Only active allocations can be ended.");
        if (effectiveTo < allocation.effectiveFrom) throw requestError(400,"An allocation cannot end before it starts.");
        await db.query("update teaching_allocations set status = 'ended',effective_to = $2,ended_by = $3,ended_at = now(),end_reason = $4 where id = $1",[allocationId,effectiveTo,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"teaching.allocation.ended",subjectType:"TeachingAllocation",subjectId:String(allocationId),reason:input.reason,metadata:{effectiveTo,staffId:allocation.staffId,role:allocation.role}});
        return {id:allocation.id,status:"ended",effectiveTo};
      });
    },
    async teachingOverview(actor) {
      return withTransaction(pool,async (db) => {
        const periods = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.status,ap.name,p.code as "programmeCode",i.label as "intakeLabel",rp.year_of_study as "yearOfStudy",rp.term
          from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id
          where rp.status <> 'closed' order by ap.starts_on,p.code`)).rows.filter((row) => actorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId}));
        const uncovered = [],workload = new Map();
        for (const period of periods) {
          for (const offering of await offeringsFor(db,period)) {
            if (!offering.covered) uncovered.push({periodId:period.id,periodName:period.name,programmeCode:period.programmeCode,intakeLabel:period.intakeLabel,courseId:offering.courseId,code:offering.code,title:offering.title,enrolled:offering.enrolled,reason:offering.reason});
            for (const row of offering.allocations.filter((entry) => entry.status === "active")) {
              const entry = workload.get(row.staffId) || {staffId:row.staffId,staffName:row.staffName,employeeNumber:row.employeeNumber,staffStatus:row.staffStatus,units:0,allocations:0};
              entry.units += row.workloadUnits; entry.allocations++; workload.set(row.staffId,entry);
            }
          }
        }
        return {periods,uncovered,workload:[...workload.values()].sort((a,b) => b.units - a.units)};
      });
    },
    async myTeaching(actor) {
      return withTransaction(pool,async (db) => {
        const staff = (await db.query("select id,status from staff_members where account_id = $1",[actor.accountId])).rows[0];
        if (!staff) throw requestError(404,"No staff record is linked to this account.");
        const allocations = (await db.query(`${allocationSelect} where a.staff_id = $1 and a.status = 'active' order by a.effective_from desc`,[staff.id])).rows;
        return {staffId:staff.id,status:staff.status,allocations};
      });
    },
    // Lecturers see class lists only through an active allocation in force today; registry staff through their scope.
    async allocationClassList(allocationId,actor) {
      return withTransaction(pool,async (db) => {
        const allocation = (await db.query(`${allocationSelect} where a.id = $1`,[allocationId])).rows[0];
        if (!allocation) throw requestError(404,"Allocation was not found.");
        const today = todayIso();
        const own = (await db.query("select 1 from staff_members where id = $1 and account_id = $2 and status = 'active'",[allocation.staffId,actor.accountId])).rowCount > 0;
        const inForce = allocation.status === "active" && allocation.effectiveFrom <= today && (!allocation.effectiveTo || allocation.effectiveTo >= today);
        if (!(own && inForce && actor.permissions.includes("teaching.self"))) {
          if (!actor.permissions.includes("teaching.view")) throw requestError(404,"Allocation was not found.");
          await periodFor(db,allocation.periodId,actor,"teaching.view");
        }
        const students = (await db.query(`select s.student_number as "studentNumber",coalesce(pe.legal_name,'') as "legalName",sr.reference_number as "registrationReference",sp.status as "programmeStatus"
          from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join student_programmes sp on sp.id = sr.student_programme_id
          join students s on s.id = sp.student_id join people pe on pe.id = s.person_id where sr.period_id = $1 and ce.course_id = $2 and ce.withdrawn_at is null order by s.student_number`,[allocation.periodId,allocation.courseId])).rows;
        return {allocationId:allocation.id,code:allocation.code,title:allocation.title,role:allocation.role,students};
      });
    }
  };
}

// Called when a staff member exits: their active allocations end on the exit date so coverage reports show the gap.
export async function endAllocationsForExit(db,staffId,effectiveOn,actorId) {
  await db.query(`update teaching_allocations set status = 'ended',effective_to = greatest($2::date,effective_from),ended_by = $3,ended_at = now(),end_reason = 'Staff member exited' where staff_id = $1 and status = 'active'`,[staffId,effectiveOn,actorId]);
  await db.query(`update teaching_allocations set status = 'rejected',reviewed_by = null,review_reason = 'Staff member exited before review' where staff_id = $1 and status = 'proposed'`,[staffId]);
}
