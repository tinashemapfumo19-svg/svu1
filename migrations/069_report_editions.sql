create table report_editions (
  id text primary key,
  created_by text not null references accounts(id),
  report_kind text not null check (report_kind in ('admissions','registry','finance','support','enquiries','communications','academic','continuation','examinations')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  definition_version text not null,
  source_generated_at timestamptz not null,
  created_at timestamptz not null,
  retain_until date not null,
  grants jsonb not null,
  title_encrypted text not null,
  reason_encrypted text not null,
  payload_encrypted text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  custody_digest text not null check (custody_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'retained' check (status in ('retained','withdrawn')),
  withdrawn_at timestamptz,
  withdrawal_reason_encrypted text,
  unique (created_by,request_key),
  check (source_generated_at <= created_at),
  check (retain_until >= (created_at at time zone 'UTC')::date and retain_until <= (created_at at time zone 'UTC')::date + 366),
  check (jsonb_typeof(grants) = 'object'),
  check ((status = 'retained' and withdrawn_at is null and withdrawal_reason_encrypted is null)
    or (status = 'withdrawn' and withdrawn_at >= created_at and withdrawal_reason_encrypted is not null))
);
create index report_edition_owner_idx on report_editions(created_by,created_at desc,id desc);
create function report_edition_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Retained report editions cannot be deleted'; end if;
  if (to_jsonb(new) - 'status' - 'withdrawn_at' - 'withdrawal_reason_encrypted') is distinct from
     (to_jsonb(old) - 'status' - 'withdrawn_at' - 'withdrawal_reason_encrypted')
     or old.status <> 'retained' or new.status <> 'withdrawn' then
    raise exception 'Report edition custody and payload are immutable; withdrawal is terminal';
  end if;
  return new;
end;
$$;
create trigger report_edition_immutable before update or delete on report_editions for each row execute function report_edition_guard();
