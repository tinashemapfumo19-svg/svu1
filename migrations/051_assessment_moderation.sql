alter table assessment_plans add column moderation text not null default 'none'
  check (moderation in ('none','internal','internal_external'));

create table assessment_moderations (
  id bigint generated always as identity primary key,
  submission_id bigint not null references assessment_submissions(id),
  stage text not null check (stage in ('internal','external')),
  outcome text not null check (outcome in ('signed','changes_requested')),
  marks_hash text not null,
  evidence_ref text not null check (length(trim(evidence_ref)) between 1 and 200),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  reviewed_by text not null references accounts(id),
  reviewed_at timestamptz not null default now(),
  unique (submission_id,stage)
);
create trigger assessment_moderations_append_only before update or delete on assessment_moderations
  for each row execute function ledger_append_only();

insert into permissions (code,description) values
('assessment.moderate','Independently moderate scoped assessment submissions'),
('assessment.external','Provide external-examiner sign-off on scoped assessment submissions') on conflict do nothing;
insert into roles (code,name,risk) values ('external_examiner','External Examiner','high') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('academic_approver','assessment.moderate'),
('system_administrator','assessment.moderate'),('system_administrator','assessment.external'),
('external_examiner','assessment.external'),('external_examiner','teaching.view') on conflict do nothing;
