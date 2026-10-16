create table staff_leave_categories (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null,
  day_basis text not null check (day_basis in ('calendar','weekdays')),
  excluded_dates jsonb not null default '[]',
  active boolean not null default true,
  revision integer not null default 1,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);
create table staff_leave_balance_entries (
  id bigint generated always as identity primary key,
  staff_id text not null references staff_members(id),
  category_code text not null references staff_leave_categories(code),
  leave_year integer not null check (leave_year between 2000 and 2200),
  days integer not null check (days <> 0 and days between -366 and 366),
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create trigger staff_leave_balance_append_only before update or delete on staff_leave_balance_entries for each row execute function ledger_append_only();
create table staff_leave_requests (
  id text primary key,
  staff_id text not null references staff_members(id),
  category_code text not null references staff_leave_categories(code),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  days integer not null check (days between 1 and 366),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','recommended','approved','denied','cancelled','reversed')),
  revision integer not null default 1,
  requested_by text not null references accounts(id),
  recommended_by text references accounts(id),
  approved_by text references accounts(id),
  replay_key text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique (staff_id,replay_key),
  check (extract(year from starts_on) = extract(year from ends_on))
);
create index staff_leave_requests_staff_dates on staff_leave_requests(staff_id,starts_on,ends_on);
create table staff_leave_history (
  id bigint generated always as identity primary key,
  request_id text not null references staff_leave_requests(id),
  from_status text,
  to_status text not null,
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create trigger staff_leave_history_append_only before update or delete on staff_leave_history for each row execute function ledger_append_only();
create function protect_staff_leave_definition() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Leave records are retained'; end if;
  if (to_jsonb(NEW) - array['status','revision','recommended_by','approved_by']) <> (to_jsonb(OLD) - array['status','revision','recommended_by','approved_by']) then
    raise exception 'Leave request definitions are immutable';
  end if;
  return NEW;
end $$;
create trigger staff_leave_definition_immutable before update or delete on staff_leave_requests for each row execute function protect_staff_leave_definition();
create function protect_staff_leave_category() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Leave categories are retained'; end if;
  if (to_jsonb(NEW) - array['active','revision']) <> (to_jsonb(OLD) - array['active','revision']) then
    raise exception 'Leave counting policies are immutable; create a new category';
  end if;
  return NEW;
end $$;
create trigger staff_leave_category_immutable before update or delete on staff_leave_categories for each row execute function protect_staff_leave_category();
insert into permissions (code,description) values
('leave.self','Request own leave and recommend leave for current direct reports'),
('leave.manage','Configure leave categories and balances and independently approve leave institution-wide') on conflict do nothing;
insert into role_permissions (role_code,permission_code)
select code,'leave.self' from roles where code in ('lecturer','hr_officer','admissions_officer','admissions_manager','academic_registrar','finance_officer','examinations_officer','academic_approver','system_administrator') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values ('hr_officer','leave.manage'),('system_administrator','leave.manage') on conflict do nothing;
