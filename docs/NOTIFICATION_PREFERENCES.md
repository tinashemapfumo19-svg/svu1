# Notification Preferences and Links

## Links in messages

Every non-secret notification can carry an in-app `link` (a `#route`), validated by `notificationLinkPattern` in
`server/notification-queue.js`. The Inbox shows an **Open** link; Home and Study / Today "Recent updates" rows go straight
to it; push notifications open it. `GET /api/notifications/me` includes `link` only when a message has one, so older
messages keep the same fields. Links are set for reminders, course notices, receipts, offers, applications, results,
awards, examination notices, fee notices, appointment messages and password-change notices.

## Muting

Settings → **Notifications** lists the groups a person can mute (`server/notification-preferences.js`,
migration `109_notification_preferences.sql`). A muted group is **not queued at all** (`queueNotification` returns null),
so it reaches neither the Inbox, email, push nor SMS.

| Group | Messages | Offered to |
| --- | --- | --- |
| Assignment deadline reminders | `course.deadline_reminder`, `course.missing_reminder` | Students |
| New course material | `course.resource`, `course.evaluation_open` | Students |
| Fee due-date reminders | `finance.due_reminder` | Students |
| Support case reminders | `support.waiting_reminder` | Students |
| Monday summary | `staff.weekly_digest` | Teaching, admissions, support and task staff |
| Teaching and support alerts | `course.missing_work`, `support.unanswered` | Teaching and support staff |

Everything else is essential and always sent: submission receipts, financial holds, offers, results, examination
notices, appointment confirmations and cancellations, security and account messages.

`GET/PUT /api/me/notification-preferences` (`{ groups: { id: true|false } }`); changes are audited.

## Outstanding

- D-40 still decides the final list of mutable groups, timings and channels.
