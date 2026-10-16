-- Preserve source evidence separately from native operational projections.
create table legacy_imports (
  id text primary key,
  source_sha256 text not null unique,
  source_bytes bigint not null,
  original_archive_encrypted text not null,
  manifest jsonb not null,
  report jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create table legacy_source_rows (
  import_id text not null references legacy_imports(id),
  source_table text not null,
  source_row integer not null,
  row_sha256 text not null,
  payload_encrypted text not null,
  target_type text,
  target_id text,
  disposition text not null default 'retained_for_reconciliation',
  primary key(import_id, source_table, source_row)
);
-- Missing/shared source emails must not become fabricated mailboxes or forced identity merges.
alter table accounts add column legacy_source_ref text unique;
alter table accounts alter column email drop not null;
alter table accounts add constraint accounts_email_or_legacy check(email is not null or legacy_source_ref is not null);
create table legacy_login_aliases (
  alias text not null,
  account_id text not null references accounts(id),
  primary key(alias,account_id),
  check(alias = lower(btrim(alias)) and length(alias) > 0)
);
create index legacy_login_aliases_account on legacy_login_aliases(account_id);

alter table courses add column legacy_source_ref text unique;
alter table courses alter column credits drop not null;
alter table courses alter column level drop not null;
alter table courses alter column effective_from drop not null;
alter table courses add constraint courses_complete_or_legacy_draft check(
  (credits is not null and level is not null and effective_from is not null)
  or (legacy_source_ref is not null and status='draft')
);
alter table intakes add column legacy_source_ref text unique;
alter table intakes alter column capacity drop not null;
alter table intakes add constraint intakes_capacity_or_legacy_draft check(
  capacity is not null or (legacy_source_ref is not null and status='draft')
);
alter table applications add column legacy_source_ref text unique;
alter table applications add column legacy_source_status text;
alter table student_programmes add column legacy_source_status text;
alter table staff_members add column legacy_source_ref text unique;
alter table staff_members alter column email drop not null;
alter table staff_members alter column employee_number drop not null;
alter table staff_members add constraint staff_identity_or_legacy check(
  (email is not null and employee_number is not null) or legacy_source_ref is not null
);
