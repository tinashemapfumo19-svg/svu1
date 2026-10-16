-- Native fleet foundation. Evidence references are not statutory compliance or accounting approval.
create table fleet_vehicles (
  id text primary key,
  asset_id text not null unique references institution_assets(id),
  registration text not null unique check (length(btrim(registration)) between 1 and 40),
  description text not null check (length(btrim(description)) between 1 and 200),
  distance_unit text not null check (distance_unit in ('km','mi')),
  opening_odometer bigint not null check (opening_odometer between 0 and 1000000000),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);
create table fleet_driver_authorisations (
  id text primary key,
  staff_id text not null references staff_members(id),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  requested_by text not null references accounts(id),
  approved_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  check (isfinite(valid_from) and isfinite(valid_until) and valid_until > valid_from),
  check (requested_by <> approved_by)
);
create table fleet_driver_revocations (
  authorisation_id text primary key references fleet_driver_authorisations(id),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now()
);
create table fleet_trips (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id),
  driver_authorisation_id text not null references fleet_driver_authorisations(id),
  requested_by text not null references accounts(id),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  destination text not null check (length(btrim(destination)) between 1 and 200),
  planned_start timestamptz not null,
  planned_end timestamptz not null,
  created_at timestamptz not null default now(),
  check (isfinite(planned_start) and isfinite(planned_end) and planned_end > planned_start)
);
create table fleet_trip_events (
  id bigint generated always as identity primary key,
  trip_id text not null references fleet_trips(id),
  revision integer not null check (revision > 0),
  kind text not null check (kind in ('approved','rejected','cancelled','dispatched','returned')),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  odometer bigint check (odometer between 0 and 1000000000),
  occurred_at timestamptz,
  recorded_at timestamptz not null default now(),
  unique (trip_id,revision),
  check ((kind in ('dispatched','returned')) = (odometer is not null)),
  check ((kind in ('dispatched','returned')) = (occurred_at is not null)),
  check (occurred_at is null or isfinite(occurred_at))
);
create index fleet_trip_vehicle_plan on fleet_trips(vehicle_id,planned_start,planned_end);
create index fleet_trip_driver_plan on fleet_trips(driver_authorisation_id,planned_start,planned_end);
create table fleet_service_events (
  id bigint generated always as identity primary key,
  vehicle_id text not null references fleet_vehicles(id),
  revision integer not null check (revision > 0),
  kind text not null check (kind in ('hold','release','service')),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now(),
  unique (vehicle_id,revision)
);
create index fleet_service_vehicle_history on fleet_service_events(vehicle_id,revision desc);
create table fleet_fuel_receipts (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id),
  receipt_reference text not null unique check (length(btrim(receipt_reference)) between 1 and 200),
  purchased_on date not null check (isfinite(purchased_on)),
  volume_millilitres bigint not null check (volume_millilitres between 1 and 1000000000),
  paid_minor bigint not null check (paid_minor between 0 and 10000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  accounting_reference text check (length(btrim(accounting_reference)) between 1 and 200),
  recorded_by text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create table fleet_incidents (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id),
  trip_id text references fleet_trips(id),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  details_encrypted text not null check (length(details_encrypted) between 1 and 20000),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_by text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create table fleet_incident_resolutions (
  incident_id text primary key references fleet_incidents(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  details_encrypted text not null check (length(details_encrypted) between 1 and 20000),
  resolved_by text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create table fleet_command_receipts (
  actor_id text not null references accounts(id),
  request_key text not null check (length(request_key) between 1 and 100),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  recorded_at timestamptz not null default now(),
  primary key (actor_id,request_key)
);

-- One fleet-wide lock orders operational writes; linked asset/staff/account shared locks
-- make dispatch checks linear with concurrent disposal, employment and account changes.
create function fleet_storage_guard() returns trigger language plpgsql as $$
declare
  vehicle text;
  asset institution_assets%rowtype;
  trip fleet_trips%rowtype;
  auth fleet_driver_authorisations%rowtype;
  staff staff_members%rowtype;
  previous fleet_trip_events%rowtype;
  service fleet_service_events%rowtype;
  latest_odometer bigint;
  driver_account text;
begin
  perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));
  NEW := jsonb_populate_record(NEW,to_jsonb(NEW) || jsonb_build_object(
    'recorded_at',clock_timestamp(),'created_at',clock_timestamp()));
  if TG_TABLE_NAME='fleet_driver_authorisations' then
    select * into staff from staff_members where id=NEW.staff_id for share;
    if staff.status is distinct from 'active' or staff.account_id is null or NEW.approved_by=staff.account_id then
      raise exception 'Driver authorisation requires active linked staff and independent approval';
    end if;
    if not exists(select 1 from accounts where id=staff.account_id and status='active') then
      raise exception 'Driver account must be active';
    end if;
    return NEW;
  elsif TG_TABLE_NAME in ('fleet_driver_revocations','fleet_command_receipts','fleet_incident_resolutions') then
    return NEW;
  elsif TG_TABLE_NAME='fleet_trip_events' then
    select * into trip from fleet_trips where id=NEW.trip_id;
    if not found then raise exception 'Unknown fleet trip'; end if;
    vehicle:=trip.vehicle_id;
    select * into previous from fleet_trip_events where trip_id=trip.id order by revision desc limit 1;
    if NEW.revision <> coalesce(previous.revision,0)+1 then raise exception 'Fleet trip revision changed'; end if;
    if not coalesce((previous.kind is null and NEW.kind in ('approved','rejected','cancelled')) or
      (previous.kind='approved' and NEW.kind in ('dispatched','cancelled')) or
      (previous.kind='dispatched' and NEW.kind='returned'),false) then
      raise exception 'Invalid fleet trip transition';
    end if;
    if NEW.kind in ('dispatched','returned') and (NEW.occurred_at > clock_timestamp() or
      NEW.occurred_at < trip.created_at or previous.occurred_at > NEW.occurred_at) then
      raise exception 'Invalid fleet trip actual time';
    end if;
    if NEW.kind='returned' then
      if NEW.odometer < previous.odometer then raise exception 'Odometer cannot decrease'; end if;
      return NEW;
    end if;
    if NEW.kind in ('rejected','cancelled') then return NEW; end if;
  elsif TG_TABLE_NAME='fleet_trips' then
    trip:=NEW;vehicle:=NEW.vehicle_id;
  elsif TG_TABLE_NAME='fleet_vehicles' then
    select * into asset from institution_assets where id=NEW.asset_id for share;
    if asset.status in ('disposed','disposal_pending') or asset.condition is distinct from 'serviceable' then
      raise exception 'Fleet registration requires a serviceable open asset';
    end if;
    return NEW;
  else
    vehicle:=NEW.vehicle_id;
  end if;
  select a.* into asset from fleet_vehicles v join institution_assets a on a.id=v.asset_id where v.id=vehicle for share of a;
  if not found then raise exception 'Unknown fleet vehicle'; end if;
  if TG_TABLE_NAME='fleet_service_events' then
    select coalesce(max(revision),0)+1 into NEW.revision from fleet_service_events where vehicle_id=vehicle;
    select * into service from fleet_service_events where vehicle_id=vehicle and kind in ('hold','release') order by revision desc limit 1;
    if NEW.kind='hold' and service.kind='hold' then raise exception 'Vehicle already held'; end if;
    if NEW.kind='release' and (service.kind is distinct from 'hold' or service.actor_id=NEW.actor_id) then
      raise exception 'Vehicle release requires a hold and independent evidence';
    end if;
    return NEW;
  elsif TG_TABLE_NAME='fleet_fuel_receipts' then
    if NEW.purchased_on > current_date then raise exception 'Fuel receipt cannot be future dated'; end if;
    perform 1 from reference_values where list_code='currency' and value_code=NEW.currency and status='active'
      and (effective_from is null or effective_from <= current_date) and (effective_to is null or effective_to >= current_date) for share;
    if not found then raise exception 'Fuel receipt requires an active currency'; end if;
    return NEW;
  elsif TG_TABLE_NAME='fleet_incidents' then
    if NEW.occurred_at > clock_timestamp() or (NEW.trip_id is not null and not exists(
      select 1 from fleet_trips where id=NEW.trip_id and vehicle_id=vehicle)) then
      raise exception 'Incident requires a matching vehicle and valid time';
    end if;
    return NEW;
  end if;
  select * into auth from fleet_driver_authorisations where id=trip.driver_authorisation_id for share;
  select * into staff from staff_members where id=auth.staff_id for share;
  driver_account:=staff.account_id;
  perform 1 from accounts where id=driver_account and status='active' for share;
  if not found or staff.status is distinct from 'active' or exists(
    select 1 from fleet_driver_revocations where authorisation_id=auth.id) then
    raise exception 'Driver authorisation is not current';
  end if;
  if trip.planned_start < auth.valid_from or trip.planned_end > auth.valid_until then
    raise exception 'Driver authorisation must cover the planned trip';
  end if;
  if TG_TABLE_NAME='fleet_trip_events' then
    if asset.status in ('disposed','disposal_pending') or asset.condition<>'serviceable' or exists(
      select 1 from fleet_service_events s where s.vehicle_id=vehicle and s.kind='hold' and s.revision=(
        select max(revision) from fleet_service_events where vehicle_id=vehicle and kind in ('hold','release'))) then
      raise exception 'Vehicle is unavailable';
    end if;
    if NEW.kind='approved' then
      if NEW.actor_id in (trip.requested_by,driver_account) then raise exception 'Trip approval must be independent'; end if;
      if exists(select 1 from fleet_trips t join fleet_driver_authorisations d on d.id=t.driver_authorisation_id
        join lateral (select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1) e on true
        where t.id<>trip.id and (t.vehicle_id=vehicle or d.staff_id=auth.staff_id) and e.kind in ('approved','dispatched')
        and tstzrange(t.planned_start,t.planned_end,'[)') && tstzrange(trip.planned_start,trip.planned_end,'[)')) then
        raise exception 'Fleet booking conflicts with an approved trip';
      end if;
    elsif NEW.kind='dispatched' then
      if NEW.occurred_at < trip.planned_start or NEW.occurred_at >= trip.planned_end or
        clock_timestamp() >= trip.planned_end then raise exception 'Dispatch must be within the planned trip'; end if;
      if clock_timestamp() < auth.valid_from or clock_timestamp() >= auth.valid_until or
        NEW.occurred_at < auth.valid_from or NEW.occurred_at >= auth.valid_until then
        raise exception 'Driver authorisation expired or not yet valid';
      end if;
      if exists(select 1 from fleet_trips t join fleet_driver_authorisations d on d.id=t.driver_authorisation_id
        join lateral (select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1) e on true
        where t.id<>trip.id and (t.vehicle_id=vehicle or d.staff_id=auth.staff_id) and e.kind='dispatched') then
        raise exception 'Vehicle or driver is already dispatched';
      end if;
      select greatest(v.opening_odometer,coalesce((select max(e.odometer) from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle),0)) into latest_odometer from fleet_vehicles v where v.id=vehicle;
      if NEW.odometer < latest_odometer then raise exception 'Odometer cannot decrease'; end if;
      if exists(select 1 from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle and e.kind='returned' and e.occurred_at > NEW.occurred_at) then
        raise exception 'Dispatch cannot precede a previous return';
      end if;
    end if;
  end if;
  return NEW;
end $$;

do $$
declare name text;
begin
  foreach name in array array['fleet_vehicles','fleet_driver_authorisations','fleet_driver_revocations','fleet_trips',
    'fleet_trip_events','fleet_service_events','fleet_fuel_receipts','fleet_incidents','fleet_incident_resolutions','fleet_command_receipts'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function ledger_append_only()',name || '_append_only',name);
    execute format('create trigger %I before insert on %I for each row execute function fleet_storage_guard()',name || '_insert_guard',name);
  end loop;
end $$;
