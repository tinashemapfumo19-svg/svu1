import { createHash } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { examResourceSegments } from './exam-arrangements.js';
import { seatingForManifest } from './exam-seating-core.js';

export function freezeExamManifests(sittings,candidatesByCourse) {
  return sittings.map((sitting) => {
    const candidates = sitting.planId ? sitting.candidates : candidatesByCourse[sitting.courseId] || [];
    const rooms = examResourceSegments(sitting,candidates).map((room) => ({
      key:room.venueId || 'main',venue:room.venue,location:room.venueLocation || null,startsAt:sitting.startsAt,durationMinutes:room.durationMinutes,
      staffIds:room.invigilators.map((staff) => staff.staffId).sort(),
      candidates:room.candidates.map((candidate) => {
        const arrangement = sitting.arrangements.find((entry) => entry.studentNumber === candidate.studentNumber);
        const extraMinutes = arrangement?.extraMinutes || 0;
        return {studentNumber:candidate.studentNumber,extraMinutes,endsAt:new Date(Date.parse(sitting.startsAt)+(sitting.durationMinutes+extraMinutes)*60000).toISOString(),instruction:arrangement?.instruction || ''};
      }).sort((a,b) => a.studentNumber.localeCompare(b.studentNumber))
    })).sort((a,b) => a.key.localeCompare(b.key));
    const content = {sittingId:sitting.id,code:sitting.code,paper:sitting.paper,sittingRevision:sitting.revision,rooms};
    return {...content,digest:createHash('sha256').update(JSON.stringify(content)).digest('hex')};
  });
}

export function manifestView(manifest,staffId = null) {
  return {sittingId:manifest.sittingId,code:manifest.code,paper:manifest.paper,sittingRevision:manifest.sittingRevision,digest:manifest.digest,
    rooms:manifest.rooms.filter((room) => staffId === null || room.staffIds.includes(staffId)).map((room) => ({
      key:room.key,venue:room.venue,location:room.location,startsAt:room.startsAt,durationMinutes:room.durationMinutes,
      candidates:room.candidates.map(({studentNumber,extraMinutes,endsAt,instruction}) => ({studentNumber,extraMinutes,endsAt,instruction}))
    }))};
}

export async function publishedManifestFor(db,sittingId,actor,self = false,permissions = ['exams.schedule','exams.publish']) {
  const row = (await db.query(`select et.period_id as "periodId",et.status,et.revision,et.published_revision as "publishedRevision",et.published_at as "publishedAt",et.published_staff_snapshot as snapshot,
    p.code as "programmeCode",i.id as "intakeId" from exam_sittings es join exam_timetables et on et.period_id = es.period_id
    join registration_periods rp on rp.id = et.period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id where es.id = $1 for share of et`,[sittingId])).rows[0];
  let staffId = null;
  if (self) {
    const staff = (await db.query("select id from staff_members where account_id = $1 and status = 'active' for share",[actor.accountId])).rows[0];
    if (!actor.permissions.includes('exams.duties.self') || !staff || !row?.snapshot?.sittings.some((sitting) => sitting.id === sittingId && sitting.invigilators.some((entry) => entry.staffId === staff.id && entry.accountId === actor.accountId))) throw requestError(404,'Assigned examination manifest was not found.');
    staffId = staff.id;
  } else if (!row || !permissions.some((permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},row))) throw requestError(404,'Examination manifest was not found.');
  if (row.status !== 'published' || row.revision !== row.publishedRevision) throw requestError(409,'Publish the current timetable before opening candidate manifests.');
  const manifest = row.snapshot?.manifests?.find((entry) => entry.sittingId === sittingId);
  if (!manifest) throw requestError(409,'This publication has no frozen candidate manifest. Republish a reviewed timetable revision to generate one.');
  const view = manifestView(manifest,staffId);
  if (self && !view.rooms.length) throw requestError(404,'Assigned examination manifest was not found.');
  return {row,manifest,view};
}

export function createExamManifestsModule(pool) {
  return {
    async getExamManifest(sittingId,actor,self = false) {
      return withTransaction(pool,async (db) => {
        const {row,manifest,view} = await publishedManifestFor(db,sittingId,actor,self);
        const seating = await seatingForManifest(db,sittingId,row,manifest);
        if (seating) {
          view.seating = {revision:seating.revision,digest:seating.digest};
          for (const room of view.rooms) for (const candidate of room.candidates) {
            const seat = seating.entries.find((entry) => entry.roomKey === room.key && entry.studentNumber === candidate.studentNumber);
            if (seat) candidate.seat = seat.seat;
          }
        }
        await insertAudit(db,{actorId:actor.accountId,action:'exams.manifest.accessed',subjectType:'ExamSitting',subjectId:sittingId,reason:'Published candidate manifest accessed',metadata:{periodId:row.periodId,publishedRevision:row.publishedRevision,digest:manifest.digest,...(seating ? {seatingRevision:seating.revision,seatingDigest:seating.digest} : {})}});
        return {periodId:row.periodId,publishedRevision:row.publishedRevision,publishedAt:row.publishedAt,...view};
      });
    }
  };
}
