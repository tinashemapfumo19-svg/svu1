create table room_message_preferences (
  account_id text primary key references accounts(id),
  enabled boolean not null default false,
  revision integer not null check(revision>0),
  updated_at timestamptz not null default now()
);
create function room_preference_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Room preferences are retained'; end if;
  if new.account_id is distinct from old.account_id or new.revision<>old.revision+1 then raise exception 'Room preference revision must advance'; end if;
  return new;
end $$;
create trigger room_preference_protected before update or delete on room_message_preferences for each row execute function room_preference_guard();
create table room_message_preference_history (
  account_id text not null references accounts(id),
  revision integer not null check(revision>0),
  enabled boolean not null,
  recorded_at timestamptz not null default now(),
  primary key(account_id,revision)
);
create trigger room_preference_history_append_only before update or delete on room_message_preference_history for each row execute function ledger_append_only();
create function room_preference_history_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from room_message_preferences p where p.account_id=new.account_id and p.revision=new.revision and p.enabled=new.enabled) then raise exception 'Room preference history must match current choice'; end if;
  return new;
end $$;
create trigger room_preference_history_valid before insert on room_message_preference_history for each row execute function room_preference_history_guard();

create table message_rooms (
  id text primary key,
  title text not null check(length(btrim(title)) between 1 and 200),
  purpose text not null check(length(btrim(purpose)) between 1 and 2000),
  policy_reference text not null check(length(btrim(policy_reference)) between 1 and 300),
  retention_rule text not null check(length(btrim(retention_rule)) between 1 and 2000),
  created_by text not null references accounts(id),
  reviewed_by text references accounts(id),
  status text not null default 'draft' check(status in ('draft','active','closed')),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  check(reviewed_by is null or reviewed_by<>created_by),
  check(status<>'active' or reviewed_by is not null and activated_at is not null),
  check(activated_at is null or activated_at>=created_at),
  check(closed_at is null or closed_at>=coalesce(activated_at,created_at)),
  check((status='closed')=(closed_at is not null))
);
create function message_room_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Message rooms are retained'; end if;
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||new.id,0));
  if tg_op='INSERT' then
    if new.status<>'draft' or new.revision<>1 or new.reviewed_by is not null or new.activated_at is not null or new.closed_at is not null then raise exception 'Message rooms begin as explicit drafts'; end if;
  else
    if (to_jsonb(new)-'status'-'revision'-'reviewed_by'-'activated_at'-'closed_at') is distinct from (to_jsonb(old)-'status'-'revision'-'reviewed_by'-'activated_at'-'closed_at')
      or new.revision<>old.revision+1 or not (old.status='draft' and new.status in ('active','closed') or old.status='active' and new.status='closed')
      or old.status='active' and (new.reviewed_by is distinct from old.reviewed_by or new.activated_at is distinct from old.activated_at)
      or new.status='closed' and old.status='draft' and (new.reviewed_by is not null or new.activated_at is not null) then raise exception 'Room definition and lifecycle are protected'; end if;
  end if;
  return new;
end $$;
create trigger message_room_protected before insert or update or delete on message_rooms for each row execute function message_room_guard();

create table message_room_memberships (
  id text primary key,
  room_id text not null references message_rooms(id),
  account_id text not null references accounts(id),
  invited_by text not null references accounts(id),
  status text not null default 'pending' check(status in ('pending','accepted','declined','left','removed','banned')),
  role text not null default 'member' check(role in ('member','moderator')),
  revision integer not null default 1 check(revision>0),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by text references accounts(id),
  consent_revision integer,
  ended_at timestamptz,
  unique(id,room_id,account_id),
  foreign key(account_id,consent_revision) references room_message_preference_history(account_id,revision),
  check((status in ('declined','left','removed','banned'))=(ended_at is not null)),
  check((accepted_at is null)=(accepted_by is null) and (accepted_at is null)=(consent_revision is null)),
  check(accepted_by is null or accepted_by=account_id),
  check(status<>'accepted' or accepted_at is not null),
  check(status<>'pending' or accepted_at is null),
  check(accepted_at is null or accepted_at>=invited_at),
  check(ended_at is null or ended_at>=coalesce(accepted_at,invited_at))
);
create unique index room_live_membership on message_room_memberships(room_id,account_id) where status in ('pending','accepted','banned');
create index room_own_memberships on message_room_memberships(account_id,invited_at desc,id);
create function message_room_membership_guard() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Room memberships are retained'; end if;
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||new.room_id,0));
  if not exists(select 1 from message_rooms r where r.id=new.room_id and r.status='active') then raise exception 'Membership changes require an active room'; end if;
  if tg_op='INSERT' then
    if new.status not in ('pending','accepted') or new.revision<>1 then raise exception 'Membership must begin as an invitation or explicit acceptance'; end if;
    if new.status='accepted' and not (new.invited_by=new.account_id and exists(select 1 from message_rooms r where r.id=new.room_id and r.created_by=new.account_id)) then raise exception 'Only the room creator can explicitly accept at creation'; end if;
  else
    if (to_jsonb(new)-'status'-'role'-'revision'-'accepted_at'-'accepted_by'-'consent_revision'-'ended_at') is distinct from (to_jsonb(old)-'status'-'role'-'revision'-'accepted_at'-'accepted_by'-'consent_revision'-'ended_at')
      or new.revision<>old.revision+1
      or not (old.status='pending' and new.status in ('accepted','declined','removed','banned') or old.status='accepted' and new.status in ('accepted','left','removed','banned') or old.status='banned' and new.status='left')
      or old.accepted_at is not null and (new.accepted_at is distinct from old.accepted_at or new.accepted_by is distinct from old.accepted_by or new.consent_revision is distinct from old.consent_revision)
      or new.status<>'accepted' and (new.accepted_at is distinct from old.accepted_at or new.accepted_by is distinct from old.accepted_by or new.consent_revision is distinct from old.consent_revision)
      or old.ended_at is not null and new.ended_at is distinct from old.ended_at
      or new.role is distinct from old.role and not (old.status='accepted' and new.status='accepted') then raise exception 'Membership origin, consent and lifecycle are protected'; end if;
  end if;
  if new.status='accepted' and not exists(select 1 from room_message_preferences p join room_message_preference_history h on h.account_id=p.account_id and h.revision=p.revision join accounts a on a.id=p.account_id where p.account_id=new.account_id and p.enabled and h.enabled and p.revision=new.consent_revision and a.status='active') then raise exception 'Acceptance requires current explicit room consent'; end if;
  return new;
end $$;
create trigger room_membership_protected before insert or update or delete on message_room_memberships for each row execute function message_room_membership_guard();
create table message_room_membership_history (
  membership_id text not null references message_room_memberships(id),
  revision integer not null check(revision>0),
  status text not null check(status in ('pending','accepted','declined','left','removed','banned')),
  role text not null check(role in ('member','moderator')),
  actor_id text not null references accounts(id),
  reason_encrypted text not null check(length(reason_encrypted) between 1 and 20000),
  recorded_at timestamptz not null default now(),
  primary key(membership_id,revision)
);
create trigger room_membership_history_append_only before update or delete on message_room_membership_history for each row execute function ledger_append_only();
create function room_membership_history_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from message_room_memberships m where m.id=new.membership_id and m.revision=new.revision and m.status=new.status and m.role=new.role) then raise exception 'Membership history must match current revision'; end if;
  return new;
end $$;
create trigger room_membership_history_valid before insert on message_room_membership_history for each row execute function room_membership_history_guard();

create table room_messages (
  id text primary key,
  position bigint generated always as identity unique,
  room_id text not null references message_rooms(id),
  author_id text not null references accounts(id),
  membership_id text not null,
  kind text not null default 'text' check(kind in ('text','action','notice')),
  envelope text not null check(length(envelope) between 1 and 20000),
  created_at timestamptz not null default now(),
  unique(id,room_id),
  foreign key(membership_id,room_id,author_id) references message_room_memberships(id,room_id,account_id)
);
create index room_message_history_page on room_messages(room_id,position desc);
create trigger room_message_append_only before update or delete on room_messages for each row execute function ledger_append_only();
create function room_message_insert_guard() returns trigger language plpgsql as $$
declare allowed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||new.room_id,0));
  select p.enabled and p.revision=m.consent_revision and a.status='active' and m.status='accepted' and r.status='active' and (new.kind<>'notice' or m.role='moderator' or r.created_by=new.author_id)
    into allowed from room_message_preferences p join accounts a on a.id=p.account_id join message_room_memberships m on m.account_id=a.id and m.id=new.membership_id join message_rooms r on r.id=m.room_id
    where p.account_id=new.author_id and m.room_id=new.room_id for share of p,a;
  if not coalesce(allowed,false) then raise exception 'Room posting requires active accepted membership and current consent'; end if;
  return new;
end $$;
create trigger room_message_valid before insert on room_messages for each row execute function room_message_insert_guard();

create table room_message_moderation (
  room_id text not null references message_rooms(id),
  message_id text not null,
  revision integer not null check(revision>0),
  hidden boolean not null,
  actor_id text not null references accounts(id),
  reason_encrypted text not null check(length(reason_encrypted) between 1 and 20000),
  recorded_at timestamptz not null default now(),
  primary key(message_id,revision),
  foreign key(message_id,room_id) references room_messages(id,room_id)
);
create trigger room_moderation_append_only before update or delete on room_message_moderation for each row execute function ledger_append_only();
create function room_moderation_insert_guard() returns trigger language plpgsql as $$
declare previous_revision integer; allowed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||new.room_id,0));
  select coalesce(max(revision),0) into previous_revision from room_message_moderation where message_id=new.message_id;
  if new.revision<>previous_revision+1 then raise exception 'Moderation revision must advance'; end if;
  select r.status='active' and m.status='accepted' and p.enabled and p.revision=m.consent_revision and a.status='active' and (m.role='moderator' or r.created_by=new.actor_id)
    into allowed from message_rooms r join message_room_memberships m on m.room_id=r.id join room_message_preferences p on p.account_id=m.account_id join accounts a on a.id=p.account_id
    where r.id=new.room_id and m.account_id=new.actor_id and m.status='accepted' for share of p,a;
  if not coalesce(allowed,false) then raise exception 'Room moderation requires a current accepted moderator'; end if;
  return new;
end $$;
create trigger room_moderation_valid before insert on room_message_moderation for each row execute function room_moderation_insert_guard();
create table room_message_receipts (
  actor_id text not null references accounts(id),
  request_key text not null check(length(request_key) between 16 and 100),
  input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
create trigger room_receipt_append_only before update or delete on room_message_receipts for each row execute function ledger_append_only();
