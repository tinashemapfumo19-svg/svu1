-- Stage 7 graduation audit and award approval (EXM-18 prerequisites). Each pinned curriculum gets versioned completion rules
-- (minimum credits, minimum elective credits, minimum cumulative GPA, award title) drafted and independently published.
-- A graduation audit checks the official record against them: every core course satisfied by a passing latest attempt or
-- applicable recognized credit, credit totals, and GPA under the rules' GPA policy. An award is requested against the
-- audit's evidence hash and conferred by a different person, which completes the programme. Awards are never deleted.
create table completion_rules (
  id text primary key,
  programme_version_id text not null references programme_versions(id),
  version integer not null check (version > 0),
  rules jsonb not null,
  gpa_rule_set_id text not null references gpa_rule_sets(id),
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  reason text not null,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  unique (programme_version_id, version),
  check (published_by is null or published_by <> created_by)
);
create unique index completion_rules_one_published on completion_rules(programme_version_id) where status = 'published';
create unique index completion_rules_one_draft on completion_rules(programme_version_id) where status = 'draft';

create table award_requests (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  completion_rule_id text not null references completion_rules(id),
  evidence_hash text not null,
  audit jsonb not null,
  award_title text not null,
  classification text,
  conferred_on date not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reason text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check ((status = 'requested') = (reviewed_by is null))
);
create unique index award_one_open on award_requests(student_programme_id) where status = 'requested';
create unique index award_one_conferred on award_requests(student_programme_id) where status = 'approved';
create trigger award_requests_no_delete before delete on award_requests for each row execute function ledger_append_only();
alter table student_programme_history add column award_request_id bigint unique references award_requests(id);

insert into permissions (code,description) values
('registry.award.request','Request scoped award conferral from a graduation audit'),
('registry.award.approve','Independently confer or reject scoped awards') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.award.request'),('system_administrator','registry.award.approve'),
('academic_registrar','registry.award.request'),('academic_approver','registry.award.approve') on conflict do nothing;
