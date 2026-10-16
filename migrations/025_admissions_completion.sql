alter table applications add column review_route text not null default 'undergraduate';

create table admissions_routes (
  code text primary key,
  name text not null,
  definition_code text not null,
  academic_stages jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into admissions_routes (code, name, definition_code, academic_stages) values
  ('undergraduate', 'Undergraduate', 'admissions_application', '["Academic review"]'),
  ('postgraduate', 'Postgraduate', 'admissions_postgraduate', '["Academic review", "Faculty review"]');

create table admissions_programme_routes (
  programme_id text primary key references programmes(id),
  route_code text not null references admissions_routes(code)
);

create table application_requests (
  id text primary key,
  application_id text not null references applications(id),
  target_intake_id text references intakes(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text
);
create unique index application_requests_one_pending on application_requests(application_id) where status = 'pending';

create table application_messages (
  id text primary key,
  application_id text not null references applications(id),
  author_account_id text not null references accounts(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index application_messages_application on application_messages(application_id, created_at);

alter table application_decisions drop constraint application_decisions_response_check;
alter table application_decisions add constraint application_decisions_response_check
  check (response in ('accepted', 'declined', 'expired', 'deferred', 'superseded', 'withdrawn'));

create table admissions_migration_batches (
  id text primary key,
  source text not null,
  checksum text not null,
  report jsonb not null,
  imported_by text not null,
  imported_at timestamptz not null default now(),
  unique (source, checksum)
);
create table admissions_legacy_records (
  source text not null,
  legacy_id text not null,
  record_type text not null check (record_type in ('application', 'document')),
  target_id text not null,
  batch_id text not null references admissions_migration_batches(id),
  primary key (source, record_type, legacy_id)
);

insert into permissions (code, description) values
  ('admissions.configure', 'Configure admissions review routes'),
  ('admissions.migrate', 'Import and reconcile approved admissions exports');
insert into role_permissions (role_code, permission_code) values
  ('system_administrator', 'admissions.configure'),
  ('system_administrator', 'admissions.migrate'),
  ('admissions_manager', 'admissions.configure');
