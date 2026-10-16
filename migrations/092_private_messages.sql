insert into permissions(code,description) values ('messages.self','Manage own opt-in private conversations') on conflict do nothing;
insert into role_permissions(role_code,permission_code)
select code,'messages.self' from roles where code in (
  'applicant','student','lecturer','system_administrator','admissions_officer','admissions_manager',
  'academic_registrar','finance_officer','examinations_officer','academic_approver','hr_officer',
  'exam_invigilator','exam_arrangements_officer','support_officer','support_manager','records_manager','asset_officer','asset_approver'
) on conflict do nothing;
create table private_message_preferences (
  account_id text primary key references accounts(id),
  enabled boolean not null default false,
  revision integer not null check(revision > 0),
  updated_at timestamptz not null default now()
);
create function private_preference_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Private preference history is retained'; end if;
  if new.account_id is distinct from old.account_id or new.revision <> old.revision + 1 then raise exception 'Private preference revision must advance'; end if;
  return new;
end $$;
create trigger private_preference_protected before update or delete on private_message_preferences for each row execute function private_preference_guard();
create table private_message_preference_history (
  account_id text not null references accounts(id),
  revision integer not null,
  enabled boolean not null,
  recorded_at timestamptz not null default now(),
  primary key(account_id,revision)
);
create trigger private_preference_history_append_only before update or delete on private_message_preference_history for each row execute function ledger_append_only();
create table private_conversations (
  id text primary key,
  account_a text not null references accounts(id),
  account_b text not null references accounts(id),
  invited_by text not null references accounts(id),
  request_key text not null,
  request_digest text not null,
  status text not null default 'pending' check(status in ('pending','accepted','declined','closed')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  closed_at timestamptz,
  check(account_a < account_b and invited_by in (account_a,account_b)),
  check((status in ('declined','closed')) = (closed_at is not null)),
  check(status <> 'accepted' or accepted_at is not null),
  unique(invited_by,request_key)
);
create unique index private_conversation_active_pair on private_conversations(account_a,account_b) where status in ('pending','accepted');
create index private_conversation_a_page on private_conversations(account_a,created_at desc,id desc);
create index private_conversation_b_page on private_conversations(account_b,created_at desc,id desc);
create function private_conversation_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Private conversations are retained'; end if;
  if (to_jsonb(new)-'status'-'revision'-'accepted_at'-'closed_at') is distinct from (to_jsonb(old)-'status'-'revision'-'accepted_at'-'closed_at')
    or new.revision <> old.revision + 1
    or not (old.status='pending' and new.status in ('accepted','declined','closed') or old.status='accepted' and new.status='closed')
    or old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at
    or new.status <> 'accepted' and new.accepted_at is distinct from old.accepted_at then raise exception 'Private conversation origin and lifecycle are protected'; end if;
  return new;
end $$;
create trigger private_conversation_protected before update or delete on private_conversations for each row execute function private_conversation_guard();
create table private_contact_blocks (
  account_id text not null references accounts(id),
  peer_id text not null references accounts(id),
  active boolean not null default true,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(account_id,peer_id),
  check(account_id <> peer_id)
);
create function private_block_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Private block history is retained'; end if;
  if new.account_id is distinct from old.account_id or new.peer_id is distinct from old.peer_id or new.revision <> old.revision+1 then raise exception 'Private block revision must advance'; end if;
  return new;
end $$;
create trigger private_block_protected before update or delete on private_contact_blocks for each row execute function private_block_guard();
create table private_messages (
  id text primary key,
  position bigint generated always as identity unique,
  conversation_id text not null references private_conversations(id),
  author_id text not null references accounts(id),
  envelope text not null,
  request_key text not null,
  request_digest text not null,
  created_at timestamptz not null default now(),
  unique(author_id,request_key)
);
create index private_message_history on private_messages(conversation_id,position desc);
create trigger private_message_append_only before update or delete on private_messages for each row execute function ledger_append_only();
create function private_message_insert_guard() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from private_conversations c where c.id=new.conversation_id and c.status='accepted' and new.author_id in (c.account_a,c.account_b)) then raise exception 'Private messages require an accepted participant'; end if;
  return new;
end $$;
create trigger private_message_valid before insert on private_messages for each row execute function private_message_insert_guard();
create table private_message_reads (
  conversation_id text not null references private_conversations(id),
  account_id text not null references accounts(id),
  through_position bigint not null default 0 check(through_position >= 0),
  updated_at timestamptz not null default now(),
  primary key(conversation_id,account_id)
);
create function private_read_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Private read receipts are retained'; end if;
  if tg_op = 'UPDATE' and (new.conversation_id is distinct from old.conversation_id or new.account_id is distinct from old.account_id or new.through_position < old.through_position) then raise exception 'Private read receipts cannot move backwards'; end if;
  if not exists(select 1 from private_conversations c where c.id=new.conversation_id and new.account_id in (c.account_a,c.account_b)) then raise exception 'Private read receipt requires a participant'; end if;
  return new;
end $$;
create trigger private_read_protected before insert or update or delete on private_message_reads for each row execute function private_read_guard();
create table private_message_reports (
  message_id text not null references private_messages(id),
  reporter_id text not null references accounts(id),
  reason_encrypted text not null,
  created_at timestamptz not null default now(),
  primary key(message_id,reporter_id)
);
create trigger private_report_append_only before update or delete on private_message_reports for each row execute function ledger_append_only();
