create table credit_recognitions (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  programme_version_id text not null references programme_versions(id),
  course_id text not null references courses(id),
  policy_id text not null references academic_policies(id),
  kind text not null check (kind in ('internal_transfer','external_transfer','exemption')),
  source_registration_id text references student_registrations(id),
  source_course_id text references courses(id),
  source jsonb not null,
  credits numeric(5,1) not null check (credits > 0 and credits <= 60),
  completed_on date not null,
  evidence_hash text not null,
  source_snapshot jsonb not null,
  reason text not null,
  evidence_ref text not null,
  expires_on date not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected','revoked')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  revoked_by text references accounts(id),
  revoked_at timestamptz,
  revoke_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check (revoked_by is null or revoked_by <> requested_by),
  check ((kind = 'internal_transfer' and source_registration_id is not null and source_course_id is not null) or (kind <> 'internal_transfer' and source_registration_id is null and source_course_id is null))
);
create unique index credit_recognition_target on credit_recognitions(student_programme_id,course_id) where status in ('requested','approved');
create unique index credit_recognition_internal_source on credit_recognitions(student_programme_id,source_registration_id,source_course_id) where kind = 'internal_transfer' and status in ('requested','approved');
create unique index credit_recognition_external_source on credit_recognitions(student_programme_id,(source->>'reference')) where kind <> 'internal_transfer' and status in ('requested','approved');
create index credit_recognition_history on credit_recognitions(student_programme_id,id desc);
insert into permissions (code,description) values
('registry.credit.request','Request scoped course credit recognition'),('registry.credit.approve','Independently review and revoke scoped course credit recognition') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.credit.request'),('system_administrator','registry.credit.approve'),
('academic_registrar','registry.credit.request'),('academic_approver','registry.credit.approve') on conflict do nothing;
