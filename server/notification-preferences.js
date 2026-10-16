import { insertAudit, requestError, withTransaction } from './support.js';

// Message groups a person may mute (docs/NOTIFICATION_PREFERENCES.md, D-40). Anything not listed here is essential
// and always sent: receipts, holds, offers, results, examination notices, security and account messages.
export const notificationGroups = {
  deadline_reminders: { label: 'Assignment deadline reminders', detail: 'Reminders 48 and 24 hours before a deadline, and lecturer nudges about missing work.', templates: ['course.deadline_reminder', 'course.missing_reminder'], who: ['registry.self'] },
  course_updates: { label: 'New course material', detail: 'A message each time a lecturer publishes material, a class or an assignment, or a course evaluation opens.', templates: ['course.resource', 'course.evaluation_open'], who: ['registry.self'] },
  fee_reminders: { label: 'Fee due-date reminders', detail: 'A reminder a week before a charge is due. Financial hold notices are always sent.', templates: ['finance.due_reminder'], who: ['registry.self'] },
  support_reminders: { label: 'Support case reminders', detail: 'A reminder when a support case has been waiting for your reply for a few days.', templates: ['support.waiting_reminder'], who: ['registry.self'] },
  weekly_digest: { label: 'Monday summary', detail: 'A weekly summary of unmarked work, applications, support cases and tasks.', templates: ['staff.weekly_digest'], who: ['teaching.self', 'admissions.review', 'support.view', 'support.manage', 'task.assign'] },
  teaching_alerts: { label: 'Teaching and support alerts', detail: 'Alerts about students with missing work after a deadline, and support cases without a staff update.', templates: ['course.missing_work', 'support.unanswered'], who: ['teaching.self', 'support.view', 'support.manage'] }
};
const groupOf = new Map(Object.entries(notificationGroups).flatMap(([group, info]) => info.templates.map((code) => [code, group])));
export const notificationGroupFor = (templateCode) => groupOf.get(templateCode) || null;

// Called by the queue before creating a message. True when the recipient muted this message's group.
export async function isMuted(db, accountId, templateCode) {
  const group = notificationGroupFor(templateCode);
  if (!group || !accountId) return false;
  return (await db.query('select 1 from notification_preferences where account_id=$1 and $2=any(muted)', [accountId, group])).rowCount > 0;
}

// A group is offered only to people who can receive its messages.
const relevant = (info, permissions) => info.who.some((code) => permissions.includes(code));

export function createNotificationPreferencesModule(pool) {
  return {
    async getNotificationPreferences(actor) {
      const muted = (await pool.query('select muted from notification_preferences where account_id=$1', [actor.accountId])).rows[0]?.muted || [];
      return { groups: Object.entries(notificationGroups).filter(([, info]) => relevant(info, actor.permissions)).map(([id, info]) => ({ id, label: info.label, detail: info.detail, enabled: !muted.includes(id) })) };
    },
    async saveNotificationPreferences(input, actor) {
      if (!input || typeof input.groups !== 'object' || Array.isArray(input.groups) || Object.entries(input.groups).some(([id, on]) => !notificationGroups[id] || typeof on !== 'boolean'))
        throw requestError(400, 'Send each message group with true (on) or false (muted).');
      await withTransaction(pool, async (db) => {
        const current = (await db.query('select muted from notification_preferences where account_id=$1 for update', [actor.accountId])).rows[0]?.muted || [];
        const muted = new Set(current);
        for (const [id, on] of Object.entries(input.groups)) on ? muted.delete(id) : muted.add(id);
        await db.query(`insert into notification_preferences(account_id,muted,updated_at) values($1,$2,now())
          on conflict (account_id) do update set muted=excluded.muted,updated_at=now()`, [actor.accountId, [...muted].sort()]);
        await insertAudit(db, { actorId: actor.accountId, action: 'notification.preferences_changed', subjectType: 'Account', subjectId: actor.accountId, reason: 'Notification preferences updated', metadata: { muted: [...muted].sort() } });
      });
      return this.getNotificationPreferences(actor);
    }
  };
}
