-- Governed student identity corrections (REG-04, REG-08): legal/preferred name, date of birth, and nationality
-- change only through an evidenced request and an independent registry review. The request rows retain the
-- private before/after values; audit metadata records only field names.
alter table students add column identity_revision integer not null default 0 check (identity_revision >= 0);
create table student_identity_requests (
  id bigint generated always as identity primary key,
  student_id text not null references students(id),
  identity_revision integer not null,
  current_snapshot jsonb not null,
  changes jsonb not null,
  reason text not null,
  evidence_ref text not null,
  channel text not null check (channel in ('self','staff')),
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create unique index student_identity_open on student_identity_requests(student_id) where status = 'requested';
create index student_identity_context on student_identity_requests(student_id,id desc);
insert into permissions (code,description) values
('registry.identity.request','Request scoped student identity corrections'),
('registry.identity.approve','Independently review scoped student identity corrections') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.identity.request'),('system_administrator','registry.identity.approve'),
('academic_registrar','registry.identity.request'),('academic_registrar','registry.identity.approve') on conflict do nothing;
