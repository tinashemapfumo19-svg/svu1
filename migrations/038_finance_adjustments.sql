-- Reviewed finance adjustments (FIN-12 replacement, FIN-07 evidence): waivers, scholarships, write-offs, manual debits, refunds,
-- and expiring financial-hold exemptions. Each needs an evidenced request and an independent reviewer before it changes the ledger.
create table finance_adjustments (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  kind text not null check (kind in ('waiver','scholarship','write_off','debit','refund','hold_exemption')),
  currency text check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint check (amount_minor > 0),
  target_entry_id bigint references ledger_entries(id),
  description text,
  due_on date,
  expires_on date,
  evidence_hash text not null,
  reason text not null,
  evidence_ref text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected','revoked')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  revoked_by text references accounts(id),
  revoked_at timestamptz,
  revoke_reason text,
  ledger_entry_id bigint unique references ledger_entries(id),
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((kind = 'hold_exemption' and amount_minor is null and expires_on is not null) or (kind <> 'hold_exemption' and amount_minor is not null and currency is not null)),
  check (kind not in ('waiver','scholarship','write_off') or target_entry_id is not null),
  check (kind <> 'debit' or (due_on is not null and description is not null)),
  check (status <> 'revoked' or kind = 'hold_exemption')
);
create unique index finance_adjustment_open on finance_adjustments(student_programme_id) where status = 'requested';

alter table ledger_entries drop constraint ledger_entries_entry_type_check;
alter table ledger_entries add constraint ledger_entries_entry_type_check check (entry_type in ('charge','payment','credit'));
alter table ledger_entries drop constraint ledger_entries_check;
alter table ledger_entries add column adjustment_id bigint unique references finance_adjustments(id);
alter table ledger_entries add constraint ledger_entries_shape check (
  (entry_type = 'charge' and charge_code is not null and due_on is not null and payment_id is null)
  or (entry_type = 'payment' and payment_id is not null and charge_code is null and adjustment_id is null)
  or (entry_type = 'credit' and adjustment_id is not null and payment_id is null and charge_code is null));

create or replace function finance_adjustment_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('rejected','revoked') or (old.status = 'approved' and not (new.status = 'revoked' and old.kind = 'hold_exemption'))
     or new.kind <> old.kind or new.amount_minor is distinct from old.amount_minor or new.student_programme_id <> old.student_programme_id then
    raise exception 'reviewed finance adjustments are immutable';
  end if;
  return new;
end $$;
create trigger finance_adjustments_guard before update on finance_adjustments for each row execute function finance_adjustment_guard();
create trigger finance_adjustments_no_delete before delete on finance_adjustments for each row execute function ledger_append_only();

insert into permissions (code,description) values
('finance.adjustment.request','Request scoped student finance adjustments'),
('finance.adjustment.approve','Independently review scoped student finance adjustments') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','finance.adjustment.request'),('system_administrator','finance.adjustment.approve'),
('finance_officer','finance.adjustment.request'),('finance_officer','finance.adjustment.approve') on conflict do nothing;
