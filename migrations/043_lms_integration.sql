-- Stage 6 LMS boundary (ADR-008 accepted: integrate a dedicated LMS). SVU publishes a versioned provisioning manifest of
-- workspaces, teachers (from approved allocations) and students (from confirmed enrolments). The LMS returns course outcomes,
-- which are staged, reconciled against the roster, independently accepted, and transferred exactly once into the official
-- results pipeline, where the existing review and publication controls still apply.
insert into roles (code,name,risk) values ('lms_connector','LMS Connector (service)','high') on conflict do nothing;

create table lms_outcome_batches (
  id bigint generated always as identity primary key,
  period_id text not null,
  course_id text not null,
  external_ref text not null unique,
  checksum text not null,
  row_count integer not null check (row_count > 0),
  rows jsonb not null,
  status text not null default 'received' check (status in ('received','accepted','rejected','transferred')),
  received_by text not null references accounts(id),
  received_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  result_batch_id text references result_batches(id),
  transferred_at timestamptz,
  foreign key (period_id, course_id) references registration_offerings(period_id, course_id),
  check (reviewed_by is null or reviewed_by <> received_by),
  check ((status = 'transferred') = (result_batch_id is not null))
);
create unique index lms_one_live_outcome on lms_outcome_batches(period_id,course_id) where status in ('received','accepted','transferred');

insert into permissions (code,description) values
('lms.sync','Read the LMS provisioning manifest and return course outcomes (service connector)'),
('lms.outcomes.review','Review scoped LMS course outcomes and transfer them to official results') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('lms_connector','lms.sync'),('system_administrator','lms.outcomes.review'),
('examinations_officer','lms.outcomes.review'),('academic_registrar','lms.outcomes.review') on conflict do nothing;
