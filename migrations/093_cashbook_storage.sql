create table cashbook_policies (
  id text primary key,
  title text not null check(length(btrim(title)) between 1 and 200),
  owner text not null check(length(btrim(owner)) between 1 and 200),
  policy_reference text not null check(length(btrim(policy_reference)) between 1 and 300),
  retention_rule text not null check(length(btrim(retention_rule)) between 1 and 2000),
  status text not null default 'draft' check(status in ('draft','published','retired')),
  revision integer not null default 1 check(revision>0),
  created_by text not null references accounts(id),
  reviewed_by text references accounts(id),
  created_at timestamptz not null default now(),
  check(status='draft' or (reviewed_by is not null and reviewed_by<>created_by))
);
create table cashbooks (
  id text primary key,
  policy_id text not null references cashbook_policies(id),
  name text not null check(length(btrim(name)) between 1 and 200),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  starts_on date not null check(starts_on>='1900-01-01'),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);
create table cashbook_accounts (
  id text primary key,
  book_id text not null references cashbooks(id),
  name text not null check(length(btrim(name)) between 1 and 200),
  kind text not null check(kind in ('bank','cash')),
  opened_on date not null,
  opening_minor bigint not null,
  opening_evidence_ref text not null check(length(btrim(opening_evidence_ref)) between 1 and 300),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  check(kind='bank' or opening_minor>=0),
  unique(book_id,id)
);
create table cashbook_movements (
  id text primary key,
  book_id text not null references cashbooks(id),
  kind text not null check(kind in ('revenue','expenditure','bank_charge','transfer','reversal')),
  occurred_on date not null,
  amount_minor bigint,
  account_id text,
  from_account_id text,
  to_account_id text,
  reverses_id text,
  evidence_ref text not null check(length(btrim(evidence_ref)) between 1 and 300),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  created_by text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique(book_id,id),
  foreign key(book_id,account_id) references cashbook_accounts(book_id,id),
  foreign key(book_id,from_account_id) references cashbook_accounts(book_id,id),
  foreign key(book_id,to_account_id) references cashbook_accounts(book_id,id),
  foreign key(book_id,reverses_id) references cashbook_movements(book_id,id),
  check(
    (kind='reversal' and reverses_id is not null and amount_minor is null and account_id is null and from_account_id is null and to_account_id is null) or
    (kind='transfer' and reverses_id is null and amount_minor is not null and amount_minor>0 and account_id is null and from_account_id is not null and to_account_id is not null and from_account_id<>to_account_id) or
    (kind in ('revenue','expenditure','bank_charge') and reverses_id is null and amount_minor is not null and amount_minor>0 and account_id is not null and from_account_id is null and to_account_id is null)
  )
);
create unique index cashbook_original_reversed_once on cashbook_movements(book_id,reverses_id) where reverses_id is not null;
create index cashbook_movement_period on cashbook_movements(book_id,occurred_on,id);
create table cashbook_periods (
  id text primary key,
  book_id text not null references cashbooks(id),
  starts_on date not null,
  ends_on date not null check(ends_on>=starts_on),
  status text not null default 'draft' check(status in ('draft','closed')),
  revision integer not null default 1 check(revision>0),
  snapshot jsonb,
  evidence_hash text check(evidence_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz,
  created_by text not null references accounts(id),
  closed_by text references accounts(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check((snapshot is null)=(evidence_hash is null) and (snapshot is null)=(captured_at is null)),
  check((status='closed')=(closed_by is not null) and (status='closed')=(closed_at is not null)),
  check(status<>'closed' or (closed_by<>created_by and snapshot is not null))
);
create index cashbook_period_lookup on cashbook_periods(book_id,starts_on,ends_on);
create table cashbook_command_receipts (
  actor_id text not null references accounts(id),
  request_key text not null,
  input_hash text not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
create trigger cashbook_movements_append_only before update or delete on cashbook_movements for each row execute function ledger_append_only();
create trigger cashbook_accounts_append_only before update or delete on cashbook_accounts for each row execute function ledger_append_only();
create trigger cashbooks_append_only before update or delete on cashbooks for each row execute function ledger_append_only();
create trigger cashbook_commands_append_only before update or delete on cashbook_command_receipts for each row execute function ledger_append_only();
create function protect_cashbook_policy() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Cashbook policies are retained'; end if;
  if (to_jsonb(NEW)-array['status','revision','reviewed_by'])<>(to_jsonb(OLD)-array['status','revision','reviewed_by']) or
    NEW.revision<>OLD.revision+1 or not ((OLD.status='draft' and NEW.status='published') or (OLD.status='published' and NEW.status='retired')) or
    (OLD.status='published' and NEW.reviewed_by is distinct from OLD.reviewed_by) then raise exception 'Cashbook policy definitions and approval are immutable'; end if;
  return NEW;
end $$;
create trigger cashbook_policy_guard before update or delete on cashbook_policies for each row execute function protect_cashbook_policy();
create function require_cashbook_policy(book text) returns void language plpgsql as $$
declare policy_status text;
begin
  select p.status into policy_status from cashbooks b join cashbook_policies p on p.id=b.policy_id where b.id=book for share of p;
  if policy_status is distinct from 'published' then raise exception 'Cashbook requires a published policy'; end if;
end $$;
create function guard_new_cashbook() returns trigger language plpgsql as $$
declare policy_status text;
begin
  select status into policy_status from cashbook_policies where id=NEW.policy_id for share;
  if policy_status is distinct from 'published' or NEW.starts_on>current_date then raise exception 'Cashbook requires published policy and valid start date'; end if;
  return NEW;
end $$;
create trigger cashbook_creation_guard before insert on cashbooks for each row execute function guard_new_cashbook();
create function guard_cashbook_account() returns trigger language plpgsql as $$
declare book_start date;
begin
  perform pg_advisory_xact_lock(hashtextextended('cashbook:'||NEW.book_id,0));
  perform require_cashbook_policy(NEW.book_id);
  select starts_on into book_start from cashbooks where id=NEW.book_id;
  if NEW.opened_on<book_start or NEW.opened_on>current_date or exists(select 1 from cashbook_periods where book_id=NEW.book_id and status='closed' and ends_on>=NEW.opened_on) then raise exception 'Account opening cannot alter closed cashbook history'; end if;
  return NEW;
end $$;
create trigger cashbook_account_creation_guard before insert on cashbook_accounts for each row execute function guard_cashbook_account();
create function guard_cashbook_movement() returns trigger language plpgsql as $$
declare original cashbook_movements; book_start date;
begin
  perform pg_advisory_xact_lock(hashtextextended('cashbook:'||NEW.book_id,0));
  perform require_cashbook_policy(NEW.book_id);
  select starts_on into book_start from cashbooks where id=NEW.book_id;
  if NEW.occurred_on<book_start or NEW.occurred_on>current_date or exists(select 1 from cashbook_periods where book_id=NEW.book_id and status='closed' and ends_on>=NEW.occurred_on) then raise exception 'Movement cannot alter closed cashbook history'; end if;
  if NEW.kind='reversal' then
    select * into original from cashbook_movements where book_id=NEW.book_id and id=NEW.reverses_id;
    if original.id is null or original.kind='reversal' or original.occurred_on>NEW.occurred_on then raise exception 'Reversal requires an earlier retained original movement'; end if;
  else
    if exists(select 1 from cashbook_accounts where book_id=NEW.book_id and id in (NEW.account_id,NEW.from_account_id,NEW.to_account_id) and opened_on>NEW.occurred_on) then raise exception 'Movement predates its account opening'; end if;
    if NEW.kind='bank_charge' and not exists(select 1 from cashbook_accounts where book_id=NEW.book_id and id=NEW.account_id and kind='bank') then raise exception 'Bank charge requires a bank account'; end if;
  end if;
  return NEW;
end $$;
create trigger cashbook_movement_guard before insert on cashbook_movements for each row execute function guard_cashbook_movement();
create function guard_cashbook_period() returns trigger language plpgsql as $$
declare book_start date;
begin
  if TG_OP='DELETE' then raise exception 'Cashbook periods are retained'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cashbook:'||NEW.book_id,0));
  perform require_cashbook_policy(NEW.book_id);
  select starts_on into book_start from cashbooks where id=NEW.book_id;
  if NEW.starts_on<book_start or NEW.ends_on>current_date or exists(select 1 from cashbook_periods p where p.book_id=NEW.book_id and p.id<>NEW.id and p.starts_on<=NEW.ends_on and NEW.starts_on<=p.ends_on) then raise exception 'Cashbook period is invalid or overlaps retained history'; end if;
  if TG_OP='UPDATE' and (OLD.status='closed' or NEW.revision<>OLD.revision+1 or (to_jsonb(NEW)-array['status','revision','snapshot','evidence_hash','captured_at','closed_by','closed_at'])<>(to_jsonb(OLD)-array['status','revision','snapshot','evidence_hash','captured_at','closed_by','closed_at'])) then raise exception 'Cashbook period definitions and closed snapshots are immutable'; end if;
  if NEW.snapshot is not null and (NEW.snapshot->>'definitionVersion' is distinct from 'cashbook-reconciliation-v2' or NEW.snapshot->>'evidenceHash' is distinct from NEW.evidence_hash or NEW.snapshot->>'from' is distinct from to_char(NEW.starts_on,'YYYY-MM-DD') or NEW.snapshot->>'to' is distinct from to_char(NEW.ends_on,'YYYY-MM-DD')) then raise exception 'Cashbook snapshot identity mismatch'; end if;
  if NEW.status='closed' then
    if jsonb_typeof(NEW.snapshot->'rows') is distinct from 'array' then raise exception 'Cashbook closing snapshot requires account rows'; end if;
    if exists(select 1 from cashbook_accounts a where a.book_id=NEW.book_id and a.opened_on<=NEW.ends_on and not exists(select 1 from jsonb_array_elements(NEW.snapshot->'rows') r where r->>'id'=a.id)) or
      exists(select 1 from jsonb_array_elements(NEW.snapshot->'rows') r where not exists(select 1 from cashbook_accounts a where a.book_id=NEW.book_id and a.opened_on<=NEW.ends_on and a.id=r->>'id')) or
      (select count(*) from jsonb_array_elements(NEW.snapshot->'rows'))<>(select count(distinct r->>'id') from jsonb_array_elements(NEW.snapshot->'rows') r) then raise exception 'Cashbook closing snapshot must cover every account exactly once'; end if;
    if NEW.captured_at>now() or exists(select 1 from cashbook_movements m where m.book_id=NEW.book_id and m.occurred_on between NEW.starts_on and NEW.ends_on and m.recorded_at>NEW.captured_at) or
      jsonb_typeof(NEW.snapshot->'movementCount') is distinct from 'number' or
      (NEW.snapshot->>'movementCount')::integer<>(select count(*) from cashbook_movements m where m.book_id=NEW.book_id and m.occurred_on between NEW.starts_on and NEW.ends_on) then raise exception 'Cashbook closing snapshot is stale'; end if;
  end if;
  if NEW.status='closed' and (NEW.closed_by=NEW.created_by or exists(select 1 from cashbook_movements where book_id=NEW.book_id and occurred_on between NEW.starts_on and NEW.ends_on and created_by=NEW.closed_by)) then raise exception 'Cashbook closure requires an independent actor'; end if;
  return NEW;
end $$;
create trigger cashbook_period_guard before insert or update or delete on cashbook_periods for each row execute function guard_cashbook_period();
