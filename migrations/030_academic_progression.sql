create table academic_policies (
  id text primary key,
  code text not null,
  version integer not null,
  name text not null,
  programme_version_id text not null references programme_versions(id),
  gpa_rule_set_id text not null references gpa_rule_sets(id),
  gpa_snapshot jsonb not null,
  rules jsonb not null,
  status text not null default 'draft' check (status in ('draft','published')),
  effective_from date,
  effective_to date,
  created_by text not null references accounts(id),
  published_by text references accounts(id),
  published_at timestamptz,
  unique (code,version),
  check (published_by is null or published_by <> created_by)
);
alter table registration_periods add column academic_policy_id text references academic_policies(id);
alter table registration_offerings add column offering_type text not null default 'curriculum' check (offering_type in ('curriculum','repeat'));
create table academic_decisions (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  period_id text not null references registration_periods(id),
  policy_id text not null references academic_policies(id),
  kind text not null check (kind in ('progression','repeat')),
  course_id text references courses(id),
  registration_revision integer,
  evidence_hash text not null,
  source_snapshot jsonb not null,
  assessment jsonb not null,
  reason text not null,
  evidence_ref text not null,
  expires_on date not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check ((kind = 'repeat' and course_id is not null and registration_revision is not null) or (kind = 'progression' and course_id is null)),
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create index academic_decision_context on academic_decisions(student_programme_id,period_id,id desc);
insert into roles (code,name,risk) values ('academic_approver','Academic Approver','high') on conflict do nothing;
insert into permissions (code,description) values
('academic.view','View scoped academic evidence and decision history'),
('academic.request','Request scoped progression and repeat decisions'),
('academic.approve','Independently approve or reject scoped academic decisions'),
('academic.policy.manage','Draft scoped academic policies'),
('academic.policy.publish','Independently publish scoped academic policies') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','academic.view'),('system_administrator','academic.request'),
('system_administrator','academic.approve'),('system_administrator','academic.policy.manage'),('system_administrator','academic.policy.publish'),
('academic_registrar','academic.view'),('academic_registrar','academic.request'),('academic_registrar','academic.policy.manage'),
('academic_approver','registry.view'),('academic_approver','academic.view'),('academic_approver','academic.approve'),('academic_approver','academic.policy.publish') on conflict do nothing;
