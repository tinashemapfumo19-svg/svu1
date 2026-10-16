import { createHash, randomUUID } from 'node:crypto';
import { queueNotification } from '../notification-queue.js';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { matchesFileSignature } from '../storage.js';
import { assertUploadIsAllowed } from './documents.js';
import { authority, offeringFor } from './assessment.js';
import { examOrderSelect } from './exam-orders.js';
import { lockExamResources } from './exam-resources.js';

const text = (value,max) => typeof value === 'string' && value.trim() && value.length <= max;
export function paperRecipientDuration(published,sitting,staffId) {
  return published?.resourceSegments?.find((row) => row.invigilators.some((entry) => entry.staffId === staffId))?.durationMinutes ?? sitting.durationMinutes;
}
export function validatePaperUpload(input) {
  if (!input || Object.keys(input).some((key) => !['fileName','sizeBytes','checksum','reason'].includes(key)) || !text(input.fileName,255) || !/\.pdf$/i.test(input.fileName)
    || !Number.isInteger(input.sizeBytes) || !/^[a-f0-9]{64}$/.test(input.checksum ?? '') || !text(input.reason,2000)) throw requestError(400,'Provide a PDF file name, byte size, SHA-256 checksum and reason.');
  assertUploadIsAllowed({...input,contentType:'application/pdf',classification:'restricted'});
}
export function validatePaperAction(input,extra = []) {
  if (!input || Object.keys(input).some((key) => !['revision','reason',...extra].includes(key)) || !Number.isInteger(input.revision) || input.revision < 1 || !text(input.reason,2000)) throw requestError(400,'Provide the current revision and a reason.');
}
export function validatePaperRelease(input,sitting,now = Date.now()) {
  validatePaperAction(input,['staffId','availableAt','expiresAt','copies','packageRef']);
  const explicit = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  const from = Date.parse(input.availableAt),until = Date.parse(input.expiresAt),end = Date.parse(sitting.startsAt)+sitting.durationMinutes*60000;
  const realDay = (value) => {const day = typeof value === 'string' ? value.slice(0,10) : '',date = new Date(`${day}T00:00:00Z`);return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === day;};
  if (!text(input.staffId,100) || !explicit.test(input.availableAt ?? '') || !explicit.test(input.expiresAt ?? '') || !Number.isFinite(from) || !Number.isFinite(until)
    || !realDay(input.availableAt) || !realDay(input.expiresAt) || from >= until || until <= now || until > end || !Number.isInteger(input.copies) || input.copies < 1 || input.copies > 5000 || !text(input.packageRef,200)) throw requestError(400,'Choose an invigilator, explicit release times ending by the sitting end, 1-5000 copies, and a package reference.');
}
export function assertPaperDelivery(release,paper,sitting,timetable,staff,{now = Date.now(),checkTime = true} = {}) {
  const published = timetable?.publishedStaffSnapshot?.sittings.find((row) => row.id === sitting?.id);
  if (release.status !== 'active' || paper.status !== 'approved' || paper.scanStatus !== 'clean' || !paper.signatureVerified || sitting?.status !== 'scheduled'
    || timetable?.status !== 'published' || timetable.publishedRevision !== release.publishedRevision || sitting.revision !== release.sittingRevision
    || published?.revision !== release.sittingRevision || !published.invigilators.some((row) => row.staffId === release.staffId && row.accountId === release.recipientAccountId)
    || staff?.status !== 'active' || staff.accountId !== release.recipientAccountId) throw requestError(409,'This release no longer matches the approved paper, published sitting or active invigilator.');
  if (checkTime && (now < Date.parse(release.availableAt) || now >= Date.parse(release.expiresAt))) throw requestError(409,'This paper release is not within its access window.');
}

const paperSelect = `select id,order_id as "orderId",version,revision,status,file_name as "fileName",size_bytes as "sizeBytes",checksum,signature_verified as "signatureVerified",
  scan_status as "scanStatus",scanner_ref as "scannerRef",created_by as "createdBy",created_at as "createdAt",reason,reviewed_by as "reviewedBy",review_reason as "reviewReason" from exam_papers`;
const releaseFields = `r.id,r.paper_id as "paperId",r.order_id as "orderId",r.sitting_id as "sittingId",r.sitting_revision as "sittingRevision",r.published_revision as "publishedRevision",
  r.staff_id as "staffId",r.recipient_account_id as "recipientAccountId",r.available_at as "availableAt",r.expires_at as "expiresAt",r.copies,r.package_ref as "packageRef",r.status,r.revision,
  r.created_by as "createdBy",r.reason,r.acknowledged_at as "acknowledgedAt",r.receipt_ref as "receiptRef",r.revocation_reason as "revocationReason"`;
const releaseSelect = `select ${releaseFields} from exam_paper_releases r`;
const sittingSelect = `select id,period_id as "periodId",order_id as "orderId",revision,status,starts_at as "startsAt",duration_minutes as "durationMinutes" from exam_sittings`;
const timetableSelect = `select status,published_revision as "publishedRevision",published_staff_snapshot as "publishedStaffSnapshot" from exam_timetables`;

export function createExamPapersModule(pool,{storage = null} = {}) {
  async function orderFor(db,id,actor) {
    const order = (await db.query(`${examOrderSelect} where eo.id = $1`,[id])).rows[0];
    if (!order) throw requestError(404,'Exam order was not found.');
    const offering = await offeringFor(db,order.periodId,order.courseId);
    const scope = {programmeCode:offering.programmeCode,intakeId:offering.intakeId};
    const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
    const author = (await authority(db,offering,actor)).managePlan;
    const capabilities = {upload:author || can('exams.papers.manage'),manage:can('exams.papers.manage'),review:can('exams.papers.review'),scan:can('exams.papers.scan'),release:can('exams.papers.release')};
    if (!Object.values(capabilities).some(Boolean)) throw requestError(404,'Exam order was not found.');
    return {order,offering,capabilities};
  }
  async function lock(db,periodId) {await lockExamResources(db);await db.query('select pg_advisory_xact_lock(hashtext($1))',[`exam-timetable:${periodId}`]);}
  async function paperFor(db,id,actor) {
    const paper = (await db.query(`${paperSelect} where id = $1`,[id])).rows[0];
    if (!paper) throw requestError(404,'Paper version was not found.');
    const view = await orderFor(db,paper.orderId,actor);
    await lock(db,view.order.periodId);
    return {...view,paper:(await db.query(`${paperSelect} where id = $1 for update`,[id])).rows[0]};
  }
  async function event(db,paperId,releaseId,action,actor,reason,metadata = {}) {
    await db.query('insert into exam_paper_events (paper_id,release_id,action,actor_id,reason,metadata) values ($1,$2,$3,$4,$5,$6)',[paperId,releaseId,action,actor.accountId,reason.trim(),metadata]);
    await insertAudit(db,{actorId:actor.accountId,action:`exams.paper.${action}`,subjectType:releaseId ? 'ExamPaperRelease' : 'ExamPaper',subjectId:releaseId || paperId,reason,metadata:{paperId,...metadata}});
  }
  async function context(db,id,actor) {
    const view = await orderFor(db,id,actor);
    const papers = (await db.query(`${paperSelect} where order_id = $1 order by version desc`,[id])).rows;
    const releases = (await db.query(`${releaseSelect} where r.order_id = $1 order by r.created_at desc`,[id])).rows;
    const events = (await db.query(`select e.id::int,e.paper_id as "paperId",e.release_id as "releaseId",e.action,e.reason,e.metadata,e.recorded_at as "recordedAt" from exam_paper_events e join exam_papers p on p.id = e.paper_id where p.order_id = $1 order by e.id desc`,[id])).rows;
    const sitting = view.order.sittingId ? (await db.query(`${sittingSelect} where id = $1`,[view.order.sittingId])).rows[0] : null;
    const timetable = (await db.query(`${timetableSelect} where period_id = $1`,[view.order.periodId])).rows[0];
    const published = timetable?.status === 'published' && timetable.publishedStaffSnapshot?.sittings.find((row) => row.id === sitting?.id && row.revision === sitting?.revision);
    const recipients = published ? (await db.query(`select m.id,m.employee_number as "employeeNumber",m.legal_name as "legalName" from staff_members m join exam_sitting_invigilators i on i.staff_id = m.id where i.sitting_id = $1 and m.status = 'active' and m.account_id is not null order by m.employee_number`,[sitting.id])).rows.filter((row) => published.invigilators.some((entry) => entry.staffId === row.id)) : [];
    return {...view,papers,releases,events,sitting:published ? sitting : null,recipients:recipients.map((row) => ({...row,releaseEndAt:new Date(Date.parse(sitting.startsAt)+paperRecipientDuration(published,sitting,row.id)*60000).toISOString()})),accountId:actor.accountId,storageAvailable:Boolean(storage)};
  }
  function requireStorage() {if (!storage) throw requestError(501,'No private storage provider is configured (ADR-004).');}
  function revision(paper,input) {if (paper.revision !== input.revision) throw requestError(409,'This paper version changed. Reload before continuing.');}
  async function bytesFor(db,paper) {
    requireStorage();
    const key = (await db.query('select storage_key from exam_papers where id = $1',[paper.id])).rows[0].storage_key;
    const bytes = await storage.get(key);
    if (bytes.length !== paper.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== paper.checksum || !matchesFileSignature('application/pdf',bytes)) throw requestError(409,'Stored paper integrity verification failed.');
    return bytes;
  }
  async function delivery(db,id,actor) {
    let release = (await db.query(`${releaseSelect} where r.id = $1 and r.recipient_account_id = $2`,[id,actor.accountId])).rows[0];
    if (!release) throw requestError(404,'Paper release was not found.');
    const order = (await db.query('select period_id from exam_orders where id = $1',[release.orderId])).rows[0];
    await lock(db,order.period_id);
    release = (await db.query(`${releaseSelect} where r.id = $1 for update`,[id])).rows[0];
    const paper = (await db.query(`${paperSelect} where id = $1`,[release.paperId])).rows[0];
    const sitting = (await db.query(`${sittingSelect} where id = $1`,[release.sittingId])).rows[0];
    const timetable = (await db.query(`${timetableSelect} where period_id = $1`,[order.period_id])).rows[0];
    const staff = (await db.query('select status,account_id as "accountId" from staff_members where id = $1 for share',[release.staffId])).rows[0];
    return {release,paper,sitting,timetable,staff};
  }
  return {
    async getExamPapers(id,actor) {return context(pool,id,actor);},
    async requestExamPaperUpload(id,input,actor) {
      validatePaperUpload(input);requireStorage();
      return withTransaction(pool,async (db) => {
        const view = await orderFor(db,id,actor);
        if (!view.capabilities.upload) throw requestError(403,'Only the lead lecturer or paper custodian can upload this paper.');
        await lock(db,view.order.periodId);
        if (view.order.status !== 'approved') throw requestError(409,'Approve the exam order before uploading its paper.');
        if ((await db.query("select 1 from exam_papers where order_id = $1 and status in ('upload_requested','uploaded','submitted')",[id])).rowCount) throw requestError(409,'A paper version already awaits upload, scanning or review.');
        const version = (await db.query('select coalesce(max(version),0) + 1 as next from exam_papers where order_id = $1',[id])).rows[0].next;
        const paperId = `exp_${randomUUID()}`,expires = new Date(Date.now()+15*60000);
        await db.query('insert into exam_papers (id,order_id,version,file_name,size_bytes,checksum,storage_key,upload_expires_at,created_by,reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[paperId,id,version,input.fileName,input.sizeBytes,input.checksum,`private/exam-papers/${randomUUID()}`,expires,actor.accountId,input.reason.trim()]);
        await event(db,paperId,null,'upload_requested',actor,input.reason,{version,checksum:input.checksum});
        return {paper:(await db.query(`${paperSelect} where id = $1`,[paperId])).rows[0],upload:{method:'PUT',url:`/api/exams/papers/${paperId}/content`,expiresAt:expires}};
      });
    },
    async receiveExamPaperUpload(id,bytes,actor) {
      requireStorage();
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);
        if (!capabilities.upload || paper.createdBy !== actor.accountId) throw requestError(403,'Only this paper version author can upload its bytes.');
        const privateRow = (await db.query('select storage_key,upload_expires_at from exam_papers where id = $1',[id])).rows[0];
        if (paper.status !== 'upload_requested' || Date.now() >= Date.parse(privateRow.upload_expires_at)) throw requestError(409,'This upload intent is no longer available. Withdraw it and request a new version.');
        if (bytes.length !== paper.sizeBytes) throw requestError(413,'Paper bytes must match the declared file size.');
        if (createHash('sha256').update(bytes).digest('hex') !== paper.checksum) throw requestError(422,'Paper bytes do not match the declared SHA-256 checksum.');
        const valid = matchesFileSignature('application/pdf',bytes);
        await storage.put(privateRow.storage_key,bytes);
        await db.query('update exam_papers set status = $2,signature_verified = $3,revision = revision + 1 where id = $1',[id,valid ? 'uploaded' : 'quarantined',valid]);
        await event(db,id,null,valid ? 'uploaded' : 'quarantined',actor,valid ? 'PDF bytes received' : 'Declared PDF has an invalid file signature',{checksum:paper.checksum,sizeBytes:bytes.length});
        return context(db,paper.orderId,actor);
      });
    },
    async scanExamPaper(id,input,actor) {
      validatePaperAction(input,['checksum','result','scannerRef']);
      if (!['clean','infected'].includes(input.result) || !text(input.scannerRef,200)) throw requestError(400,'Provide a clean/infected scan result and scanner reference.');
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);
        if (!capabilities.scan) throw requestError(403,'Scanner-result authority is required.');
        revision(paper,input);
        if (paper.status !== 'uploaded' || paper.scanStatus !== 'pending' || input.checksum !== paper.checksum) throw requestError(409,'The scan must match the current uploaded paper checksum.');
        await bytesFor(db,paper);
        await db.query("update exam_papers set scan_status = $2,status = $3,scanner_ref = $4,scanned_by = $5,revision = revision + 1 where id = $1",[id,input.result,input.result === 'infected' ? 'quarantined' : 'uploaded',input.scannerRef,actor.accountId]);
        await event(db,id,null,`scan_${input.result}`,actor,input.reason,{checksum:paper.checksum,scannerRef:input.scannerRef});
        return context(db,paper.orderId,actor);
      });
    },
    async submitExamPaper(id,input,actor) {
      validatePaperAction(input);
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);revision(paper,input);
        if (!capabilities.upload || paper.createdBy !== actor.accountId) throw requestError(403,'Only the current paper author can submit this version.');
        if (paper.status !== 'uploaded' || paper.scanStatus !== 'clean') throw requestError(409,'Upload and clean-scan this paper before submitting it.');
        await db.query("update exam_papers set status = 'submitted',revision = revision + 1 where id = $1",[id]);
        await event(db,id,null,'submitted',actor,input.reason,{checksum:paper.checksum});return context(db,paper.orderId,actor);
      });
    },
    async reviewExamPaper(id,input,actor) {
      validatePaperAction(input,['outcome']);
      if (!['approved','returned'].includes(input.outcome)) throw requestError(400,'Approve or return this paper version.');
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);revision(paper,input);
        if (!capabilities.review) throw requestError(403,'Paper review authority is required.');
        if (paper.createdBy === actor.accountId) throw requestError(403,'Another colleague must review your paper version.');
        if (paper.status !== 'submitted' || paper.scanStatus !== 'clean') throw requestError(409,'Only a clean, submitted paper version can be reviewed.');
        await bytesFor(db,paper);
        if (input.outcome === 'approved') {
          const previous = (await db.query("select id from exam_papers where order_id = $1 and status = 'approved'",[paper.orderId])).rows;
          await db.query("update exam_papers set status = 'superseded',revision = revision + 1 where order_id = $1 and status = 'approved'",[paper.orderId]);
          for (const row of previous) await event(db,row.id,null,'superseded',actor,input.reason,{replacementPaperId:id});
        }
        await db.query('update exam_papers set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4,revision = revision + 1 where id = $1',[id,input.outcome,actor.accountId,input.reason.trim()]);
        await event(db,id,null,input.outcome,actor,input.reason,{checksum:paper.checksum});return context(db,paper.orderId,actor);
      });
    },
    async withdrawExamPaper(id,input,actor) {
      validatePaperAction(input);
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);revision(paper,input);
        if (!capabilities.manage && !(capabilities.upload && paper.createdBy === actor.accountId && ['upload_requested','uploaded','submitted','returned'].includes(paper.status))) throw requestError(403,'Paper-custody authority is required to withdraw this version.');
        if (['withdrawn','superseded'].includes(paper.status)) throw requestError(409,'This paper version is already withdrawn or superseded.');
        await db.query("update exam_papers set status = 'withdrawn',revision = revision + 1 where id = $1",[id]);
        await event(db,id,null,'withdrawn',actor,input.reason,{checksum:paper.checksum});return context(db,paper.orderId,actor);
      });
    },
    async downloadExamPaper(id,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== 'reason') || !text(input.reason,2000)) throw requestError(400,'Provide the paper-access purpose.');
      return withTransaction(pool,async (db) => {
        const {paper,capabilities} = await paperFor(db,id,actor);
        const own = capabilities.upload && paper.createdBy === actor.accountId;
        if (!(own || capabilities.manage || capabilities.review && ['submitted','approved'].includes(paper.status))) throw requestError(403,'Paper content access is not authorized.');
        if (!['uploaded','submitted','approved','returned'].includes(paper.status) || paper.scanStatus !== 'clean') throw requestError(409,'Only a current clean paper version can be downloaded.');
        const bytes = await bytesFor(db,paper);await event(db,id,null,'custody_downloaded',actor,input.reason,{checksum:paper.checksum});return {paper,bytes};
      });
    },
    async releaseExamPaper(id,input,actor) {
      return withTransaction(pool,async (db) => {
        const {paper,order,capabilities} = await paperFor(db,id,actor);
        if (!capabilities.release) throw requestError(403,'Paper release authority is required.');
        const sitting = (await db.query(`${sittingSelect} where order_id = $1 and status = 'scheduled'`,[order.id])).rows[0];
        if (!sitting) throw requestError(409,'Schedule and publish an ordered sitting before releasing its paper.');
        const timetable = (await db.query(`${timetableSelect} where period_id = $1`,[order.periodId])).rows[0];
        const published = timetable?.publishedStaffSnapshot?.sittings.find((row) => row.id === sitting.id);
        validatePaperRelease(input,{...sitting,durationMinutes:paperRecipientDuration(published,sitting,input?.staffId)});
        if (input.revision !== sitting.revision) throw requestError(409,'The sitting changed. Review it before releasing the paper.');
        const staff = (await db.query('select status,account_id as "accountId" from staff_members where id = $1 for share',[input.staffId])).rows[0];
        const release = {status:'active',staffId:input.staffId,recipientAccountId:staff?.accountId,sittingRevision:sitting.revision,publishedRevision:timetable?.publishedRevision,availableAt:input.availableAt,expiresAt:input.expiresAt};
        assertPaperDelivery(release,paper,sitting,timetable,staff,{checkTime:false});await bytesFor(db,paper);
        if ((await db.query("select 1 from exam_paper_releases where sitting_id = $1 and staff_id = $2 and status = 'active'",[sitting.id,input.staffId])).rowCount) throw requestError(409,'Revoke the existing release before issuing another package for this invigilator.');
        const releaseId = `expr_${randomUUID()}`;
        await db.query('insert into exam_paper_releases (id,paper_id,order_id,sitting_id,sitting_revision,published_revision,staff_id,recipient_account_id,available_at,expires_at,copies,package_ref,created_by,reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[releaseId,id,order.id,sitting.id,sitting.revision,timetable.publishedRevision,input.staffId,staff.accountId,input.availableAt,input.expiresAt,input.copies,input.packageRef.trim(),actor.accountId,input.reason.trim()]);
        await event(db,id,releaseId,'released',actor,input.reason,{sittingId:sitting.id,sittingRevision:sitting.revision,publishedRevision:timetable.publishedRevision,staffId:input.staffId,copies:input.copies,packageRef:input.packageRef});
        await queueNotification(db,staff.accountId,'exams.paper_release',{action:'issued',availableAt:new Date(input.availableAt).toISOString(),expiresAt:new Date(input.expiresAt).toISOString()},{link:'#registry/exams'});
        return context(db,order.id,actor);
      });
    },
    async revokeExamPaperRelease(id,input,actor) {
      validatePaperAction(input);
      return withTransaction(pool,async (db) => {
        let release = (await db.query(`${releaseSelect} where r.id = $1`,[id])).rows[0];
        if (!release) throw requestError(404,'Paper release was not found.');
        const view = await orderFor(db,release.orderId,actor);
        if (!view.capabilities.release) throw requestError(403,'Paper release authority is required.');
        await lock(db,view.order.periodId);release = (await db.query(`${releaseSelect} where r.id = $1 for update`,[id])).rows[0];
        if (release.revision !== input.revision || release.status !== 'active') throw requestError(409,'This release changed or was already revoked.');
        await db.query("update exam_paper_releases set status = 'revoked',revision = revision + 1,revoked_by = $2,revocation_reason = $3 where id = $1",[id,actor.accountId,input.reason.trim()]);
        await event(db,release.paperId,id,'release_revoked',actor,input.reason,{});
        await queueNotification(db,release.recipientAccountId,'exams.paper_release',{action:'revoked',availableAt:new Date(release.availableAt).toISOString(),expiresAt:new Date(release.expiresAt).toISOString()},{link:'#registry/exams'});return context(db,release.orderId,actor);
      });
    },
    async ownExamPaperReleases(actor) {
      const rows = (await pool.query(`select ${releaseFields},p.file_name as "fileName",p.version,p.checksum,
        jsonb_build_object('status',p.status,'scanStatus',p.scan_status,'signatureVerified',p.signature_verified) as "paperFacts",
        jsonb_build_object('id',s.id,'revision',s.revision,'status',s.status) as "sittingFacts",
        jsonb_build_object('status',et.status,'publishedRevision',et.published_revision,'publishedStaffSnapshot',et.published_staff_snapshot) as "timetableFacts",
        jsonb_build_object('status',m.status,'accountId',m.account_id) as "staffFacts"
        from exam_paper_releases r join exam_papers p on p.id = r.paper_id join exam_sittings s on s.id = r.sitting_id join staff_members m on m.id = r.staff_id
        left join exam_timetables et on et.period_id = s.period_id where r.recipient_account_id = $1 order by r.created_at desc`,[actor.accountId])).rows;
      const result = [];
      for (const release of rows) {
        let eligible = true;try {assertPaperDelivery(release,release.paperFacts,release.sittingFacts,release.timetableFacts,release.staffFacts,{checkTime:false});} catch {eligible = false;}
        result.push({id:release.id,paperId:release.paperId,sittingId:release.sittingId,fileName:release.fileName,version:release.version,checksum:release.checksum,copies:release.copies,packageRef:release.packageRef,
          availableAt:release.availableAt,expiresAt:release.expiresAt,status:release.status,eligible,acknowledgedAt:release.acknowledgedAt,receiptRef:release.receiptRef});
      }
      return result;
    },
    async downloadReleasedExamPaper(id,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== 'reason') || !text(input.reason,2000)) throw requestError(400,'Provide the paper-access purpose.');
      return withTransaction(pool,async (db) => {
        const view = await delivery(db,id,actor);assertPaperDelivery(view.release,view.paper,view.sitting,view.timetable,view.staff);
        const bytes = await bytesFor(db,view.paper);await event(db,view.paper.id,id,'recipient_downloaded',actor,input.reason,{checksum:view.paper.checksum});return {paper:view.paper,bytes};
      });
    },
    async acknowledgeExamPaperRelease(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !['reason','receiptRef'].includes(key)) || !text(input.reason,2000) || !text(input.receiptRef,200)) throw requestError(400,'Provide a custody receipt reference and reason.');
      return withTransaction(pool,async (db) => {
        const view = await delivery(db,id,actor);assertPaperDelivery(view.release,view.paper,view.sitting,view.timetable,view.staff,{checkTime:false});
        if (view.release.acknowledgedAt) throw requestError(409,'This package receipt was already acknowledged.');
        if (!(await db.query("select 1 from exam_paper_events where release_id = $1 and actor_id = $2 and action = 'recipient_downloaded'",[id,actor.accountId])).rowCount) throw requestError(409,'Download this released paper before acknowledging its custody receipt.');
        await db.query('update exam_paper_releases set acknowledged_at = now(),receipt_ref = $2,revision = revision + 1 where id = $1',[id,input.receiptRef.trim()]);
        await event(db,view.paper.id,id,'receipt_acknowledged',actor,input.reason,{receiptRef:input.receiptRef});return {id,acknowledged:true,receiptRef:input.receiptRef.trim()};
      });
    }
  };
}
