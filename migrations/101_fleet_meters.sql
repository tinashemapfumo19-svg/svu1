alter table fleet_trip_events add column meter_revision integer not null default 0 check (meter_revision >= 0);

create table fleet_meter_changes (
  id text primary key, vehicle_id text not null references fleet_vehicles(id),
  expected_revision integer not null check (expected_revision >= 0),
  expected_reading_revision integer not null check (expected_reading_revision >= 0),
  last_event_id bigint references fleet_trip_events(id),
  kind text not null check (kind in ('replacement','reset')),
  closing_odometer bigint not null check (closing_odometer between 0 and 1000000000),
  opening_odometer bigint not null check (opening_odometer between 0 and 1000000000),
  meter_reference text not null check (length(btrim(meter_reference)) between 1 and 200),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  requested_by text not null references accounts(id), recorded_at timestamptz not null default now()
);
create table fleet_meter_decisions (
  change_id text primary key references fleet_meter_changes(id), vehicle_id text not null references fleet_vehicles(id),
  outcome text not null check (outcome in ('approved','rejected')), applied_revision integer check (applied_revision > 0),
  actor_id text not null references accounts(id), evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now(),
  check ((outcome='approved') = (applied_revision is not null)), unique(vehicle_id,applied_revision)
);
create table fleet_reading_corrections (
  id text primary key, vehicle_id text not null references fleet_vehicles(id),
  expected_revision integer not null check (expected_revision >= 0),
  expected_meter_revision integer not null check (expected_meter_revision >= 0),
  last_event_id bigint references fleet_trip_events(id),
  target_meter_revision integer not null check (target_meter_revision >= 0),
  target_kind text not null check (target_kind in ('opening','closing','trip')),
  target_event_id bigint references fleet_trip_events(id),
  odometer bigint not null check (odometer between 0 and 1000000000),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  requested_by text not null references accounts(id), recorded_at timestamptz not null default now(),
  check ((target_kind='trip') = (target_event_id is not null))
);
create table fleet_reading_decisions (
  correction_id text primary key references fleet_reading_corrections(id), vehicle_id text not null references fleet_vehicles(id),
  outcome text not null check (outcome in ('approved','rejected')), applied_revision integer check (applied_revision > 0),
  actor_id text not null references accounts(id), evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 200),
  recorded_at timestamptz not null default now(),
  check ((outcome='approved') = (applied_revision is not null)), unique(vehicle_id,applied_revision)
);
create index fleet_meter_change_history on fleet_meter_changes(vehicle_id,recorded_at desc,id);
create index fleet_reading_correction_history on fleet_reading_corrections(vehicle_id,recorded_at desc,id);
create index fleet_reading_target on fleet_reading_corrections(vehicle_id,target_meter_revision,target_kind,target_event_id);

create function fleet_effective_reading(vehicle text, epoch integer, kind text, event_id bigint default null)
returns bigint language plpgsql stable as $$
declare original bigint; corrected bigint;
begin
  if kind='trip' then
    select e.odometer into original from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
      where e.id=event_id and t.vehicle_id=vehicle and e.meter_revision=epoch and e.odometer is not null;
  elsif kind='opening' and epoch=0 then
    select opening_odometer into original from fleet_vehicles where id=vehicle;
  elsif kind in ('opening','closing') then
    select case when fleet_effective_reading.kind='opening' then c.opening_odometer else c.closing_odometer end into original
      from fleet_meter_changes c join fleet_meter_decisions d on d.change_id=c.id
      where d.vehicle_id=vehicle and d.outcome='approved' and d.applied_revision=case when fleet_effective_reading.kind='opening' then epoch else epoch+1 end;
  end if;
  if original is null then return null; end if;
  select c.odometer into corrected from fleet_reading_corrections c join fleet_reading_decisions d on d.correction_id=c.id
    where c.vehicle_id=vehicle and c.target_meter_revision=epoch and c.target_kind=kind and c.target_event_id is not distinct from event_id
      and d.outcome='approved' order by d.applied_revision desc limit 1;
  return coalesce(corrected,original);
end $$;

create function fleet_meter_offset(vehicle text, epoch integer) returns bigint language sql stable as $$
  select fleet_effective_reading(vehicle,0,'opening')-fleet_effective_reading(vehicle,epoch,'opening')+
    coalesce((select sum(fleet_effective_reading(vehicle,n,'closing')-fleet_effective_reading(vehicle,n,'opening'))
      from generate_series(0,epoch-1) n),0)::bigint
$$;

create function fleet_meter_state(vehicle text)
returns table(revision integer,reading_revision integer,last_event_id bigint,odometer bigint,opening_odometer bigint,
  cumulative_odometer bigint,effective_from timestamptz,pending boolean) language plpgsql stable as $$
begin
  select coalesce(max(applied_revision),0) into revision from fleet_meter_decisions where vehicle_id=vehicle and outcome='approved';
  select coalesce(max(applied_revision),0) into reading_revision from fleet_reading_decisions where vehicle_id=vehicle and outcome='approved';
  select e.id into last_event_id from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
    where t.vehicle_id=vehicle and e.meter_revision=fleet_meter_state.revision and e.odometer is not null order by e.recorded_at desc,e.id desc limit 1;
  opening_odometer:=fleet_effective_reading(vehicle,revision,'opening');
  odometer:=coalesce(fleet_effective_reading(vehicle,revision,'trip',last_event_id),opening_odometer);
  cumulative_odometer:=odometer+fleet_meter_offset(vehicle,revision);
  select coalesce((select c.occurred_at from fleet_meter_changes c join fleet_meter_decisions d on d.change_id=c.id
    where d.vehicle_id=vehicle and d.applied_revision=fleet_meter_state.revision and d.outcome='approved'),v.created_at) into effective_from from fleet_vehicles v where v.id=vehicle;
  pending:=exists(select 1 from fleet_meter_changes c where c.vehicle_id=vehicle and not exists(select 1 from fleet_meter_decisions where change_id=c.id))
    or exists(select 1 from fleet_reading_corrections c where c.vehicle_id=vehicle and not exists(select 1 from fleet_reading_decisions where correction_id=c.id));
  return next;
end $$;

create function fleet_meter_guard() returns trigger language plpgsql as $$
declare change fleet_meter_changes%rowtype; correction fleet_reading_corrections%rowtype; state record; target_event fleet_trip_events%rowtype;
  vehicle text; lower_reading bigint; upper_reading bigint; original bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));
  NEW.recorded_at:=clock_timestamp();vehicle:=NEW.vehicle_id;
  if TG_TABLE_NAME='fleet_meter_decisions' then
    select * into change from fleet_meter_changes where id=NEW.change_id;
    if not found or change.vehicle_id<>vehicle or change.requested_by=NEW.actor_id then raise exception 'Meter decision requires matching identity and independent review'; end if;
    if NEW.outcome='rejected' then return NEW; end if;
  elsif TG_TABLE_NAME='fleet_meter_changes' then change:=NEW;
  elsif TG_TABLE_NAME='fleet_reading_decisions' then
    select * into correction from fleet_reading_corrections where id=NEW.correction_id;
    if not found or correction.vehicle_id<>vehicle or correction.requested_by=NEW.actor_id then raise exception 'Reading decision requires matching identity and independent review'; end if;
    if NEW.outcome='rejected' then return NEW; end if;
  else correction:=NEW;
  end if;
  perform 1 from fleet_vehicles v join institution_assets a on a.id=v.asset_id where v.id=vehicle and a.status not in ('disposed','disposal_pending') for share of a;
  if not found then raise exception 'Meter operation requires an open vehicle asset'; end if;
  if exists(select 1 from fleet_trips t join lateral(select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1)e on true
    where t.vehicle_id=vehicle and e.kind='dispatched') then raise exception 'Meter operation is unavailable while dispatched'; end if;
  select * into state from fleet_meter_state(vehicle);
  if change.id is not null then
    if change.expected_revision<>state.revision or change.expected_reading_revision<>state.reading_revision or change.last_event_id is distinct from state.last_event_id then
      raise exception 'Meter snapshot changed'; end if;
    if TG_TABLE_NAME='fleet_meter_decisions' then
      if NEW.applied_revision<>state.revision+1 then raise exception 'Meter revision changed'; end if;
    end if;
    if change.closing_odometer<state.odometer or change.occurred_at>clock_timestamp() or change.occurred_at<state.effective_from or exists(
      select 1 from fleet_trip_events where id=state.last_event_id and occurred_at>change.occurred_at) then raise exception 'Invalid meter closing reading or time'; end if;
  else
    if correction.expected_revision<>state.reading_revision or correction.expected_meter_revision<>state.revision or correction.last_event_id is distinct from state.last_event_id then
      raise exception 'Reading snapshot changed'; end if;
    if TG_TABLE_NAME='fleet_reading_decisions' then
      if NEW.applied_revision<>state.reading_revision+1 then raise exception 'Reading revision changed'; end if;
    end if;
    original:=fleet_effective_reading(vehicle,correction.target_meter_revision,correction.target_kind,correction.target_event_id);
    if original is null or original=correction.odometer then raise exception 'Reading correction requires an existing changed target'; end if;
    if correction.target_kind='opening' then
      lower_reading:=0;
      select min(fleet_effective_reading(vehicle,correction.target_meter_revision,'trip',e.id)) into upper_reading from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle and e.meter_revision=correction.target_meter_revision and e.odometer is not null;
      upper_reading:=coalesce(upper_reading,fleet_effective_reading(vehicle,correction.target_meter_revision,'closing'));
    elsif correction.target_kind='closing' then
      select max(fleet_effective_reading(vehicle,correction.target_meter_revision,'trip',e.id)) into lower_reading from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle and e.meter_revision=correction.target_meter_revision and e.odometer is not null;
      lower_reading:=coalesce(lower_reading,fleet_effective_reading(vehicle,correction.target_meter_revision,'opening'));
    else
      select * into target_event from fleet_trip_events where id=correction.target_event_id;
      select max(fleet_effective_reading(vehicle,correction.target_meter_revision,'trip',e.id)) into lower_reading from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle and e.meter_revision=correction.target_meter_revision and e.odometer is not null
          and (e.recorded_at,e.id)<(target_event.recorded_at,target_event.id);
      select min(fleet_effective_reading(vehicle,correction.target_meter_revision,'trip',e.id)) into upper_reading from fleet_trip_events e join fleet_trips t on t.id=e.trip_id
        where t.vehicle_id=vehicle and e.meter_revision=correction.target_meter_revision and e.odometer is not null
          and (e.recorded_at,e.id)>(target_event.recorded_at,target_event.id);
      lower_reading:=coalesce(lower_reading,fleet_effective_reading(vehicle,correction.target_meter_revision,'opening'));
      upper_reading:=coalesce(upper_reading,fleet_effective_reading(vehicle,correction.target_meter_revision,'closing'));
    end if;
    if correction.odometer<lower_reading or (upper_reading is not null and correction.odometer>upper_reading) then raise exception 'Correction violates retained reading order'; end if;
  end if;
  return NEW;
end $$;
do $$ declare name text; begin
  foreach name in array array['fleet_meter_changes','fleet_meter_decisions','fleet_reading_corrections','fleet_reading_decisions'] loop
    execute format('create trigger %I before insert on %I for each row execute function fleet_meter_guard()',name || '_insert',name);
    execute format('create trigger %I before update or delete on %I for each row execute function ledger_append_only()',name || '_retained',name);
  end loop;
end $$;

-- Only trip-event validation changes; existing asset/driver/service/fuel guards remain intact.
create function fleet_meter_trip_guard() returns trigger language plpgsql as $$
declare trip fleet_trips%rowtype; previous fleet_trip_events%rowtype; asset institution_assets%rowtype;
  auth fleet_driver_authorisations%rowtype; staff staff_members%rowtype; state record;
begin
  perform pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0));NEW.recorded_at:=clock_timestamp();
  select * into trip from fleet_trips where id=NEW.trip_id;
  if not found then raise exception 'Unknown fleet trip'; end if;
  select * into previous from fleet_trip_events where trip_id=trip.id order by revision desc limit 1;
  if NEW.revision<>coalesce(previous.revision,0)+1 then raise exception 'Fleet trip revision changed'; end if;
  if not coalesce((previous.kind is null and NEW.kind in ('approved','rejected','cancelled')) or
    (previous.kind='approved' and NEW.kind in ('dispatched','cancelled')) or (previous.kind='dispatched' and NEW.kind='returned'),false) then raise exception 'Invalid fleet trip transition'; end if;
  if NEW.kind in ('dispatched','returned') then
    select * into state from fleet_meter_state(trip.vehicle_id);
    if NEW.meter_revision<>state.revision or NEW.occurred_at>clock_timestamp() or NEW.occurred_at<trip.created_at or
      NEW.occurred_at<state.effective_from or previous.occurred_at>NEW.occurred_at then raise exception 'Invalid fleet actual time or meter revision'; end if;
    if NEW.kind='returned' then
      if previous.meter_revision<>NEW.meter_revision or NEW.odometer<fleet_effective_reading(trip.vehicle_id,NEW.meter_revision,'trip',previous.id) then raise exception 'Odometer cannot decrease within a meter period'; end if;
      return NEW;
    end if;
    if state.pending then raise exception 'Resolve pending meter reviews before dispatch'; end if;
    if NEW.odometer<state.odometer then raise exception 'Odometer cannot decrease within a meter period'; end if;
  end if;
  if NEW.kind in ('rejected','cancelled') then return NEW; end if;
  select a.* into asset from fleet_vehicles v join institution_assets a on a.id=v.asset_id where v.id=trip.vehicle_id for share of a;
  select * into auth from fleet_driver_authorisations where id=trip.driver_authorisation_id for share;
  select * into staff from staff_members where id=auth.staff_id for share;
  perform 1 from accounts where id=staff.account_id and status='active' for share;
  if not found or staff.status is distinct from 'active' or exists(select 1 from fleet_driver_revocations where authorisation_id=auth.id) then raise exception 'Driver authorisation is not current'; end if;
  if trip.planned_start<auth.valid_from or trip.planned_end>auth.valid_until then raise exception 'Driver authorisation must cover the planned trip'; end if;
  if asset.status in ('disposed','disposal_pending') or asset.condition<>'serviceable' or exists(select 1 from fleet_service_events s
    where s.vehicle_id=trip.vehicle_id and s.kind='hold' and s.revision=(select max(revision) from fleet_service_events where vehicle_id=trip.vehicle_id and kind in ('hold','release'))) then raise exception 'Vehicle is unavailable'; end if;
  if NEW.kind='approved' then
    if NEW.actor_id in (trip.requested_by,staff.account_id) then raise exception 'Trip approval must be independent'; end if;
    if exists(select 1 from fleet_trips t join fleet_driver_authorisations d on d.id=t.driver_authorisation_id
      join lateral(select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1)e on true
      where t.id<>trip.id and (t.vehicle_id=trip.vehicle_id or d.staff_id=auth.staff_id) and e.kind in ('approved','dispatched')
      and tstzrange(t.planned_start,t.planned_end,'[)') && tstzrange(trip.planned_start,trip.planned_end,'[)')) then raise exception 'Fleet booking conflicts with an approved trip'; end if;
  elsif NEW.kind='dispatched' then
    if NEW.occurred_at<trip.planned_start or NEW.occurred_at>=trip.planned_end or clock_timestamp()>=trip.planned_end then raise exception 'Dispatch must be within the planned trip'; end if;
    if clock_timestamp()<auth.valid_from or clock_timestamp()>=auth.valid_until or NEW.occurred_at<auth.valid_from or NEW.occurred_at>=auth.valid_until then raise exception 'Driver authorisation expired or not yet valid'; end if;
    if exists(select 1 from fleet_trips t join fleet_driver_authorisations d on d.id=t.driver_authorisation_id
      join lateral(select kind from fleet_trip_events where trip_id=t.id order by revision desc limit 1)e on true
      where t.id<>trip.id and (t.vehicle_id=trip.vehicle_id or d.staff_id=auth.staff_id) and e.kind='dispatched') then raise exception 'Vehicle or driver is already dispatched'; end if;
    if exists(select 1 from fleet_trip_events e join fleet_trips t on t.id=e.trip_id where t.vehicle_id=trip.vehicle_id and e.kind='returned' and e.occurred_at>NEW.occurred_at) then raise exception 'Dispatch cannot precede a previous return'; end if;
  end if;
  return NEW;
end $$;
drop trigger fleet_trip_events_insert_guard on fleet_trip_events;
create trigger fleet_trip_events_insert_guard before insert on fleet_trip_events for each row execute function fleet_meter_trip_guard();
