create table support_cases (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  intake_id text not null references intakes(id),
  requested_by text not null references accounts(id),
  request_key text not null,
  request_hash text not null,
  subject_encrypted text not null,
  category text not null check (category in ('academic','registration','finance','learning','feedback','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_student','resolved','closed')),
  assignee_id text references accounts(id),
  escalated boolean not null default false,
  escalation_level integer not null default 0 check (escalation_level >= 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (student_programme_id,requested_by,request_key),
  check (not escalated or (assignee_id is not null and escalation_level > 0)),
  check ((status in ('resolved','closed')) = (resolved_at is not null)),
  check ((status = 'closed') = (closed_at is not null))
);
create index support_cases_intake_queue on support_cases(intake_id,status,updated_at,id);
create index support_cases_programme on support_cases(student_programme_id,created_at,id);

create table support_case_comments (
  id text primary key,
  case_id text not null references support_cases(id),
  revision integer not null,
  author_id text not null references accounts(id),
  author_kind text not null check (author_kind in ('student','staff')),
  visibility text not null check (visibility in ('public','internal')),
  body_encrypted text not null,
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique (case_id,author_id,request_key),
  check (author_kind <> 'student' or visibility = 'public')
);
create table support_case_history (
  id bigint generated always as identity primary key,
  case_id text not null references support_cases(id),
  revision integer not null,
  action text not null,
  from_status text,
  to_status text not null,
  category text not null,
  priority text not null,
  assignee_id text references accounts(id),
  escalated boolean not null,
  escalation_level integer not null,
  actor_id text not null references accounts(id),
  visibility text not null check (visibility in ('public','internal')),
  reason_encrypted text,
  recorded_at timestamptz not null default now(),
  unique (case_id,revision)
);
create trigger support_comments_append_only before update or delete on support_case_comments for each row execute function ledger_append_only();
create trigger support_history_append_only before update or delete on support_case_history for each row execute function ledger_append_only();
create function support_case_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Support cases cannot be deleted'; end if;
  if row(new.id,new.student_programme_id,new.intake_id,new.requested_by,new.request_key,new.request_hash,new.subject_encrypted,new.created_at)
    is distinct from row(old.id,old.student_programme_id,old.intake_id,old.requested_by,old.request_key,old.request_hash,old.subject_encrypted,old.created_at) then
    raise exception 'Support case origin is immutable';
  end if;
  if new.revision <> old.revision + 1 or new.escalation_level < old.escalation_level then raise exception 'Invalid support case revision'; end if;
  return new;
end;
$$;
create trigger support_case_immutable before update or delete on support_cases for each row execute function support_case_guard();

insert into roles (code,name,risk) values ('support_officer','Student Support Officer','high'),('support_manager','Student Support Manager','high') on conflict do nothing;
insert into permissions (code,description) values
('support.self','Create and follow own student support cases'),('support.view','View scoped student support cases'),
('support.manage','Assign and respond to scoped student support cases'),('support.escalate','Resolve and manage escalated support cases') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('student','support.self'),('system_administrator','support.self'),('system_administrator','support.view'),('system_administrator','support.manage'),('system_administrator','support.escalate'),
('support_officer','support.view'),('support_officer','support.manage'),
('support_manager','support.view'),('support_manager','support.manage'),('support_manager','support.escalate') on conflict do nothing;
