import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestError } from "./support.js";
import { isMuted } from "./notification-preferences.js";
import { encryptSecret, decryptSecret, normalizeEmail } from './security.js';

// Messages carrying secrets are stored redacted, because staff with notification.send can read the
// queue. Their immutable encrypted snapshot commits with the business transaction. Provider delivery
// is still separate work; the development mail catcher is not a delivery acknowledgement.
export const notificationLinkPattern = /^#[A-Za-z0-9_/?=&.%-]{1,200}$/;

// The student's course page, where the assignment is.
export const courseLink = (periodId, courseId) => `#study/courses/${encodeURIComponent(periodId)}/${encodeURIComponent(courseId)}`;

export async function queueNotification(db, accountId, templateCode, variables, { sensitive = false, devOutboxDir = null, recipientEmail = null, activeOnly = false, dataEncryptionKey, link = null } = {}) {
  // Optional in-app route the message is about (for example #office/fees), shown as an Open button in the Inbox.
  if (link !== null && (typeof link !== 'string' || !notificationLinkPattern.test(link))) throw requestError(500, 'Notification link must be an in-app route.');
  // A muted, non-essential message group is not sent at all (docs/NOTIFICATION_PREFERENCES.md).
  if (!sensitive && await isMuted(db, accountId, templateCode)) return null;
  if (sensitive && (!Buffer.isBuffer(dataEncryptionKey) || dataEncryptionKey.length !== 32)) throw requestError(500, 'Sensitive notification requires a configured encryption key.');
  const template = await db.query(
    `select id, subject, body from notification_templates
     where code = $1 and channel = 'email' and (not $2::boolean or status = 'active')
     order by version desc limit 1`,
    [templateCode, activeOnly]
  );
  if (template.rowCount === 0) {
    if (activeOnly) throw requestError(500, `Notification template ${templateCode} has no active email version.`);
    throw requestError(500, `Notification template ${templateCode} is not loaded; run npm run reference:load.`);
  }
  const { id: templateId } = template.rows[0];
  const render = (text) => Object.entries(variables).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)), text);
  const subject = render(template.rows[0].subject);
  const rendered = render(template.rows[0].body);
  const notificationId = `not_${randomUUID()}`;
  let content;
  if (sensitive) {
    const destination = recipientEmail || canonicalNotificationDestination((await db.query('select email from accounts where id = $1', [accountId])).rows[0]?.email);
    if (!validDestination(destination)) throw requestError(409, 'Sensitive notification requires a valid delivery address.');
    content = { notificationId, accountId, recipientEmail: destination, templateCode, subject, body: rendered };
  }
  const storedBody = sensitive ? "[redacted: contains a one-time secret; delivered to the recipient only]" : rendered;
  await db.query(
    `insert into notifications (id, recipient_account_id, channel, template_id, payload, status)
     values ($1, $2, 'email', $3, $4, 'queued')`,
    [notificationId, accountId, templateId, { subject: sensitive ? '[restricted notification]' : subject, body: storedBody, sensitive, ...(!sensitive && recipientEmail ? { recipientEmail } : {}), ...(link && !sensitive ? { link } : {}) }]
  );
  if (content) await db.query('insert into notification_delivery_content (notification_id,envelope) values ($1,$2)', [notificationId, encryptSecret(JSON.stringify(content), dataEncryptionKey)]);
  if (sensitive && devOutboxDir) {
    await mkdir(devOutboxDir, { recursive: true });
    await writeFile(
      join(devOutboxDir, `${notificationId}.json`),
      JSON.stringify({ ...content, variables, queuedAt: new Date().toISOString() }, null, 2)
    );
  }
  return notificationId;
}

export const validNotificationDestination = value => {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(domain);
};
const validDestination = validNotificationDestination;

export function canonicalNotificationDestination(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const canonical = normalizeEmail(value);
  return validDestination(canonical) ? canonical : null;
}

// Internal worker helper, deliberately not exposed by repository/router notification APIs.
export async function readNotificationDeliveryContent(db, notificationId, dataEncryptionKey) {
  const row = (await db.query('select envelope from notification_delivery_content where notification_id = $1', [notificationId])).rows[0];
  if (!row) return null; // Older redacted messages cannot be reconstructed from public queue data.
  try {
    const content = JSON.parse(decryptSecret(row.envelope, dataEncryptionKey));
    if (content.notificationId !== notificationId || !validDestination(content.recipientEmail) || typeof content.subject !== 'string' || typeof content.body !== 'string' || typeof content.templateCode !== 'string') throw new Error('Invalid snapshot');
    return content;
  } catch { throw requestError(409, 'Notification delivery content requires secure reconciliation.'); }
}
