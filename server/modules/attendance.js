import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { deriveKey } from '../derived-keys.js';
import { courseAccess, courseRoster } from './course-workspace.js';

// Class attendance by QR code (docs/ATTENDANCE.md). The code shown in class changes every 20 seconds; a check-in
// accepts the current or previous code only, so a photo sent to someone at home soon stops working. Students must be
// signed in and enrolled. Nothing about location is collected.
export const codeWindowSeconds = 20;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const attendanceWindow = (now = Date.now()) => Math.floor(now / (codeWindowSeconds * 1000));

export function attendanceCode(key, sessionId, window) {
  const bytes = createHmac('sha256', key).update(`${sessionId}:${window}`).digest();
  return [...bytes.subarray(0, 6)].map((byte) => alphabet[byte % 32]).join('');
}
// True when the code matches this window or the one before it.
export function codeMatches(key, sessionId, code, now = Date.now()) {
  const given = Buffer.from(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (given.length !== 6) return false;
  const current = attendanceWindow(now);
  return [current, current - 1].some((window) => { const expected = Buffer.from(attendanceCode(key, sessionId, window)); return timingSafeEqual(expected, given); });
}
export function attendanceRate(attended, total) { return total ? Math.round((attended / total) * 100) : null; }

export function createAttendanceModule(pool, { dataEncryptionKey } = {}) {
  const key = () => deriveKey(dataEncryptionKey, 'attendance');
  const isOpen = (session, now = new Date()) => !session.closedAt && new Date(session.closesAt) > now;
  const sessionSelect = `select id,period_id as "periodId",course_id as "courseId",title,opened_at as "openedAt",closes_at as "closesAt",closed_at as "closedAt" from attendance_sessions`;
  async function managedSession(db, periodId, courseId, sessionId, actor) {
    const access = await courseAccess(db, periodId, courseId, actor, true);
    if (!access.canManage) throw requestError(404, 'This course is not available to your account.');
    const session = (await db.query(`${sessionSelect} where id=$1 and period_id=$2 and course_id=$3`, [sessionId, periodId, courseId])).rows[0];
    if (!session) throw requestError(404, 'Attendance session was not found.');
    return session;
  }
  async function mark(db, session, studentId, method, actor) {
    const added = await db.query(`insert into attendance_marks(session_id,student_id,method,marked_by) values($1,$2,$3,$4) on conflict do nothing`, [session.id, studentId, method, actor.accountId]);
    return added.rowCount > 0;
  }

  return {
    async courseAttendance(periodId, courseId, actor) {
      return withTransaction(pool, async (db) => {
        const access = await courseAccess(db, periodId, courseId, actor);
        const sessions = (await db.query(`${sessionSelect} where period_id=$1 and course_id=$2 order by opened_at desc limit 60`, [periodId, courseId])).rows;
        if (access.canManage) {
          const counts = new Map((await db.query(`select session_id as id,count(*)::int as n from attendance_marks where session_id=any($1::text[]) group by session_id`, [sessions.map((row) => row.id)])).rows.map((row) => [row.id, row.n]));
          const enrolled = (await courseRoster(db, periodId, courseId)).length;
          return { canManage: true, enrolled, sessions: sessions.map((row) => ({ ...row, open: isOpen(row), present: counts.get(row.id) || 0 })) };
        }
        const mine = new Set((await db.query(`select session_id as id from attendance_marks where student_id=$1 and session_id=any($2::text[])`, [access.studentId, sessions.map((row) => row.id)])).rows.map((row) => row.id));
        const past = sessions.filter((row) => !isOpen(row) || mine.has(row.id));
        return { canManage: false, attended: past.filter((row) => mine.has(row.id)).length, total: past.length, rate: attendanceRate(past.filter((row) => mine.has(row.id)).length, past.length),
          openSession: sessions.find((row) => isOpen(row) && !mine.has(row.id)) ? { title: sessions.find((row) => isOpen(row) && !mine.has(row.id)).title } : null,
          sessions: sessions.slice(0, 20).map((row) => ({ id: row.id, title: row.title, openedAt: row.openedAt, present: mine.has(row.id), open: isOpen(row) })) };
      });
    },

    async openAttendance(periodId, courseId, input, actor) {
      const minutes = input?.minutes === undefined ? 15 : input.minutes;
      const title = typeof input?.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 160) : `Class on ${new Date().toISOString().slice(0, 10)}`;
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) throw requestError(400, 'Keep attendance open for 5 to 180 minutes.');
      return withTransaction(pool, async (db) => {
        const access = await courseAccess(db, periodId, courseId, actor, true);
        if (!access.canManage) throw requestError(404, 'This course is not available to your account.');
        await db.query('select pg_advisory_xact_lock(hashtext($1))', [`attendance:${periodId}:${courseId}`]);
        const open = (await db.query(`${sessionSelect} where period_id=$1 and course_id=$2 and closed_at is null and closes_at>now()`, [periodId, courseId])).rows[0];
        if (open) throw requestError(409, 'Attendance is already open for this course. Close it before starting another.');
        const id = `att_${randomUUID()}`;
        await db.query(`insert into attendance_sessions(id,period_id,course_id,title,opened_by,closes_at) values($1,$2,$3,$4,$5,now()+make_interval(mins=>$6))`, [id, periodId, courseId, title, actor.accountId, minutes]);
        await insertAudit(db, { actorId: actor.accountId, action: 'attendance.opened', subjectType: 'AttendanceSession', subjectId: id, reason: 'Attendance opened', metadata: { periodId, courseId, minutes } });
        return { id, title };
      });
    },

    // The lecturer's projector view: the current code, its QR and who has checked in. Polled every few seconds.
    async attendanceLive(periodId, courseId, sessionId, actor, { origin = '' } = {}) {
      return withTransaction(pool, async (db) => {
        const session = await managedSession(db, periodId, courseId, sessionId, actor);
        const roster = await courseRoster(db, periodId, courseId);
        const marks = new Map((await db.query(`select student_id as "studentId",method,marked_at as "markedAt" from attendance_marks where session_id=$1`, [sessionId])).rows.map((row) => [row.studentId, row]));
        const open = isOpen(session), now = Date.now(), window = attendanceWindow(now);
        const code = open ? attendanceCode(key(), sessionId, window) : null;
        const url = open ? `${origin}/#attend/${sessionId}~${code}` : null;
        return { ...session, open, enrolled: roster.length, present: marks.size, code, url,
          qrSvg: url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null,
          refreshInSeconds: codeWindowSeconds - Math.floor((now / 1000) % codeWindowSeconds),
          students: roster.map((row) => ({ studentId: row.studentId, studentNumber: row.studentNumber, studentName: row.studentName, present: marks.has(row.studentId), method: marks.get(row.studentId)?.method || null })) };
      });
    },

    async closeAttendance(periodId, courseId, sessionId, actor) {
      return withTransaction(pool, async (db) => {
        const session = await managedSession(db, periodId, courseId, sessionId, actor);
        if (session.closedAt) return { id: sessionId, closed: true };
        await db.query('update attendance_sessions set closed_at=now() where id=$1', [sessionId]);
        await insertAudit(db, { actorId: actor.accountId, action: 'attendance.closed', subjectType: 'AttendanceSession', subjectId: sessionId, reason: 'Attendance closed' });
        return { id: sessionId, closed: true };
      });
    },

    // A lecturer marks a student present by hand (for example, no phone). Allowed after closing, too.
    async markAttendance(periodId, courseId, sessionId, input, actor) {
      return withTransaction(pool, async (db) => {
        const session = await managedSession(db, periodId, courseId, sessionId, actor);
        const student = (await courseRoster(db, periodId, courseId)).find((row) => row.studentId === input?.studentId);
        if (!student) throw requestError(404, 'That student is not enrolled in this course.');
        const added = await mark(db, session, student.studentId, 'manual', actor);
        if (added) await insertAudit(db, { actorId: actor.accountId, action: 'attendance.marked_manually', subjectType: 'AttendanceSession', subjectId: sessionId, reason: 'Student marked present by the lecturer', metadata: { studentId: student.studentId } });
        return { studentId: student.studentId, present: true };
      });
    },

    // Student check-in, from the scanned link (session~code) or a typed code.
    async checkInAttendance(input, actor) {
      const raw = typeof input?.token === 'string' ? input.token : typeof input?.code === 'string' ? input.code : '';
      const [sessionPart, codePart] = raw.includes('~') ? raw.split('~') : [null, raw];
      if (!/^[A-Za-z0-9 -]{4,12}$/.test(codePart || '') || (sessionPart !== null && !/^att_[0-9a-f-]{36}$/.test(sessionPart))) throw requestError(400, 'Enter the 6-character code shown in class.');
      return withTransaction(pool, async (db) => {
        // Open sessions for courses this student is enrolled in; a typed code is matched against each.
        const sessions = (await db.query(`${sessionSelect} s where closed_at is null and closes_at>now() and ($1::text is null or id=$1) and exists (
            select 1 from course_enrolments ce join student_registrations sr on sr.id=ce.registration_id join students st on st.id=ce.student_id
            join student_programmes sp on sp.id=sr.student_programme_id where sr.period_id=s.period_id and ce.course_id=s.course_id and st.account_id=$2
            and sr.status='confirmed' and ce.withdrawn_at is null and sp.status in ('onboarded','active'))`, [sessionPart, actor.accountId])).rows;
        const session = sessions.find((row) => codeMatches(key(), row.id, codePart));
        if (!session && sessionPart && !sessions.length && (await db.query('select 1 from attendance_sessions where id=$1 and closed_at is null and closes_at>now()', [sessionPart])).rowCount)
          throw requestError(403, 'You are not enrolled in this course, so you cannot check in to its class.');
        if (!session) throw requestError(409, sessionPart ? 'This code has changed or attendance has closed. Scan the code on the screen again.' : 'That code does not match an open attendance session for your courses. Check the code on the screen; it changes every 20 seconds.');
        const access = await courseAccess(db, session.periodId, session.courseId, actor);
        const added = await mark(db, session, access.studentId, sessionPart ? 'qr' : 'code', actor);
        return { sessionId: session.id, title: session.title, course: access.offering, alreadyMarked: !added, markedAt: new Date().toISOString() };
      });
    }
  };
}
