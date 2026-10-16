create table result_batches (
  id text primary key,
  period_id text not null references registration_periods(id),
  source_ref text not null unique,
  checksum text not null,
  row_count integer not null check (row_count > 0),
  mark_total integer not null check (mark_total >= 0),
  rows jsonb not null,
  policy_snapshot jsonb not null,
  status text not null default 'draft' check (status in ('draft','reviewed','rejected','published')),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  import_reason text not null,
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  evidence_ref text,
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  check (reviewed_by is null or reviewed_by <> created_by),
  check (published_by is null or published_by <> created_by)
);
create unique index result_batch_active_period on result_batches(period_id) where status <> 'rejected';
create table academic_results (
  registration_id text not null,
  course_id text not null,
  batch_id text not null references result_batches(id),
  result_snapshot jsonb not null,
  primary key (registration_id,course_id),
  foreign key (registration_id,course_id) references course_enrolments(registration_id,course_id)
);
insert into roles (code,name,risk) values ('examinations_officer','Examinations Officer','high') on conflict do nothing;
insert into permissions (code,description) values
('results.view','View scoped enrolled rosters and result batches'),
('results.import','Import reconciled scoped result batches'),
('results.review','Independently review scoped result batches'),
('results.publish','Publish independently reviewed scoped results') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','results.view'),('system_administrator','results.import'),
('system_administrator','results.review'),('system_administrator','results.publish'),
('academic_registrar','results.view'),('academic_registrar','results.import'),
('examinations_officer','registry.view'),('examinations_officer','results.view'),
('examinations_officer','results.review'),('examinations_officer','results.publish') on conflict do nothing;
