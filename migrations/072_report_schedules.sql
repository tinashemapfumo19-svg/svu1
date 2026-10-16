create table report_schedules (
  id text primary key,
  created_by text not null references accounts(id),
  report_kind text not null check (report_kind in ('admissions','registry','finance','support','enquiries','communications','academic','continuation','examinations')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  cadence text not null check (cadence in ('daily','weekly')),
  first_run_at timestamptz not null,
  retain_days integer not null check (retain_days between 1 and 366),
  grants jsonb not null check (jsonb_typeof(grants) = 'object'),
  configuration_encrypted text not null,
  custody_digest text not null check (custody_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  revision integer not null default 0 check (revision >= 0),
  next_run_at timestamptz not null,
  unique (created_by,request_key),
  check (next_run_at >= first_run_at)
);
create index report_schedule_due_idx on report_schedules(next_run_at,id) where status = 'active';
create index report_schedule_owner_idx on report_schedules(created_by,created_at desc,id desc);
create function report_schedule_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Report schedule custody cannot be deleted'; end if;
  if (to_jsonb(new) - 'status' - 'revision' - 'next_run_at') is distinct from (to_jsonb(old) - 'status' - 'revision' - 'next_run_at')
    or old.status = 'cancelled' or new.next_run_at < old.next_run_at
    or (new.status is distinct from old.status and new.revision <> old.revision + 1)
    or (new.status is not distinct from old.status and new.revision <> old.revision) then
    raise exception 'Report schedule definition is immutable and cancellation is terminal';
  end if;
  return new;
end;
$$;
create trigger report_schedule_immutable before update or delete on report_schedules for each row execute function report_schedule_guard();

create table report_schedule_runs (
  id text primary key,
  schedule_id text not null references report_schedules(id),
  scheduled_for timestamptz not null,
  retain_until date not null,
  created_at timestamptz not null default now(),
  attempts integer not null check (attempts between 1 and 3),
  custody_digest text not null check (custody_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running','succeeded','failed')),
  lease_token text,
  lease_until timestamptz,
  retry_at timestamptz,
  finished_at timestamptz,
  error_code text check (error_code in ('authority_unavailable','source_reconciliation','capture_unavailable','lease_expired','schedule_stopped')),
  edition_id text references report_editions(id),
  unique (schedule_id,scheduled_for),
  check ((status = 'running' and lease_token is not null and lease_until > created_at and retry_at is null and finished_at is null and error_code is null and edition_id is null)
    or (status = 'succeeded' and lease_token is null and lease_until is null and retry_at is null and finished_at >= created_at and error_code is null and edition_id is not null)
    or (status = 'failed' and lease_token is null and lease_until is null and finished_at >= created_at and error_code is not null and edition_id is null and (retry_at is null or retry_at >= finished_at and attempts < 3)))
);
create index report_schedule_run_history_idx on report_schedule_runs(schedule_id,scheduled_for desc,id desc);
create function report_schedule_run_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Report schedule run custody cannot be deleted'; end if;
  if row(new.id,new.schedule_id,new.scheduled_for,new.retain_until,new.created_at,new.custody_digest) is distinct from row(old.id,old.schedule_id,old.scheduled_for,old.retain_until,old.created_at,old.custody_digest)
    or old.status = 'succeeded' or old.status = 'failed' and old.retry_at is null then
    raise exception 'Report schedule run origin and terminal result are immutable';
  end if;
  if new.status = 'running' then
    if new.attempts <> old.attempts + 1 or old.attempts >= 3
      or old.status = 'running' and old.lease_until > transaction_timestamp()
      or old.status = 'failed' and old.retry_at > transaction_timestamp() then
      raise exception 'Invalid report schedule retry lease';
    end if;
  elsif old.status = 'failed' and new.status = 'failed' and new.retry_at is null and new.error_code = 'schedule_stopped' and new.attempts = old.attempts then
    return new;
  elsif old.status <> 'running' or new.attempts <> old.attempts then
    raise exception 'Invalid report schedule run completion';
  end if;
  return new;
end;
$$;
create trigger report_schedule_run_immutable before update or delete on report_schedule_runs for each row execute function report_schedule_run_guard();

create table report_schedule_transitions (
  id text primary key,
  schedule_id text not null references report_schedules(id),
  actor_id text not null references accounts(id),
  revision integer not null check (revision > 0),
  to_status text not null check (to_status in ('active','paused','cancelled')),
  reason_encrypted text not null,
  created_at timestamptz not null default now(),
  unique (schedule_id,revision)
);
create trigger report_schedule_transition_append_only before update or delete on report_schedule_transitions for each row execute function ledger_append_only();

insert into permissions(code,description) values ('reports.schedule','Delegate automatic creator-private captures within current native report authority') on conflict do nothing;
insert into roles(code,name,risk) values ('report_scheduler','Private Report Scheduler','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values ('report_scheduler','reports.schedule'),('system_administrator','reports.schedule') on conflict do nothing;
