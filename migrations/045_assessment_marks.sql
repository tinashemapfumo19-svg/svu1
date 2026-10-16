-- Stage 7 assessment configuration and mark entry (EXM-01, EXM-02, EXM-06, EXM-08 to EXM-10, EXM-13). Each course offering gets
-- an independently approved, versioned plan of weighted components. Lecturers holding an in-force allocation (or examinations
-- staff) enter component marks with explicit absent/deferred/exempt states; a complete set is submitted, independently reviewed,
-- and its calculated final marks become a source for the period's official results assembly.
create table assessment_plans (
  id text primary key,
  period_id text not null,
  course_id text not null,
  version integer not null check (version > 0),
  components jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  reason text not null,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  approved_by text references accounts(id),
  approved_at timestamptz,
  approval_reason text,
  foreign key (period_id, course_id) references registration_offerings(period_id, course_id),
  unique (period_id, course_id, version),
  check (approved_by is null or approved_by <> created_by)
);
create unique index assessment_one_approved_plan on assessment_plans(period_id,course_id) where status = 'approved';

create table assessment_marks (
  plan_id text not null references assessment_plans(id),
  registration_id text not null references student_registrations(id),
  component_code text not null,
  state text not null check (state in ('mark','absent','deferred','exempt')),
  mark integer,
  reason text,
  revision integer not null default 1,
  entered_by text not null references accounts(id),
  entered_at timestamptz not null default now(),
  primary key (plan_id, registration_id, component_code),
  check ((state = 'mark') = (mark is not null)),
  check (state = 'mark' or reason is not null)
);
create table assessment_mark_history (
  id bigint generated always as identity primary key,
  plan_id text not null,
  registration_id text not null,
  component_code text not null,
  state text not null,
  mark integer,
  reason text,
  revision integer not null,
  entered_by text not null,
  entered_at timestamptz not null default now()
);
create trigger assessment_mark_history_append_only before update or delete on assessment_mark_history for each row execute function ledger_append_only();

create table assessment_submissions (
  id bigint generated always as identity primary key,
  plan_id text not null references assessment_plans(id),
  status text not null default 'submitted' check (status in ('submitted','returned','approved','transferred')),
  marks_hash text not null,
  finals jsonb not null,
  submitted_by text not null references accounts(id),
  submitted_at timestamptz not null default now(),
  submit_reason text not null,
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  result_batch_id text references result_batches(id),
  check (reviewed_by is null or reviewed_by <> submitted_by),
  check ((status = 'transferred') = (result_batch_id is not null))
);
create unique index assessment_one_live_submission on assessment_submissions(plan_id) where status in ('submitted','approved','transferred');

insert into permissions (code,description) values
('assessment.plan.manage','Draft scoped assessment plans'),
('assessment.plan.approve','Independently approve scoped assessment plans'),
('assessment.marks','Enter and submit scoped assessment marks as examinations staff'),
('assessment.review','Independently review submitted scoped assessment marks') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','assessment.plan.manage'),('system_administrator','assessment.plan.approve'),('system_administrator','assessment.marks'),('system_administrator','assessment.review'),
('academic_registrar','assessment.plan.manage'),('examinations_officer','assessment.marks'),('examinations_officer','assessment.review'),
('academic_approver','assessment.plan.approve'),('academic_approver','assessment.review') on conflict do nothing;
