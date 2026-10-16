alter table student_programmes add column status_revision integer not null default 0 check (status_revision >= 0);
create table programme_lifecycle_requests (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  from_status text not null,
  to_status text not null check (to_status in ('suspended','interrupted','withdrawn','onboarded')),
  status_revision integer not null,
  evidence_hash text not null,
  source_snapshot jsonb not null,
  reason text not null,
  evidence_ref text not null,
  expires_on date not null,
  review_on date,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((to_status in ('suspended','interrupted') and review_on is not null) or (to_status in ('withdrawn','onboarded') and review_on is null))
);
create index programme_lifecycle_context on programme_lifecycle_requests(student_programme_id,id desc);
alter table student_programme_history add column lifecycle_request_id bigint unique references programme_lifecycle_requests(id);
insert into permissions (code,description) values
('registry.lifecycle.request','Request scoped student programme lifecycle changes'),
('registry.lifecycle.approve','Independently review scoped student programme lifecycle changes') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.lifecycle.request'),('system_administrator','registry.lifecycle.approve'),
('academic_registrar','registry.lifecycle.request'),('academic_approver','registry.lifecycle.approve') on conflict do nothing;
