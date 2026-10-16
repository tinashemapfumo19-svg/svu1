create table restricted_profile_policies (
  id text primary key,
  category text not null check(category in ('religion','disability','medical')),
  purpose_code text not null check(purpose_code ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  title text not null,
  purpose text not null,
  owner text not null,
  policy_reference text not null,
  retention_rule text not null,
  consent_days integer not null check(consent_days between 1 and 366),
  status text not null default 'draft' check(status in ('draft','published','retired')),
  revision integer not null default 1 check(revision > 0),
  created_by text not null references accounts(id),
  reviewed_by text references accounts(id),
  created_at timestamptz not null default now(),
  check(status='draft' or (reviewed_by is not null and reviewed_by<>created_by)),
  unique(id,category)
);
create table restricted_student_profiles (
  student_programme_id text not null references student_programmes(id),
  category text not null check(category in ('religion','disability','medical')),
  revision integer not null check(revision > 0),
  policy_id text not null references restricted_profile_policies(id),
  status text not null check(status in ('consented','withdrawn')),
  values_encrypted text not null,
  expires_at timestamptz not null,
  changed_at timestamptz not null default now(),
  primary key(student_programme_id,category),
  foreign key(policy_id,category) references restricted_profile_policies(id,category)
);
create table restricted_profile_history (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  category text not null,
  revision integer not null,
  policy_id text not null references restricted_profile_policies(id),
  status text not null check(status in ('consented','withdrawn')),
  values_encrypted text not null,
  expires_at timestamptz not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique(student_programme_id,category,revision),
  foreign key(policy_id,category) references restricted_profile_policies(id,category)
);
create table restricted_profile_access (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  category text not null,
  revision integer not null,
  policy_id text not null references restricted_profile_policies(id),
  purpose_code text not null,
  actor_id text not null references accounts(id),
  accessed_at timestamptz not null default now(),
  foreign key(policy_id,category) references restricted_profile_policies(id,category)
);
create table restricted_profile_commands (
  actor_id text not null references accounts(id),
  request_key text not null,
  input_hash text not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
create index restricted_history_programme on restricted_profile_history(student_programme_id,category,id desc);
create index restricted_access_programme on restricted_profile_access(student_programme_id,category,id desc);
create trigger restricted_history_immutable before update or delete on restricted_profile_history for each row execute function ledger_append_only();
create trigger restricted_access_immutable before update or delete on restricted_profile_access for each row execute function ledger_append_only();
create trigger restricted_commands_immutable before update or delete on restricted_profile_commands for each row execute function ledger_append_only();
create function protect_restricted_policy() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Restricted policies are retained'; end if;
  if (to_jsonb(NEW)-array['status','revision','reviewed_by'])<>(to_jsonb(OLD)-array['status','revision','reviewed_by']) or
    NEW.revision<>OLD.revision+1 or not ((OLD.status='draft' and NEW.status='published') or (OLD.status='published' and NEW.status='retired')) or
    (OLD.status='published' and NEW.reviewed_by is distinct from OLD.reviewed_by) then
    raise exception 'Policy definitions are immutable and lifecycle is sequential';
  end if;
  return NEW;
end $$;
create trigger restricted_policy_immutable before update or delete on restricted_profile_policies for each row execute function protect_restricted_policy();
create function retain_restricted_profile() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Restricted profiles require an authorized retention process'; end if;
  if NEW.student_programme_id<>OLD.student_programme_id or NEW.category<>OLD.category or NEW.revision<>OLD.revision+1 then
    raise exception 'Restricted profile identity is immutable and revisions are sequential';
  end if;
  return NEW;
end $$;
create trigger restricted_profile_retained before update or delete on restricted_student_profiles for each row execute function retain_restricted_profile();
insert into permissions(code,description) values
('restricted.policy.manage','Create and retire institution-wide restricted profile policies'),
('restricted.policy.approve','Independently publish restricted profile policies'),
('restricted.religion.read','Read consented religion information for an approved purpose within scope'),
('restricted.disability.read','Read consented disability information for an approved purpose within scope'),
('restricted.medical.read','Read consented medical information for an approved purpose within scope') on conflict do nothing;
insert into roles(code,name,risk) values
('privacy_officer','Privacy Policy Officer','high'),('privacy_approver','Privacy Policy Approver','high'),
('religion_records_officer','Restricted Religion Records Officer','high'),('disability_support_officer','Disability Support Officer','high'),
('student_medical_officer','Student Medical Records Officer','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('system_administrator','restricted.policy.manage'),('system_administrator','restricted.policy.approve'),
('privacy_officer','restricted.policy.manage'),('privacy_approver','restricted.policy.approve'),
('religion_records_officer','restricted.religion.read'),('disability_support_officer','restricted.disability.read'),
('student_medical_officer','restricted.medical.read') on conflict do nothing;
