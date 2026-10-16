-- Finance migration wave: approved opening balances (debit owed or credit held) per student programme and currency,
-- imported all-or-nothing against control totals. Opening balances are ledger entries like any other, so statements,
-- allocation, holds, and control totals include them without special cases.
create table finance_migrations (
  id bigint generated always as identity primary key,
  source text not null,
  source_ref text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  as_of date not null,
  line_count integer not null check (line_count > 0),
  debit_minor bigint not null,
  credit_minor bigint not null,
  checksum text not null,
  reason text not null,
  imported_by text not null references accounts(id),
  imported_at timestamptz not null default now(),
  unique (source, source_ref)
);
create table finance_migration_lines (
  id bigint generated always as identity primary key,
  migration_id bigint not null references finance_migrations(id),
  line_no integer not null,
  legacy_ref text not null,
  student_number text not null,
  student_programme_id text not null references student_programmes(id),
  amount_minor bigint not null check (amount_minor <> 0),
  unique (migration_id, line_no)
);
create trigger finance_migrations_append_only before update or delete on finance_migrations for each row execute function ledger_append_only();
create trigger finance_migration_lines_append_only before update or delete on finance_migration_lines for each row execute function ledger_append_only();

alter table ledger_entries add column opening_line_id bigint unique references finance_migration_lines(id);
alter table ledger_entries drop constraint ledger_entries_shape;
alter table ledger_entries add constraint ledger_entries_shape check (
  (entry_type = 'charge' and charge_code is not null and due_on is not null and payment_id is null)
  or (entry_type = 'payment' and payment_id is not null and charge_code is null and adjustment_id is null and opening_line_id is null)
  or (entry_type = 'credit' and payment_id is null and charge_code is null and num_nonnulls(adjustment_id,opening_line_id) = 1));
create unique index ledger_one_opening_balance on ledger_entries(student_programme_id,currency) where opening_line_id is not null;

insert into permissions (code,description) values
('finance.migrate','Import approved opening balances (global finance scope)') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values ('system_administrator','finance.migrate') on conflict do nothing;
