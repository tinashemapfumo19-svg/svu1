create table registration_exceptions (
  id bigint generated always as identity primary key,
  registration_id text not null references student_registrations(id),
  kind text not null check (kind in ('credit_limit','timetable_clash')),
  parameters jsonb not null,
  registration_revision integer not null check (registration_revision > 0),
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
  check (revoked_by is null or revoked_by <> requested_by)
);
create index registration_exception_history on registration_exceptions(registration_id,id desc);
insert into permissions (code,description) values
('registry.exception.request','Request scoped reasoned registration exceptions'),
('registry.exception.approve','Independently review and revoke scoped registration exceptions') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.exception.request'),('system_administrator','registry.exception.approve'),
('academic_registrar','registry.exception.request'),('academic_approver','registry.exception.approve') on conflict do nothing;
