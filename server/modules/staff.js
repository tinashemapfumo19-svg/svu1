import { randomUUID } from "node:crypto";
import { createSecret, digestToken, normalizeEmail } from "../security.js";
import { queueNotification } from "../notification-queue.js";
import { lockAccountMailbox } from "../account-mailbox.js";
import { endAllocationsForExit } from "./teaching.js";
import { insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";

// Roles a staff invitation may grant. Critical and self-service roles are assigned through access management instead.
export const staffInvitationRoles = ["lecturer","hr_officer","admissions_officer","admissions_manager","academic_registrar","finance_officer","examinations_officer","academic_approver","asset_officer","asset_approver","cashbook_officer","cashbook_approver","fleet_officer","fleet_approver","fleet_safety_officer"];
const transitions = {invited:["exited"],active:["suspended","exited"],suspended:["active","exited"],exited:[]};
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const dayBefore = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0,10);

export function staffTransitions(status) {return transitions[status] || [];}

function validateEmployment(input) {
  if (!text(input.departmentId,100) || !/^[A-Z][A-Z_]{1,39}$/.test(input.category ?? "") || !text(input.grade,40)
    || input.supervisorStaffId !== undefined && input.supervisorStaffId !== null && !text(input.supervisorStaffId,100) || !text(input.reason,2000)) {
    throw requestError(400,"Provide department, staff category, grade, optional supervisor, and a reason.");
  }
}

export function validateNewStaff(input) {
  const allowed = ["email","legalName","preferredName","employeeNumber","category","grade","departmentId","supervisorStaffId","engagedOn","roleCode","scope","reason","linkExistingAccount"];
  if (input && input.linkExistingAccount !== undefined && typeof input.linkExistingAccount !== "boolean") throw requestError(400,"linkExistingAccount must be true or false.");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,"Staff record contains unsupported fields.");
  const email = normalizeEmail(input.email ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254 || !text(input.legalName,200) || !text(input.preferredName,100) || !input.engagedOn
    || input.employeeNumber !== undefined && !/^[A-Z0-9-]{3,20}$/.test(input.employeeNumber) || !staffInvitationRoles.includes(input.roleCode)) {
    throw requestError(400,"Provide a valid email, legal and preferred names, engagement date, optional employee number, and a staff role.");
  }
  if (input.scope !== undefined && (!input.scope || typeof input.scope !== "object" || Array.isArray(input.scope) || Object.keys(input.scope).some((key) => !["programmeCodes","intakeIds"].includes(key))
    || Object.values(input.scope).some((list) => !Array.isArray(list) || list.some((value) => !text(value,100))))) throw requestError(400,"Scope may list programmeCodes and intakeIds only.");
  validateEmployment(input);
  return {email,engagedOn:parseEffectiveDate(input.engagedOn)};
}

export function validateEmploymentChange(input) {
  if (!input || Object.keys(input).some((key) => !["revision","departmentId","category","grade","supervisorStaffId","effectiveFrom","reason"].includes(key)) || !Number.isInteger(input.revision) || !input.effectiveFrom) {
    throw requestError(400,"Provide the staff revision, new employment details, effective date, and reason.");
  }
  validateEmployment(input);
  return {effectiveFrom:parseEffectiveDate(input.effectiveFrom)};
}

export function validateStatusChange(input,status,today = todayIso()) {
  if (!input || Object.keys(input).some((key) => !["revision","toStatus","effectiveOn","reason"].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000) || !input.effectiveOn) {
    throw requestError(400,"Provide the staff revision, target status, effective date, and reason.");
  }
  if (!staffTransitions(status).includes(input.toStatus)) throw requestError(409,`A ${status} staff record cannot become ${input.toStatus}.`);
  const effectiveOn = parseEffectiveDate(input.effectiveOn);
  if (effectiveOn > today) throw requestError(400,"Status changes take effect today or earlier; schedule future exits once the date arrives.");
  return {effectiveOn};
}

function requireGlobalStaff(actor) {
  const roles = actor.roles.filter((role) => (role.permissions || []).includes("staff.manage"));
  if (!roles.some((role) => role.code === "system_administrator" || isGlobalScope(role.scope))) throw requestError(403,"Staff administration needs institution-wide scope.");
}

async function assertEmploymentReferences(db,input,staffId = null) {
  const unit = (await db.query("select status from organization_units where id = $1",[input.departmentId])).rows[0];
  if (!unit || unit.status !== "active") throw requestError(400,"Select an active department.");
  const category = await db.query("select 1 from reference_values where list_code = 'staff_category' and value_code = $1 and status = 'active'",[input.category]);
  if (!category.rowCount) throw requestError(400,`${input.category} is not an active staff category.`);
  if (!input.supervisorStaffId) return;
  // Walk the reporting line upwards so a change can never make someone their own (indirect) supervisor.
  let cursor = input.supervisorStaffId;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === staffId) throw requestError(409,"This supervisor change would create a reporting loop.");
    const row = (await db.query(`select m.status,p.supervisor_staff_id as next from staff_members m left join staff_employment_periods p on p.staff_id = m.id and p.effective_to is null where m.id = $1`,[cursor])).rows[0];
    if (!row) throw requestError(400,"Supervisor staff record was not found.");
    if (depth === 0 && row.status === "exited") throw requestError(409,"An exited staff member cannot supervise.");
    cursor = row.next;
  }
}

const staffSelect = `select m.id,m.employee_number as "employeeNumber",m.email,coalesce(pe.legal_name,m.legal_name) as "legalName",coalesce(pe.preferred_name,m.preferred_name) as "preferredName",
  m.status,m.account_id as "accountId",to_char(m.engaged_on,'YYYY-MM-DD') as "engagedOn",to_char(m.exited_on,'YYYY-MM-DD') as "exitedOn",m.revision,
  p.department_id as "departmentId",u.name as "departmentName",p.category,p.grade,p.supervisor_staff_id as "supervisorStaffId",
  coalesce(spe.preferred_name,sm.preferred_name) as "supervisorName",sm.status as "supervisorStatus",to_char(p.effective_from,'YYYY-MM-DD') as "employmentFrom"
  from staff_members m left join accounts a on a.id = m.account_id left join people pe on pe.id = a.person_id
  left join staff_employment_periods p on p.staff_id = m.id and (p.effective_to is null or m.status = 'exited' and p.effective_to = m.exited_on)
  left join organization_units u on u.id = p.department_id left join staff_members sm on sm.id = p.supervisor_staff_id
  left join accounts sa on sa.id = sm.account_id left join people spe on spe.id = sa.person_id`;

export function createStaffModule(pool,{devOutboxDir = null,dataEncryptionKey} = {}) {
  async function detail(db,id) {
    const row = (await db.query(`${staffSelect} where m.id = $1`,[id])).rows[0];
    if (!row) throw requestError(404,"Staff record was not found.");
    row.employment = (await db.query(`select p.id::int,p.department_id as "departmentId",u.name as "departmentName",p.category,p.grade,p.supervisor_staff_id as "supervisorStaffId",
      to_char(p.effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(p.effective_to,'YYYY-MM-DD') as "effectiveTo",p.reason from staff_employment_periods p join organization_units u on u.id = p.department_id
      where p.staff_id = $1 order by p.effective_from desc,p.id desc`,[id])).rows;
    row.statusHistory = (await db.query(`select from_status as "fromStatus",to_status as "toStatus",to_char(effective_on,'YYYY-MM-DD') as "effectiveOn",reason,recorded_at as "recordedAt"
      from staff_status_history where staff_id = $1 order by id desc`,[id])).rows;
    row.roles = row.accountId ? (await db.query(`select role_code as "roleCode",scope,to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(effective_to,'YYYY-MM-DD') as "effectiveTo"
      from role_assignments where account_id = $1 order by effective_from desc`,[row.accountId])).rows : [];
    // HR sees whether the offer went to a new account (activation) or an existing one (acceptance), and its outcome.
    row.invitation = (await db.query(`select i.status,i.expires_at as "expiresAt",i.status in ('pending_acceptance','declined') as "existingAccount" from staff_members m
      join invitations i on i.id = m.invitation_id where m.id = $1`,[id])).rows[0];
    return row;
  }
  return {
    async listStaff(filters,actor) {
      const limit = Math.min(Math.max(Number(filters.limit) || 25,1),100),offset = Math.max(Number(filters.offset) || 0,0);
      const conditions = [],values = [];
      if (filters.q) {values.push(`%${filters.q}%`); conditions.push(`(m.employee_number ilike $${values.length} or m.email ilike $${values.length} or coalesce(pe.legal_name,m.legal_name) ilike $${values.length})`);}
      if (filters.status) {values.push(filters.status); conditions.push(`m.status = $${values.length}`);}
      if (filters.departmentId) {values.push(filters.departmentId); conditions.push(`p.department_id = $${values.length}`);}
      const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
      const total = (await pool.query(`select count(*)::int as total from (${staffSelect} ${where}) s`,values)).rows[0].total;
      const items = (await pool.query(`${staffSelect} ${where} order by coalesce(pe.legal_name,m.legal_name) limit ${limit} offset ${offset}`,values)).rows;
      const canManage = actor.roles.some((role) => (role.permissions || []).includes("staff.manage") && (role.code === "system_administrator" || isGlobalScope(role.scope)));
      return {items,total,limit,offset,capabilities:{manage:canManage,invitationRoles:staffInvitationRoles},accountId:actor.accountId};
    },
    async getStaffMember(id) {
      return withTransaction(pool,async (db) => detail(db,id));
    },
    async createStaffMember(input,actor) {
      requireGlobalStaff(actor);
      const {email,engagedOn} = validateNewStaff(input);
      return withTransaction(pool,async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`staff-email:${email}`]);
        await lockAccountMailbox(db,email);
        if ((await db.query("select 1 from staff_members where lower(btrim(email)) = $1",[email])).rowCount) throw requestError(409,"A staff record already uses this email.");
        // A person who already has an account (for example a student) is never given a second one. HR must ask to link,
        // and the appointment takes effect only when the signed-in account holder accepts it.
        const matches = (await db.query("select id,status from accounts where lower(btrim(email)) = $1 limit 2",[email])).rows;
        if (matches.length > 1) throw requestError(409,"Account identity is ambiguous; resolve it before offering an appointment.");
        const existing = matches[0];
        if (existing && input.linkExistingAccount !== true) throw requestError(409,"An account already uses this email. Set linkExistingAccount to offer the appointment to that account holder.");
        if (!existing && input.linkExistingAccount === true) throw requestError(400,"No existing account uses this email; leave linkExistingAccount off to send a new-account invitation.");
        if (existing && existing.status !== "active") throw requestError(409,"The existing account is not active, so it cannot accept an appointment.");
        await assertEmploymentReferences(db,input);
        const employeeNumber = input.employeeNumber || `E${String((await db.query("select nextval('staff_number_seq') as value")).rows[0].value).padStart(6,"0")}`;
        if ((await db.query("select 1 from staff_members where employee_number = $1",[employeeNumber])).rowCount) throw requestError(409,"This employee number is already in use.");
        const invitationId = `inv_${randomUUID()}`,activationToken = createSecret(),expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),id = `stf_${randomUUID()}`;
        await db.query(`insert into invitations (id,email,role_code,scope,status,expires_at) values ($1,$2,$3,$4,$5,$6)`,[invitationId,email,input.roleCode,JSON.stringify(input.scope || {}),existing ? "pending_acceptance" : "pending_activation",expiresAt]);
        if (!existing) await db.query(`insert into account_activation_tokens (id,invitation_id,email,token_digest,status,expires_at) values ($1,$2,$3,$4,'active',$5)`,[`act_${randomUUID()}`,invitationId,email,digestToken(activationToken),expiresAt]);
        await db.query(`insert into staff_members (id,employee_number,email,legal_name,preferred_name,invitation_id,engaged_on,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id,employeeNumber,email,input.legalName.trim(),input.preferredName.trim(),invitationId,engagedOn,actor.accountId]);
        await db.query(`insert into staff_employment_periods (staff_id,department_id,category,grade,supervisor_staff_id,effective_from,reason,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id,input.departmentId,input.category,input.grade.trim(),input.supervisorStaffId || null,engagedOn,input.reason.trim(),actor.accountId]);
        await db.query("insert into staff_status_history (staff_id,from_status,to_status,effective_on,reason,actor_id) values ($1,null,'invited',$2,$3,$4)",[id,engagedOn,input.reason.trim(),actor.accountId]);
        if (existing) await queueNotification(db,existing.id,"staff.appointment",{preferredName:input.preferredName.trim(),employeeNumber});
        else await queueNotification(db,null,"staff.invitation",{preferredName:input.preferredName.trim(),employeeNumber,activationToken},{sensitive:true,devOutboxDir,recipientEmail:email,dataEncryptionKey});
        await insertAudit(db,{actorId:actor.accountId,action:"staff.created",subjectType:"StaffMember",subjectId:id,reason:input.reason,metadata:{employeeNumber,roleCode:input.roleCode,departmentId:input.departmentId,category:input.category,invitationId,linkedAccount:existing?.id || null}});
        return detail(db,id);
      });
    },
    // Appointments offered to the signed-in account (matched by its own email), still open and unexpired.
    async listOwnStaffAppointments(actor) {
      return (await pool.query(`select i.id as "invitationId",i.role_code as "roleCode",i.expires_at as "expiresAt",m.employee_number as "employeeNumber",m.preferred_name as "preferredName",
        to_char(m.engaged_on,'YYYY-MM-DD') as "engagedOn",p.category,p.grade,u.name as "departmentName"
        from invitations i join accounts a on lower(btrim(a.email)) = lower(btrim(i.email)) and a.id = $1 join staff_members m on m.invitation_id = i.id
        join staff_employment_periods p on p.staff_id = m.id and p.effective_to is null join organization_units u on u.id = p.department_id
        where i.status = 'pending_acceptance' and i.expires_at > now() and m.status = 'invited'
        and not exists(select 1 from accounts other where other.id<>a.id and lower(btrim(other.email))=lower(btrim(a.email))) order by i.created_at`,[actor.accountId])).rows;
    },
    // Acceptance links the staff record to this account and grants the invited role; declining leaves the account
    // untouched and tells HR through the record's history.
    async respondToStaffAppointment(invitationId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["accept","reason"].includes(key)) || typeof input.accept !== "boolean" || (input.reason !== undefined && !text(input.reason,500))) throw requestError(400,"Choose accept true or false, with an optional reason.");
      return withTransaction(pool,async (db) => {
        const invitation = (await db.query(`select i.id,i.role_code as "roleCode",i.scope,i.status,i.expires_at as "expiresAt",m.id as "staffId",m.status as "staffStatus",a.person_id as "personId"
          from invitations i join accounts a on lower(btrim(a.email)) = lower(btrim(i.email)) and a.id = $2 join staff_members m on m.invitation_id = i.id where i.id = $1
          and not exists(select 1 from accounts other where other.id<>a.id and lower(btrim(other.email))=lower(btrim(a.email))) for update of i,m`,[invitationId,actor.accountId])).rows[0];
        if (!invitation) throw requestError(404,"Appointment was not found.");
        if (invitation.status !== "pending_acceptance" || invitation.staffStatus !== "invited") throw requestError(409,"This appointment has already been answered or withdrawn.");
        if (new Date(invitation.expiresAt) <= new Date()) throw requestError(409,"This appointment has expired. Ask HR to send it again.");
        const reason = input.reason?.trim() || (input.accept ? "Staff appointment accepted by the account holder" : "Staff appointment declined by the account holder");
        if (!input.accept) {
          await db.query("update invitations set status = 'declined' where id = $1",[invitationId]);
          await insertAudit(db,{actorId:actor.accountId,action:"staff.appointment.declined",subjectType:"StaffMember",subjectId:invitation.staffId,reason});
          return {invitationId,status:"declined"};
        }
        await db.query("update invitations set status = 'activated' where id = $1",[invitationId]);
        if (!(await db.query("select 1 from role_assignments where account_id = $1 and role_code = $2 and scope = $3::jsonb and (effective_to is null or effective_to >= current_date)",
          [actor.accountId,invitation.roleCode,JSON.stringify(invitation.scope || {})])).rowCount) {
          const assignmentId = `ra_${randomUUID()}`;
          await db.query("insert into role_assignments (id,account_id,role_code,scope,effective_from,granted_by,reason) values ($1,$2,$3,$4,current_date,$5,'Granted by accepted staff appointment')",
            [assignmentId,actor.accountId,invitation.roleCode,invitation.scope || {},`invitation:${invitationId}`]);
          await insertAudit(db,{actorId:actor.accountId,action:"access.role_assignment.created",subjectType:"RoleAssignment",subjectId:assignmentId,reason:`Granted ${invitation.roleCode} from staff appointment ${invitationId}`});
        }
        await db.query("update people set personas = personas || '[\"staff\"]'::jsonb,updated_at = now() where id = $1 and not personas ? 'staff'",[invitation.personId]);
        await linkActivatedStaff(db,invitationId,actor.accountId);
        await insertAudit(db,{actorId:actor.accountId,action:"staff.appointment.accepted",subjectType:"StaffMember",subjectId:invitation.staffId,reason});
        return {invitationId,status:"accepted",staffId:invitation.staffId};
      });
    },
    async changeStaffEmployment(id,input,actor) {
      requireGlobalStaff(actor);
      const {effectiveFrom} = validateEmploymentChange(input);
      return withTransaction(pool,async (db) => {
        const staff = (await db.query("select status,revision,to_char(engaged_on,'YYYY-MM-DD') as \"engagedOn\" from staff_members where id = $1 for update",[id])).rows[0];
        if (!staff) throw requestError(404,"Staff record was not found.");
        if (staff.status === "exited") throw requestError(409,"Exited staff records are closed.");
        if (staff.revision !== input.revision) throw requestError(409,"Staff record changed. Reload before changing employment.");
        const current = (await db.query("select id,to_char(effective_from,'YYYY-MM-DD') as \"effectiveFrom\" from staff_employment_periods where staff_id = $1 and effective_to is null",[id])).rows[0];
        if (effectiveFrom <= current.effectiveFrom) throw requestError(409,`A new employment period must start after the current one (${current.effectiveFrom}); history is never overwritten.`);
        await assertEmploymentReferences(db,input,id);
        await db.query("update staff_employment_periods set effective_to = $2 where id = $1",[current.id,dayBefore(effectiveFrom)]);
        await db.query(`insert into staff_employment_periods (staff_id,department_id,category,grade,supervisor_staff_id,effective_from,reason,recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id,input.departmentId,input.category,input.grade.trim(),input.supervisorStaffId || null,effectiveFrom,input.reason.trim(),actor.accountId]);
        await db.query("update staff_members set revision = revision + 1 where id = $1",[id]);
        await insertAudit(db,{actorId:actor.accountId,action:"staff.employment_changed",subjectType:"StaffMember",subjectId:id,reason:input.reason,metadata:{effectiveFrom,departmentId:input.departmentId,category:input.category,grade:input.grade,supervisorStaffId:input.supervisorStaffId || null}});
        return detail(db,id);
      });
    },
    async changeStaffStatus(id,input,actor) {
      requireGlobalStaff(actor);
      return withTransaction(pool,async (db) => {
        const staff = (await db.query("select status,revision,account_id as \"accountId\",invitation_id as \"invitationId\",to_char(engaged_on,'YYYY-MM-DD') as \"engagedOn\" from staff_members where id = $1 for update",[id])).rows[0];
        if (!staff) throw requestError(404,"Staff record was not found.");
        const {effectiveOn} = validateStatusChange(input,staff.status);
        if (staff.revision !== input.revision) throw requestError(409,"Staff record changed. Reload before changing status.");
        if (effectiveOn < staff.engagedOn) throw requestError(400,"A status change cannot precede the engagement date.");
        if (input.toStatus === "active" && !staff.accountId) throw requestError(409,"The staff member must activate their account first.");
        if (staff.accountId) {
          // Access follows employment: suspension and exit lock the account and end live sessions; reinstatement unlocks it.
          await db.query("update accounts set status = $2,updated_at = now() where id = $1",[staff.accountId,input.toStatus === "active" ? "active" : "suspended"]);
          if (input.toStatus !== "active") await db.query("update sessions set status = 'revoked',revoked_at = now() where account_id = $1 and status = 'active'",[staff.accountId]);
          if (input.toStatus === "exited") await db.query("update role_assignments set effective_to = $2 where account_id = $1 and (effective_to is null or effective_to > $2)",[staff.accountId,effectiveOn]);
        } else {
          await db.query("update account_activation_tokens set status = 'used',used_at = now() where invitation_id = $1 and status = 'active'",[staff.invitationId]);
          await db.query("update invitations set status = 'withdrawn' where id = $1",[staff.invitationId]);
        }
        if (input.toStatus === "exited") {
          const current = (await db.query("select id,to_char(effective_from,'YYYY-MM-DD') as \"effectiveFrom\" from staff_employment_periods where staff_id = $1 and effective_to is null",[id])).rows[0];
          if (effectiveOn < current.effectiveFrom) throw requestError(409,`Exit cannot precede the current employment period (${current.effectiveFrom}).`);
          await db.query("update staff_employment_periods set effective_to = $2 where id = $1",[current.id,effectiveOn]);
          await endAllocationsForExit(db,id,effectiveOn,actor.accountId);
        }
        await db.query("update staff_members set status = $2,exited_on = $3,revision = revision + 1 where id = $1",[id,input.toStatus,input.toStatus === "exited" ? effectiveOn : null]);
        await db.query("insert into staff_status_history (staff_id,from_status,to_status,effective_on,reason,actor_id) values ($1,$2,$3,$4,$5,$6)",[id,staff.status,input.toStatus,effectiveOn,input.reason.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:`staff.${input.toStatus}`,subjectType:"StaffMember",subjectId:id,reason:input.reason,metadata:{fromStatus:staff.status,toStatus:input.toStatus,effectiveOn}});
        return detail(db,id);
      });
    }
  };
}

// Called inside account activation: links the invited staff record to the new account and records it as active.
export async function linkActivatedStaff(db,invitationId,accountId) {
  const linked = await db.query("update staff_members set account_id = $2,status = 'active',revision = revision + 1 where invitation_id = $1 and account_id is null and status = 'invited' returning id",[invitationId,accountId]);
  for (const row of linked.rows) await db.query("insert into staff_status_history (staff_id,from_status,to_status,effective_on,reason,actor_id) values ($1,'invited','active',current_date,'Account activated from staff invitation',$2)",[row.id,accountId]);
}
