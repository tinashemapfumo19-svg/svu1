create table cashbook_capture_history (
  period_id text not null references cashbook_periods(id),
  revision integer not null check(revision>1),
  actor_id text not null references accounts(id),
  snapshot jsonb not null,
  captured_at timestamptz not null default now(),
  primary key(period_id,revision)
);
create trigger cashbook_capture_append_only before update or delete on cashbook_capture_history for each row execute function ledger_append_only();
create function guard_cashbook_capture_history() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from cashbook_periods p where p.id=NEW.period_id and p.status='draft' and p.revision=NEW.revision and p.snapshot=NEW.snapshot) then raise exception 'Cashbook capture history must match the current draft snapshot'; end if;
  return NEW;
end $$;
create trigger cashbook_capture_identity_guard before insert on cashbook_capture_history for each row execute function guard_cashbook_capture_history();
create function require_independent_cashbook_capture() returns trigger language plpgsql as $$
begin
  if NEW.status='closed' and exists(select 1 from cashbook_capture_history where period_id=NEW.id and actor_id=NEW.closed_by) then raise exception 'Cashbook closure must be independent of observation capturers'; end if;
  return NEW;
end $$;
create trigger cashbook_capture_closure_guard before insert or update on cashbook_periods for each row execute function require_independent_cashbook_capture();
