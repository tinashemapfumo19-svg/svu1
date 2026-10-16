create table course_assignment_reviews (
  id text primary key,
  upload_id text not null references course_assignment_uploads(id),
  revision integer not null check (revision > 0),
  mark numeric(12,2),
  max_mark numeric(12,2) not null check (max_mark > 0),
  feedback text not null,
  file jsonb,
  released boolean not null,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  reason text not null,
  check (mark is null or (mark >= 0 and mark <= max_mark)),
  unique(upload_id,revision)
);
create index course_assignment_reviews_release on course_assignment_reviews(upload_id,released,revision desc);

insert into notification_templates (id,code,channel,subject,body,version,status) values
('nt_course_resource_email_v1','course.resource','email','New course resource: {{courseCode}}',
 'A new {{kind}} is available for {{courseCode}}: {{title}}. Sign in to your course workspace to view it.',1,'active'),
('nt_course_feedback_email_v1','course.feedback','email','Coursework feedback is available: {{courseCode}}',
 'Your coursework feedback for {{courseCode}} is available. Sign in to view your private marks, feedback and returned files.',1,'active')
on conflict do nothing;
