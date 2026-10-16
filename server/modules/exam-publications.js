import { createHash } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { manifestView } from './exam-manifests.js';

export function publicationFilters(input = {}) {
  const limit = Number(input.limit ?? 25),offset = Number(input.offset ?? 0),q = input.q ?? '';
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000000 || typeof q !== 'string' || q.length > 100) throw requestError(400,'Use a search of up to 100 characters and bounded publication pagination.');
  return {limit,offset,q:q.trim()};
}
const mayRead = (actor,row) => ['exams.schedule','exams.publish'].some((permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.scopeProgrammeCode ?? row.programmeCode,intakeId:row.intakeId}));
const publicationSelect = `select ep.period_id as "periodId",ep.revision,ep.published_at as "publishedAt",ep.origin,ep.reason,ep.snapshot,ep.staff_snapshot as "staffSnapshot",
  ep.prepared_by as "preparedBy",ep.published_by as "publishedBy",ep.period_name as name,ep.programme_code as "programmeCode",p.code as "scopeProgrammeCode",i.id as "intakeId",ep.intake_label as "intakeLabel" from exam_publications ep
  join registration_periods rp on rp.id = ep.period_id join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id`;
const fields = (row,keys) => Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key,row[key]]));
const sittingFields = ['id','courseId','code','title','paper','startsAt','durationMinutes','venue','venueLocation','revision','deferred'];

export function publicationView(row) {
  const sittings = (row.snapshot?.sittings || []).map((sitting) => {
    const staff = row.staffSnapshot?.sittings?.find((entry) => entry.id === sitting.id),manifest = row.staffSnapshot?.manifests?.find((entry) => entry.sittingId === sitting.id);
    return {...fields(sitting,sittingFields),candidateCount:Array.isArray(sitting.candidates) ? sitting.candidates.length : null,manifestAvailable:Boolean(manifest),
      invigilators:(staff?.invigilators || []).map((entry) => fields(entry,['employeeNumber','legalName','role']))};
  });
  return {periodId:row.periodId,revision:row.revision,publishedAt:row.publishedAt,origin:row.origin,reason:row.reason,name:row.name,programmeCode:row.programmeCode,intakeLabel:row.intakeLabel,sittings};
}
export function publicationDigest(row) {
  // JSONB may reorder object keys; canonicalize recursively rather than hashing its serialized storage order.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key,canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical({periodId:row.periodId,revision:row.revision,name:row.name,programmeCode:row.programmeCode,intakeLabel:row.intakeLabel,
    publishedAt:new Date(row.publishedAt).toISOString(),reason:row.reason,origin:row.origin,preparedBy:row.preparedBy ?? null,publishedBy:row.publishedBy ?? null,snapshot:row.snapshot,staffSnapshot:row.staffSnapshot ?? null}))).digest('hex');
}
async function editionFor(db,periodId,revision,actor) {
  if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647) throw requestError(400,'Choose a positive publication revision.');
  const row = (await db.query(`${publicationSelect} where ep.period_id = $1 and ep.revision = $2`,[periodId,revision])).rows[0];
  if (!row || !mayRead(actor,row)) throw requestError(404,'Examination publication was not found.');
  return row;
}
export function createExamPublicationsModule(pool) {
  return {
    async listExamPublications(input,actor) {
      const filters = publicationFilters(input);
      return withTransaction(pool,async (db) => {
        const rows = (await db.query(`select ep.period_id as "periodId",ep.revision,ep.published_at as "publishedAt",ep.origin,
          jsonb_array_length(ep.snapshot->'sittings') as "sittingCount",ep.period_name as name,ep.programme_code as "programmeCode",p.code as "scopeProgrammeCode",i.id as "intakeId",ep.intake_label as "intakeLabel"
          from exam_publications ep join registration_periods rp on rp.id = ep.period_id join academic_periods ap on ap.id = rp.academic_period_id
          join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id order by ep.published_at desc,ep.period_id,ep.revision desc`)).rows;
        const visible = rows.filter((row) => mayRead(actor,row) && [row.name,row.programmeCode,row.intakeLabel].some((value) => String(value).toLowerCase().includes(filters.q.toLowerCase())));
        await insertAudit(db,{actorId:actor.accountId,action:'exams.publications.listed',subjectType:'ExamPublicationIndex',subjectId:'index',reason:'Publication history searched',metadata:{limit:filters.limit,offset:filters.offset,returned:Math.min(filters.limit,Math.max(0,visible.length-filters.offset))}});
        return {items:visible.slice(filters.offset,filters.offset+filters.limit).map(({intakeId,scopeProgrammeCode,...row}) => row),total:visible.length,...filters};
      });
    },
    async getExamPublication(periodId,revision,actor) {
      return withTransaction(pool,async (db) => {
        const row = await editionFor(db,periodId,revision,actor),digest = publicationDigest(row);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.publication.accessed',subjectType:'ExamTimetable',subjectId:periodId,reason:'Historical publication accessed',metadata:{revision,digest}});
        return {...publicationView(row),digest};
      });
    },
    async getPublicationManifest(periodId,revision,sittingId,input,actor) {
      const seatRevision = input?.seatRevision === undefined ? null : Number(input.seatRevision);
      if (seatRevision !== null && (!Number.isInteger(seatRevision) || seatRevision < 0 || seatRevision > 2147483647)) throw requestError(400,'Choose a seating revision or zero for the original unseated manifest.');
      return withTransaction(pool,async (db) => {
        const row = await editionFor(db,periodId,revision,actor);
        if (!row.snapshot.sittings.some((entry) => entry.id === sittingId)) throw requestError(404,'Sitting was not part of this publication.');
        const manifest = row.staffSnapshot?.manifests?.find((entry) => entry.sittingId === sittingId);
        if (!manifest) throw requestError(409,'This retained edition has no frozen manifest. Historical candidates cannot be reconstructed.');
        const history = (await db.query("select revision,snapshot,recorded_at as \"publishedAt\" from exam_seating_history where sitting_id = $1 and action = 'published' order by id desc",[sittingId])).rows
          .filter((entry) => entry.snapshot.publishedRevision === revision && entry.snapshot.manifestDigest === manifest.digest);
        const seating = seatRevision === 0 ? null : seatRevision === null ? history[0] : history.find((entry) => entry.revision === seatRevision);
        if (seatRevision && !seating) throw requestError(404,'Seating revision was not published for this manifest edition.');
        const view = manifestView(manifest);
        if (seating) {
          view.seating = {revision:seating.revision,digest:seating.snapshot.digest,publishedAt:seating.publishedAt};
          for (const room of view.rooms) for (const candidate of room.candidates) {
            const seat = seating.snapshot.entries.find((entry) => entry.roomKey === room.key && entry.studentNumber === candidate.studentNumber);
            if (seat) candidate.seat = seat.seat;
          }
        }
        const digest = publicationDigest(row);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.publication.manifest.accessed',subjectType:'ExamTimetable',subjectId:periodId,reason:'Historical manifest accessed',metadata:{revision,sittingId,digest,manifestDigest:manifest.digest,seatingRevision:seating?.revision || 0}});
        return {archived:true,periodId,publishedRevision:revision,publishedAt:row.publishedAt,origin:row.origin,publicationDigest:digest,...view,
          seatingEditions:history.map((entry) => ({revision:entry.revision,publishedAt:entry.publishedAt,assigned:entry.snapshot.entries.length})),seatRevision:seating?.revision || 0};
      });
    }
  };
}
