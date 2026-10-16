create table applicant_communication_preferences (
  account_id text primary key references accounts(id),
  in_app boolean not null default false,
  email boolean not null default false,
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now()
);
create table applicant_communication_preference_history (
  id bigint generated always as identity primary key,
  account_id text not null references accounts(id),
  in_app boolean not null,
  email boolean not null,
  revision integer not null,
  recorded_at timestamptz not null default now(),
  unique (account_id,revision)
);
create trigger applicant_preferences_history_append_only before update or delete on applicant_communication_preference_history for each row execute function ledger_append_only();
create function applicant_preferences_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Communication preferences cannot be deleted'; end if;
  if new.account_id is distinct from old.account_id or new.revision <> old.revision + 1 then
    raise exception 'Communication preference revision must advance';
  end if;
  return new;
end;
$$;
create trigger applicant_preferences_revision before update or delete on applicant_communication_preferences for each row execute function applicant_preferences_guard();

create table applicant_communication_campaigns (
  id text primary key,
  intake_id text not null references intakes(id),
  created_by text not null references accounts(id),
  request_key text not null,
  request_hash text not null,
  subject_encrypted text not null,
  body_encrypted text not null,
  reason_encrypted text not null,
  filters jsonb not null,
  channels jsonb not null,
  audience_encrypted text not null,
  audience_hash text not null,
  counts jsonb not null,
  status text not null default 'preview' check (status in ('preview','published')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  published_at timestamptz,
  unique (created_by,request_key),
  check ((status = 'published') = (published_at is not null))
);
create index applicant_campaign_intake_idx on applicant_communication_campaigns(intake_id,created_at desc);
create function applicant_campaign_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Communication campaigns cannot be deleted'; end if;
  if old.status <> 'preview' or new.status <> 'published' or new.published_at is null
    or (to_jsonb(new) - 'status' - 'published_at') is distinct from (to_jsonb(old) - 'status' - 'published_at') then
    raise exception 'Communication campaign origin and content are immutable';
  end if;
  return new;
end;
$$;
create trigger applicant_campaign_immutable before update or delete on applicant_communication_campaigns for each row execute function applicant_campaign_guard();

create table applicant_communication_recipients (
  id text primary key,
  campaign_id text not null references applicant_communication_campaigns(id),
  account_id text not null references accounts(id),
  channel text not null check (channel in ('in_app','email')),
  status text not null check (status in ('available','queued','cancelled')),
  recipient_encrypted text,
  preference_revision integer not null check (preference_revision > 0),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(campaign_id,account_id,channel),
  check ((channel = 'in_app' and status = 'available' and recipient_encrypted is null)
    or (channel = 'email' and status in ('queued','cancelled') and recipient_encrypted is not null and read_at is null))
);
create index applicant_recipient_account_idx on applicant_communication_recipients(account_id,channel,created_at desc);
create function applicant_recipient_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Communication recipients cannot be deleted'; end if;
  if (to_jsonb(new) - 'status' - 'read_at') is distinct from (to_jsonb(old) - 'status' - 'read_at')
    or not (new.status = old.status or old.status = 'queued' and new.status = 'cancelled')
    or old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'Communication recipient origin and history are immutable';
  end if;
  return new;
end;
$$;
create trigger applicant_recipient_immutable before update or delete on applicant_communication_recipients for each row execute function applicant_recipient_guard();

insert into permissions (code,description) values
('communications.self','Manage own optional applicant updates and inbox'),
('admissions.communicate','Preview and publish consent-aware scoped applicant group updates') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('applicant','communications.self'),('student','communications.self'),('system_administrator','communications.self'),
('admissions_officer','admissions.communicate'),('admissions_manager','admissions.communicate'),('system_administrator','admissions.communicate') on conflict do nothing;
