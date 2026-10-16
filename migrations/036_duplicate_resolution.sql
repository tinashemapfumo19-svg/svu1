-- Governed duplicate student resolution (REG-04, REG-10): a reviewed case either merges a duplicate student record into a
-- surviving record or confirms the two records are distinct people. Merges re-link programme records and course enrolments
-- to the survivor; the duplicate student row, its profile, and its history are retained and marked as merged.
alter table students add column merged_into_student_id text references students(id);
alter table students add column merged_at timestamptz;
alter table students add constraint students_not_merged_into_self check (merged_into_student_id is null or merged_into_student_id <> id);
create table student_duplicate_cases (
  id bigint generated always as identity primary key,
  survivor_student_id text not null references students(id),
  duplicate_student_id text not null references students(id),
  proposal text not null check (proposal in ('merge','distinct')),
  evidence_hash text not null,
  source_snapshot jsonb not null,
  reason text not null,
  evidence_ref text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  merge_result jsonb,
  check (survivor_student_id <> duplicate_student_id),
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create unique index student_duplicate_open_pair on student_duplicate_cases(least(survivor_student_id,duplicate_student_id),greatest(survivor_student_id,duplicate_student_id)) where status = 'requested';
create index student_duplicate_survivor on student_duplicate_cases(survivor_student_id,id desc);
create index student_duplicate_duplicate on student_duplicate_cases(duplicate_student_id,id desc);
insert into permissions (code,description) values
('registry.duplicate.request','Request scoped duplicate student resolution'),
('registry.duplicate.approve','Independently review scoped duplicate student resolution') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.duplicate.request'),('system_administrator','registry.duplicate.approve'),
('academic_registrar','registry.duplicate.request'),('academic_registrar','registry.duplicate.approve') on conflict do nothing;
