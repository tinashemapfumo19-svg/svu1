import { randomUUID } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { courseLink, queueNotification } from '../notification-queue.js';
import { courseAccess, courseRoster } from './course-workspace.js';

// Anonymous course evaluations (docs/COURSE_EVALUATIONS.md). Fixed questions; responses hold no student reference.
export const evaluationQuestions = [
  'The course was well organised.',
  'The lecturer explained ideas clearly.',
  'Materials and resources helped me learn.',
  'Assessment and feedback were fair and timely.',
  'Overall, I am satisfied with this course.'
];
export const minimumResponses = 5;
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

// Averages, distributions and comments, only once enough students have answered.
export function summariseEvaluation(responses, enrolled) {
  const count = responses.length;
  const base = { responses: count, enrolled, responseRate: enrolled ? Math.round((count / enrolled) * 100) : null, minimumResponses };
  if (count < minimumResponses) return { ...base, visible: false };
  return { ...base, visible: true,
    questions: evaluationQuestions.map((text, index) => {
      const values = responses.map((row) => row.ratings[index]);
      const distribution = [1, 2, 3, 4, 5].map((score) => values.filter((value) => value === score).length);
      return { text, average: Math.round((values.reduce((sum, value) => sum + value, 0) / count) * 10) / 10, distribution };
    }),
    wentWell: responses.map((row) => row.wentWell).filter(Boolean).sort(),
    toChange: responses.map((row) => row.toChange).filter(Boolean).sort() };
}

export function createCourseEvaluationsModule(pool) {
  const manage = (actor) => { if (!actor.permissions.includes('evaluations.manage')) throw requestError(403, 'Permission required: evaluations.manage'); };
  const isOpen = (row, today = isoDate(new Date())) => !row.closedAt && row.opensOn <= today && row.closesOn >= today;
  const select = `select id,period_id as "periodId",course_id as "courseId",to_char(opens_on,'YYYY-MM-DD') as "opensOn",to_char(closes_on,'YYYY-MM-DD') as "closesOn",closed_at as "closedAt" from course_evaluations`;
  const responsesFor = async (db, id) => (await db.query(`select ratings,went_well as "wentWell",to_change as "toChange" from course_evaluation_responses where evaluation_id=$1`, [id])).rows;

  return {
    evaluationQuestions() { return evaluationQuestions; },

    // Registry / quality office: open evaluations for every course offered in a period, and notify enrolled students.
    async openPeriodEvaluations(input, actor) {
      manage(actor);
      const { periodId, opensOn, closesOn } = input || {};
      if (typeof periodId !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(opensOn || '') || !/^\d{4}-\d\d-\d\d$/.test(closesOn || '') || closesOn < opensOn) throw requestError(400, 'Choose a semester and an opening and closing date.');
      return withTransaction(pool, async (db) => {
        const offerings = (await db.query('select course_id as "courseId" from registration_offerings where period_id=$1', [periodId])).rows;
        if (!offerings.length) throw requestError(404, 'That semester has no course offerings.');
        let opened = 0, notified = 0;
        for (const { courseId } of offerings) {
          const id = `cev_${randomUUID()}`;
          const added = await db.query(`insert into course_evaluations(id,period_id,course_id,opens_on,closes_on,opened_by) values($1,$2,$3,$4,$5,$6) on conflict (period_id,course_id) do nothing`, [id, periodId, courseId, opensOn, closesOn, actor.accountId]);
          if (!added.rowCount) continue;
          opened++;
          const code = (await db.query('select code from courses where id=$1', [courseId])).rows[0]?.code || '';
          for (const student of await courseRoster(db, periodId, courseId)) { if (await queueNotification(db, student.accountId, 'course.evaluation_open', { courseCode: code, closesOn }, { activeOnly: true, link: courseLink(periodId, courseId) })) notified++; }
        }
        await insertAudit(db, { actorId: actor.accountId, action: 'evaluations.opened', subjectType: 'RegistrationPeriod', subjectId: periodId, reason: 'Course evaluations opened', metadata: { opened, opensOn, closesOn } });
        return { opened, alreadyOpen: offerings.length - opened, notified };
      });
    },

    async listPeriodEvaluations(periodId, actor) {
      manage(actor);
      if (!periodId) return { periods: (await pool.query(`select rp.id,ap.name,rp.status,count(distinct ro.course_id)::int as offerings,count(distinct ce.id)::int as evaluations
          from registration_periods rp join academic_periods ap on ap.id=rp.academic_period_id left join registration_offerings ro on ro.period_id=rp.id
          left join course_evaluations ce on ce.period_id=rp.id group by rp.id,ap.name,rp.status,ap.starts_on order by ap.starts_on desc nulls last limit 40`)).rows, minimumResponses };
      const rows = (await pool.query(`${select.replace(' from course_evaluations', `,(select code from courses c where c.id=course_id) as "code",(select title from courses c where c.id=course_id) as "title" from course_evaluations`)} where period_id=$1 order by "code"`, [periodId])).rows;
      const items = [];
      for (const row of rows) {
        const enrolled = (await courseRoster(pool, periodId, row.courseId)).length;
        const summary = summariseEvaluation(await responsesFor(pool, row.id), enrolled);
        items.push({ ...row, open: isOpen(row), responses: summary.responses, enrolled, responseRate: summary.responseRate, overall: summary.visible ? summary.questions[4].average : null });
      }
      return { periodId, items, minimumResponses };
    },

    async closeEvaluation(id, actor) {
      manage(actor);
      return withTransaction(pool, async (db) => {
        const row = (await db.query(`${select} where id=$1 for update`, [id])).rows[0];
        if (!row) throw requestError(404, 'Evaluation was not found.');
        if (!row.closedAt) {
          await db.query('update course_evaluations set closed_at=now() where id=$1', [id]);
          await insertAudit(db, { actorId: actor.accountId, action: 'evaluations.closed', subjectType: 'CourseEvaluation', subjectId: id, reason: 'Course evaluation closed early' });
        }
        return { id, closed: true };
      });
    },

    // Course page: a student sees whether they can answer; the lecturer (and managers) see results.
    async courseEvaluation(periodId, courseId, actor) {
      return withTransaction(pool, async (db) => {
        const access = await courseAccess(db, periodId, courseId, actor);
        const row = (await db.query(`${select} where period_id=$1 and course_id=$2`, [periodId, courseId])).rows[0];
        if (!row) return { exists: false };
        if (!access.canManage) {
          const answered = (await db.query('select 1 from course_evaluation_participants where evaluation_id=$1 and student_id=$2', [row.id, access.studentId])).rowCount > 0;
          return { exists: true, open: isOpen(row), answered, closesOn: row.closesOn, questions: evaluationQuestions };
        }
        const enrolled = (await courseRoster(db, periodId, courseId)).length;
        return { exists: true, open: isOpen(row), closesOn: row.closesOn, opensOn: row.opensOn, ...summariseEvaluation(await responsesFor(db, row.id), enrolled) };
      });
    },

    async submitEvaluation(periodId, courseId, input, actor) {
      const ratings = input?.ratings;
      const text = (value) => (typeof value === 'string' ? value.trim() : '');
      if (!Array.isArray(ratings) || ratings.length !== 5 || ratings.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) throw requestError(400, 'Answer each of the five questions with a score from 1 to 5.');
      if (text(input.wentWell).length > 2000 || text(input.toChange).length > 2000) throw requestError(400, 'Keep each comment under 2000 characters.');
      return withTransaction(pool, async (db) => {
        const access = await courseAccess(db, periodId, courseId, actor);
        if (access.canManage) throw requestError(403, 'Only enrolled students can answer the evaluation.');
        const row = (await db.query(`${select} where period_id=$1 and course_id=$2`, [periodId, courseId])).rows[0];
        if (!row || !isOpen(row)) throw requestError(409, 'This course evaluation is not open.');
        const joined = await db.query('insert into course_evaluation_participants(evaluation_id,student_id) values($1,$2) on conflict do nothing', [row.id, access.studentId]);
        if (!joined.rowCount) throw requestError(409, 'You have already answered this evaluation. Thank you.');
        await db.query('insert into course_evaluation_responses(id,evaluation_id,ratings,went_well,to_change) values($1,$2,$3,$4,$5)', [`cer_${randomUUID()}`, row.id, ratings, text(input.wentWell), text(input.toChange)]);
        return { submitted: true };
      });
    }
  };
}
