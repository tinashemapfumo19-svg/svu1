alter table student_programmes add column origin_programme_id text references student_programmes(id);
alter table student_programmes drop constraint student_programmes_application_id_key;
create unique index student_programme_admission on student_programmes(application_id) where origin_programme_id is null;
create table programme_transfer_requests (
  id bigint generated always as identity primary key,
  source_programme_id text not null references student_programmes(id),
  target_intake_id text not null references intakes(id),
  target_version_id text not null references programme_versions(id),
  target_programme_id text unique references student_programmes(id),
  source_revision integer not null,
  evidence_hash text not null,
  source_snapshot jsonb not null,
  reason text not null,
  evidence_ref text not null,
  expires_on date not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((status = 'approved' and target_programme_id is not null) or (status <> 'approved' and target_programme_id is null))
);
create unique index programme_transfer_pending on programme_transfer_requests(source_programme_id) where status = 'requested';
alter table student_programmes add column transfer_request_id bigint unique references programme_transfer_requests(id);
alter table student_programmes add constraint student_programme_transfer_origin check ((origin_programme_id is null and transfer_request_id is null) or (origin_programme_id is not null and transfer_request_id is not null and origin_programme_id <> id));
alter table student_programme_history add column transfer_request_id bigint references programme_transfer_requests(id);
create index programme_transfer_history on programme_transfer_requests(source_programme_id,id desc);
alter table registration_periods drop constraint registration_periods_intake_id_academic_period_id_key;
alter table registration_periods add unique (intake_id,academic_period_id,programme_version_id);
insert into permissions (code,description) values
('registry.transfer.request','Request scoped programme, intake or curriculum transfer'),
('registry.transfer.approve','Independently review scoped programme transfers') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.transfer.request'),('system_administrator','registry.transfer.approve'),
('academic_registrar','registry.transfer.request'),('academic_approver','registry.transfer.approve') on conflict do nothing;
