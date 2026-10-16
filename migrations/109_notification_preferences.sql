-- Notification preferences (docs/NOTIFICATION_PREFERENCES.md, D-40): a person may mute non-essential message groups.
-- Essential messages (receipts, holds, offers, results, security) cannot be muted; the server holds that list.
create table notification_preferences (
  account_id text primary key references accounts(id) on delete cascade,
  muted text[] not null default '{}' check (muted <@ array['deadline_reminders','course_updates','fee_reminders','support_reminders','weekly_digest','teaching_alerts']::text[]),
  updated_at timestamptz not null default now()
);
