-- Reconciled bank / mobile-money statement imports (FIN-07, FIN-08). Lines naming exactly one eligible student programme post
-- payments automatically; replayed references are kept as duplicates; everything else waits in a work queue for an independent
-- finance officer to assign or mark as returned to the payer.
create table payment_imports (
  id bigint generated always as identity primary key,
  source text not null check (source in ('bank','mobile_money')),
  source_ref text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  line_count integer not null check (line_count > 0),
  total_minor bigint not null check (total_minor > 0),
  checksum text not null,
  reason text not null,
  imported_by text not null references accounts(id),
  imported_at timestamptz not null default now(),
  unique (source, source_ref)
);
create table payment_import_lines (
  id bigint generated always as identity primary key,
  import_id bigint not null references payment_imports(id),
  line_no integer not null,
  external_ref text not null,
  amount_minor bigint not null check (amount_minor > 0),
  received_on date not null,
  payer_reference text not null,
  status text not null check (status in ('matched','duplicate','unmatched','assigned','returned')),
  match_note text not null,
  student_programme_id text references student_programmes(id),
  payment_id bigint unique references student_payments(id),
  resolved_by text references accounts(id),
  resolved_at timestamptz,
  resolution_reason text,
  unique (import_id, line_no),
  check (status not in ('matched','assigned') or (payment_id is not null and student_programme_id is not null)),
  check (status not in ('assigned','returned') or (resolved_by is not null and resolution_reason is not null))
);
create index payment_import_queue on payment_import_lines(status,id) where status = 'unmatched';

create or replace function payment_import_line_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'unmatched' or new.status not in ('assigned','returned') or new.amount_minor <> old.amount_minor
     or new.external_ref <> old.external_ref or new.import_id <> old.import_id then
    raise exception 'statement lines change only once, from unmatched to assigned or returned';
  end if;
  return new;
end $$;
create trigger payment_import_lines_guard before update on payment_import_lines for each row execute function payment_import_line_guard();
create trigger payment_import_lines_no_delete before delete on payment_import_lines for each row execute function ledger_append_only();
create trigger payment_imports_append_only before update or delete on payment_imports for each row execute function ledger_append_only();

insert into permissions (code,description) values
('finance.import','Import reconciled payment statements and resolve the unmatched-payment queue (global finance scope)') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','finance.import'),('finance_officer','finance.import') on conflict do nothing;
