import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { publishedManifestFor } from './exam-manifests.js';
import { currentSeatPlan, freezeSeatPlan, validateSeatEntries } from './exam-seating-core.js';
import { queueNotification } from '../notification-queue.js';

const planSelect = `select sitting_id as "sittingId",revision,status,published_revision as "publishedRevision",manifest_digest as "manifestDigest",entries,
  prepared_by as "preparedBy",prepared_at as "preparedAt",reason,published_at as "publishedAt",published_snapshot as "publishedSnapshot" from exam_seating_plans`;
const text = (value,max) => typeof value === 'string' && value.trim() && value.length <= max;
function validateInput(input,publish) {
  if (!input || Object.keys(input).some((key) => !['revision','publishedRevision','manifestDigest','reason',...(publish ? [] : ['entries'])].includes(key))
    || !Number.isInteger(input.revision) || input.revision < (publish ? 1 : 0) || !Number.isInteger(input.publishedRevision) || input.publishedRevision < 1
    || !/^[a-f0-9]{64}$/.test(input.manifestDigest || '') || !text(input.reason,2000)) throw requestError(400,'Provide the seating revision, current publication revision and manifest digest, assignments and a reason.');
}
function assertSource(input,row,manifest) {
  if (input.publishedRevision !== row.publishedRevision || input.manifestDigest !== manifest.digest) throw requestError(409,'The published roster changed. Reload the current manifest before preparing or publishing seats.');
  if (manifest.rooms.some((room) => Date.parse(room.startsAt) <= Date.now())) throw requestError(409,'Seating plans cannot change after the sitting starts.');
}
async function lockPeriod(db,sittingId) {
  const sitting = (await db.query('select period_id as "periodId" from exam_sittings where id = $1',[sittingId])).rows[0];
  if (!sitting) throw requestError(404,'Examination sitting was not found.');
  await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${sitting.periodId}`]);
}
export function createExamSeatingModule(pool) {
  async function context(db,sittingId,actor) {
    const {row,manifest,view} = await publishedManifestFor(db,sittingId,actor);
    const plan = (await db.query(`${planSelect} where sitting_id = $1 for share`,[sittingId])).rows[0] || null;
    const current = plan?.publishedRevision === row.publishedRevision && plan?.manifestDigest === manifest.digest;
    const published = currentSeatPlan(plan?.publishedSnapshot,row,manifest);
    const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},row);
    return {periodId:row.periodId,publishedRevision:row.publishedRevision,...view,plan:plan ? {...plan,entries:current ? plan.entries : [],publishedSnapshot:published,stale:!current} : null,
      capabilities:{prepare:can('exams.schedule'),publish:can('exams.publish')},accountId:actor.accountId,started:manifest.rooms.some((room) => Date.parse(room.startsAt) <= Date.now())};
  }
  return {
    async getExamSeating(sittingId,actor) {
      return withTransaction(pool,async (db) => {
        const result = await context(db,sittingId,actor);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.seating.accessed',subjectType:'ExamSitting',subjectId:sittingId,reason:'Seating workspace accessed',metadata:{publishedRevision:result.publishedRevision,revision:result.plan?.revision || 0}});
        return result;
      });
    },
    async saveExamSeating(sittingId,input,actor) {
      validateInput(input,false);
      return withTransaction(pool,async (db) => {
        await lockPeriod(db,sittingId);
        const {row,manifest} = await publishedManifestFor(db,sittingId,actor,false,['exams.schedule']);
        assertSource(input,row,manifest);
        const plan = (await db.query(`${planSelect} where sitting_id = $1 for update`,[sittingId])).rows[0];
        if ((plan?.revision || 0) !== input.revision) throw requestError(409,'The seating plan changed. Reload before saving.');
        const entries = validateSeatEntries(input.entries,manifest);
        if (plan?.status === 'draft' && plan.publishedRevision === row.publishedRevision && plan.manifestDigest === manifest.digest
          && plan.entries.length === entries.length && plan.entries.every((entry,index) => ['roomKey','studentNumber','seat'].every((key) => entry[key] === entries[index][key]))) throw requestError(409,'There are no seating changes to save.');
        await db.query(`insert into exam_seating_plans (sitting_id,published_revision,manifest_digest,entries,prepared_by,reason) values ($1,$2,$3,$4,$5,$6)
          on conflict (sitting_id) do update set revision = exam_seating_plans.revision + 1,status = 'draft',published_revision = $2,manifest_digest = $3,entries = $4,prepared_by = $5,prepared_at = now(),reason = $6`,
        [sittingId,row.publishedRevision,manifest.digest,JSON.stringify(entries),actor.accountId,input.reason.trim()]);
        const revision = (plan?.revision || 0)+1;
        const snapshot = freezeSeatPlan(revision,row.publishedRevision,manifest.digest,entries);
        await db.query("insert into exam_seating_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,$2,'prepared',$3,$4,$5)",[sittingId,revision,snapshot,input.reason.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:'exams.seating.prepared',subjectType:'ExamSitting',subjectId:sittingId,reason:input.reason,metadata:{revision,publishedRevision:row.publishedRevision,assigned:entries.length}});
        return context(db,sittingId,actor);
      });
    },
    async publishExamSeating(sittingId,input,actor) {
      validateInput(input,true);
      return withTransaction(pool,async (db) => {
        await lockPeriod(db,sittingId);
        const {row,manifest} = await publishedManifestFor(db,sittingId,actor,false,['exams.publish']);
        assertSource(input,row,manifest);
        const plan = (await db.query(`${planSelect} where sitting_id = $1 for update`,[sittingId])).rows[0];
        if (!plan || plan.revision !== input.revision || plan.status !== 'draft' || plan.publishedRevision !== row.publishedRevision || plan.manifestDigest !== manifest.digest) throw requestError(409,'Review a current draft seating plan before publishing.');
        if (plan.preparedBy === actor.accountId) throw requestError(403,'A different colleague must publish the seating plan.');
        const entries = validateSeatEntries(plan.entries,manifest,{complete:true}),snapshot = freezeSeatPlan(plan.revision,row.publishedRevision,manifest.digest,entries);
        await db.query("update exam_seating_plans set status = 'published',published_by = $2,published_at = now(),publication_reason = $3,published_snapshot = $4 where sitting_id = $1",[sittingId,actor.accountId,input.reason.trim(),JSON.stringify(snapshot)]);
        await db.query("insert into exam_seating_history (sitting_id,revision,action,snapshot,reason,actor_id) values ($1,$2,'published',$3,$4,$5)",[sittingId,plan.revision,snapshot,input.reason.trim(),actor.accountId]);
        const candidates = new Set(manifest.rooms.flatMap((room) => room.candidates.map((entry) => entry.studentNumber)));
        const recipients = new Set((row.snapshot.candidateAccounts || []).filter((entry) => candidates.has(entry.studentNumber)).map((entry) => entry.accountId));
        for (const sitting of row.snapshot.sittings.filter((entry) => entry.id === sittingId)) for (const staff of sitting.invigilators) if (staff.accountId) recipients.add(staff.accountId);
        for (const accountId of recipients) await queueNotification(db,accountId,'exams.seating',{courseCode:manifest.code,action:entries.length ? 'published' : 'withdrawn'});
        await insertAudit(db,{actorId:actor.accountId,action:'exams.seating.published',subjectType:'ExamSitting',subjectId:sittingId,reason:input.reason,metadata:{revision:plan.revision,publishedRevision:row.publishedRevision,assigned:entries.length,digest:snapshot.digest}});
        return context(db,sittingId,actor);
      });
    },
    async examSeatingHistory(sittingId,actor) {
      return withTransaction(pool,async (db) => {
        await publishedManifestFor(db,sittingId,actor);
        const items = (await db.query('select revision,action,snapshot,reason,recorded_at as "recordedAt" from exam_seating_history where sitting_id = $1 order by id desc',[sittingId])).rows;
        await insertAudit(db,{actorId:actor.accountId,action:'exams.seating.history.accessed',subjectType:'ExamSitting',subjectId:sittingId,reason:'Seating revision history accessed',metadata:{entries:items.length}});
        return items;
      });
    }
  };
}
