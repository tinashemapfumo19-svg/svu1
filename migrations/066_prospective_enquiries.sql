create table prospective_enquiries (
  id text primary key,
  owner_id text not null references accounts(id),
  programme_id text not null references programmes(id),
  intake_id text not null references intakes(id),
  guidance_version_id text references guidance_versions(id),
  subject_encrypted text not null,
  channel text not null default 'portal' check (channel = 'portal'),
  consent_policy text not null check (consent_policy = 'portal-enquiry-v1'),
  consented_at timestamptz not null default now(),
  consent_active boolean not null default true,
  status text not null default 'open' check (status in ('open','in_progress','waiting_applicant','resolved','withdrawn')),
  assignee_id text references accounts(id),
  escalated boolean not null default false,
  escalation_level integer not null default 0 check (escalation_level >= 0),
  revision integer not null default 1 check (revision > 0),
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  withdrawn_at timestamptz,
  unique(owner_id,request_key),
  check (consent_active = (status in ('open','in_progress','waiting_applicant'))),
  check ((status = 'resolved') = (resolved_at is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (status not in ('in_progress','waiting_applicant','resolved') or assignee_id is not null),
  check (not escalated or assignee_id is not null and status not in ('resolved','withdrawn'))
);
create index prospective_enquiry_owner_idx on prospective_enquiries(owner_id,updated_at desc,id);
create index prospective_enquiry_queue_idx on prospective_enquiries(intake_id,status,updated_at desc,id);
create table prospective_enquiry_messages (
  id text primary key,
  enquiry_id text not null references prospective_enquiries(id),
  revision integer not null,
  author_id text not null references accounts(id),
  author_kind text not null check (author_kind in ('applicant','staff')),
  visibility text not null check (visibility in ('public','internal')),
  body_encrypted text not null,
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique(enquiry_id,revision),
  unique(enquiry_id,author_id,request_key),
  check (author_kind <> 'applicant' or visibility = 'public')
);
create table prospective_enquiry_history (
  id bigint generated always as identity primary key,
  enquiry_id text not null references prospective_enquiries(id),
  revision integer not null,
  action text not null,
  from_status text,
  to_status text not null,
  consent_active boolean not null,
  consent_policy text not null,
  assignee_id text references accounts(id),
  escalated boolean not null,
  escalation_level integer not null,
  actor_id text not null references accounts(id),
  reason_encrypted text,
  recorded_at timestamptz not null default now(),
  unique(enquiry_id,revision)
);
create trigger prospective_messages_append_only before update or delete on prospective_enquiry_messages for each row execute function ledger_append_only();
create trigger prospective_history_append_only before update or delete on prospective_enquiry_history for each row execute function ledger_append_only();
create function prospective_enquiry_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Prospective enquiries cannot be deleted'; end if;
  if tg_op = 'INSERT' then
    if not exists(select 1 from intakes where id = new.intake_id and programme_id = new.programme_id) then raise exception 'Enquiry intake must belong to programme'; end if;
    if new.guidance_version_id is not null and not exists(
      select 1 from guidance_versions v join guidance_articles g on g.id = v.article_id
      where v.id = new.guidance_version_id and v.status = 'published'
      and (g.programme_id is null or g.programme_id = new.programme_id) and (g.intake_id is null or g.intake_id = new.intake_id)
    ) then raise exception 'Enquiry guidance must be approved and within intake scope'; end if;
    if new.status <> 'open' or not new.consent_active or new.revision <> 1 then raise exception 'New enquiry requires explicit active consent'; end if;
    return new;
  end if;
  if row(new.id,new.owner_id,new.programme_id,new.intake_id,new.guidance_version_id,new.subject_encrypted,new.channel,new.consent_policy,new.consented_at,new.request_key,new.request_hash,new.created_at)
    is distinct from row(old.id,old.owner_id,old.programme_id,old.intake_id,old.guidance_version_id,old.subject_encrypted,old.channel,old.consent_policy,old.consented_at,old.request_key,old.request_hash,old.created_at)
    or new.revision <> old.revision + 1 or old.status = 'withdrawn' then
    raise exception 'Enquiry custody is immutable and withdrawn consent is terminal';
  end if;
  return new;
end;
$$;
create trigger prospective_enquiry_immutable before insert or update or delete on prospective_enquiries for each row execute function prospective_enquiry_guard();
insert into permissions(code,description) values
('enquiries.self','Create and read own consented prospective enquiry'),
('enquiries.manage','Triage and reply to scoped prospective enquiries'),
('enquiries.escalate','Manage escalated scoped prospective enquiries') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('applicant','enquiries.self'),('student','enquiries.self'),('system_administrator','enquiries.self'),
('admissions_officer','enquiries.manage'),('admissions_manager','enquiries.manage'),('admissions_manager','enquiries.escalate'),
('system_administrator','enquiries.manage'),('system_administrator','enquiries.escalate') on conflict do nothing;
