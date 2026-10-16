-- Stage 4 payment plans. A finance officer proposes instalments covering a student programme's outstanding charges in
-- one currency; a different person approves. While payments keep pace with the instalments due so far, the covered
-- charges do not raise a financial hold; falling behind restores the hold automatically, and paying the covered total
-- completes the plan. Standing is computed from the ledger, never stored, so it cannot drift from the payments.
create table payment_plans (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  covered_entry_ids bigint[] not null check (cardinality(covered_entry_ids) > 0),
  covered_amount bigint not null check (covered_amount > 0),
  instalments jsonb not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','cancelled')),
  reason text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  cancelled_by text references accounts(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((status = 'cancelled') = (cancelled_by is not null))
);
create unique index payment_plans_one_live on payment_plans(student_programme_id,currency) where status in ('requested','approved');
create trigger payment_plans_no_delete before delete on payment_plans for each row execute function ledger_append_only();
