import { createHash, randomUUID } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { queueNotification } from '../notification-queue.js';
import { decryptSecret, encryptSecret } from '../security.js';
import { lockExamResources, venueLabel, venueSelect } from './exam-resources.js';

const text = (value,max) => typeof value === 'string' && value.trim() && value.length <= max;
export function validateArrangementRequest(input) {
  if (!input || Object.keys(input).some((key) => !['extraMinutes','separateRoom','requestNote','evidenceRef','registrationId'].includes(key)) || !Number.isInteger(input.extraMinutes)
    || input.extraMinutes < 0 || input.extraMinutes > 240 || input.extraMinutes % 15 || typeof input.separateRoom !== 'boolean' || !text(input.requestNote,2000) || !text(input.evidenceRef,200)
    || input.registrationId !== undefined && !text(input.registrationId,100)) throw requestError(400,'Provide extra minutes in 15-minute steps (0-240), a separate-room choice, a private note and evidence reference.');
}
export function arrangementSittingHash(row) {
  return createHash('sha256').update(JSON.stringify([row.id,row.courseId,new Date(row.startsAt).toISOString(),row.durationMinutes,row.venue,row.capacity ?? null,row.venueId ?? null,row.venueRevision ?? null,row.venueLocation ?? null,row.orderId ?? null,row.planId ?? null,row.componentCode ?? null])).digest('hex');
}
export function operationalArrangement(row) {
  return {studentNumber:row.studentNumber,extraMinutes:row.extraMinutes,instruction:row.instruction,venueId:row.venueId,venueRevision:row.venueRevision,venue:row.venue,venueLocation:row.venueLocation,capacity:row.capacity,invigilatorStaffId:row.invigilatorStaffId};
}
export function personalExamSitting(row,studentNumber) {
  const {candidates,arrangements,resourceSegments,invigilators,...base} = row;
  const own = arrangements?.find((entry) => entry.studentNumber === studentNumber);
  return {...base,...(own ? {durationMinutes:row.durationMinutes+own.extraMinutes,venue:own.venue || row.venue,venueLocation:own.venueLocation || row.venueLocation,arrangement:{extraMinutes:own.extraMinutes,instruction:own.instruction}} : {})};
}
export function personalExamDuty(row,staffId) {
  const segment = (row.resourceSegments || [row]).find((entry) => entry.invigilators.some((staff) => staff.staffId === staffId));
  if (!segment) return null;
  return {id:row.id,courseId:row.courseId,code:row.code,title:row.title,paper:row.paper,startsAt:row.startsAt,durationMinutes:segment.durationMinutes,venue:segment.venue,venueLocation:segment.venueLocation,revision:row.revision,
    role:segment.invigilators.find((entry) => entry.staffId === staffId).role,arrangements:(row.arrangements || []).filter((entry) => entry.venueId ? entry.venueId === segment.venueId : segment.venueId === row.venueId)
      .map(({studentNumber,extraMinutes,instruction}) => ({studentNumber,extraMinutes,instruction}))};
}
export function examResourceSegments(row,candidates = []) {
  const arrangements = row.arrangements || [],separateStaff = new Set(arrangements.filter((entry) => entry.venueId).map((entry) => entry.invigilatorStaffId));
  const groups = [];
  const base = candidates.filter((entry) => !arrangements.some((caseRow) => caseRow.studentNumber === entry.studentNumber && caseRow.venueId));
  if (base.length || !candidates.length) groups.push({...row,arrangements:[],candidates:base,invigilators:row.invigilators.filter((entry) => !separateStaff.has(entry.staffId)),
    durationMinutes:row.durationMinutes+Math.max(0,...arrangements.filter((entry) => !entry.venueId).map((entry) => entry.extraMinutes))});
  for (const arrangement of arrangements.filter((entry) => entry.venueId)) {
    let group = groups.find((entry) => entry.venueId === arrangement.venueId);
    if (!group) {group = {...row,venueId:arrangement.venueId,venueRevision:arrangement.venueRevision,venue:arrangement.venue,venueLocation:arrangement.venueLocation,capacity:arrangement.capacity,candidates:[],arrangements:[],invigilators:[],durationMinutes:row.durationMinutes};groups.push(group);}
    group.candidates.push(...candidates.filter((entry) => entry.studentNumber === arrangement.studentNumber));
    group.durationMinutes = Math.max(group.durationMinutes,row.durationMinutes+arrangement.extraMinutes);
    if (!group.invigilators.some((entry) => entry.staffId === arrangement.invigilatorStaffId)) group.invigilators.push(...row.invigilators.filter((entry) => entry.staffId === arrangement.invigilatorStaffId));
  }
  return groups;
}
export function arrangementPrivateView(row,key) {
  const {privateNotesEncrypted,...view} = row;
  if (privateNotesEncrypted) for (const field of ['requestNote','evidenceRef','reviewNote','closeNote']) if (view[field] !== null && view[field] !== undefined) view[field] = decryptSecret(view[field],key);
  return view;
}
export function arrangementHistoryFilters(input = {}) {
  const integer = (value,fallback,max) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw requestError(400,'Invalid arrangement history pagination.');
    return Number(value);
  };
  const limit = integer(input.limit,25,100),offset = integer(input.offset,0,1000000),status = input.status || 'all',q = input.q || '';
  if (!limit || !['all','requested','approved','returned','withdrawn','revoked'].includes(status) || typeof q !== 'string' || q.length > 100) throw requestError(400,'Select a case status and a search of up to 100 characters.');
  return {limit,offset,status,q:q.trim()};
}
export function arrangementHistoryPage(rows,filters,self = false) {
  return {...filters,total:rows.length,items:rows.slice(filters.offset,filters.offset+filters.limit).map(({id,sittingId,code,paper,startsAt,status,revision,sittingStatus,intakeLabel,studentNumber}) =>
    ({id,sittingId,code,paper,startsAt,status,revision,sittingStatus,intakeLabel,...(!self ? {studentNumber} : {})}))};
}
export const arrangementSelect = `select a.id,a.private_notes_encrypted as "privateNotesEncrypted",a.sitting_id as "sittingId",a.registration_id as "registrationId",a.sitting_hash as "sittingHash",a.extra_minutes as "extraMinutes",a.separate_room as "separateRoom",
  a.request_note as "requestNote",a.evidence_ref as "evidenceRef",a.status,a.revision,a.requested_by as "requestedBy",a.requested_at as "requestedAt",a.reviewed_by as "reviewedBy",a.review_note as "reviewNote",
  a.instruction,a.venue_id as "venueId",a.venue_revision as "venueRevision",a.venue,a.venue_location as "venueLocation",a.capacity,a.invigilator_staff_id as "invigilatorStaffId",a.close_note as "closeNote",
  s.student_number as "studentNumber",s.account_id as "accountId" from exam_arrangements a join student_registrations sr on sr.id = a.registration_id join student_programmes sp on sp.id = sr.student_programme_id join students s on s.id = sp.student_id`;
const sittingSelect = `select s.id,s.period_id as "periodId",s.course_id as "courseId",s.revision,s.status,s.paper,s.starts_at as "startsAt",to_char(s.local_date,'YYYY-MM-DD') as "localDate",s.duration_minutes as "durationMinutes",
  s.venue,s.capacity,s.venue_id as "venueId",s.venue_revision as "venueRevision",s.venue_location as "venueLocation",s.order_id as "orderId",s.assessment_plan_id as "planId",s.component_code as "componentCode",
  p.code as "programmeCode",rp.intake_id as "intakeId",i.label as "intakeLabel",c.code from exam_sittings s join courses c on c.id = s.course_id join registration_periods rp on rp.id = s.period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id`;
export async function arrangementCandidates(db,sitting) {
  return (await db.query(`select sr.id as "registrationId",s.student_number as "studentNumber",s.account_id as "accountId" from student_registrations sr join course_enrolments ce on ce.registration_id = sr.id
    join student_programmes sp on sp.id = sr.student_programme_id join students s on s.id = sp.student_id where sr.period_id = $1 and ce.course_id = $2 and sr.status = 'confirmed'
    and ($3::text is null or exists (select 1 from exam_deferred_candidates dc where dc.sitting_id = $3 and dc.registration_id = sr.id)) order by s.student_number`,[sitting.periodId,sitting.courseId,sitting.planId ? sitting.id : null])).rows;
}
export async function examCandidatesForSittings(db,ids) {
  return (await db.query(`select es.id as "sittingId",ce.registration_id as "registrationId",st.student_number as "studentNumber" from exam_sittings es
    join student_registrations sr on sr.period_id = es.period_id and sr.status = 'confirmed' join course_enrolments ce on ce.registration_id = sr.id and ce.course_id = es.course_id
    join students st on st.id = ce.student_id where es.id = any($1::text[]) and (es.assessment_plan_id is null or exists (select 1 from exam_deferred_candidates dc where dc.sitting_id = es.id and dc.registration_id = sr.id))`,[ids])).rows;
}
export function createExamArrangementsModule(pool,{dataEncryptionKey} = {}) {
  const can = (actor,row,permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId});
  async function sittingFor(db,id,actor,self = false,historyAccess = false) {
    const sitting = (await db.query(`${sittingSelect} where s.id = $1`,[id])).rows[0];
    if (!sitting) throw requestError(404,'Examination sitting was not found.');
    const candidates = await arrangementCandidates(db,sitting);
    const ownedCase = self && historyAccess && (await db.query(`select 1 from exam_arrangements a join student_registrations sr on sr.id = a.registration_id
      join student_programmes sp on sp.id = sr.student_programme_id join students st on st.id = sp.student_id where a.sitting_id = $1 and st.account_id = $2 limit 1`,[id,actor.accountId])).rowCount;
    if (self ? !candidates.some((row) => row.accountId === actor.accountId) && !ownedCase : !['exams.arrangements.manage','exams.arrangements.review'].some((permission) => can(actor,sitting,permission))) throw requestError(404,'Examination sitting was not found.');
    return {sitting,candidates};
  }
  async function lock(db,sitting) {await lockExamResources(db);await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${sitting.periodId}`]);}
  async function context(db,id,actor,self = false) {
    const {sitting,candidates} = await sittingFor(db,id,actor,self,true);
    const rows = (await db.query(`${arrangementSelect} where a.sitting_id = $1 and ($2::text is null or s.account_id = $2) order by a.requested_at desc,a.id`,[id,self ? actor.accountId : null])).rows;
    const cases = rows.map(({accountId,...row}) => ({...arrangementPrivateView(row,dataEncryptionKey),current:sitting.status === 'scheduled' && row.sittingHash === arrangementSittingHash(sitting) && candidates.some((entry) => entry.registrationId === row.registrationId)}));
    const history = self ? [] : (await db.query('select h.revision,h.snapshot,h.recorded_at as "recordedAt" from exam_arrangement_history h join exam_arrangements a on a.id = h.arrangement_id where a.sitting_id = $1 order by h.id desc',[id])).rows;
    const future = sitting.status === 'scheduled' && Date.parse(sitting.startsAt) > Date.now(),manage = self || can(actor,sitting,'exams.arrangements.manage'),review = !self && can(actor,sitting,'exams.arrangements.review');
    let request = manage && future && (self ? candidates.some((row) => row.accountId === actor.accountId) : candidates.length > 0);
    if (self && request) {
      const timetable = (await db.query('select status,published_snapshot as snapshot from exam_timetables where period_id = $1',[sitting.periodId])).rows[0];
      const own = candidates.find((row) => row.accountId === actor.accountId);
      request = timetable?.status === 'published' && Boolean(timetable.snapshot?.sittings.some((row) => row.id === id && row.revision === sitting.revision && (!row.candidates || row.candidates.includes(own.studentNumber))));
    }
    return {sitting:{id:sitting.id,code:sitting.code,status:sitting.status,paper:sitting.paper,startsAt:sitting.startsAt,durationMinutes:sitting.durationMinutes},cases,history:history.map((row) => ({...row,snapshot:arrangementPrivateView(row.snapshot,dataEncryptionKey)})),
      candidates:self ? [] : candidates.map(({accountId,...row}) => row),venues:self ? [] : (await db.query(`${venueSelect} where status = 'active' order by code`)).rows,
      staff:self ? [] : (await db.query(`select m.id,m.employee_number as "employeeNumber",m.legal_name as "legalName" from staff_members m join exam_sitting_invigilators i on i.staff_id = m.id where i.sitting_id = $1 and m.status = 'active' order by m.employee_number`,[id])).rows,
      capabilities:{manage,request:Boolean(request),approve:review && future,revoke:!self && manage && future,review},accountId:actor.accountId};
  }
  async function history(db,id,actor,action) {
    const row = (await db.query(`${arrangementSelect} where a.id = $1`,[id])).rows[0];
    await db.query('insert into exam_arrangement_history (arrangement_id,revision,snapshot,actor_id) values ($1,$2,$3,$4)',[id,row.revision,row,actor.accountId]);
    await insertAudit(db,{actorId:actor.accountId,action:`exams.arrangement.${action}`,subjectType:'ExamArrangement',subjectId:id,reason:`Candidate arrangement ${action}`,metadata:{sittingId:row.sittingId}});
    await queueNotification(db,row.accountId,'exams.arrangement',{action},{link:'#study/timetable'});
  }
  async function mutable(db,sitting) {
    if (sitting.status !== 'scheduled' || Date.parse(sitting.startsAt) <= Date.now()) throw requestError(409,'Arrangements require a scheduled sitting that has not started.');
    if ((await db.query("select 1 from assessment_deferred_completions where sitting_id = $1 and status in ('submitted','approved')",[sitting.id])).rowCount) throw requestError(409,'A sitting with live completion marks cannot change its arrangements.');
  }
  async function touch(db,sitting,actor) {
    await db.query('update exam_sittings set revision = revision + 1,updated_by = $2,updated_at = now() where id = $1',[sitting.id,actor.accountId]);
    const row = (await db.query(`${sittingSelect} where s.id = $1`,[sitting.id])).rows[0];
    await db.query("insert into exam_sitting_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,$2,'changed',$3,$4,$5)",[row.id,row.revision,row,'Approved candidate arrangements changed',actor.accountId]);
    await db.query("update exam_timetables set status = 'draft',revision = revision + 1,prepared_by = $2,prepared_at = now() where period_id = $1",[sitting.periodId,actor.accountId]);
  }
  return {
    async listArrangementHistory(input,actor,programmeId = null) {
      const filters = arrangementHistoryFilters(input),self = programmeId !== null;
      if (self && !(await pool.query('select 1 from student_programmes sp join students st on st.id = sp.student_id where sp.id = $1 and st.account_id = $2',[programmeId,actor.accountId])).rowCount) throw requestError(404,'Student programme was not found.');
      const rows = (await pool.query(`select a.id,a.sitting_id as "sittingId",a.status,a.revision,es.status as "sittingStatus",es.paper,es.starts_at as "startsAt",c.code,i.label as "intakeLabel",st.student_number as "studentNumber",p.code as "programmeCode",i.id as "intakeId"
        from exam_arrangements a join exam_sittings es on es.id = a.sitting_id join courses c on c.id = es.course_id join registration_periods rp on rp.id = es.period_id
        join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id join student_registrations sr on sr.id = a.registration_id
        join student_programmes sp on sp.id = sr.student_programme_id join students st on st.id = sp.student_id
        where ($1::text is null or sp.id = $1 and st.account_id = $2) and ($3 = 'all' or a.status = $3)
          and ($4 = '' or position(lower($4) in lower(concat_ws(' ',c.code,es.paper,i.label,st.student_number))) > 0)
        order by a.requested_at desc,a.id`,[programmeId,self ? actor.accountId : null,filters.status,filters.q])).rows;
      return arrangementHistoryPage(rows.filter((row) => self || ['exams.arrangements.manage','exams.arrangements.review'].some((permission) => can(actor,row,permission))),filters,self);
    },
    async listArrangementSittings(actor) {
      return (await pool.query(`${sittingSelect} where s.status = 'scheduled' and s.starts_at > now() order by s.starts_at`)).rows.filter((row) => ['exams.arrangements.manage','exams.arrangements.review'].some((permission) => can(actor,row,permission)))
        .map(({id,paper,startsAt,periodId,courseId,code,intakeLabel}) => ({id,paper,startsAt,periodId,courseId,code,intakeLabel}));
    },
    async getExamArrangements(id,actor,self = false) {return context(pool,id,actor,self);},
    async requestExamArrangement(id,input,actor,self = false) {
      validateArrangementRequest(input);
      return withTransaction(pool,async (db) => {
        let view = await sittingFor(db,id,actor,self);await lock(db,view.sitting);view = await sittingFor(db,id,actor,self);await mutable(db,view.sitting);
        if (!self && !can(actor,view.sitting,'exams.arrangements.manage')) throw requestError(403,'Arrangement management authority is required.');
        if (self && input.registrationId !== undefined) throw requestError(400,'Personal requests cannot select another registration.');
        const candidate = view.candidates.find((row) => self ? row.accountId === actor.accountId : row.registrationId === input.registrationId);
        if (!candidate) throw requestError(404,'Confirmed examination candidate was not found.');
        if (self) {
          const timetable = (await db.query('select status,published_snapshot as snapshot from exam_timetables where period_id = $1',[view.sitting.periodId])).rows[0];
          if (timetable?.status !== 'published' || !timetable.snapshot.sittings.some((row) => row.id === id && row.revision === view.sitting.revision && (!row.candidates || row.candidates.includes(candidate.studentNumber)))) throw requestError(409,'Wait for the current candidate timetable to be published before requesting an arrangement.');
        }
        if (view.sitting.durationMinutes+input.extraMinutes > 480) throw requestError(400,'The total examination duration cannot exceed the current 480-minute scheduling limit.');
        if ((await db.query("select 1 from exam_arrangements where sitting_id = $1 and registration_id = $2 and status in ('requested','approved')",[id,candidate.registrationId])).rowCount) throw requestError(409,'A live request or approval already exists for this candidate.');
        const caseId = `exa_${randomUUID()}`;
        await db.query('insert into exam_arrangements (id,sitting_id,registration_id,sitting_hash,extra_minutes,separate_room,request_note,evidence_ref,requested_by,private_notes_encrypted) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',[caseId,id,candidate.registrationId,arrangementSittingHash(view.sitting),input.extraMinutes,input.separateRoom,encryptSecret(input.requestNote.trim(),dataEncryptionKey),encryptSecret(input.evidenceRef.trim(),dataEncryptionKey),actor.accountId]);
        await history(db,caseId,actor,'requested');return context(db,id,actor,self);
      });
    },
    async reviewExamArrangement(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !['revision','outcome','reviewNote','instruction','venueId','invigilatorStaffId'].includes(key)) || !Number.isInteger(input.revision) || !['approved','returned'].includes(input.outcome) || !text(input.reviewNote,2000)
        || input.outcome === 'approved' && !text(input.instruction,500)) throw requestError(400,'Provide the case revision, decision, private review note and approved operational instruction.');
      return withTransaction(pool,async (db) => {
        let row = (await db.query(`${arrangementSelect} where a.id = $1`,[id])).rows[0];if (!row) throw requestError(404,'Arrangement request was not found.');
        const initial = await sittingFor(db,row.sittingId,actor);await lock(db,initial.sitting);
        row = (await db.query(`${arrangementSelect} where a.id = $1 for update of a`,[id])).rows[0];const {sitting,candidates} = await sittingFor(db,row.sittingId,actor);
        if (!can(actor,sitting,'exams.arrangements.review')) throw requestError(403,'Arrangement review authority is required.');
        if (row.status !== 'requested' || row.revision !== input.revision) throw requestError(409,'This request changed or was already reviewed.');
        if (row.requestedBy === actor.accountId) throw requestError(403,'Another colleague must review your arrangement request.');
        let venue = null;
        if (input.outcome === 'approved') {
          await mutable(db,sitting);
          if (row.sittingHash !== arrangementSittingHash(sitting) || !candidates.some((entry) => entry.registrationId === row.registrationId)) throw requestError(409,'The sitting or confirmed candidate changed. Return this request and create a fresh one.');
          if (row.separateRoom) {
            venue = (await db.query(`${venueSelect} where id = $1 and status = 'active' for share`,[input.venueId])).rows[0];
            const assigned = (await db.query(`select m.id,m.status,to_char(m.engaged_on,'YYYY-MM-DD') as engaged from exam_sitting_invigilators i join staff_members m on m.id = i.staff_id where i.sitting_id = $1 and i.staff_id = $2 for share of m`,[sitting.id,input.invigilatorStaffId])).rows[0];
            if (!venue || venue.id === sitting.venueId || venueLabel(venue).toLowerCase() === sitting.venue.toLowerCase() || !assigned || assigned.status !== 'active' || assigned.engaged > sitting.localDate) throw requestError(409,'Choose a different active managed room and an active invigilator allocated to this sitting.');
          } else if (input.venueId || input.invigilatorStaffId) throw requestError(400,'A main-room arrangement cannot allocate a separate room or invigilator.');
        }
        await db.query('update exam_arrangements set status = $2,revision = revision + 1,reviewed_by = $3,reviewed_at = now(),review_note = $4,instruction = $5,venue_id = $6,venue_revision = $7,venue = $8,venue_location = $9,capacity = $10,invigilator_staff_id = $11 where id = $1',
          [id,input.outcome,actor.accountId,row.privateNotesEncrypted ? encryptSecret(input.reviewNote.trim(),dataEncryptionKey) : input.reviewNote.trim(),input.outcome === 'approved' ? input.instruction.trim() : null,venue?.id || null,venue?.revision || null,venue ? venueLabel(venue) : null,venue ? `${venue.campus} - ${venue.location}` : null,venue?.capacity || null,venue ? input.invigilatorStaffId : null]);
        if (input.outcome === 'approved') await touch(db,sitting,actor);await history(db,id,actor,input.outcome);return context(db,sitting.id,actor);
      });
    },
    async closeExamArrangement(id,input,actor,self = false) {
      if (!input || Object.keys(input).some((key) => !['revision','closeNote'].includes(key)) || !Number.isInteger(input.revision) || !text(input.closeNote,2000)) throw requestError(400,'Provide the case revision and private close note.');
      return withTransaction(pool,async (db) => {
        let row = (await db.query(`${arrangementSelect} where a.id = $1`,[id])).rows[0];if (!row || self && row.accountId !== actor.accountId) throw requestError(404,'Arrangement request was not found.');
        let view = await sittingFor(db,row.sittingId,actor,self,true);await lock(db,view.sitting);row = (await db.query(`${arrangementSelect} where a.id = $1 for update of a`,[id])).rows[0];view = await sittingFor(db,row.sittingId,actor,self,true);
        if (!self && !can(actor,view.sitting,'exams.arrangements.manage')) throw requestError(403,'Arrangement management authority is required.');
        if (row.revision !== input.revision || !['requested','approved'].includes(row.status)) throw requestError(409,'This request changed or is already closed.');
        if (self && row.status !== 'requested') throw requestError(403,'Contact the arrangements office to revoke an approval.');
        if (row.status === 'approved') {await mutable(db,view.sitting);await touch(db,view.sitting,actor);}
        const status = row.status === 'approved' ? 'revoked' : 'withdrawn';
        await db.query('update exam_arrangements set status = $2,revision = revision + 1,closed_by = $3,close_note = $4 where id = $1',[id,status,actor.accountId,row.privateNotesEncrypted ? encryptSecret(input.closeNote.trim(),dataEncryptionKey) : input.closeNote.trim()]);await history(db,id,actor,status);return context(db,row.sittingId,actor,self);
      });
    }
  };
}
