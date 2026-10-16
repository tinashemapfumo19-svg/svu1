-- Stage 4 sponsor accounts and third-party billing. A sponsor (bursary fund, employer, government scheme) can cover a
-- percentage of a student programme's charges in one currency, optionally only some charge codes, optionally up to a cap,
-- for charges due within a validity window. A finance officer proposes; someone else approves. Each covered charge
-- produces one sponsor transfer: a credit on the student's ledger and the same amount owed by the sponsor. Sponsor
-- payments settle the sponsor's balance, never the student's, and the student is no longer held for the covered part.
create table sponsors (
  id text primary key,
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name text not null,
  contact_email text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);

create table sponsorships (
  id bigint generated always as identity primary key,
  sponsor_id text not null references sponsors(id),
  student_programme_id text not null references student_programmes(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  coverage_percent integer not null check (coverage_percent between 1 and 100),
  charge_codes text[] not null default '{}',
  cap_minor bigint check (cap_minor is null or cap_minor > 0),
  valid_from date not null,
  valid_to date not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','ended')),
  reason text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  ended_by text references accounts(id),
  ended_at timestamptz,
  end_reason text,
  check (valid_to >= valid_from),
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((status = 'ended') = (ended_by is not null))
);
create unique index sponsorships_one_live on sponsorships(sponsor_id,student_programme_id,currency) where status in ('requested','approved');

create table sponsor_transfers (
  id bigint generated always as identity primary key,
  sponsorship_id bigint not null references sponsorships(id),
  charge_entry_id bigint not null unique references ledger_entries(id),
  amount_minor bigint not null check (amount_minor > 0),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);

create table sponsor_payments (
  id bigint generated always as identity primary key,
  sponsor_id text not null references sponsors(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  external_ref text not null,
  received_on date not null,
  reason text not null,
  recorded_by text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique (sponsor_id, external_ref)
);

create trigger sponsor_transfers_append_only before update or delete on sponsor_transfers for each row execute function ledger_append_only();
create trigger sponsor_payments_append_only before update or delete on sponsor_payments for each row execute function ledger_append_only();

-- A sponsor credit is a third kind of ledger credit, alongside approved adjustments and opening balances.
alter table ledger_entries add column sponsor_transfer_id bigint unique references sponsor_transfers(id);
alter table ledger_entries drop constraint ledger_entries_shape;
alter table ledger_entries add constraint ledger_entries_shape check (
  (entry_type = 'charge' and charge_code is not null and due_on is not null and payment_id is null)
  or (entry_type = 'payment' and payment_id is not null and charge_code is null and adjustment_id is null and opening_line_id is null and sponsor_transfer_id is null)
  or (entry_type = 'credit' and payment_id is null and charge_code is null and num_nonnulls(adjustment_id,opening_line_id,sponsor_transfer_id) = 1));
