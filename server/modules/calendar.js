import { createHash, randomBytes } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { buildCalendar } from '../ics.js';
import { financialStatus, formatMoney } from './student-finance.js';
import { teachingRoles } from './teaching.js';

// One dated view across modules (docs/CALENDAR.md): assignment deadlines, online classes, published exam sittings,
// fee due dates and offer expiry. Every event comes from a read the person can already make; nothing is invented.
const day = 864e5;
export const calendarTypes = ['assignment', 'class', 'exam', 'fee', 'offer', 'intake', 'appointment'];

export function calendarRange(input = {}, now = new Date()) {
  const parse = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) throw requestError(400, 'Use dates in YYYY-MM-DD form.');
    return new Date(`${value}T00:00:00Z`);
  };
  const from = parse(input.from, new Date(now.getTime() - 7 * day)), to = parse(input.to, new Date(now.getTime() + 42 * day));
  if (to <= from || to - from > 120 * day) throw requestError(400, 'Choose a range of up to 120 days.');
  return { from, to };
}

// Status words for a deadline, from the person's own submission state.
export function deadlineStatus({ dueAt, submitted, now = new Date() }) {
  if (submitted) return 'submitted';
  const left = new Date(dueAt).getTime() - now.getTime();
  if (left < 0) return 'overdue';
  return left <= day ? 'due_soon' : 'due';
}

export function createCalendarModule(pool, { repository = () => null } = {}) {
  const inRange = (value, range) => { const time = new Date(value).getTime(); return time >= range.from.getTime() && time < range.to.getTime(); };

  async function studentEvents(actor, range, now) {
    const events = [];
    const programmes = (await pool.query(`select sp.id,sp.status from student_programmes sp join students s on s.id=sp.student_id
      where s.account_id=$1 and sp.status in ('onboarded','active')`, [actor.accountId])).rows;
    for (const programme of programmes) {
      const course = (await pool.query(`select r.id,r.kind,r.title,r.due_at as "dueAt",r.starts_at as "startsAt",r.url,r.period_id as "periodId",r.course_id as "courseId",c.code,
          exists (select 1 from course_assignment_uploads u where u.resource_id=r.id and u.student_id=ce.student_id) as submitted
        from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id join course_resources r on r.period_id=sr.period_id and r.course_id=ce.course_id
        join courses c on c.id=r.course_id
        where sr.student_programme_id=$1 and sr.status='confirmed' and ce.withdrawn_at is null and r.status='published' and r.kind in ('assignment','class')
          and coalesce(r.due_at,r.starts_at)>=$2 and coalesce(r.due_at,r.starts_at)<$3`, [programme.id, range.from, range.to])).rows;
      for (const row of course) {
        const href = `#study/courses/${encodeURIComponent(row.periodId)}/${encodeURIComponent(row.courseId)}`;
        if (row.kind === 'assignment') events.push({ id: `assignment:${row.id}`, type: 'assignment', title: row.title, subtitle: `${row.code} assignment due`, start: row.dueAt, allDay: false, status: deadlineStatus({ dueAt: row.dueAt, submitted: row.submitted, now }), href });
        else events.push({ id: `class:${row.id}`, type: 'class', title: row.title, subtitle: `${row.code} online class`, start: row.startsAt, end: new Date(new Date(row.startsAt).getTime() + 3600000).toISOString(), allDay: false, status: 'scheduled', href, url: row.url });
      }
      const repo = repository();
      if (repo?.listOwnExams) {
        try {
          for (const period of await repo.listOwnExams(programme.id, actor)) for (const sitting of period.sittings || []) if (inRange(sitting.startsAt, range))
            events.push({ id: `exam:${sitting.id}`, type: 'exam', title: `${sitting.code} ${sitting.paper}`, subtitle: [sitting.venue, sitting.seat ? `Seat ${sitting.seat}` : ''].filter(Boolean).join(' · '),
              start: sitting.startsAt, end: new Date(new Date(sitting.startsAt).getTime() + (sitting.durationMinutes || 0) * 60000).toISOString(), allDay: false, status: 'scheduled', href: '#study/timetable' });
        } catch { /* Exams stay out of the calendar if the timetable cannot be read. */ }
      }
      const summary = await financialStatus(pool, programme.id, now.toISOString().slice(0, 10));
      for (const entry of summary.entries) if (entry.entryType === 'charge' && entry.dueOn && inRange(`${entry.dueOn}T00:00:00Z`, range))
        events.push({ id: `fee:${entry.id}`, type: 'fee', title: entry.description, subtitle: entry.outstanding > 0 ? `${formatMoney(entry.currency, entry.outstanding)} outstanding` : 'Paid',
          start: `${entry.dueOn}T00:00:00.000Z`, allDay: true, status: entry.outstanding <= 0 ? 'paid' : entry.dueOn < now.toISOString().slice(0, 10) ? 'overdue' : 'due', href: '#office/fees' });
    }
    return events;
  }

  async function teachingEvents(actor, range) {
    const rows = (await pool.query(`select r.id,r.kind,r.title,r.due_at as "dueAt",r.starts_at as "startsAt",r.url,c.code,
        (select count(*)::int from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id join student_programmes sp on sp.id=sr.student_programme_id
           where sr.period_id=r.period_id and ce.course_id=r.course_id and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active')) as enrolled,
        (select count(distinct u.student_id)::int from course_assignment_uploads u where u.resource_id=r.id) as submitted
      from course_resources r join courses c on c.id=r.course_id
      join teaching_allocations a on a.period_id=r.period_id and a.course_id=r.course_id and a.status='active' and a.role=any($4::text[])
      join staff_members st on st.id=a.staff_id and st.account_id=$1 and st.status='active'
      where r.status='published' and r.kind in ('assignment','class') and coalesce(r.due_at,r.starts_at)>=$2 and coalesce(r.due_at,r.starts_at)<$3`, [actor.accountId, range.from, range.to, teachingRoles])).rows;
    return rows.map(row => row.kind === 'assignment'
      ? { id: `teaching-assignment:${row.id}`, type: 'assignment', title: row.title, subtitle: `${row.code} · ${row.submitted} of ${row.enrolled} submitted`, start: row.dueAt, allDay: false, status: 'teaching', href: '#learning', progress: { done: row.submitted, total: row.enrolled } }
      : { id: `teaching-class:${row.id}`, type: 'class', title: row.title, subtitle: `${row.code} online class`, start: row.startsAt, end: new Date(new Date(row.startsAt).getTime() + 3600000).toISOString(), allDay: false, status: 'scheduled', href: '#learning', url: row.url });
  }

  async function applicantEvents(actor, range) {
    const rows = (await pool.query(`select a.id,p.name as "programmeName",i.label as "intakeLabel",i.starts_on as "startsOn",d.offer_expires_at as "expiresAt",d.response
      from applications a join intakes i on i.id=a.intake_id join programmes p on p.id=i.programme_id
      left join lateral (select offer_expires_at,response from application_decisions where application_id=a.id and decision='offer' order by decided_at desc limit 1) d on true
      where a.applicant_account_id=$1 and a.status<>'withdrawn'`, [actor.accountId])).rows;
    const events = [];
    for (const row of rows) {
      if (row.expiresAt && !row.response && inRange(row.expiresAt, range)) events.push({ id: `offer:${row.id}`, type: 'offer', title: `Offer expires: ${row.programmeName}`, subtitle: row.intakeLabel, start: row.expiresAt, allDay: false, status: 'due', href: '#apply' });
      if (row.startsOn && inRange(row.startsOn, range)) events.push({ id: `intake:${row.id}`, type: 'intake', title: `${row.programmeName} starts`, subtitle: row.intakeLabel, start: new Date(row.startsOn).toISOString(), allDay: true, status: 'scheduled', href: '#apply' });
    }
    return events;
  }

  return {
    async listMyCalendar(actor, input = {}) {
      const now = new Date(), range = calendarRange(input, now);
      const parts = [];
      if (actor.permissions.includes('registry.self')) parts.push(studentEvents(actor, range, now));
      if (actor.permissions.includes('teaching.self')) parts.push(teachingEvents(actor, range));
      if (actor.permissions.includes('admissions.apply')) parts.push(applicantEvents(actor, range));
      const repo = repository();
      if (repo?.appointmentCalendarEvents && (actor.permissions.includes('registry.self') || actor.permissions.includes('appointments.host'))) parts.push(repo.appointmentCalendarEvents(actor, range));
      const seen = new Set();
      const events = (await Promise.all(parts)).flat().filter(event => !seen.has(event.id) && seen.add(event.id))
        .sort((a, b) => new Date(a.start) - new Date(b.start) || a.title.localeCompare(b.title));
      return { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10), now: now.toISOString(), events };
    },

    // Private subscription feed. The address carries a random token; only its digest is stored. Opening the feed
    // needs no session, so it carries no amounts or seat numbers and turns off with the account or the person's roles.
    async calendarFeedStatus(actor) {
      const row = (await pool.query('select created_at as "createdAt",last_used_at as "lastUsedAt" from calendar_feeds where account_id=$1', [actor.accountId])).rows[0];
      return row ? { active: true, ...row } : { active: false };
    },
    async createCalendarFeed(actor) {
      const token = randomBytes(32).toString('base64url');
      await withTransaction(pool, async db => {
        await db.query(`insert into calendar_feeds(account_id,token_digest) values($1,$2)
          on conflict (account_id) do update set token_digest=excluded.token_digest,created_at=now(),last_used_at=null`, [actor.accountId, feedDigest(token)]);
        await insertAudit(db, { actorId: actor.accountId, action: 'calendar.feed_created', subjectType: 'Account', subjectId: actor.accountId, reason: 'Calendar subscription address created or reset' });
      });
      return { active: true, token };
    },
    async revokeCalendarFeed(actor) {
      await withTransaction(pool, async db => {
        await db.query('delete from calendar_feeds where account_id=$1', [actor.accountId]);
        await insertAudit(db, { actorId: actor.accountId, action: 'calendar.feed_revoked', subjectType: 'Account', subjectId: actor.accountId, reason: 'Calendar subscription turned off' });
      });
      return { active: false };
    },
    async calendarFeed(token, { origin = '', now = new Date() } = {}) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw requestError(404, 'Calendar not found.');
      const feed = (await pool.query(`select f.account_id as "accountId",f.last_used_at as "lastUsedAt" from calendar_feeds f join accounts a on a.id=f.account_id
        where f.token_digest=$1 and a.status='active'`, [feedDigest(token)])).rows[0];
      if (!feed) throw requestError(404, 'Calendar not found.');
      const permissions = (await pool.query(`select distinct rp.permission_code as code from role_assignments ra join roles r on r.code=ra.role_code and r.active
        join role_permissions rp on rp.role_code=r.code where ra.account_id=$1 and ra.ended_at is null and ra.effective_from<=current_date
        and (ra.effective_to is null or ra.effective_to>=current_date)`, [feed.accountId])).rows.map(row => row.code);
      const actor = { accountId: feed.accountId, permissions };
      const { events } = await this.listMyCalendar(actor, { from: isoDay(new Date(now.getTime() - 14 * day)), to: isoDay(new Date(now.getTime() + 106 * day)) });
      if (!feed.lastUsedAt || now - new Date(feed.lastUsedAt) > 3600000) await pool.query('update calendar_feeds set last_used_at=now() where account_id=$1', [feed.accountId]);
      return buildCalendar({ name: 'SVU calendar', now, events: events.map(event => feedEvent(event, origin)) });
    }
  };
}

const isoDay = (date) => date.toISOString().slice(0, 10);
export const feedDigest = (token) => createHash('sha256').update(token).digest('hex');
// What a feed shows: titles and times only. Fee amounts and exam seats stay in the portal.
export function feedEvent(event, origin = '') {
  const description = { fee: 'A fee is due. Check your statement in the portal.', exam: 'Examination. Check your venue and seat in the portal.', offer: 'Respond to your offer in the portal before it expires.' }[event.type]
    || [event.subtitle, event.status === 'submitted' ? 'Submitted' : ''].filter(Boolean).join(' · ');
  return { id: event.id, title: event.type === 'exam' ? `Exam: ${event.title}` : event.type === 'assignment' ? `Due: ${event.title}` : event.title,
    description, start: event.start, end: event.end, allDay: event.allDay, url: origin && event.href ? `${origin}/${event.href}` : '' };
}
