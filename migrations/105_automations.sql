-- Scheduled reminders and digests (docs/AUTOMATIONS.md). Each automated message is recorded once per job, subject
-- and recipient, so repeated sweeps never send the same reminder twice.
create table automation_sends (
  job text not null check (job ~ '^[a-z0-9_]{3,40}$'),
  subject_key text not null check (length(subject_key) between 1 and 200),
  recipient_account_id text not null references accounts(id),
  notification_id text,
  sent_at timestamptz not null default now(),
  primary key (job, subject_key, recipient_account_id)
);
create index automation_sends_recent on automation_sends(sent_at desc);

create table automation_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (trigger in ('schedule','manual')),
  actor_id text references accounts(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  results jsonb not null default '{}'::jsonb,
  failed boolean not null default false,
  check (trigger = 'schedule' or actor_id is not null)
);
create index automation_runs_recent on automation_runs(started_at desc);

insert into notification_templates (id,code,channel,subject,body,version,status) values
('nt_course_deadline_reminder_v1','course.deadline_reminder','email','Assignment due {{when}}: {{courseCode}}',
 'Your assignment "{{title}}" for {{courseCode}} is due {{dueAt}} (UTC). You have not submitted it yet. Submit it from the course page in Study.',1,'active'),
('nt_course_submission_receipt_v1','course.submission_receipt','email','Submission received: {{courseCode}}',
 'We received your submission for "{{title}}" ({{courseCode}}), attempt {{attempt}}, at {{submittedAt}} (UTC). File: {{fileName}}. Receipt: {{receipt}}. Keep this message as proof of submission.',1,'active'),
('nt_course_missing_work_v1','course.missing_work','email','Missing submissions: {{courseCode}}',
 '{{missingCount}} of {{enrolledCount}} students have not submitted "{{title}}" for {{courseCode}}, which was due {{dueAt}} (UTC). Open the course to see who, and send them a reminder.',1,'active'),
('nt_course_missing_reminder_v1','course.missing_reminder','email','Reminder from your lecturer: {{courseCode}}',
 'Your lecturer has reminded you that "{{title}}" for {{courseCode}} has not been submitted. {{lateNote}}',1,'active'),
('nt_admissions_offer_expiry_v1','admissions.offer_expiry_reminder','email','Your offer expires {{when}}',
 'Your offer for {{programmeName}} ({{intakeLabel}}) expires on {{expiresOn}} (UTC). Accept or decline it in the applicant portal before then.',1,'active'),
('nt_registration_ready_v1','registration.ready','email','You can now confirm your registration',
 'Your course selection for {{periodName}} now meets the registration checks. Confirm your registration in Student Office.',1,'active'),
('nt_finance_due_reminder_v1','finance.due_reminder','email','Payment due {{dueOn}}',
 'Student {{studentNumber}}: {{amount}} is due on {{dueOn}}. Your statement is in Student Office under Fees & Payments.',1,'active'),
('nt_finance_hold_notice_v1','finance.hold_notice','email','A financial hold is on your account',
 'Student {{studentNumber}}: a financial hold is on your account because {{amount}} is overdue. Registration actions may be blocked until it is paid or a payment plan is approved. See Fees & Payments in Student Office.',1,'active'),
('nt_support_waiting_reminder_v1','support.waiting_reminder','email','Your support case is waiting for your reply',
 'Student support is waiting for your reply on a {{category}} case opened on {{openedOn}}. Open Requests in Student Office to reply.',1,'active'),
('nt_support_unanswered_v1','support.unanswered','email','Support case without an update for {{days}} days',
 'A {{priority}}-priority {{category}} support case assigned to you has had no update for {{days}} days. Open Support in the staff workspace.',1,'active'),
('nt_staff_weekly_digest_v1','staff.weekly_digest','email','Your week: {{headline}}',
 '{{lines}} Open your staff home to start.',1,'active')
on conflict do nothing;
