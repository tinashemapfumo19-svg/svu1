import { randomUUID } from "node:crypto";
import { queueNotification } from "../notification-queue.js";
import { insertAudit, requestError } from "../support.js";

// ADM-17/ADM-18: turn an accepted application into a student record exactly once. Safe to call
// repeatedly and concurrently: database uniqueness on person and application is the final guard.

export function formatStudentNumber(entryYear, sequence) {
  return `S${String(entryYear).slice(-2)}${String(sequence).padStart(6, "0")}`;
}

export async function convertAcceptedApplication(client, applicationId, actorId) {
  // Serialise conversion per application so a retry waits instead of racing.
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`convert:${applicationId}`]);

  const existing = await client.query(
    `select s.student_number as "studentNumber", sp.id as "studentProgrammeId", s.id as "studentId"
     from student_programmes sp join students s on s.id = sp.student_id
     where sp.application_id = $1 and sp.origin_programme_id is null`,
    [applicationId]
  );
  if (existing.rowCount > 0) {
    return { ...existing.rows[0], created: false };
  }

  const found = await client.query(
    `select a.id, a.applicant_account_id, a.intake_id, a.programme_version_id, a.workflow_instance_id, a.reference_number,
            acc.person_id, w.state, to_char(i.starts_on, 'YYYY') as entry_year, p.code as programme_code, p.name as programme_name
     from applications a
     join accounts acc on acc.id = a.applicant_account_id
     join workflow_instances w on w.id = a.workflow_instance_id
     join intakes i on i.id = a.intake_id
     join programmes p on p.id = i.programme_id
     where a.id = $1`,
    [applicationId]
  );
  const application = found.rows[0];
  if (!application) {
    throw requestError(404, "Application was not found.");
  }
  if (application.state !== "Accepted") {
    throw requestError(409, `Only accepted applications convert to student records; this one is ${application.state}.`);
  }

  // A returning applicant keeps the student number they already have.
  let student = (await client.query(
    // A merged duplicate resolves to its surviving record, so the person keeps one student identity.
    `select coalesce(m.id, s.id) as id, coalesce(m.student_number, s.student_number) as "studentNumber"
     from students s left join students m on m.id = s.merged_into_student_id where s.person_id = $1`,
    [application.person_id]
  )).rows[0];
  let newStudent = false;
  if (!student) {
    const sequence = await client.query("select nextval('student_number_seq') as value");
    student = { id: `stu_${randomUUID()}`, studentNumber: formatStudentNumber(application.entry_year, sequence.rows[0].value) };
    await client.query(
      "insert into students (id, student_number, person_id, account_id) values ($1, $2, $3, $4)",
      [student.id, student.studentNumber, application.person_id, application.applicant_account_id]
    );
    newStudent = true;
  }

  const studentProgrammeId = `spr_${randomUUID()}`;
  await client.query(
    `insert into student_programmes (id, student_id, application_id, programme_version_id, intake_id, status)
     values ($1, $2, $3, $4, $5, 'pending_onboarding')`,
    [studentProgrammeId, student.id, applicationId, application.programme_version_id, application.intake_id]
  );
  await client.query(`insert into student_programme_history (id, student_programme_id, to_status, reason, actor_id)
    values ($1, $2, 'pending_onboarding', 'Accepted-offer conversion', $3)`, [`sph_${randomUUID()}`, studentProgrammeId, actorId]);

  await client.query(
    `update people
     set personas = case when personas ? 'student' then personas else personas || '["student"]'::jsonb end,
         updated_at = now()
     where id = $1`,
    [application.person_id]
  );
  const hasStudentRole = await client.query(
    "select 1 from role_assignments where account_id = $1 and role_code = 'student' and (effective_to is null or effective_to >= current_date)",
    [application.applicant_account_id]
  );
  if (hasStudentRole.rowCount === 0) {
    await client.query(
      `insert into role_assignments (id, account_id, role_code, scope, effective_from, granted_by, reason)
       values ($1, $2, 'student', '{}'::jsonb, current_date, 'admissions_conversion', $3)`,
      [`ra_${randomUUID()}`, application.applicant_account_id, `Accepted offer ${application.reference_number}`]
    );
  }

  // Registry picks onboarding up from its queue (Stage 3).
  await client.query(
    `insert into tasks (id, title, queue, workflow_instance_id, priority, due_at, status)
     values ($1, $2, 'registry.onboarding', $3, 'normal', now() + interval '14 days', 'open')`,
    [`task_${randomUUID()}`, `Onboard ${student.studentNumber} into ${application.programme_code}`, application.workflow_instance_id]
  );
  await queueNotification(client, application.applicant_account_id, "admissions.welcome_student", {
    studentNumber: student.studentNumber,
    programme: application.programme_name
  },{link:'#study/today'});
  await insertAudit(client, {
    actorId,
    action: "admissions.application.converted",
    subjectType: "Application",
    subjectId: applicationId,
    reason: `Converted to student ${student.studentNumber}${newStudent ? " (new student record)" : " (existing student record)"}`,
    afterRef: studentProgrammeId
  });
  return { studentId: student.id, studentNumber: student.studentNumber, studentProgrammeId, created: true };
}
