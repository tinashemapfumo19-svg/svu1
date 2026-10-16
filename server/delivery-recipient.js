import { canonicalNotificationDestination, validNotificationDestination } from './notification-queue.js';

export async function deliveryRecipientMatches(db, accountId, account, destination) {
  if (account?.status !== 'active' || !validNotificationDestination(destination)) return false;
  const canonical = canonicalNotificationDestination(destination);
  if (!canonical || canonicalNotificationDestination(account.email) !== canonical) return false;
  const matches = (await db.query('select id from accounts where lower(btrim(email))=$1 limit 2', [canonical])).rows;
  return matches.length === 1 && matches[0].id === accountId;
}
