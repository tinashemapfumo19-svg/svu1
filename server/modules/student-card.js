import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveKey } from '../derived-keys.js';
import QRCode from 'qrcode';
import { requestError } from '../support.js';

// Digital student ID card (docs/STUDENT_CARD.md). The card's QR code carries a short-lived signed token, so a scan
// proves the student is current at that moment; a screenshot stops verifying when the token expires. Nothing is
// stored: the token holds the programme id and an expiry, signed with a key derived from SVU_DATA_KEY.
export const cardTokenMinutes = 15;
const currentStatuses = ['onboarded', 'active'];
const b64 = (value) => Buffer.from(value).toString('base64url');

export const cardKey = (dataEncryptionKey) => deriveKey(dataEncryptionKey, 'student-card');

export function signCardToken(programmeId, key, now = Date.now()) {
  const payload = b64(JSON.stringify({ p: programmeId, e: Math.floor(now / 1000) + cardTokenMinutes * 60 }));
  return `card-${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

// Returns { programmeId, expiresAt } for a genuine token, or throws 404 (unknown) / 410 (expired).
export function readCardToken(token, key, now = Date.now()) {
  const match = typeof token === 'string' && token.match(/^card-([A-Za-z0-9_-]{10,200})\.([A-Za-z0-9_-]{43})$/);
  if (!match) throw requestError(404, 'This is not a South Valley University card code.');
  const expected = createHmac('sha256', key).update(match[1]).digest();
  const given = Buffer.from(match[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw requestError(404, 'This is not a South Valley University card code.');
  let body;
  try { body = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { throw requestError(404, 'This is not a South Valley University card code.'); }
  if (typeof body?.p !== 'string' || !Number.isInteger(body?.e)) throw requestError(404, 'This is not a South Valley University card code.');
  if (body.e * 1000 < now) throw requestError(410, 'This card code has expired. Ask the student to open their card again; the code refreshes every few minutes.');
  return { programmeId: body.p, expiresAt: new Date(body.e * 1000).toISOString() };
}

export function createStudentCardModule(pool, { repository = () => null, dataEncryptionKey } = {}) {
  const key = () => cardKey(dataEncryptionKey);
  return {
    async getMyCard(actor, { origin = '' } = {}) {
      const own = await repository().getOwnStudent(actor);
      const programme = own.programmes.find(row => row.status === 'active') || own.programmes.find(row => currentStatuses.includes(row.status));
      if (!programme) throw requestError(409, 'A student card is available while you are a current student.');
      const token = signCardToken(programme.id, key());
      const verifyUrl = `${origin}/#verify/${token}`;
      return { legalName: programme.legalName, preferredName: own.profile?.preferredName || null, studentNumber: programme.studentNumber, programmeName: programme.programmeName,
        programmeCode: programme.programmeCode, faculty: programme.faculty || null, intakeLabel: programme.intakeLabel, status: programme.status,
        expiresAt: readCardToken(token, key()).expiresAt, refreshSeconds: (cardTokenMinutes - 5) * 60, verifyUrl,
        qrSvg: await QRCode.toString(verifyUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
    },
    // Public: what a scan shows. Only what the card itself already shows, plus whether the student is current now.
    async verifyStudentCard(token) {
      const { programmeId, expiresAt } = readCardToken(token, key());
      const row = (await pool.query(`select sp.status,s.student_number as "studentNumber",pe.legal_name as "legalName",p.code as "programmeCode",p.name as "programmeName",i.label as "intakeLabel"
        from student_programmes sp join students s on s.id=sp.student_id join people pe on pe.id=s.person_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id
        where sp.id=$1`, [programmeId])).rows[0];
      if (!row) throw requestError(404, 'This is not a South Valley University card code.');
      return { kind: 'student_card', current: currentStatuses.includes(row.status), legalName: row.legalName, studentNumber: row.studentNumber,
        programme: { code: row.programmeCode, name: row.programmeName }, intakeLabel: row.intakeLabel, checkedAt: new Date().toISOString(), codeExpiresAt: expiresAt };
    }
  };
}
