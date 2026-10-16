import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { normaliseVerificationCode, transcriptHash, verificationCode } from './transcripts.js';

// Self-service letters (docs/STUDENT_LETTERS.md). A student issues a confirmation of enrolment or a proof of
// registration from their own official record. Each letter is an immutable snapshot with a content hash and a public
// verification code, checked on the same Verify page as transcripts. Letters state the record on their issue date.
export const letterKinds = { enrolment: 'Confirmation of enrolment', registration: 'Proof of registration' };
export const dailyLetterLimit = 10;
const current = ['onboarded', 'active'];

export function buildLetter({ kind, programme, registration = null, asOf }) {
  const student = { legalName: programme.legalName, studentNumber: programme.studentNumber };
  const base = { kind, title: letterKinds[kind], institution: 'South Valley University', asOf, student,
    programme: { code: programme.programmeCode, name: programme.programmeName, faculty: programme.faculty || null, department: programme.department || null }, intake: programme.intakeLabel };
  if (kind === 'enrolment') return { ...base,
    statement: `This is to confirm that ${student.legalName}, student number ${student.studentNumber}, is a registered student of South Valley University on the ${programme.programmeName} programme (${programme.intakeLabel} intake), as of ${asOf}.` };
  const courses = (registration.courses || []).map(({ code, title, credits }) => ({ code, title, credits: Number(credits) || 0 }));
  return { ...base, period: { name: registration.periodName, startsOn: registration.startsOn || null, endsOn: registration.endsOn || null },
    courses, totalCredits: courses.reduce((sum, row) => sum + row.credits, 0), reference: registration.referenceNumber || null,
    statement: `This is to confirm that ${student.legalName}, student number ${student.studentNumber}, is registered for ${registration.periodName} on the ${programme.programmeName} programme for the courses listed below, as of ${asOf}.` };
}

export function createStudentLettersModule(pool, { repository = () => null } = {}) {
  async function ownProgramme(programmeId, actor) {
    const own = await repository().getOwnStudent(actor);
    const programme = own.programmes.find(row => row.id === programmeId);
    if (!programme) throw requestError(404, 'Student programme was not found.');
    return programme;
  }
  async function confirmedRegistrations(programmeId, actor) {
    const list = await repository().listProgrammeRegistrations(programmeId, actor, true);
    return (Array.isArray(list) ? list : list.items || []).filter(entry => entry.registration?.status === 'confirmed').map(entry => ({
      periodId: entry.period.id, periodName: entry.period.name, startsOn: entry.period.startsOn, endsOn: entry.period.endsOn,
      referenceNumber: entry.registration.referenceNumber || entry.registration.confirmation?.referenceNumber || null,
      courses: entry.registration.confirmation?.courses || [] }));
  }
  const select = `select l.id,l.kind,l.period_id as "periodId",l.content,l.content_hash as "contentHash",l.verification_code as "verificationCode",
    l.status,l.issued_at as "issuedAt",l.revoked_at as "revokedAt",l.student_programme_id as "programmeId" from student_letters l`;

  return {
    async listMyLetters(programmeId, actor) {
      const programme = await ownProgramme(programmeId, actor);
      const rows = (await pool.query(`${select} where l.student_programme_id=$1 order by l.issued_at desc limit 50`, [programmeId])).rows;
      return {
        letters: rows.map(({ content, ...row }) => ({ ...row, title: content.title, periodName: content.period?.name || null })),
        available: { enrolment: current.includes(programme.status), registrations: current.includes(programme.status) ? (await confirmedRegistrations(programmeId, actor)).map(({ periodId, periodName }) => ({ periodId, periodName })) : [] },
        dailyLimit: dailyLetterLimit
      };
    },

    async issueMyLetter(programmeId, input, actor) {
      if (!input || !letterKinds[input.kind] || (input.kind === 'registration' && (typeof input.periodId !== 'string' || !input.periodId))) throw requestError(400, 'Choose a letter type, and a semester for proof of registration.');
      const programme = await ownProgramme(programmeId, actor);
      if (!current.includes(programme.status)) throw requestError(409, 'Letters are available while you are a current student. Contact the registry for other letters.');
      let registration = null;
      if (input.kind === 'registration') {
        registration = (await confirmedRegistrations(programmeId, actor)).find(row => row.periodId === input.periodId);
        if (!registration) throw requestError(409, 'Proof of registration needs a confirmed registration for that semester.');
      }
      const content = buildLetter({ kind: input.kind, programme, registration, asOf: new Date().toISOString().slice(0, 10) });
      return withTransaction(pool, async db => {
        await db.query('select pg_advisory_xact_lock(hashtext($1))', [`letters:${programmeId}`]);
        const today = (await db.query(`select count(*)::int as n from student_letters where student_programme_id=$1 and issued_at>now()-interval '1 day'`, [programmeId])).rows[0].n;
        if (today >= dailyLetterLimit) throw requestError(429, `You can issue up to ${dailyLetterLimit} letters a day. Earlier letters remain valid.`);
        const id = `ltr_${randomUUID()}`, code = verificationCode();
        await db.query(`insert into student_letters(id,student_programme_id,kind,period_id,content,content_hash,verification_code,issued_by) values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, programmeId, input.kind, registration?.periodId || null, content, transcriptHash(content), code, actor.accountId]);
        await insertAudit(db, { actorId: actor.accountId, action: 'registry.letter_issued', subjectType: 'StudentProgramme', subjectId: programmeId, reason: `${letterKinds[input.kind]} issued by the student`, metadata: { letterId: id, kind: input.kind } });
        return { id, kind: input.kind, title: content.title, verificationCode: code, status: 'issued' };
      });
    },

    // One letter with a QR code pointing at its verification page.
    async getMyLetter(letterId, actor, { origin = '' } = {}) {
      const row = (await pool.query(`${select} where l.id=$1`, [letterId])).rows[0];
      if (!row) throw requestError(404, 'Letter was not found.');
      await ownProgramme(row.programmeId, actor);
      const verifyUrl = `${origin}/#verify/${row.verificationCode}`;
      return { ...row, verifyUrl, qrSvg: await QRCode.toString(verifyUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
    },

    async revokeLetter(letterId, input, actor) {
      if (!actor.permissions.includes('registry.transcript.issue')) throw requestError(403, 'Permission required: registry.transcript.issue');
      const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
      if (reason.length < 3 || reason.length > 500) throw requestError(400, 'Give a reason for revoking the letter.');
      return withTransaction(pool, async db => {
        const row = (await db.query('select id,student_programme_id as "programmeId",status from student_letters where id=$1 for update', [letterId])).rows[0];
        if (!row) throw requestError(404, 'Letter was not found.');
        if (row.status !== 'issued') throw requestError(409, 'This letter is already revoked.');
        await db.query(`update student_letters set status='revoked',revoked_by=$2,revoked_at=now(),revoke_reason=$3 where id=$1`, [letterId, actor.accountId, reason]);
        await insertAudit(db, { actorId: actor.accountId, action: 'registry.letter_revoked', subjectType: 'StudentProgramme', subjectId: row.programmeId, reason, metadata: { letterId } });
        return { id: letterId, status: 'revoked' };
      });
    },

    // Public verification, in the same shape the Verify page uses for transcripts.
    async verifyLetter(code) {
      const normal = normaliseVerificationCode(code);
      const row = normal && (await pool.query(`${select} where l.verification_code=$1`, [normal])).rows[0];
      if (!row) throw requestError(404, 'No document matches this verification code.');
      const { content } = row;
      return { verificationCode: row.verificationCode, status: row.status, kind: 'letter', letterKind: row.kind, title: content.title, issuedAt: row.issuedAt, revokedAt: row.revokedAt, supersededAt: null,
        student: content.student, programme: { code: content.programme.code, name: content.programme.name }, summary: null, award: null, terms: [],
        letter: { asOf: content.asOf, intake: content.intake, period: content.period?.name || null, courses: (content.courses || []).map(({ code: courseCode, title }) => ({ code: courseCode, title })) },
        contentHash: row.contentHash, referenceNumber: content.reference || null, templateVersion: null };
    }
  };
}
