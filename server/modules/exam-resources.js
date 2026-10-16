import { randomUUID } from 'node:crypto';
import { insertAudit, isGlobalScope, requestError, withTransaction } from '../support.js';
import { personalExamDuty } from './exam-arrangements.js';

const text = (value,max) => typeof value === 'string' && value.trim() && value.length <= max;
export const venueLabel = (row) => `${row.code} - ${row.name}`;
export const venueSelect = `select id,code,name,campus,location,capacity,status,revision,updated_by as "updatedBy",updated_at as "updatedAt" from exam_venues`;
export const invigilatorSelect = `select i.sitting_id as "sittingId",i.staff_id as "staffId",i.role,m.employee_number as "employeeNumber",m.status,
  coalesce(p.legal_name,m.legal_name) as "legalName",to_char(m.engaged_on,'YYYY-MM-DD') as "engagedOn",m.account_id as "accountId"
  from exam_sitting_invigilators i join staff_members m on m.id = i.staff_id left join accounts a on a.id = m.account_id left join people p on p.id = a.person_id`;

export function validateVenue(input,update = false) {
  const allowed = ['name','campus','location','capacity','reason',...(update ? ['revision','status'] : ['code'])];
  if (!input || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key)) || !text(input.name,90) || !text(input.campus,80)
    || !text(input.location,120) || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 5000 || !text(input.reason,2000)
    || (update ? !Number.isInteger(input.revision) || !['active','inactive'].includes(input.status) : !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(input.code ?? ''))) throw requestError(400,'Provide the venue code, name, campus, location, capacity and reason; updates also need revision and status.');
  return {...input,name:input.name.trim(),campus:input.campus.trim(),location:input.location.trim(),reason:input.reason.trim()};
}
export function validateInvigilators(input) {
  if (!input || Object.keys(input).some((key) => !['revision','entries','reason'].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000)
    || !Array.isArray(input.entries) || input.entries.length > 20) throw requestError(400,'Provide the sitting revision, up to 20 invigilators, and a reason.');
  const seen = new Set();
  for (const row of input.entries) {
    if (!row || Object.keys(row).some((key) => !['staffId','role'].includes(key)) || !text(row.staffId,100) || !['lead','invigilator'].includes(row.role) || seen.has(row.staffId)) throw requestError(400,'Choose distinct staff members and a lead or invigilator role.');
    seen.add(row.staffId);
  }
  if (input.entries.filter((row) => row.role === 'lead').length > 1) throw requestError(400,'A sitting can have only one lead invigilator.');
}
export const examsOverlap = (a,b) => Date.parse(a.startsAt) < Date.parse(b.startsAt) + b.durationMinutes*60000 && Date.parse(b.startsAt) < Date.parse(a.startsAt) + a.durationMinutes*60000;
export async function publishedExamCommitments(db,excludedPeriodId) {
  const rows = (await db.query('select published_staff_snapshot as snapshot from exam_timetables where period_id <> $1 and published_staff_snapshot is not null',[excludedPeriodId])).rows;
  return rows.flatMap((row) => row.snapshot.sittings.flatMap((sitting) => (sitting.resourceSegments || [sitting]).map((entry) => ({...entry,id:sitting.id,status:'scheduled'}))));
}
export function examResourceIssues(sittings,others,venues,now = Date.now()) {
  const issues = [];
  for (const row of sittings.filter((entry) => entry.status === 'scheduled')) {
    const future = Date.parse(row.startsAt) + row.durationMinutes*60000 > now;
    if (row.venueId && future) {
      const venue = venues.find((entry) => entry.id === row.venueId);
      if (!venue || venue.status !== 'active' || row.venueRevision !== venue.revision) issues.push({sittingId:row.id,kind:'venue',problem:'The managed venue changed or is inactive. Re-select an active venue.'});
    }
    if (future && row.invigilators.some((entry) => entry.status !== 'active' || entry.engagedOn > row.localDate)) issues.push({sittingId:row.id,kind:'staff',problem:'An assigned invigilator is inactive or not engaged on the sitting date.'});
    for (const other of others) {
      if (row.id === other.id || other.status !== 'scheduled' || !examsOverlap(row,other)) continue;
      const sameRoom = row.venueId && other.venueId ? row.venueId === other.venueId : (row.venueId || other.venueId) && row.venue.toLowerCase() === other.venue.toLowerCase();
      if (sameRoom) issues.push({sittingId:row.id,kind:'room',problem:'The managed room overlaps another active sitting.'});
      if (row.invigilators.some((entry) => other.invigilators.some((assigned) => assigned.staffId === entry.staffId))) issues.push({sittingId:row.id,kind:'invigilator',problem:'An invigilator overlaps another active sitting.'});
    }
  }
  return issues.filter((issue,index) => issues.findIndex((entry) => entry.sittingId === issue.sittingId && entry.kind === issue.kind) === index);
}

// All resource-changing operations acquire this before the per-period timetable lock.
export async function lockExamResources(db) {await db.query("select pg_advisory_xact_lock(hashtext('exam-resources'))");}
export async function resolveSittingVenue(db,changes,current = null) {
  const id = changes.venueId === undefined ? current?.venueId : changes.venueId;
  if (!id) {
    const label = changes.venue ?? current?.venue;
    if (label && (await db.query("select 1 from exam_venues where lower(code) = lower($1) or lower(code || ' - ' || name) = lower($1)",[label])).rows.length) throw requestError(409,'This venue is registered. Select its active catalogue record.');
    return {...changes,venueId:null,venueRevision:null,venueLocation:null};
  }
  const venue = (await db.query(`${venueSelect} where id = $1 for share`,[id])).rows[0];
  if (!venue) throw requestError(404,'Exam venue was not found.');
  if (venue.status !== 'active') throw requestError(409,'Choose an active exam venue.');
  if (changes.venueId === undefined && current.venueRevision !== venue.revision) throw requestError(409,'The venue changed. Re-select the current managed venue.');
  if ((changes.venue !== undefined && changes.venue !== venueLabel(venue)) || (changes.capacity !== undefined && changes.capacity !== venue.capacity)) throw requestError(400,'Managed venue name and capacity come from its catalogue record.');
  return {...changes,venueId:id,venueRevision:venue.revision,venueLocation:`${venue.campus} - ${venue.location}`,venue:venueLabel(venue),capacity:venue.capacity};
}

const mayManage = (actor) => actor.roles.some((role) => role.permissions?.includes('exams.venues.manage') && isGlobalScope(role.scope));
export function createExamResourcesModule(pool) {
  return {
    async listExamVenues(actor) {
      const items = (await pool.query(`${venueSelect} order by campus,code`)).rows;
      return {items,capabilities:{manage:mayManage(actor)}};
    },
    async saveExamVenue(id,input,actor) {
      if (!mayManage(actor)) throw requestError(403,'Global venue-management authority is required.');
      const values = validateVenue(input,Boolean(id));
      return withTransaction(pool,async (db) => {
        await lockExamResources(db);
        if (id) {
          const current = (await db.query(`${venueSelect} where id = $1 for update`,[id])).rows[0];
          if (!current) throw requestError(404,'Exam venue was not found.');
          if (current.revision !== values.revision) throw requestError(409,'This venue changed. Reload before saving.');
          await db.query('update exam_venues set name = $2,campus = $3,location = $4,capacity = $5,status = $6,revision = revision + 1,updated_by = $7,updated_at = now() where id = $1',[id,values.name,values.campus,values.location,values.capacity,values.status,actor.accountId]);
        } else {
          if ((await db.query('select 1 from exam_venues where code = $1',[values.code])).rowCount) throw requestError(409,'This venue code is already registered.');
          id = `exv_${randomUUID()}`;
          await db.query('insert into exam_venues (id,code,name,campus,location,capacity,updated_by) values ($1,$2,$3,$4,$5,$6,$7)',[id,values.code,values.name,values.campus,values.location,values.capacity,actor.accountId]);
        }
        const row = (await db.query(`${venueSelect} where id = $1`,[id])).rows[0];
        await db.query('insert into exam_venue_history (venue_id,revision,snapshot,reason,actor_id) values ($1,$2,$3,$4,$5)',[id,row.revision,row,values.reason,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:values.revision ? 'exams.venue.changed' : 'exams.venue.created',subjectType:'ExamVenue',subjectId:id,reason:values.reason,metadata:{revision:row.revision,status:row.status,capacity:row.capacity}});
        return row;
      });
    },
    async examVenueHistory(id,actor) {
      if (!mayManage(actor)) throw requestError(403,'Global venue-management authority is required.');
      return (await pool.query('select revision,snapshot,reason,recorded_at as "recordedAt" from exam_venue_history where venue_id = $1 order by revision desc',[id])).rows;
    },
    async ownExamDuties(actor) {
      const staff = (await pool.query('select id from staff_members where account_id = $1',[actor.accountId])).rows[0];
      if (!staff) return [];
      const rows = (await pool.query(`select et.period_id as "periodId",ap.name,et.published_at as "publishedAt",et.published_staff_snapshot as snapshot
        from exam_timetables et join registration_periods rp on rp.id = et.period_id join academic_periods ap on ap.id = rp.academic_period_id where et.published_staff_snapshot is not null order by ap.starts_on desc`)).rows;
      return rows.map((row) => ({periodId:row.periodId,name:row.name,publishedAt:row.publishedAt,sittings:row.snapshot.sittings.map((entry) => personalExamDuty(entry,staff.id)).filter(Boolean)})).filter((row) => row.sittings.length);
    }
  };
}
