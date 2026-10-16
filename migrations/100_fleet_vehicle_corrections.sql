create table fleet_vehicle_corrections (
  id text primary key,
  vehicle_id text not null references fleet_vehicles(id),
  expected_revision integer not null check (expected_revision >= 0),
  registration text not null check (length(btrim(registration)) between 1 and 40 and registration=upper(btrim(registration))),
  description text not null check (length(btrim(description)) between 1 and 200),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  requested_by text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create index fleet_vehicle_correction_history on fleet_vehicle_corrections(vehicle_id,recorded_at desc,id);
create table fleet_vehicle_correction_decisions (
  correction_id text primary key references fleet_vehicle_corrections(id),
  vehicle_id text not null references fleet_vehicles(id),
  outcome text not null check (outcome in ('approved','rejected')),
  applied_revision integer check (applied_revision > 0),
  actor_id text not null references accounts(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now(),
  check ((outcome='approved') = (applied_revision is not null)),
  unique(vehicle_id,applied_revision)
);

create view fleet_current_vehicles as
select v.id,v.asset_id,coalesce(c.registration,v.registration) as registration,
  coalesce(c.description,v.description) as description,v.distance_unit,v.opening_odometer,
  v.evidence_reference,v.created_by,v.created_at,coalesce(d.applied_revision,0) as definition_revision
from fleet_vehicles v
left join lateral(select correction_id,applied_revision from fleet_vehicle_correction_decisions
  where vehicle_id=v.id and outcome='approved' order by applied_revision desc limit 1) d on true
left join fleet_vehicle_corrections c on c.id=d.correction_id;

create function fleet_vehicle_correction_guard() returns trigger language plpgsql as $$
declare
  proposal fleet_vehicle_corrections%rowtype;
  current_vehicle fleet_current_vehicles%rowtype;
  target_vehicle text;
begin
  perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));
  if TG_TABLE_NAME='fleet_vehicles' then
    -- Retained registrations cannot silently become another vehicle's identity.
    if exists(select 1 from fleet_vehicles where upper(btrim(registration))=upper(btrim(NEW.registration))) or exists(
      select 1 from fleet_vehicle_corrections c join fleet_vehicle_correction_decisions d on d.correction_id=c.id
      where d.outcome='approved' and upper(btrim(c.registration))=upper(btrim(NEW.registration))) then
      raise exception 'Registration belongs to a retained fleet identity';
    end if;
    return NEW;
  end if;
  NEW.recorded_at:=clock_timestamp();
  target_vehicle:=NEW.vehicle_id;
  select * into current_vehicle from fleet_current_vehicles where id=target_vehicle;
  if not found then raise exception 'Unknown fleet vehicle'; end if;
  if TG_TABLE_NAME='fleet_vehicle_correction_decisions' then
    select * into proposal from fleet_vehicle_corrections where id=NEW.correction_id;
    if not found or proposal.vehicle_id<>target_vehicle or proposal.requested_by=NEW.actor_id then
      raise exception 'Vehicle correction decision requires matching identity and independent evidence';
    end if;
    if NEW.outcome='rejected' then return NEW; end if;
    if proposal.expected_revision<>current_vehicle.definition_revision or NEW.applied_revision<>current_vehicle.definition_revision+1 then
      raise exception 'Vehicle definition revision changed';
    end if;
  else
    proposal:=NEW;
    if proposal.expected_revision<>current_vehicle.definition_revision then raise exception 'Vehicle definition revision changed'; end if;
  end if;
  perform 1 from institution_assets where id=current_vehicle.asset_id and status not in ('disposed','disposal_pending') for share;
  if not found then raise exception 'Vehicle asset is retired or awaiting disposal'; end if;
  if exists(select 1 from fleet_trips t join lateral(select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1)e on true
    where t.vehicle_id=target_vehicle and e.kind='dispatched') then
    raise exception 'Vehicle identity cannot change while dispatched';
  end if;
  if proposal.registration=current_vehicle.registration and proposal.description=current_vehicle.description then
    raise exception 'Vehicle correction must change the definition';
  end if;
  if exists(select 1 from fleet_vehicles where id<>target_vehicle and upper(btrim(registration))=proposal.registration) or exists(
    select 1 from fleet_vehicle_corrections c join fleet_vehicle_correction_decisions d on d.correction_id=c.id
    where c.vehicle_id<>target_vehicle and d.outcome='approved' and c.registration=proposal.registration) then
    raise exception 'Registration belongs to another retained fleet identity';
  end if;
  return NEW;
end $$;
create trigger fleet_vehicle_registration_reserved before insert on fleet_vehicles for each row execute function fleet_vehicle_correction_guard();
create trigger fleet_vehicle_corrections_insert before insert on fleet_vehicle_corrections for each row execute function fleet_vehicle_correction_guard();
create trigger fleet_vehicle_correction_decisions_insert before insert on fleet_vehicle_correction_decisions for each row execute function fleet_vehicle_correction_guard();
create trigger fleet_vehicle_corrections_retained before update or delete on fleet_vehicle_corrections for each row execute function ledger_append_only();
create trigger fleet_vehicle_correction_decisions_retained before update or delete on fleet_vehicle_correction_decisions for each row execute function ledger_append_only();
