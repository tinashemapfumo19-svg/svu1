import { randomUUID } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, requestError, withTransaction } from "../support.js";
import { studyYearSelect, withStudyYear } from "./study-year.js";

const phonePattern = /^\+[1-9]\d{7,14}$/;
const relationships = ["parent", "spouse", "sibling", "guardian", "other"];

export function validateStudentProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw requestError(400, "Profile must be an object.");
  const allowed = ["phone", "address", "nextOfKin", "revision"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400, "Profile contains unsupported or restricted fields.");
  if (!Number.isInteger(input.revision) || input.revision < 0) throw requestError(400, "A non-negative profile revision is required.");
  if (typeof input.phone !== "string" || !phonePattern.test(input.phone)) throw requestError(400, "Phone must be in international format.");
  for (const [name, keys] of [["address", ["line1", "line2", "city", "postalCode", "countryCode"]], ["nextOfKin", ["name", "relationship", "phone"]]]) {
    const value = input[name];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || Object.values(value).some((field) => typeof field !== "string" || field.length > 200)) {
      throw requestError(400, `${name} contains invalid fields.`);
    }
  }
  if (!input.address.line1?.trim() || !input.address.city?.trim() || !/^[A-Z]{2}$/.test(input.address.countryCode || "")) throw requestError(400, "A complete address and country code are required.");
  if (Object.values(input.nextOfKin).some((value) => value.trim()) && (!input.nextOfKin.name?.trim() || !relationships.includes(input.nextOfKin.relationship) || !phonePattern.test(input.nextOfKin.phone || ""))) {
    throw requestError(400, "Next-of-kin needs a name, supported relationship, and international phone.");
  }
  return input;
}

export function onboardingReadiness(profile) {
  const missing = [];
  if (!phonePattern.test(profile?.phone || "")) missing.push("phone");
  if (!profile?.address?.line1?.trim() || !profile?.address?.city?.trim() || !profile?.address?.countryCode) missing.push("address");
  if (!profile?.nextOfKin?.name?.trim() || !relationships.includes(profile?.nextOfKin?.relationship) || !phonePattern.test(profile?.nextOfKin?.phone || "")) missing.push("nextOfKin");
  return { complete: missing.length === 0, missing };
}

const programmeSelect = `select sp.id, s.student_number as "studentNumber", pe.legal_name as "legalName", sp.student_id as "studentId", sp.status,sp.legacy_source_status as "legacySourceStatus",sp.status_revision as "statusRevision",
 sp.application_id as "applicationId",sp.origin_programme_id as "originProgrammeId",sp.transfer_request_id as "transferRequestId", sp.intake_id as "intakeId", sp.programme_version_id as "programmeVersionId",
 sp.legacy_recorded_study_year as "legacyRecordedStudyYear",sp.legacy_study_year_updated_on as "legacyStudyYearUpdatedOn",
 p.code as "programmeCode", p.name as "programmeName", i.label as "intakeLabel",v.version_label as "versionLabel",
 d.name as department, f.name as faculty, a.study_mode_code as "studyModeCode", sp.created_at as "convertedAt",${studyYearSelect}
 from student_programmes sp join intakes i on i.id = sp.intake_id
 join programmes p on p.id = i.programme_id
 join organization_units d on d.id = p.department_id left join organization_units f on f.id = d.parent_id
 join applications a on a.id = sp.application_id
 left join programme_versions v on v.id = sp.programme_version_id
 join students s on s.id = sp.student_id join people pe on pe.id = s.person_id`;

async function ownedStudent(client, actor) {
  const row = (await client.query('select id, student_number as "studentNumber" from students where account_id = $1', [actor.accountId])).rows[0];
  if (!row) throw requestError(404, "No student record is linked to this account.");
  return row;
}

async function profileFor(client, studentId) {
  const profile = (await client.query(`select phone, address, next_of_kin as "nextOfKin", revision from student_profiles where student_id = $1`, [studentId])).rows[0];
  if (profile) return profile;
  const initial = (await client.query(`select coalesce(p.phone, '') as phone, coalesce(p.address, '{}'::jsonb) as address
    from students s left join applicant_profiles p on p.account_id = s.account_id where s.id = $1`, [studentId])).rows[0];
  return { ...initial, nextOfKin: {}, revision: 0 };
}

export function createRegistryModule(pool) {
  return {
    async getOwnStudent(actor) {
      return withTransaction(pool, async (client) => {
        const student = await ownedStudent(client, actor);
        const profile = await profileFor(client, student.id);
        const programmes = (await client.query(`${programmeSelect} where sp.student_id = $1 order by sp.created_at desc`, [student.id])).rows;
        return { ...student, profile, programmes:programmes.map(withStudyYear), readiness: onboardingReadiness(profile) };
      });
    },

    async saveStudentProfile(input, actor) {
      validateStudentProfile(input);
      return withTransaction(pool, async (client) => {
        const student = await ownedStudent(client, actor);
        await client.query("select id from students where id = $1 for update", [student.id]);
        const previous = await profileFor(client, student.id);
        if (previous.revision !== input.revision) throw requestError(409, "Profile changed. Reload before saving again.");
        const country = await client.query("select 1 from reference_values where list_code = 'country' and value_code = $1 and status = 'active' and (effective_from is null or effective_from <= current_date) and (effective_to is null or effective_to >= current_date)", [input.address.countryCode]);
        if (!country.rowCount) throw requestError(400, "Select an active country.");
        const revision = previous.revision + 1;
        await client.query(`insert into student_profile_history (id,student_id,revision,snapshot,actor_id) values ($1,$2,$3,$4,$5) on conflict (student_id,revision) do nothing`,
          [`sph_${randomUUID()}`, student.id, previous.revision, previous, actor.accountId]);
        await client.query(`insert into student_profiles (student_id, phone, address, next_of_kin, revision) values ($1,$2,$3,$4,$5)
          on conflict (student_id) do update set phone = excluded.phone, address = excluded.address, next_of_kin = excluded.next_of_kin, revision = excluded.revision, updated_at = now()`,
        [student.id, input.phone, input.address, input.nextOfKin, revision]);
        await client.query(`insert into student_profile_history (id,student_id,revision,snapshot,actor_id) values ($1,$2,$3,$4,$5)`,
          [`sph_${randomUUID()}`, student.id, revision, { phone: input.phone, address: input.address, nextOfKin: input.nextOfKin }, actor.accountId]);
        await insertAudit(client, { actorId: actor.accountId, action: "registry.profile.saved", subjectType: "Student", subjectId: student.id,
          reason: "Student updated contact and emergency contact details", metadata: { revision } });
        return { revision, readiness: onboardingReadiness(input) };
      });
    },

    async listRegistryStudents(filters, actor) {
      const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 50, 1), 100);
      const offset = Math.max(Number.parseInt(filters.offset, 10) || 0, 0);
      const rows = (await pool.query(`${programmeSelect}
        where ($1::text is null or s.student_number ilike '%' || $1 || '%' or pe.legal_name ilike '%' || $1 || '%')
        and ($2::text is null or sp.status = $2) and ($3::text is null or sp.intake_id = $3)
        order by sp.created_at desc, sp.id`, [filters.q?.slice(0, 200) || null, filters.status || null, filters.intakeId || null])).rows
        .filter((row) => actorCanAccessScope(actor, { programmeCode: row.programmeCode, intakeId: row.intakeId }));
      return { items: rows.slice(offset, offset + limit).map(withStudyYear), total: rows.length, offset, limit };
    },

    async getRegistryProgramme(programmeId, actor) {
      return withTransaction(pool, async (client) => {
        const programme = (await client.query(`${programmeSelect} where sp.id = $1`, [programmeId])).rows[0];
        if (!programme) throw requestError(404, "Student programme was not found.");
        assertActorCanAccessScope(actor, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        const history = (await client.query(`select from_status as "fromStatus", to_status as "toStatus", reason, effective_at as "effectiveAt"
          from student_programme_history where student_programme_id = $1 order by effective_at, id`, [programmeId])).rows;
        const profile = await profileFor(client, programme.studentId);
        // Next-of-kin is deliberately not included in the general registry view.
        const permission = "registry.registration.configure";
        const canConfigureRegistration = actor.permissions.includes(permission) && actorCanAccessScope({ ...actor, authorizingPermission: permission }, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        const canOnboard = actor.permissions.includes("registry.onboard") && actorCanAccessScope({ ...actor, authorizingPermission: "registry.onboard" }, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        const canViewResults = actor.permissions.includes("results.view") && actorCanAccessScope({ ...actor, authorizingPermission: "results.view" }, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        const canViewAcademic = actor.permissions.includes("academic.view") && actorCanAccessScope({ ...actor, authorizingPermission: "academic.view" }, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        return { ...withStudyYear(programme), history, readiness: onboardingReadiness(profile), canConfigureRegistration, canOnboard, canViewResults, canViewAcademic };
      });
    },

    async approveStudentOnboarding(programmeId, input, actor) {
      if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400, "An approval reason is required.");
      if (input.identityConfirmed !== true) throw requestError(400, "Identity confirmation is required.");
      return withTransaction(pool, async (client) => {
        const programme = (await client.query(`${programmeSelect} where sp.id = $1 for update of sp`, [programmeId])).rows[0];
        if (!programme) throw requestError(404, "Student programme was not found.");
        assertActorCanAccessScope(actor, { programmeCode: programme.programmeCode, intakeId: programme.intakeId });
        await client.query("select id from students where id = $1 for update", [programme.studentId]);
        if (programme.status !== "pending_onboarding") throw requestError(409, "Only pending onboarding can be approved.");
        const readiness = onboardingReadiness(await profileFor(client, programme.studentId));
        if (!readiness.complete) throw requestError(409, `Complete the student profile first: ${readiness.missing.join(', ')}.`);
        await client.query("update student_programmes set status = 'onboarded',status_revision = status_revision + 1 where id = $1", [programmeId]);
        await client.query(`insert into student_programme_history (id,student_programme_id,from_status,to_status,reason,actor_id)
          values ($1,$2,'pending_onboarding','onboarded',$3,$4)`, [`sph_${randomUUID()}`, programmeId, input.reason.trim(), actor.accountId]);
        await client.query(`update tasks set status = 'completed', updated_at = now() where queue = 'registry.onboarding' and status = 'open'
          and workflow_instance_id = (select workflow_instance_id from applications where id = $1)`, [programme.applicationId]);
        await insertAudit(client, { actorId: actor.accountId, action: "registry.onboarding.approved", subjectType: "StudentProgramme", subjectId: programmeId,
          reason: input.reason.trim(), metadata: { fromStatus: "pending_onboarding", toStatus: "onboarded", identityConfirmed: true } });
        return { id: programmeId, status: "onboarded" };
      });
    }
  };
}
