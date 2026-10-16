create table institution_assets (
  id text primary key,
  asset_tag text not null unique,
  barcode text unique,
  serial_number text unique,
  name text not null,
  category text not null,
  acquired_on date not null,
  acquisition_method text not null,
  value_minor bigint not null check (value_minor between 0 and 10000000000),
  currency text not null,
  department_id text not null references organization_units(id),
  location text not null,
  condition text not null check (condition in ('serviceable','damaged','repair','missing')),
  status text not null default 'available' check (status in ('available','allocated','disposal_pending','disposed')),
  revision integer not null default 1,
  last_activity_on date not null,
  copied_from text references institution_assets(id),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);
create table asset_custody (
  id bigint generated always as identity primary key,
  asset_id text not null references institution_assets(id),
  staff_id text not null references staff_members(id),
  allocated_on date not null,
  location text not null,
  reason text not null,
  actor_id text not null references accounts(id),
  ended_on date,
  end_kind text check (end_kind in ('returned','disposed')),
  end_condition text,
  end_location text,
  end_reason text,
  end_actor text references accounts(id),
  check ((ended_on is null) = (end_kind is null)),
  check (ended_on is null or ended_on >= allocated_on)
);
create unique index asset_one_live_custody on asset_custody(asset_id) where ended_on is null;
create table asset_stock_checks (
  id bigint generated always as identity primary key,
  asset_id text not null references institution_assets(id),
  checked_on date not null,
  outcome text not null check (outcome in ('found','missing','damaged')),
  observed_condition text not null,
  observed_location text,
  expected_location text not null,
  expected_staff_id text references staff_members(id),
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create trigger asset_checks_append_only before update or delete on asset_stock_checks for each row execute function ledger_append_only();
create table asset_disposals (
  id text primary key,
  asset_id text not null references institution_assets(id),
  proposed_on date not null,
  value_minor bigint not null check (value_minor between 0 and 10000000000),
  currency text not null,
  method text not null,
  reason text not null,
  requested_by text not null references accounts(id),
  status text not null default 'requested' check (status in ('requested','approved','denied')),
  reviewed_by text references accounts(id),
  reviewed_on date,
  review_reason text,
  created_at timestamptz not null default now()
);
create unique index asset_one_pending_disposal on asset_disposals(asset_id) where status='requested';
create table asset_events (
  id bigint generated always as identity primary key,
  asset_id text not null references institution_assets(id),
  action text not null,
  reason text not null,
  actor_id text not null references accounts(id),
  before_state jsonb,
  after_state jsonb not null,
  recorded_at timestamptz not null default now()
);
create trigger asset_events_append_only before update or delete on asset_events for each row execute function ledger_append_only();
create table asset_command_receipts (
  actor_id text not null references accounts(id),
  replay_key text not null,
  input_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id,replay_key)
);
create trigger asset_receipts_append_only before update or delete on asset_command_receipts for each row execute function ledger_append_only();
create function protect_asset_custody() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Custody history is retained'; end if;
  if OLD.ended_on is not null or NEW.ended_on is null or
    (to_jsonb(NEW) - array['ended_on','end_kind','end_condition','end_location','end_reason','end_actor']) <>
    (to_jsonb(OLD) - array['ended_on','end_kind','end_condition','end_location','end_reason','end_actor']) then
    raise exception 'Custody definitions are immutable and can only be closed once';
  end if;
  return NEW;
end $$;
create trigger asset_custody_immutable before update or delete on asset_custody for each row execute function protect_asset_custody();
create function protect_asset_disposal() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Disposal history is retained'; end if;
  if OLD.status<>'requested' or NEW.status='requested' or
    (to_jsonb(NEW) - array['status','reviewed_by','reviewed_on','review_reason']) <>
    (to_jsonb(OLD) - array['status','reviewed_by','reviewed_on','review_reason']) then
    raise exception 'Disposal proposals are immutable and can only be decided once';
  end if;
  return NEW;
end $$;
create trigger asset_disposal_immutable before update or delete on asset_disposals for each row execute function protect_asset_disposal();
create function retain_institution_asset() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Assets are retained'; end if;
  if OLD.status='disposed' then raise exception 'Disposed assets are immutable'; end if;
  return NEW;
end $$;
create trigger institution_assets_retained before update or delete on institution_assets for each row execute function retain_institution_asset();
insert into roles (code,name,risk) values ('asset_officer','Asset Officer','high'),('asset_approver','Asset Disposal Approver','high') on conflict do nothing;
insert into permissions (code,description) values
('assets.view','View institution-wide asset register and custody history'),
('assets.manage','Register assets, record custody and stock checks and propose disposal institution-wide'),
('assets.approve','Independently approve or deny asset disposal institution-wide') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','assets.view'),('system_administrator','assets.manage'),('system_administrator','assets.approve'),
('asset_officer','assets.view'),('asset_officer','assets.manage'),
('asset_approver','assets.view'),('asset_approver','assets.approve'),
('asset_officer','leave.self'),('asset_approver','leave.self') on conflict do nothing;
