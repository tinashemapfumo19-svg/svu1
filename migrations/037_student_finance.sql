-- Stage 4 student finance foundation (FIN-01 to FIN-11, FIN-14). Amounts are integer minor units in one currency per row.
-- Ledger entries are append-only; balances and holds are always derived from entries and allocations.
insert into reference_lists (code, name, owner, sensitivity, lawful_purpose, status, value_pattern)
values ('charge_type', 'Student charge types', 'Finance', 'standard', null, 'active', '^[A-Z][A-Z0-9_]{1,39}$')
on conflict (code) do nothing;

create table fee_schedules (
  id text primary key,
  programme_id text not null references programmes(id),
  year_of_study integer not null check (year_of_study between 1 and 8),
  term text not null check (term in ('S1','S2','S3')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  due_days integer not null check (due_days between 0 and 365),
  lines jsonb not null,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  reason text not null,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  published_by text references accounts(id),
  published_at timestamptz,
  publish_reason text,
  check (published_by is null or published_by <> created_by)
);
create unique index fee_schedules_published_slot on fee_schedules(programme_id,year_of_study,term,currency,effective_from) where status = 'published';

create table billing_runs (
  id bigint generated always as identity primary key,
  registration_period_id text not null references registration_periods(id),
  fee_schedule_id text not null references fee_schedules(id),
  reason text not null,
  run_by text not null references accounts(id),
  run_at timestamptz not null default now(),
  charges_created integer not null,
  amount_minor bigint not null
);

create table student_payments (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('bank','mobile_money','cash')),
  external_ref text not null,
  received_on date not null,
  reason text not null,
  recorded_by text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique (method, external_ref)
);

create table ledger_entries (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  entry_type text not null check (entry_type in ('charge','payment')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  charge_code text,
  description text not null,
  due_on date,
  registration_period_id text references registration_periods(id),
  billing_run_id bigint references billing_runs(id),
  payment_id bigint unique references student_payments(id),
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  check ((entry_type = 'charge' and charge_code is not null and due_on is not null and payment_id is null)
      or (entry_type = 'payment' and payment_id is not null and charge_code is null))
);
create unique index ledger_period_charge on ledger_entries(student_programme_id,registration_period_id,charge_code) where entry_type = 'charge' and registration_period_id is not null;
create index ledger_programme on ledger_entries(student_programme_id,id);

create table ledger_allocations (
  id bigint generated always as identity primary key,
  payment_entry_id bigint not null references ledger_entries(id),
  charge_entry_id bigint not null references ledger_entries(id),
  amount_minor bigint not null check (amount_minor > 0),
  allocated_at timestamptz not null default now(),
  unique (payment_entry_id, charge_entry_id)
);

create or replace function ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'ledger rows are append-only';
end $$;
create trigger ledger_entries_append_only before update or delete on ledger_entries for each row execute function ledger_append_only();
create trigger ledger_allocations_append_only before update or delete on ledger_allocations for each row execute function ledger_append_only();
create trigger student_payments_append_only before update or delete on student_payments for each row execute function ledger_append_only();

insert into permissions (code,description) values
('finance.view','View scoped student accounts and fee schedules'),
('finance.schedule.manage','Draft fee schedules'),
('finance.schedule.publish','Independently publish fee schedules'),
('finance.billing.run','Run scoped period billing'),
('finance.payment.record','Record scoped student payments') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','finance.view'),('system_administrator','finance.schedule.manage'),('system_administrator','finance.schedule.publish'),
('system_administrator','finance.billing.run'),('system_administrator','finance.payment.record'),
('finance_officer','finance.view'),('finance_officer','finance.schedule.manage'),('finance_officer','finance.schedule.publish'),
('finance_officer','finance.billing.run'),('finance_officer','finance.payment.record'),
('academic_registrar','finance.view') on conflict do nothing;
