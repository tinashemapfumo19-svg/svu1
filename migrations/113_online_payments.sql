-- Online fee payments (docs/ONLINE_PAYMENTS.md, D-44). A student starts a checkout for an amount up to their balance; the
-- payment provider confirms it, and the confirmed amount is posted through the normal payment path (method 'online').
-- An intent is posted at most once: the payment row is unique on (method, external_ref) with the intent id as the ref.
alter table student_payments drop constraint student_payments_method_check;
alter table student_payments add constraint student_payments_method_check check (method in ('bank','mobile_money','cash','online'));

create table payment_intents (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  account_id text not null references accounts(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  provider text not null check (provider in ('paynow','simulated')),
  provider_reference text,
  poll_url text,
  status text not null default 'created' check (status in ('created','pending','paid','failed','cancelled','expired')),
  status_detail text,
  payment_id bigint references student_payments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (payment_id is not null))
);
create index payment_intents_programme on payment_intents(student_programme_id,created_at desc);
create index payment_intents_open on payment_intents(status) where status in ('created','pending');
