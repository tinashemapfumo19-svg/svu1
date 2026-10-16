import { createHash, randomUUID } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { createAiAssistant } from '../ai-assist.js';
import { decodeCourseFile } from './course-workspace.js';
import { financialStatus } from './student-finance.js';
import { bestPage, pagesFor, rankPages } from '../help-map.js';

// Assistive features (docs/AI_ASSIST.md) and the rules-based early-warning list. Each feature first performs the
// same authorised read a person would, then asks the assistant; results are returned for a person to review and
// are never written to the record. Audit events record that assistance was used, not its content.
const text = (value, limit) => String(value ?? '').slice(0, limit);
const askLimiter = new Map();

// Public questions are rate limited per client address: 10 per hour.
export function allowPublicQuestion(key, now = Date.now(), limit = 10) {
  const recent = (askLimiter.get(key) || []).filter(time => now - time < 3600000);
  if (recent.length >= limit) { askLimiter.set(key, recent); return false; }
  recent.push(now); askLimiter.set(key, recent);
  if (askLimiter.size > 5000) for (const [entry, times] of askLimiter) if (!times.some(time => now - time < 3600000)) askLimiter.delete(entry);
  return true;
}

export const followUpOutcomes = { contacted: 'Contacted the student', meeting_booked: 'Meeting booked', referred: 'Referred to a service', no_action: 'No action needed' };

// CSV of the early-warning list. Cells that a spreadsheet could read as a formula are prefixed with an apostrophe.
export function earlyWarningCsv(items) {
  const cell = value => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const rows = [['Student number', 'Name', 'Programme', 'Reasons', 'Last follow-up', 'Follow-up date', 'Followed up by']]
    .concat(items.map(row => [row.studentNumber, row.studentName, row.programmeCode, row.reasons.map(reason => reason.text).join('; '),
      row.lastFollowUp ? followUpOutcomes[row.lastFollowUp.outcome] : '', row.lastFollowUp ? new Date(row.lastFollowUp.at).toISOString().slice(0, 10) : '', row.lastFollowUp?.by || '']));
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Advisory reasons a student may need support, from records staff can already see.
export function supportReasons({ missingSubmissions = 0, averageMark = null, held = false, waitingSupport = 0, unregistered = false, attendanceSessions = 0, attendanceMarked = 0 }) {
  const reasons = [];
  // Attendance counts only once there are enough closed sessions to mean something.
  if (attendanceSessions >= 4 && attendanceMarked / attendanceSessions < 0.75) reasons.push({ code: 'low_attendance', text: `Attended ${attendanceMarked} of ${attendanceSessions} recent classes` });
  if (missingSubmissions >= 2) reasons.push({ code: 'missing_work', text: `${missingSubmissions} assignments past due without a submission` });
  if (averageMark !== null && averageMark < 50) reasons.push({ code: 'low_marks', text: `Released coursework marks average ${Math.round(averageMark)}%` });
  if (held) reasons.push({ code: 'financial_hold', text: 'Financial hold on the account' });
  if (waitingSupport) reasons.push({ code: 'support_waiting', text: `${waitingSupport} support ${waitingSupport === 1 ? 'case is' : 'cases are'} waiting for the student` });
  if (unregistered) reasons.push({ code: 'not_registered', text: 'Not yet registered for an open registration period' });
  return reasons;
}

export function createAiFeaturesModule(pool, { aiAssist = null, aiAssistant, repository = () => null, askSvuPersonal = false } = {}) {
  const assistant = aiAssistant !== undefined ? aiAssistant : createAiAssistant(aiAssist);
  const ensureEnabled = () => { if (!assistant) throw requestError(409, 'AI assistance is not enabled.'); };
  const run = async (task, input) => {
    try { return await assistant(task, input); }
    catch (error) { throw requestError(error.aiCode === 'RATE_LIMITED' ? 429 : 503, error.aiCode ? error.message : 'The AI assistant is unavailable.'); }
  };
  const audit = (actorId, action, subjectType, subjectId, metadata = {}) => withTransaction(pool, db => insertAudit(db, { actorId, action, subjectType, subjectId, reason: 'AI assistance used', metadata }));
  // Ask SVU phase 2 (D-41): a short, read-only summary of the person's own upcoming dates, money and work, built from
  // the same reads their screens make. Only sent when SVU_ASK_SVU_PERSONAL is enabled.
  async function personalContext(actor) {
    const repo = repository(), lines = [], now = Date.now(), day = 864e5;
    const at = (value, allDay) => allDay ? new Date(value).toISOString().slice(0, 10) : new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    try {
      const { events } = await repo.listMyCalendar(actor, { from: new Date(now - day).toISOString().slice(0, 10), to: new Date(now + 21 * day).toISOString().slice(0, 10) });
      for (const event of events.filter(row => new Date(row.end || row.start).getTime() >= now - day).slice(0, 15))
        lines.push(`${event.type}: ${event.title}${event.subtitle ? ` (${event.subtitle})` : ''} on ${at(event.start, event.allDay)}${event.status && !['scheduled', 'teaching'].includes(event.status) ? `, ${event.status.replace('_', ' ')}` : ''}`);
      if (!events.length) lines.push('No deadlines, classes, exams, fees or appointments in the next three weeks.');
    } catch { /* calendar unavailable: answer without it */ }
    if (actor.permissions.includes('registry.self') && repo.getOwnStudent) {
      try {
        for (const programme of (await repo.getOwnStudent(actor)).programmes.filter(row => ['onboarded', 'active'].includes(row.status))) {
          const money = await financialStatus(pool, programme.id);
          lines.push(`Programme: ${programme.programmeName} (${programme.status}), student number ${programme.studentNumber}`);
          for (const row of money.currencies) lines.push(`Account: balance ${(row.balance / 100).toFixed(2)} ${row.currency}, due now ${(row.due / 100).toFixed(2)} ${row.currency}`);
          lines.push(money.hold.held ? `Financial hold: ${money.hold.reasons.map(reason => reason.message).join(' ')}` : 'No financial hold.');
        }
      } catch { /* record unavailable */ }
    }
    if (repo.myWorkSummary && actor.permissions.some(code => ['teaching.self', 'support.view', 'support.manage', 'task.assign'].includes(code))) {
      try { const work = await repo.myWorkSummary(actor); lines.push(`Work waiting: ${work.unmarked} unmarked submissions, ${work.support} support cases assigned, ${work.tasks} open tasks.`); } catch { /* summary unavailable */ }
    }
    return lines.slice(0, 25).map(line => text(line, 300));
  }
  const publishedGuidance = async () => {
    const repo = repository();
    const list = repo?.listPublicGuidance ? await repo.listPublicGuidance({}) : { items: [] };
    return list.items.map(item => ({ id: item.id, title: text(item.title, 200), programme: item.programmeName || null, intake: item.intakeLabel || null, body: text(item.body || item.summary || '', 4000) }));
  };

  return {
    aiAssistStatus() { return { enabled: Boolean(assistant), askSvuPersonal: Boolean(assistant && askSvuPersonal) }; },

    // 9. Lecturer feedback draft for one submission; the lecturer edits and releases it as usual.
    async draftCourseFeedback(periodId, courseId, resourceId, input, actor) {
      ensureEnabled();
      if (!input || typeof input.submissionId !== 'string' || !Number.isFinite(input.maxMark) || input.maxMark <= 0 || (input.mark !== null && !Number.isFinite(input.mark)) || typeof (input.notes ?? '') !== 'string' || (input.notes ?? '').length > 4000)
        throw requestError(400, 'Provide the submission, mark, maximum mark and optional notes.');
      const repo = repository();
      const workspace = await repo.getCourseWorkspace(periodId, courseId, actor);
      if (!workspace.canManage) throw requestError(404, 'This course is not available to your account.');
      const resource = workspace.resources.find(row => row.id === resourceId && row.kind === 'assignment');
      const submission = workspace.submissions.find(row => row.id === input.submissionId && row.resourceId === resourceId);
      if (!resource || !submission) throw requestError(404, 'Submission was not found.');
      const documents = [];
      let included = 'not included';
      try {
        const { file, bytes } = await repo.downloadCourseFile(periodId, courseId, resourceId, submission.id, actor);
        if (file.contentType === 'application/pdf' && bytes.length <= 8 * 1024 * 1024) { documents.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }); included = 'attached as a PDF'; }
        else if (file.contentType === 'text/plain') { documents.push({ type: 'text', text: `Submission text:\n${text(bytes.toString('utf8'), 60000)}` }); included = 'included as text'; }
      } catch { /* The draft still uses the brief, mark and notes. */ }
      const draft = await run('feedback', { documents, meta: {}, text: [
        `Course: ${workspace.course.code} ${workspace.course.title}`, `Assignment: ${resource.title}`, `Brief: ${text(resource.description, 4000) || 'Not provided'}`,
        `Mark: ${input.mark === null ? 'Not set' : `${input.mark} / ${input.maxMark}`}`, `Lecturer notes: ${text(input.notes, 4000) || 'None'}`, `Submission: ${included}`].join('\n') });
      await audit(actor.accountId, 'ai.feedback_drafted', 'CourseSubmission', submission.id, { resourceId, submissionIncluded: included });
      return { draft: [draft.feedback, draft.strengths?.length ? `Strengths: ${draft.strengths.join('; ')}.` : '', draft.improvements?.length ? `To improve: ${draft.improvements.join('; ')}.` : ''].filter(Boolean).join('\n\n'), ...draft };
    },

    // 10. Support triage suggestion for staff who can already read the case.
    async assistSupportCase(caseId, actor) {
      ensureEnabled();
      const repo = repository();
      const supportCase = await repo.getSupportCase(caseId, actor, false);
      const thread = (supportCase.comments || supportCase.thread || []).filter(row => row.visibility !== 'private').slice(-8).map(row => `${row.authorKind || row.author || 'person'}: ${text(row.body, 2000)}`);
      const guidance = await publishedGuidance();
      const result = await run('support_triage', { meta: {}, text: [
        `Current category: ${supportCase.category}; priority: ${supportCase.priority}; status: ${supportCase.status}`, `Subject: ${text(supportCase.subject, 300)}`,
        `Conversation:\n${thread.join('\n') || 'No messages'}`, `Published guidance:\n${guidance.map(row => `[${row.id}] ${row.title}: ${row.body}`).join('\n\n') || 'None published'}`].join('\n\n') });
      const ids = new Set(guidance.map(row => row.id));
      await audit(actor.accountId, 'ai.support_triaged', 'SupportCase', caseId);
      return { ...result, guidance: (result.guidanceIds || []).filter(id => ids.has(id)).map(id => ({ id, title: guidance.find(row => row.id === id).title })) };
    },

    // 11. Public admissions question answered only from published guidance.
    async askAdmissionsGuidance(input, clientKey) {
      ensureEnabled();
      const question = typeof input?.question === 'string' ? input.question.trim() : '';
      if (question.length < 3 || question.length > 500) throw requestError(400, 'Ask a question of up to 500 characters.');
      if (!allowPublicQuestion(createHash('sha256').update(String(clientKey)).digest('hex'))) throw requestError(429, 'Too many questions from this connection. Try again in an hour, or send an enquiry.');
      const guidance = await publishedGuidance();
      if (!guidance.length) return { answered: false, answer: 'There is no published admissions guidance yet. The admissions team can help through an enquiry.', articles: [] };
      const result = await run('admissions_answer', { meta: {}, text: `Question: ${question}\n\nPublished guidance:\n${guidance.map(row => `[${row.id}] ${row.title}${row.programme ? ` (${row.programme}${row.intake ? `, ${row.intake}` : ''})` : ''}: ${row.body}`).join('\n\n')}` });
      const ids = new Set(guidance.map(row => row.id));
      return { answered: Boolean(result.answered), answer: result.answer, articles: (result.articleIds || []).filter(id => ids.has(id)).map(id => ({ id, title: guidance.find(row => row.id === id).title })) };
    },

    // Ask SVU (docs/ASK_SVU.md): in-app how-to help from the pages the asker can open and published guidance.
    // It sees no personal records and takes no actions; links it returns are checked against the asker's pages.
    async askSvu(input, { actor = null, clientKey = 'unknown' } = {}) {
      ensureEnabled();
      const question = typeof input?.question === 'string' ? input.question.trim() : '';
      if (question.length < 2 || question.length > 500) throw requestError(400, 'Ask a question of up to 500 characters.');
      const history = Array.isArray(input?.history) ? input.history.slice(-6).filter(row => row && ['user', 'assistant'].includes(row.role) && typeof row.text === 'string').map(row => ({ role: row.role, text: text(row.text, 800) })) : [];
      const path = typeof input?.path === 'string' && /^#[\w/?=&.%-]{0,120}$/.test(input.path) ? input.path : '';
      const key = actor ? `help:account:${actor.accountId}` : `help:client:${createHash('sha256').update(String(clientKey)).digest('hex')}`;
      if (!allowPublicQuestion(key, Date.now(), actor ? 30 : 10)) throw requestError(429, actor ? 'You have asked a lot of questions this hour. Try again later, or open a request in Student Office or contact support.' : 'Too many questions from this connection. Try again in an hour, or send an enquiry.');
      const pages = rankPages(question, pagesFor(actor ? actor.permissions : null));
      const guidance = (await publishedGuidance()).slice(0, 25).map(row => ({ ...row, body: text(row.body, 1500) }));
      const personal = actor && askSvuPersonal ? await personalContext(actor) : [];
      const result = await run('help', {
        meta: { bestPage: bestPage(question, pages), personal, question },
        text: [`Signed in: ${actor ? 'yes' : 'no (visitor)'}`, path ? `Current page: ${path}` : '',
          `Pages this person can open:\n${pages.map(page => `[${page.id}] ${page.title} (${page.route}): ${page.text}`).join('\n')}`,
          guidance.length ? `Published guidance articles:\n${guidance.map(row => `[${row.id}] ${row.title}${row.programme ? ` (${row.programme}${row.intake ? `, ${row.intake}` : ''})` : ''}: ${row.body}`).join('\n\n')}` : 'Published guidance articles: none.',
          personal.length ? `Your information (read-only, from the portal, as of ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC):\n${personal.map(line => `- ${line}`).join('\n')}` : '',
          history.length ? `Conversation so far:\n${history.map(row => `${row.role === 'user' ? 'Person' : 'Ask SVU'}: ${row.text}`).join('\n')}` : '',
          `Question: ${question}`].filter(Boolean).join('\n\n')
      });
      const byId = new Map(pages.map(page => [page.id, page])), articles = new Map(guidance.map(row => [row.id, row]));
      const answer = {
        answered: Boolean(result.answered), answer: text(result.answer, 2000),
        links: [...new Set(result.pageIds || [])].filter(id => byId.has(id)).slice(0, 3).map(id => ({ id, title: byId.get(id).title, href: byId.get(id).route, external: Boolean(byId.get(id).external) })),
        articles: [...new Set(result.articleIds || [])].filter(id => articles.has(id)).map(id => ({ id, title: articles.get(id).title })),
        followUps: (result.followUps || []).filter(row => typeof row === 'string' && row.trim()).slice(0, 3).map(row => text(row.trim(), 120)),
        personal: personal.length > 0
      };
      if (actor) await audit(actor.accountId, 'ai.help_asked', 'Account', actor.accountId, { answered: answer.answered, pages: answer.links.map(row => row.id), personal: answer.personal });
      return answer;
    },

    // Ask SVU feedback: only whether the answer helped is kept, never the question or answer.
    async recordHelpFeedback(input, actor) {
      if (typeof input?.helpful !== 'boolean') throw requestError(400, 'Say whether the answer helped.');
      await audit(actor.accountId, 'ai.help_feedback', 'Account', actor.accountId, { helpful: input.helpful });
      return { recorded: true };
    },

    // 12. Applicant document-type check before upload; nothing is stored.
    async checkApplicationDocument(applicationId, input, actor) {
      ensureEnabled();
      if (!input || typeof input.documentType !== 'string' || !/^[a-z_]{2,60}$/.test(input.documentType) || !input.file) throw requestError(400, 'Provide the document type and file.');
      const repo = repository();
      await repo.getApplication(actor, applicationId);
      const { bytes, contentType } = decodeCourseFile(input.file);
      const block = contentType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }
        : ['image/png', 'image/jpeg'].includes(contentType) ? { type: 'image', source: { type: 'base64', media_type: contentType, data: bytes.toString('base64') } } : null;
      if (!block) return { checked: false, note: 'Only PDF, PNG and JPG files can be checked.' };
      const result = await run('document_check', { documents: [block], meta: { documentType: input.documentType }, text: `The application asks for: ${input.documentType.replaceAll('_', ' ')}. What kind of document is this, is it that kind, and is it legible?` });
      await audit(actor.accountId, 'ai.document_checked', 'Application', applicationId, { documentType: input.documentType, matches: Boolean(result.matches) });
      return { checked: true, ...result };
    },

    // 13. Plain-language explanation of the student's own published record.
    async explainMyAcademicRecord(programmeId, actor) {
      ensureEnabled();
      const repo = repository();
      const [academic, results] = await Promise.all([repo.listAcademicContext(programmeId, actor, true), repo.listProgrammeResults(programmeId, actor, true)]);
      const record = JSON.stringify({ academic, results }).slice(0, 60000);
      const result = await run('record_explanation', { meta: {}, text: `The student's own published record (JSON):\n${record}` });
      await audit(actor.accountId, 'ai.record_explained', 'StudentProgramme', programmeId);
      return result;
    },

    // 14. Rules-based early warning, advisory and limited to staff scope. No AI is used.
    async listStudentsNeedingSupport(actor, { format = 'json' } = {}) {
      if (!actor.permissions.includes('registry.view')) throw requestError(403, 'Permission required: registry.view');
      const rows = (await pool.query(`select sp.id as "programmeId",sp.intake_id as "intakeId",p.code as "programmeCode",s.student_number as "studentNumber",pe.legal_name as "studentName",
          (select count(*)::int from course_resources r join student_registrations sr on sr.period_id=r.period_id and sr.student_programme_id=sp.id and sr.status='confirmed'
             join course_enrolments ce on ce.registration_id=sr.id and ce.course_id=r.course_id and ce.withdrawn_at is null
             where r.kind='assignment' and r.status='published' and r.due_at<now() and r.due_at>now()-interval '60 days'
             and not exists (select 1 from course_assignment_uploads u where u.resource_id=r.id and u.student_id=s.id)) as "missingSubmissions",
          (select avg(v.mark/v.max_mark*100)::float8 from course_assignment_reviews v join course_assignment_uploads u on u.id=v.upload_id
             where u.student_id=s.id and v.released and v.mark is not null and v.revision=(select max(x.revision) from course_assignment_reviews x where x.upload_id=v.upload_id)) as "averageMark",
          (select count(*)::int from attendance_sessions a join student_registrations sr on sr.period_id=a.period_id and sr.student_programme_id=sp.id and sr.status='confirmed'
             join course_enrolments ce on ce.registration_id=sr.id and ce.course_id=a.course_id and ce.withdrawn_at is null
             where coalesce(a.closed_at,a.closes_at)<now() and a.opened_at>now()-interval '60 days') as "attendanceSessions",
          (select count(*)::int from attendance_marks m join attendance_sessions a on a.id=m.session_id where m.student_id=s.id
             and coalesce(a.closed_at,a.closes_at)<now() and a.opened_at>now()-interval '60 days') as "attendanceMarked",
          (select count(*)::int from support_cases c where c.student_programme_id=sp.id and c.status='waiting_student') as "waitingSupport",
          exists (select 1 from registration_periods rp where rp.intake_id=sp.intake_id and rp.status='open'
             and not exists (select 1 from student_registrations sr where sr.student_programme_id=sp.id and sr.period_id=rp.id and sr.status='confirmed')) as unregistered
        from student_programmes sp join students s on s.id=sp.student_id join people pe on pe.id=s.person_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id
        where sp.status in ('onboarded','active') order by s.student_number limit 2000`)).rows
        .filter(row => actorCanAccessScope({ ...actor, authorizingPermission: 'registry.view' }, { programmeCode: row.programmeCode, intakeId: row.intakeId }));
      const items = [];
      for (const row of rows) {
        const held = (await financialStatus(pool, row.programmeId)).hold.held;
        const reasons = supportReasons({ ...row, held });
        if (reasons.length) items.push({ programmeId: row.programmeId, studentNumber: row.studentNumber, studentName: row.studentName, programmeCode: row.programmeCode, reasons });
      }
      const latest = new Map((await pool.query(`select distinct on (f.student_programme_id) f.student_programme_id as "programmeId",f.outcome,f.note,f.created_at as "at",
          coalesce(pe.preferred_name,pe.legal_name) as "by" from early_warning_followups f join accounts a on a.id=f.created_by join people pe on pe.id=a.person_id
        where f.student_programme_id=any($1::text[]) order by f.student_programme_id,f.created_at desc`, [items.map(row => row.programmeId)])).rows.map(({ programmeId, ...row }) => [programmeId, row]));
      for (const item of items) item.lastFollowUp = latest.get(item.programmeId) || null;
      await withTransaction(pool, db => insertAudit(db, { actorId: actor.accountId, action: format === 'csv' ? 'registry.early_warning.exported' : 'registry.early_warning.viewed', subjectType: 'Report', subjectId: 'early-warning', reason: format === 'csv' ? 'Early warning list exported' : 'Early warning list viewed', metadata: { count: items.length } }));
      const sorted = items.sort((a, b) => b.reasons.length - a.reasons.length);
      return format === 'csv' ? earlyWarningCsv(sorted) : { items: sorted, checkedAt: new Date().toISOString() };
    },

    // A staff member records that they followed up a flagged student. Append-only; only a fixed outcome and a short note.
    async recordEarlyWarningFollowUp(programmeId, input, actor) {
      if (!actor.permissions.includes('registry.view')) throw requestError(403, 'Permission required: registry.view');
      if (!input || !followUpOutcomes[input.outcome] || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000))) throw requestError(400, 'Choose an outcome and keep the note under 1000 characters.');
      const row = (await pool.query(`select sp.id,sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id where sp.id=$1`, [programmeId])).rows[0];
      if (!row || !actorCanAccessScope({ ...actor, authorizingPermission: 'registry.view' }, { programmeCode: row.programmeCode, intakeId: row.intakeId })) throw requestError(404, 'Student programme was not found.');
      const id = `ewf_${randomUUID()}`;
      await withTransaction(pool, async db => {
        await db.query('insert into early_warning_followups(id,student_programme_id,outcome,note,created_by) values($1,$2,$3,$4,$5)', [id, programmeId, input.outcome, (input.note || '').trim(), actor.accountId]);
        await insertAudit(db, { actorId: actor.accountId, action: 'registry.early_warning.followed_up', subjectType: 'StudentProgramme', subjectId: programmeId, reason: followUpOutcomes[input.outcome], metadata: { followUpId: id, outcome: input.outcome } });
      });
      return { id, outcome: input.outcome, at: new Date().toISOString() };
    }
  };
}
