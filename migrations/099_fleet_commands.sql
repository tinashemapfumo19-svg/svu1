create table fleet_driver_requests (
  id text primary key,
  staff_id text not null references staff_members(id),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  requested_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  check (isfinite(valid_from) and isfinite(valid_until) and valid_until > valid_from)
);
create table fleet_driver_decisions (
  request_id text primary key references fleet_driver_requests(id),
  outcome text not null check (outcome in ('approved','rejected')),
  authorisation_id text unique references fleet_driver_authorisations(id),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now(),
  check ((outcome='approved') = (authorisation_id is not null))
);
create table fleet_fuel_reversals (
  receipt_id text primary key references fleet_fuel_receipts(id),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now()
);
create function fleet_decision_guard() returns trigger language plpgsql as $$
declare proposal fleet_driver_requests%rowtype; authorisation fleet_driver_authorisations%rowtype; driver_account text;
begin
  perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));
  NEW.recorded_at:=clock_timestamp();
  if TG_TABLE_NAME='fleet_fuel_reversals' then
    if exists(select 1 from fleet_fuel_receipts where id=NEW.receipt_id and recorded_by=NEW.actor_id) then
      raise exception 'Fuel reversal requires independent approval';
    end if;
    return NEW;
  end if;
  select * into proposal from fleet_driver_requests where id=NEW.request_id;
  select account_id into driver_account from staff_members where id=proposal.staff_id for share;
  if NEW.actor_id in (proposal.requested_by,driver_account) then raise exception 'Driver decision must be independent'; end if;
  if NEW.outcome='approved' then
    select * into authorisation from fleet_driver_authorisations where id=NEW.authorisation_id;
    if not found or authorisation.staff_id<>proposal.staff_id or authorisation.valid_from<>proposal.valid_from
      or authorisation.valid_until<>proposal.valid_until or authorisation.evidence_reference<>proposal.evidence_reference
      or authorisation.requested_by<>proposal.requested_by or authorisation.approved_by<>NEW.actor_id then
      raise exception 'Driver decision must bind the retained request';
    end if;
  end if;
  return NEW;
end $$;
create trigger fleet_driver_request_append_only before update or delete on fleet_driver_requests for each row execute function ledger_append_only();
create trigger fleet_driver_decision_append_only before update or delete on fleet_driver_decisions for each row execute function ledger_append_only();
create trigger fleet_fuel_reversal_append_only before update or delete on fleet_fuel_reversals for each row execute function ledger_append_only();
create trigger fleet_driver_decision_guard before insert on fleet_driver_decisions for each row execute function fleet_decision_guard();
create trigger fleet_fuel_reversal_guard before insert on fleet_fuel_reversals for each row execute function fleet_decision_guard();

create function fleet_asset_disposal_guard() returns trigger language plpgsql as $$
begin
  if NEW.status in ('disposal_pending','disposed') and NEW.status is distinct from OLD.status then
    perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));
    if exists(select 1 from fleet_vehicles v join fleet_trips t on t.vehicle_id=v.id
      join lateral(select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1) e on true
      where v.asset_id=NEW.id and e.kind in ('approved','dispatched')) then
      raise exception 'Resolve outstanding fleet bookings before asset disposal';
    end if;
  end if;
  return NEW;
end $$;
create trigger fleet_asset_disposal_guard before update on institution_assets for each row execute function fleet_asset_disposal_guard();

insert into permissions(code,description) values
('fleet.view','View institution-wide operational fleet records, excluding incident details'),
('fleet.manage','Register vehicles, request driver authority and trips, dispatch/return, record fuel and service holds'),
('fleet.approve','Independently decide driver requests and trips, release service holds, revoke driver authority and reverse fuel receipts'),
('fleet.incidents','Record and read restricted fleet incidents and resolutions') on conflict do nothing;
insert into roles(code,name,risk) values
('fleet_officer','Fleet Officer','high'),('fleet_approver','Fleet Approver','high'),('fleet_safety_officer','Fleet Safety Officer','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('system_administrator','fleet.view'),('system_administrator','fleet.manage'),('system_administrator','fleet.approve'),('system_administrator','fleet.incidents'),
('fleet_officer','fleet.view'),('fleet_officer','fleet.manage'),
('fleet_approver','fleet.view'),('fleet_approver','fleet.approve'),
('fleet_safety_officer','fleet.view'),('fleet_safety_officer','fleet.incidents') on conflict do nothing;
insert into role_permissions(role_code,permission_code)
select r,p from unnest(array['fleet_officer','fleet_approver','fleet_safety_officer']) r
cross join unnest(array['leave.self','messages.self','rooms.self']) p on conflict do nothing;
