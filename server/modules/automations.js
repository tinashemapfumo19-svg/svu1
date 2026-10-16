import { insertAudit, requestError, withTransaction } from '../support.js';
import { courseLink, queueNotification } from '../notification-queue.js';
import { financialStatus, formatMoney } from './student-finance.js';
import { teachingRoles } from './teaching.js';

// Scheduled reminders and digests (docs/AUTOMATIONS.md). Every message is claimed in automation_sends before it is
// queued, in the same transaction, so a repeated or concurrent sweep never sends it twice.
export const automationJobs = ['deadline_reminders', 'missing_work', 'offer_expiry', 'registration_ready', 'fee_reminders', 'support_followups', 'weekly_digest'];
const day = 864e5;
const iso = value => new Date(value).toISOString().slice(0, 16).replace('T', ' ');
const isoDate = value => new Date(value).toISOString().slice(0, 10);

// ISO week label, e.g. 2026-W42, used to send the digest at most once a week.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / day + 1) / 7)).padStart(2, '0')}`;
}

// The deadline window a reminder belongs to, or null when it is not due within 48 hours.
export function deadlineWindow(dueAt, now) {
  const left = new Date(dueAt).getTime() - now.getTime();
  if (left <= 0 || left > 2 * day) return null;
  return left <= day ? { job: 'deadline_24', when: 'within 24 hours' } : { job: 'deadline_48', when: 'within 2 days' };
}

export function offerWindow(expiresAt, now) {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0 || left > 7 * day) return null;
  return left <= 2 * day ? { job: 'offer_2d', when: 'in 2 days' } : { job: 'offer_7d', when: 'in 7 days' };
}

export function digestLines({ tasks = 0, unmarked = 0, support = 0, applications = 0 }) {
  const parts = [];
  if (applications) parts.push([`${applications} ${applications === 1 ? 'application' : 'applications'} waiting for review`, applications]);
  if (unmarked) parts.push([`${unmarked} unmarked ${unmarked === 1 ? 'submission' : 'submissions'}`, unmarked]);
  if (support) parts.push([`${support} open support ${support === 1 ? 'case' : 'cases'} assigned to you`, support]);
  if (tasks) parts.push([`${tasks} open ${tasks === 1 ? 'task' : 'tasks'} assigned to you`, tasks]);
  if (!parts.length) return null;
  return { headline: parts.map(([text]) => text).slice(0, 2).join(', '), lines: `This week: ${parts.map(([text]) => text).join('; ')}.` };
}

export function createAutomationsModule(pool, { repository = () => null } = {}) {
  // Claim then queue in one transaction. Returns true when this call sent the message.
  async function send(job, subjectKey, accountId, template, variables, link = null) {
    return withTransaction(pool, async db => {
      const claimed = await db.query(`insert into automation_sends(job,subject_key,recipient_account_id) values($1,$2,$3) on conflict do nothing`, [job, subjectKey, accountId]);
      if (!claimed.rowCount) return false;
      if (!template) return true;
      const notificationId = await queueNotification(db, accountId, template, variables, { activeOnly: true, link });
      await db.query('update automation_sends set notification_id=$1 where job=$2 and subject_key=$3 and recipient_account_id=$4', [notificationId, job, subjectKey, accountId]);
      return true;
    });
  }
  const marked = async (job, subjectKey, accountId) => (await pool.query('select 1 from automation_sends where job=$1 and subject_key=$2 and recipient_account_id=$3', [job, subjectKey, accountId])).rowCount > 0;

  const jobs = {
    async deadline_reminders(now) {
      const rows = (await pool.query(`select r.id as "resourceId",r.title,r.due_at as "dueAt",c.code as "courseCode",s.account_id as "accountId",r.period_id as "periodId",r.course_id as "courseId"
        from course_resources r join courses c on c.id=r.course_id
        join student_registrations sr on sr.period_id=r.period_id and sr.status='confirmed'
        join course_enrolments ce on ce.registration_id=sr.id and ce.course_id=r.course_id and ce.withdrawn_at is null
        join student_programmes sp on sp.id=sr.student_programme_id and sp.status in ('onboarded','active')
        join students s on s.id=ce.student_id
        where r.kind='assignment' and r.status='published' and r.due_at>$1 and r.due_at<=$1::timestamptz+interval '48 hours'
          and not exists (select 1 from course_assignment_uploads u where u.resource_id=r.id and u.student_id=ce.student_id)`, [now])).rows;
      let sent = 0;
      for (const row of rows) {
        const window = deadlineWindow(row.dueAt, now);
        if (window && await send(window.job, row.resourceId, row.accountId, 'course.deadline_reminder', { courseCode: row.courseCode, title: row.title, dueAt: iso(row.dueAt), when: window.when }, courseLink(row.periodId, row.courseId))) sent++;
      }
      return sent;
    },
    async missing_work(now) {
      const rows = (await pool.query(`select r.id as "resourceId",r.title,r.due_at as "dueAt",c.code as "courseCode",st.account_id as "accountId",
          (select count(*)::int from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id
            join student_programmes sp on sp.id=sr.student_programme_id where sr.period_id=r.period_id and ce.course_id=r.course_id
            and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')) as enrolled,
          (select count(*)::int from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id
            join student_programmes sp on sp.id=sr.student_programme_id where sr.period_id=r.period_id and ce.course_id=r.course_id
            and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')
            and not exists (select 1 from course_assignment_uploads u where u.resource_id=r.id and u.student_id=ce.student_id)) as missing
        from course_resources r join courses c on c.id=r.course_id
        join teaching_allocations a on a.period_id=r.period_id and a.course_id=r.course_id and a.status='active' and a.role=any($2::text[])
          and a.effective_from<=($1::timestamptz)::date and (a.effective_to is null or a.effective_to>=($1::timestamptz)::date)
        join staff_members st on st.id=a.staff_id and st.status='active' and st.account_id is not null
        where r.kind='assignment' and r.status='published' and r.due_at<=$1::timestamptz and r.due_at>$1::timestamptz-interval '7 days'`, [now, teachingRoles])).rows;
      let sent = 0;
      for (const row of rows) if (row.missing > 0 && await send('missing_work', row.resourceId, row.accountId, 'course.missing_work',
        { courseCode: row.courseCode, title: row.title, dueAt: iso(row.dueAt), missingCount: row.missing, enrolledCount: row.enrolled }, '#learning')) sent++;
      return sent;
    },
    async offer_expiry(now) {
      const rows = (await pool.query(`select d.id,d.offer_expires_at as "expiresAt",a.applicant_account_id as "accountId",p.name as "programmeName",i.label as "intakeLabel"
        from application_decisions d join applications a on a.id=d.application_id join intakes i on i.id=a.intake_id join programmes p on p.id=i.programme_id
        where d.decision='offer' and d.response is null and a.status='submitted' and d.offer_expires_at>$1 and d.offer_expires_at<=$1::timestamptz+interval '7 days'`, [now])).rows;
      let sent = 0;
      for (const row of rows) {
        const window = offerWindow(row.expiresAt, now);
        if (window && await send(window.job, row.id, row.accountId, 'admissions.offer_expiry_reminder', { programmeName: row.programmeName, intakeLabel: row.intakeLabel, expiresOn: iso(row.expiresAt), when: window.when }, '#apply')) sent++;
      }
      return sent;
    },
    // Tell a student once their saved selection becomes eligible, but only after a sweep saw it blocked.
    async registration_ready() {
      const repo = repository();
      if (!repo?.listProgrammeRegistrations) return 0;
      const rows = (await pool.query(`select sr.student_programme_id as "programmeId",sr.period_id as "periodId",s.account_id as "accountId"
        from student_registrations sr join student_programmes sp on sp.id=sr.student_programme_id join students s on s.id=sp.student_id
        join registration_periods rp on rp.id=sr.period_id
        where sr.status='draft' and jsonb_array_length(sr.selected_courses)>0 and rp.status='open' and sp.status='onboarded'`)).rows;
      let sent = 0;
      for (const row of rows) {
        let entry;
        try { entry = (await repo.listProgrammeRegistrations(row.programmeId, { accountId: row.accountId, permissions: ['registry.self'] }, true)).find(item => item.period.id === row.periodId); }
        catch { continue; }
        if (!entry || entry.registration?.status === 'confirmed') continue;
        const key = `${row.programmeId}:${row.periodId}`;
        if (!entry.eligibility.ready) { await send('registration_blocked', key, row.accountId, null); continue; }
        if (await marked('registration_blocked', key, row.accountId) && await send('registration_ready', key, row.accountId, 'registration.ready', { periodName: entry.period.name }, '#office/registration')) sent++;
      }
      return sent;
    },
    async fee_reminders(now) {
      const today = isoDate(now), soon = isoDate(now.getTime() + 7 * day);
      const rows = (await pool.query(`select distinct sp.id as "programmeId",s.account_id as "accountId",s.student_number as "studentNumber"
        from ledger_entries e join student_programmes sp on sp.id=e.student_programme_id join students s on s.id=sp.student_id
        where e.entry_type='charge' and e.due_on<=$1::date and sp.status in ('onboarded','active')`, [soon])).rows;
      let sent = 0;
      for (const row of rows) {
        const summary = await financialStatus(pool, row.programmeId, today);
        const dueSoon = new Map();
        for (const entry of summary.entries) if (entry.entryType === 'charge' && entry.outstanding > 0 && entry.dueOn > today && entry.dueOn <= soon) {
          const key = `${entry.dueOn}:${entry.currency}`;
          dueSoon.set(key, (dueSoon.get(key) || 0) + entry.outstanding);
        }
        for (const [key, amount] of dueSoon) {
          const [dueOn, currency] = key.split(':');
          if (await send('fee_due', `${row.programmeId}:${key}`, row.accountId, 'finance.due_reminder', { studentNumber: row.studentNumber, amount: formatMoney(currency, amount), dueOn }, '#office/fees')) sent++;
        }
        if (summary.hold.held) {
          const ids = summary.hold.reasons.map(reason => reason.entryId).sort((a, b) => a - b).join(',');
          const totals = new Map();
          for (const reason of summary.hold.reasons) totals.set(reason.currency, (totals.get(reason.currency) || 0) + reason.amountMinor);
          if (await send('fee_hold', `${row.programmeId}:${ids}`.slice(0, 200), row.accountId, 'finance.hold_notice', { studentNumber: row.studentNumber, amount: [...totals].map(([currency, minor]) => formatMoney(currency, minor)).join(' and ') }, '#office/fees')) sent++;
        }
      }
      return sent;
    },
    async support_followups(now) {
      let sent = 0;
      const waiting = (await pool.query(`select id,revision,category,created_at as "createdAt",requested_by as "accountId" from support_cases
        where status='waiting_student' and updated_at<$1::timestamptz-interval '3 days'`, [now])).rows;
      for (const row of waiting) if (await send('support_waiting', `${row.id}:${row.revision}`, row.accountId, 'support.waiting_reminder', { category: row.category, openedOn: isoDate(row.createdAt) }, '#office/requests')) sent++;
      const stale = (await pool.query(`select id,revision,category,priority,updated_at as "updatedAt",assignee_id as "accountId" from support_cases
        where status in ('open','in_progress') and assignee_id is not null and updated_at<$1::timestamptz-interval '5 days'`, [now])).rows;
      for (const row of stale) if (await send('support_unanswered', `${row.id}:${row.revision}`, row.accountId, 'support.unanswered',
        { category: row.category, priority: row.priority, days: Math.floor((now - new Date(row.updatedAt)) / day) }, '#registry/support')) sent++;
      return sent;
    },
    async weekly_digest(now, { manual = false } = {}) {
      if (!manual && now.getUTCDay() !== 1) return 0;
      const week = isoWeek(now);
      const rows = (await pool.query(`select a.id as "accountId",
          (select count(*)::int from tasks t where t.assignee_account_id=a.id and t.status not in ('completed','cancelled')) as tasks,
          (select count(*)::int from support_cases c where c.assignee_id=a.id and c.status in ('open','in_progress')) as support,
          (select count(*)::int from course_assignment_uploads u join course_resources r on r.id=u.resource_id
             join teaching_allocations ta on ta.period_id=r.period_id and ta.course_id=r.course_id and ta.status='active' and ta.role=any($1::text[])
             join staff_members tm on tm.id=ta.staff_id and tm.account_id=a.id
             where u.attempt=(select max(x.attempt) from course_assignment_uploads x where x.resource_id=u.resource_id and x.student_id=u.student_id)
               and not exists (select 1 from course_assignment_reviews v where v.upload_id=u.id)) as unmarked
        from accounts a join staff_members sm on sm.account_id=a.id and sm.status='active'
        where a.status='active'`, [teachingRoles])).rows;
      let sent = 0;
      for (const row of rows) {
        const digest = digestLines(row);
        if (digest && await send('weekly_digest', week, row.accountId, 'staff.weekly_digest', digest, '#home')) sent++;
      }
      return sent;
    }
  };

  async function run(trigger, actorId, options = {}) {
    const now = options.now || new Date();
    const runId = (await pool.query(`insert into automation_runs(trigger,actor_id) values($1,$2) returning id::int`, [trigger, actorId || null])).rows[0].id;
    const results = {};
    let failed = false;
    for (const name of automationJobs) {
      try { results[name] = { sent: await jobs[name](now, { manual: trigger === 'manual' }) }; }
      catch (error) { failed = true; results[name] = { error: String(error.code || error.message || 'failed').slice(0, 120) }; }
    }
    await pool.query('update automation_runs set finished_at=now(),results=$2,failed=$3 where id=$1', [runId, results, failed]);
    return { id: runId, trigger, results, failed };
  }

  return {
    async runAutomationSweep(options = {}) { return run('schedule', null, options); },
    async runAutomationsNow(actor) {
      if (!actor.permissions.includes('notification.send')) throw requestError(403, 'Permission required: notification.send');
      const result = await run('manual', actor.accountId);
      await withTransaction(pool, db => insertAudit(db, { actorId: actor.accountId, action: 'automations.run', subjectType: 'AutomationRun', subjectId: String(result.id), reason: 'Manual automation run', metadata: { failed: result.failed } }));
      return result;
    },
    // The same counts as the weekly digest, for the signed-in person's home page.
    async myWorkSummary(actor) {
      const row = (await pool.query(`select
          (select count(*)::int from tasks t where t.assignee_account_id=$1 and t.status not in ('completed','cancelled')) as tasks,
          (select count(*)::int from support_cases c where c.assignee_id=$1 and c.status in ('open','in_progress')) as support,
          (select count(*)::int from course_assignment_uploads u join course_resources r on r.id=u.resource_id
             join teaching_allocations ta on ta.period_id=r.period_id and ta.course_id=r.course_id and ta.status='active' and ta.role=any($2::text[])
             join staff_members tm on tm.id=ta.staff_id and tm.account_id=$1
             where u.attempt=(select max(x.attempt) from course_assignment_uploads x where x.resource_id=u.resource_id and x.student_id=u.student_id)
               and not exists (select 1 from course_assignment_reviews v where v.upload_id=u.id)) as unmarked`, [actor.accountId, teachingRoles])).rows[0];
      return row;
    },
    async listAutomationRuns(actor) {
      if (!actor.permissions.includes('notification.send')) throw requestError(403, 'Permission required: notification.send');
      const runs = (await pool.query(`select id::int,trigger,started_at as "startedAt",finished_at as "finishedAt",results,failed from automation_runs order by started_at desc limit 20`)).rows;
      const totals = (await pool.query(`select job,count(*)::int as count from automation_sends where notification_id is not null and sent_at>now()-interval '30 days' group by job order by job`)).rows;
      return { jobs: automationJobs, runs, last30Days: totals };
    },
    // Lecturer action: remind every enrolled student who has not submitted, at most once a day per assignment.
    async remindMissingSubmissions(periodId, courseId, resourceId, actor) {
      const allowed = (await pool.query(`select 1 from teaching_allocations a join staff_members s on s.id=a.staff_id
        where a.period_id=$1 and a.course_id=$2 and s.account_id=$3 and s.status='active' and a.status='active' and a.role=any($4::text[])
        and a.effective_from<=current_date and (a.effective_to is null or a.effective_to>=current_date)`, [periodId, courseId, actor.accountId, teachingRoles])).rowCount > 0;
      if (!actor.permissions.includes('teaching.self') || !allowed) throw requestError(404, 'This course is not available to your account.');
      const resource = (await pool.query(`select r.id,r.title,r.due_at as "dueAt",r.allow_late as "allowLate",c.code as "courseCode" from course_resources r join courses c on c.id=r.course_id
        where r.id=$1 and r.period_id=$2 and r.course_id=$3 and r.kind='assignment' and r.status='published'`, [resourceId, periodId, courseId])).rows[0];
      if (!resource) throw requestError(404, 'Assignment is unavailable.');
      const students = (await pool.query(`select distinct s.account_id as "accountId" from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id
        join student_programmes sp on sp.id=sr.student_programme_id join students s on s.id=ce.student_id
        where sr.period_id=$1 and ce.course_id=$2 and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')
        and not exists (select 1 from course_assignment_uploads u where u.resource_id=$3 and u.student_id=ce.student_id)`, [periodId, courseId, resourceId])).rows;
      const past = new Date(resource.dueAt) < new Date();
      const lateNote = !past ? `It is due ${iso(resource.dueAt)} (UTC).` : resource.allowLate ? 'The deadline has passed, but late submissions are still accepted.' : 'The deadline has passed; contact your lecturer.';
      const key = `${resourceId}:${isoDate(new Date())}`;
      let sent = 0;
      for (const student of students) if (await send('missing_reminder', key, student.accountId, 'course.missing_reminder', { courseCode: resource.courseCode, title: resource.title, lateNote }, courseLink(periodId, courseId))) sent++;
      await withTransaction(pool, db => insertAudit(db, { actorId: actor.accountId, action: 'course.assignment.missing_reminded', subjectType: 'CourseResource', subjectId: resourceId, reason: resource.title, metadata: { sent, missing: students.length } }));
      return { missing: students.length, sent, alreadyRemindedToday: students.length - sent };
    }
  };
}

