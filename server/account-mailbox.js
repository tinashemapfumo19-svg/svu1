import { normalizeEmail } from './security.js';
import { validNotificationDestination } from './notification-queue.js';
import { requestError } from './support.js';

export function accountMailbox(raw) {
  if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw)) throw requestError(400, 'Provide one valid email address.');
  const email = normalizeEmail(raw);
  if (!validNotificationDestination(email)) throw requestError(400, 'Provide one valid email address.');
  return email;
}

export async function lockAccountMailbox(db, raw) {
  const email = accountMailbox(raw);
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`account-mailbox:${email}`]);
  return email;
}

export async function requireNewAccountMailbox(db, email) {
  if ((await db.query('select 1 from accounts where lower(btrim(email))=$1 limit 1', [email])).rowCount) throw requestError(409, 'An account already uses this email.');
}
