import { createHash, randomUUID } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { matchesFileSignature } from '../storage.js';
import { teachingRoles } from './teaching.js';
import { courseLink, queueNotification } from '../notification-queue.js';
import { createCourseDiscussionModule } from './course-discussions.js';
import { aiCheckable, aiCheckDailyLimit, aiVerdict, createAiChecker, validThreshold } from '../ai-checker.js';

export const courseUploadLimit = 10 * 1024 * 1024;
const officeTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const types = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', zip: 'application/zip', ...officeTypes };
const kinds = ['file','link','note','class','assignment'];
const fields = ['kind','section','title','description','url','startsAt','dueAt','allowLate','pinned','position','sectionPosition','status','file','revision','aiThreshold'];
const bounded = (s,n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n;

export function validateCourseResource(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key)) || !kinds.includes(input.kind)
    || !bounded(input.title,200) || !bounded(input.section,100) || typeof input.description !== 'string' || input.description.length > 12000
    || !['draft','published','archived'].includes(input.status) || typeof input.pinned !== 'boolean' || typeof input.allowLate !== 'boolean'
    || !Number.isInteger(input.position) || input.position < 0 || input.position > 9999
    || !Number.isInteger(input.sectionPosition) || input.sectionPosition < 0 || input.sectionPosition > 9999) throw requestError(400,'Provide a title, section, resource type, status and valid order.');
  let url = null;
  if (input.url) {
    try {
      const parsed = new URL(input.url);
      if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password || input.url.length > 2000) throw new Error();
      url = parsed.href;
    } catch { throw requestError(400,'Use a valid HTTP or HTTPS link without embedded credentials.'); }
  }
  if (['link','class'].includes(input.kind) && !url) throw requestError(400,'A link is required for this resource.');
  const timestamp = (value,label) => {
    if (!value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw requestError(400,`Provide a valid ${label} with a timezone.`);
    return new Date(value).toISOString();
  };
  const startsAt = timestamp(input.startsAt,'class time'), dueAt = timestamp(input.dueAt,'deadline');
  if (input.kind === 'class' && !startsAt) throw requestError(400,'Set the online class time.');
  if (input.kind === 'assignment' && !dueAt) throw requestError(400,'Set the assignment deadline.');
  if (input.aiThreshold != null && !validThreshold(input.aiThreshold)) throw requestError(400,'Set the allowable AI similarity score as a percentage from 0 to 100.');
  return { ...input, title: input.title.trim(), section: input.section.trim(), url,
    startsAt: input.kind === 'class' ? startsAt : null, dueAt: input.kind === 'assignment' ? dueAt : null,
    aiThreshold: input.kind === 'assignment' && input.aiThreshold != null ? input.aiThreshold : null };
}

export function decodeCourseFile(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['fileName','base64'].includes(key))
    || !bounded(input.fileName,255) || /[\\/\x00-\x1f\x7f]/.test(input.fileName) || typeof input.base64 !== 'string'
    || input.base64.length > Math.ceil(courseUploadLimit / 3) * 4 || input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw requestError(400,'Choose a supported file up to 10 MB.');
  const extension = input.fileName.split('.').at(-1).toLowerCase(), contentType = types[extension];
  const bytes = Buffer.from(input.base64,'base64');
  if (bytes.toString('base64') !== input.base64) throw requestError(400,'The upload encoding is invalid.');
  if (!contentType || !bytes.length || bytes.length > courseUploadLimit) throw requestError(400,'Supported files: PDF, PNG, JPG, TXT, DOCX, PPTX, XLSX and ZIP, up to 10 MB.');
  const zipped = extension === 'zip' || extension in officeTypes;
  let valid = false;
  try {
    valid = zipped ? bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))
      : extension === 'txt' ? !bytes.includes(0) && !new TextDecoder('utf-8',{fatal:true}).decode(bytes).includes('\ufffd')
        : matchesFileSignature(contentType,bytes);
  } catch { valid = false; }
  if (!valid) throw requestError(400,'The file contents do not match its extension.');
  return {bytes,fileName:input.fileName,contentType,sizeBytes:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')};
}

const resourceSelect = `select id,kind,section,title,description,url,starts_at as "startsAt",due_at as "dueAt",allow_late as "allowLate",pinned,position,
  section_position as "sectionPosition",status,revision,file,ai_threshold::float8 as "aiThreshold",updated_at as "updatedAt" from course_resources`;
const publicFile = file => file ? {fileName:file.fileName,contentType:file.contentType,sizeBytes:file.sizeBytes,checksum:file.checksum} : null;
const publicResource = row => ({...row,file:publicFile(row.file)});
const reviewSelect = `select id,revision,mark::float8 as mark,max_mark::float8 as "maxMark",feedback,file,released,created_at as "createdAt" from course_assignment_reviews`;

export function validateCourseReview(input) {
  const allowed = ['submissionId','revision','mark','maxMark','feedback','file','release','reason'];
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k)) || !bounded(input.submissionId,100)
    || !Number.isInteger(input.revision) || input.revision < 0 || !Number.isFinite(input.maxMark) || input.maxMark <= 0 || input.maxMark > 10000
    || input.mark !== null && (!Number.isFinite(input.mark) || input.mark < 0 || input.mark > input.maxMark)
    || typeof input.feedback !== 'string' || input.feedback.length > 12000 || typeof input.release !== 'boolean' || !bounded(input.reason,2000)) throw requestError(400,'Provide valid marks, feedback, revision and a reason.');
  if (input.mark === null && !input.feedback.trim() && !input.file) throw requestError(400,'Provide a mark, feedback or a returned file.');
  for (const value of [input.mark,input.maxMark]) if (value !== null && Math.abs(value*100-Math.round(value*100)) > 1e-7) throw requestError(400,'Marks support up to two decimal places.');
  return input;
}

// Who may use a course page: an allocated lecturer (canManage) or an enrolled, current student. Shared with attendance.
export async function courseAccess(db,periodId,courseId,actor,staffOnly = false) {
  const offering = (await db.query(`select c.code,c.title from registration_offerings o join courses c on c.id=o.course_id where o.period_id=$1 and o.course_id=$2`,[periodId,courseId])).rows[0];
  if (!offering) throw requestError(404,'Course was not found.');
  const canManage = actor.permissions.includes('teaching.self') && (await db.query(`select 1 from teaching_allocations a join staff_members s on s.id=a.staff_id
    where a.period_id=$1 and a.course_id=$2 and s.account_id=$3 and s.status='active' and a.status='active'
    and a.role=any($4::text[]) and a.effective_from<=current_date and (a.effective_to is null or a.effective_to>=current_date)`,[periodId,courseId,actor.accountId,teachingRoles])).rowCount > 0;
  if (canManage) return {offering,canManage:true};
  if (!staffOnly && actor.permissions.includes('registry.self')) {
    const own = (await db.query(`select ce.student_id as "studentId",ce.registration_id as "registrationId" from course_enrolments ce
      join student_registrations sr on sr.id=ce.registration_id join students s on s.id=ce.student_id
      join student_programmes sp on sp.id=sr.student_programme_id where sr.period_id=$1 and ce.course_id=$2 and s.account_id=$3
      and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')`,[periodId,courseId,actor.accountId])).rows[0];
    if (own) return {offering,canManage:false,...own};
  }
  throw requestError(404,'This course is not available to your account.');
}

// Current, confirmed students enrolled in the course.
export async function courseRoster(db,periodId,courseId) {
  return (await db.query(`select distinct s.id as "studentId",s.account_id as "accountId",s.student_number as "studentNumber",p.legal_name as "studentName"
    from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id
    join students s on s.id=ce.student_id join people p on p.id=s.person_id
    join student_programmes sp on sp.id=sr.student_programme_id
    where sr.period_id=$1 and ce.course_id=$2 and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')
    order by "studentNumber"`,[periodId,courseId])).rows;
}

export function createCourseWorkspaceModule(pool,{storage = null,aiCheck = null,aiChecker} = {}) {
  // The checker is advisory: injected for tests, otherwise built from configuration and absent when disabled.
  const checker = aiChecker !== undefined ? aiChecker : createAiChecker(aiCheck);
  const access = courseAccess, roster = courseRoster;
  const aiSettings = {enabled:Boolean(checker),threshold:aiCheck?.threshold ?? 20,provider:checker ? aiCheck?.provider || 'simulated' : null};
  async function fileFor(input) {
    if (!storage) throw requestError(503,'Course file storage is unavailable.');
    const {bytes,...metadata} = decodeCourseFile(input);
    const file = {...metadata,storageKey:`course-workspace/${randomUUID()}`};
    await storage.put(file.storageKey,bytes);
    return file;
  }
  async function cleanOnFailure(file,work) {
    try { return await work(); }
    catch (error) { if (file) await storage.remove(file.storageKey).catch(() => {}); throw error; }
  }
  return {
    ...createCourseDiscussionModule(pool,access),
    async getCourseWorkspaceSummaries(programmeId,actor) {
      if (!actor.permissions.includes('registry.self')) throw requestError(403,'Student access is required.');
      return (await pool.query(`select sr.period_id as "periodId",ce.course_id as "courseId",
        min(r.due_at) filter(where r.kind='assignment' and r.due_at>now() and not exists
          (select 1 from course_assignment_uploads u where u.resource_id=r.id and u.student_id=ce.student_id)) as "nextDeadline",
        min(r.starts_at) filter(where r.kind='class' and r.starts_at>now()) as "nextClass"
        from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id
        join students s on s.id=ce.student_id join student_programmes sp on sp.id=sr.student_programme_id
        left join course_resources r on r.period_id=sr.period_id and r.course_id=ce.course_id and r.status='published'
        where s.account_id=$1 and sp.id=$2 and sp.status in ('onboarded','active') and sr.status='confirmed' and ce.withdrawn_at is null
        group by sr.period_id,ce.course_id`,[actor.accountId,programmeId])).rows;
    },
    async getCourseWorkspace(periodId,courseId,actor) {
      return withTransaction(pool,async db => {
        const own = await access(db,periodId,courseId,actor);
        const resources = (await db.query(`${resourceSelect} where period_id=$1 and course_id=$2 ${own.canManage ? '' : "and status='published'"}
          order by section_position,section,pinned desc,position,id`,[periodId,courseId])).rows;
        const submissions = (await db.query(`select u.id,u.student_id as "studentId",u.resource_id as "resourceId",u.attempt,u.file,u.submitted_at as "submittedAt",u.late,
          s.student_number as "studentNumber",p.legal_name as "studentName" from course_assignment_uploads u
          join course_resources r on r.id=u.resource_id join students s on s.id=u.student_id join people p on p.id=s.person_id
          where r.period_id=$1 and r.course_id=$2 ${own.canManage ? '' : "and u.student_id=$3 and r.status='published'"}
          order by u.submitted_at desc`,own.canManage ? [periodId,courseId] : [periodId,courseId,own.studentId])).rows;
        const ids = submissions.map(s => s.id);
        const checks = ids.length ? (await db.query(`select u.id as "uploadId",c.status,c.ai_score::float8 as "aiScore",c.threshold::float8 as threshold,c.above_threshold as "aboveThreshold",
          c.predicted_class as "predictedClass",c.provider,c.checked_at as "checkedAt",u.ai_warning_acknowledged as acknowledged
          from course_assignment_uploads u join course_ai_checks c on c.id=u.ai_check_id where u.id=any($1::text[])`,[ids])).rows : [];
        const checkByUpload = new Map(checks.map(({uploadId,...row}) => [uploadId,row]));
        const reviews = ids.length ? (await db.query(`select distinct on (upload_id) upload_id as "uploadId",id,revision,mark::float8 as mark,max_mark::float8 as "maxMark",feedback,file,released,created_at as "createdAt"
          from course_assignment_reviews where upload_id=any($1::text[]) ${own.canManage ? '' : 'and released=true'} order by upload_id,revision desc`,[ids])).rows : [];
        const byUpload = new Map(reviews.map(r => [r.uploadId,{...r,file:publicFile(r.file)}]));
        const students = own.canManage ? (await roster(db,periodId,courseId)).map(({accountId,...r}) => r) : [];
        return {course:own.offering,canManage:own.canManage,resources:resources.map(publicResource),roster:students,
          submissions:submissions.map(row=>({...row,file:publicFile(row.file),review:byUpload.get(row.id) || null,aiCheck:checkByUpload.get(row.id) || null})),
          aiCheck:{enabled:aiSettings.enabled,threshold:aiSettings.threshold}};
      });
    },
    async saveCourseResource(periodId,courseId,id,input,actor) {
      const value = validateCourseResource(input);
      // Authorize before writing bytes, then repeat authorization inside the transaction.
      await access(pool,periodId,courseId,actor,true);
      const uploaded = input.file ? await fileFor(input.file) : null;
      return cleanOnFailure(uploaded,() => withTransaction(pool,async db => {
        const own = await access(db,periodId,courseId,actor,true);
        const previous = id ? (await db.query(`${resourceSelect} where id=$1 and period_id=$2 and course_id=$3 for update`,[id,periodId,courseId])).rows[0] : null;
        if (id && !previous) throw requestError(404,'Resource was not found.');
        if (previous && previous.revision !== input.revision) throw requestError(409,'This resource changed. Reload it before saving.');
        if (previous && previous.kind !== value.kind) throw requestError(409,'Create a new resource to change its type.');
        const file = uploaded || previous?.file || null;
        if (value.kind === 'file' && !file) throw requestError(400,'Choose a file to upload.');
        if (input.file && !['file','assignment'].includes(value.kind)) throw requestError(400,'Only file resources and assignment briefs accept attachments.');
        const resourceId = id || `cr_${randomUUID()}`;
        const params = [resourceId,periodId,courseId,value.kind,value.section,value.title,value.description,value.url,value.startsAt,value.dueAt,
          value.allowLate,value.pinned,value.position,value.sectionPosition,value.status,file,actor.accountId,value.aiThreshold];
        await db.query(`insert into course_resources (id,period_id,course_id,kind,section,title,description,url,starts_at,due_at,allow_late,pinned,position,section_position,status,file,created_by,ai_threshold)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          on conflict(id) do update set section=excluded.section,title=excluded.title,description=excluded.description,url=excluded.url,
          starts_at=excluded.starts_at,due_at=excluded.due_at,allow_late=excluded.allow_late,pinned=excluded.pinned,position=excluded.position,
          section_position=excluded.section_position,status=excluded.status,file=excluded.file,ai_threshold=excluded.ai_threshold,revision=course_resources.revision+1,updated_at=now()`,params);
        await insertAudit(db,{actorId:actor.accountId,action:'course.resource.saved',subjectType:'CourseResource',subjectId:resourceId,reason:value.title,metadata:{periodId,courseId,status:value.status}});
        if (value.status === 'published' && previous?.status !== 'published') {
          for (const student of await roster(db,periodId,courseId)) await queueNotification(db,student.accountId,'course.resource',{courseCode:own.offering.code,kind:value.kind,title:value.title},{activeOnly:true,link:courseLink(periodId,courseId)});
        }
        return {id:resourceId};
      }));
    },
    // Scores one exact file before submission. The file itself is not stored; only the result, by checksum.
    async checkCourseAssignmentAi(periodId,courseId,id,input,actor) {
      if (!input || Object.keys(input).some(key=>key!=='file')) throw requestError(400,'Provide an assignment file.');
      if (!checker) return {status:'disabled'};
      const {bytes,...file} = decodeCourseFile(input.file);
      if (!aiCheckable(file.fileName)) return {status:'unsupported'};
      const prepared = await withTransaction(pool,async db => {
        const own = await access(db,periodId,courseId,actor);
        if (!own.studentId) throw requestError(403,'Only enrolled students can check assignment files.');
        const resource = (await db.query(`${resourceSelect} where id=$1 and period_id=$2 and course_id=$3`,[id,periodId,courseId])).rows[0];
        if (!resource || resource.kind!=='assignment' || resource.status!=='published') throw requestError(404,'Assignment is unavailable.');
        if (Date.now()>new Date(resource.dueAt).getTime() && !resource.allowLate) throw requestError(409,'The assignment deadline has passed.');
        const recent = (await db.query(`select count(*)::int as count from course_ai_checks where resource_id=$1 and student_id=$2 and checked_at>now()-interval '1 day'`,[id,own.studentId])).rows[0].count;
        if (recent>=aiCheckDailyLimit) throw requestError(429,`You can run up to ${aiCheckDailyLimit} AI similarity checks per assignment in a day. Try again later.`);
        return {studentId:own.studentId,threshold:resource.aiThreshold ?? aiSettings.threshold,title:resource.title};
      });
      // The provider call runs outside any transaction; a failure is recorded so the student can still submit.
      let result = null,failureCode = null;
      try { result = await checker({bytes,fileName:file.fileName,contentType:file.contentType}); }
      catch (error) { failureCode = String(error.aiCode || 'PROVIDER_UNAVAILABLE').slice(0,64); }
      const aboveThreshold = result ? aiVerdict(result.aiScore,prepared.threshold).aboveThreshold : false;
      const checkId = `ca_${randomUUID()}`;
      return withTransaction(pool,async db => {
        await access(db,periodId,courseId,actor);
        await db.query(`insert into course_ai_checks(id,resource_id,student_id,checksum,file_name,provider,status,ai_score,mixed_score,human_score,predicted_class,provider_version,threshold,above_threshold,failure_code,checked_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[checkId,id,prepared.studentId,file.checksum,file.fileName,aiSettings.provider,result ? 'completed' : 'unavailable',
          result?.aiScore ?? null,result?.mixedScore ?? null,result?.humanScore ?? null,result?.predictedClass ?? null,result?.providerVersion ?? null,prepared.threshold,aboveThreshold,failureCode,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:'course.assignment.ai_checked',subjectType:'CourseAiCheck',subjectId:checkId,reason:prepared.title,
          metadata:{resourceId:id,checksum:file.checksum,status:result ? 'completed' : 'unavailable',aiScore:result?.aiScore ?? null,threshold:prepared.threshold,aboveThreshold}});
        return {id:checkId,status:result ? 'completed' : 'unavailable',aiScore:result?.aiScore ?? null,predictedClass:result?.predictedClass ?? null,threshold:prepared.threshold,aboveThreshold,checksum:file.checksum};
      });
    },
    async submitCourseAssignment(periodId,courseId,id,input,actor) {
      if (!input || Object.keys(input).some(key=>!['file','aiCheckId','acknowledgeAiWarning'].includes(key)) || input.aiCheckId !== undefined && !bounded(input.aiCheckId,100)
        || input.acknowledgeAiWarning !== undefined && typeof input.acknowledgeAiWarning !== 'boolean') throw requestError(400,'Provide an assignment file.');
      const own = await access(pool,periodId,courseId,actor);
      if (!own.studentId) throw requestError(403,'Only enrolled students can submit assignments.');
      const file = await fileFor(input.file);
      return cleanOnFailure(file,()=>withTransaction(pool,async db => {
        const student = await access(db,periodId,courseId,actor);
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`course-upload:${id}:${student.studentId}`]);
        const resource = (await db.query(`${resourceSelect} where id=$1 and period_id=$2 and course_id=$3 for share`,[id,periodId,courseId])).rows[0];
        if (!resource || resource.kind!=='assignment' || resource.status!=='published') throw requestError(404,'Assignment is unavailable.');
        const late = Date.now()>new Date(resource.dueAt).getTime();
        if (late && !resource.allowLate) throw requestError(409,'The assignment deadline has passed.');
        // When checking is on, a checkable file must carry a recent check of these exact bytes.
        let check = null;
        if (checker && aiCheckable(file.fileName)) {
          if (!input.aiCheckId) throw requestError(409,'Run the AI similarity check on this file before submitting.');
          check = (await db.query(`select id,status,ai_score::float8 as "aiScore",above_threshold as "aboveThreshold" from course_ai_checks
            where id=$1 and resource_id=$2 and student_id=$3 and checksum=$4 and checked_at>now()-interval '1 day'`,[input.aiCheckId,id,student.studentId,file.checksum])).rows[0];
          if (!check) throw requestError(409,'The AI similarity check does not match this file. Check the file again before submitting.');
          if (check.aboveThreshold && input.acknowledgeAiWarning !== true) throw requestError(409,'This file is above the allowable AI similarity score. Confirm that you want to submit it anyway.');
        }
        const attempt = (await db.query('select coalesce(max(attempt),0)+1 as attempt from course_assignment_uploads where resource_id=$1 and student_id=$2',[id,student.studentId])).rows[0].attempt;
        const uploadId = `cu_${randomUUID()}`;
        await db.query('insert into course_assignment_uploads(id,resource_id,student_id,registration_id,attempt,file,late,ai_check_id,ai_warning_acknowledged) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [uploadId,id,student.studentId,student.registrationId,attempt,file,late,check?.id || null,Boolean(check?.aboveThreshold && input.acknowledgeAiWarning)]);
        await insertAudit(db,{actorId:actor.accountId,action:'course.assignment.submitted',subjectType:'CourseSubmission',subjectId:uploadId,reason:resource.title,
          metadata:{attempt,late,checksum:file.checksum,...(check ? {aiCheckId:check.id,aiScore:check.aiScore,aboveThreshold:check.aboveThreshold} : {})}});
        // A dated receipt in the student's inbox (and email when delivery is configured) as proof of submission.
        await queueNotification(db,actor.accountId,'course.submission_receipt',{courseCode:student.offering.code,title:resource.title,attempt,
          submittedAt:new Date().toISOString().slice(0,16).replace('T',' '),fileName:file.fileName,receipt:uploadId},{activeOnly:true,link:courseLink(periodId,courseId)});
        return {id:uploadId,attempt,late,aiCheck:check ? {status:check.status,aiScore:check.aiScore,aboveThreshold:check.aboveThreshold} : null};
      }));
    },
    async reviewCourseAssignment(periodId,courseId,id,input,actor) {
      validateCourseReview(input);
      await access(pool,periodId,courseId,actor,true);
      const file = input.file ? await fileFor(input.file) : null;
      return cleanOnFailure(file,() => withTransaction(pool,async db => {
        const own = await access(db,periodId,courseId,actor,true);
        const upload = (await db.query(`select u.id,s.account_id as "accountId" from course_assignment_uploads u
          join course_resources r on r.id=u.resource_id join students s on s.id=u.student_id
          where u.id=$1 and r.id=$2 and r.period_id=$3 and r.course_id=$4 and r.kind='assignment' for share of u,r`,[input.submissionId,id,periodId,courseId])).rows[0];
        if (!upload) throw requestError(404,'Submission was not found.');
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`course-review:${upload.id}`]);
        const previous = (await db.query(`${reviewSelect} where upload_id=$1 order by revision desc limit 1`,[upload.id])).rows[0];
        if ((previous?.revision || 0) !== input.revision) throw requestError(409,'This review changed. Reload before marking.');
        const reviewId = `cv_${randomUUID()}`, revision = input.revision+1;
        await db.query(`insert into course_assignment_reviews(id,upload_id,revision,mark,max_mark,feedback,file,released,created_by,reason)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[reviewId,upload.id,revision,input.mark,input.maxMark,input.feedback,file || previous?.file || null,input.release,actor.accountId,input.reason]);
        await insertAudit(db,{actorId:actor.accountId,action:input.release ? 'course.assignment.feedback_released' : 'course.assignment.review_drafted',subjectType:'CourseSubmission',subjectId:upload.id,reason:input.reason,metadata:{reviewId,revision}});
        if (input.release) await queueNotification(db,upload.accountId,'course.feedback',{courseCode:own.offering.code},{activeOnly:true,link:courseLink(periodId,courseId)});
        return {id:reviewId,revision,released:input.release};
      }));
    },
    async downloadCourseFile(periodId,courseId,id,submission,actor,reviewId = null) {
      const metadata = await withTransaction(pool,async db => {
        const own = await access(db,periodId,courseId,actor);
        const resource = (await db.query(`${resourceSelect} where id=$1 and period_id=$2 and course_id=$3`,[id,periodId,courseId])).rows[0];
        if (!resource || !own.canManage && resource.status!=='published') throw requestError(404,'Resource was not found.');
        let file = resource.file;
        if (reviewId) {
          const review = (await db.query(`select v.file,v.released,u.student_id as "studentId" from course_assignment_reviews v
            join course_assignment_uploads u on u.id=v.upload_id where v.id=$1 and u.resource_id=$2`,[reviewId,id])).rows[0];
          if (!review || !own.canManage && (!review.released || review.studentId !== own.studentId)) throw requestError(404,'Returned file was not found.');
          file = review.file;
        } else if (submission) {
          const upload = (await db.query('select file,student_id as "studentId" from course_assignment_uploads where id=$1 and resource_id=$2',[submission,id])).rows[0];
          if (!upload || !own.canManage && upload.studentId!==own.studentId) throw requestError(404,'Submission was not found.');
          file = upload.file;
        }
        if (!file) throw requestError(404,'No file attached.');
        return file;
      });
      if (!storage) throw requestError(503,'Course file storage is unavailable.');
      return {file:publicFile(metadata),bytes:await storage.get(metadata.storageKey)};
    }
  };
}
