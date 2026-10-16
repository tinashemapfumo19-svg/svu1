-- Stage 5 staff records (STF-01 to STF-06). A staff record is the employment relationship; the person and login account are
-- created when the invited staff member activates. Department, category, grade and supervisor are effective-dated periods,
-- and status changes are append-only history.
insert into roles (code,name,risk) values ('lecturer','Lecturer','medium'),('hr_officer','HR Officer','high') on conflict do nothing;

insert into reference_lists (code, name, owner, sensitivity, lawful_purpose, status, value_pattern)
values ('staff_category', 'Staff employment categories', 'Human resources', 'standard', null, 'active', '^[A-Z][A-Z_]{1,39}$')
on conflict (code) do nothing;

create sequence staff_number_seq;
create table staff_members (
  id text primary key,
  employee_number text not null unique,
  email text not null unique,
  legal_name text not null,
  preferred_name text not null,
  invitation_id text not null unique references invitations(id),
  account_id text unique references accounts(id),
  status text not null default 'invited' check (status in ('invited','active','suspended','exited')),
  engaged_on date not null,
  exited_on date,
  revision integer not null default 0,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  check ((status = 'exited') = (exited_on is not null))
);
create table staff_employment_periods (
  id bigint generated always as identity primary key,
  staff_id text not null references staff_members(id),
  department_id text not null references organization_units(id),
  category text not null,
  grade text not null,
  supervisor_staff_id text references staff_members(id),
  effective_from date not null,
  effective_to date,
  reason text not null,
  recorded_by text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (supervisor_staff_id is null or supervisor_staff_id <> staff_id)
);
create unique index staff_one_open_period on staff_employment_periods(staff_id) where effective_to is null;
create table staff_status_history (
  id bigint generated always as identity primary key,
  staff_id text not null references staff_members(id),
  from_status text,
  to_status text not null,
  effective_on date not null,
  reason text not null,
  actor_id text not null,
  recorded_at timestamptz not null default now()
);
create trigger staff_status_history_append_only before update or delete on staff_status_history for each row execute function ledger_append_only();

insert into permissions (code,description) values
('staff.view','View staff records and employment history'),
('staff.manage','Create staff records, change employment periods and status (institution-wide)') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','staff.view'),('system_administrator','staff.manage'),
('hr_officer','staff.view'),('hr_officer','staff.manage'),
('academic_registrar','staff.view'),('academic_approver','staff.view') on conflict do nothing;
