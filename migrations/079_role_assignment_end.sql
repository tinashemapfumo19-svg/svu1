-- Ending a role assignment keeps the row and records who ended it, when and why.
alter table role_assignments add column if not exists ended_at timestamptz;
alter table role_assignments add column if not exists ended_by text references accounts(id);
alter table role_assignments add column if not exists end_reason text;
alter table role_assignments add constraint role_assignment_end_shape
  check ((ended_at is null) = (ended_by is null) and (ended_at is null) = (end_reason is null));
create index if not exists role_assignments_account_active_idx on role_assignments(account_id) where ended_at is null;
