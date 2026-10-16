create sequence registration_reference_seq;
create table registration_periods (
  id text primary key,
  intake_id text not null references intakes(id),
  academic_period_id text not null references academic_periods(id),
  programme_version_id text not null references programme_versions(id),
  year_of_study integer not null check (year_of_study between 1 and 8),
  term text not null check (term in ('S1','S2','S3')),
  credit_limit numeric(5,1) not null check (credit_limit > 0 and credit_limit <= 480),
  status text not null default 'planning' check (status in ('planning','open','closed')),
  unique (intake_id, academic_period_id)
);
create table registration_offerings (
  period_id text not null references registration_periods(id),
  course_id text not null references courses(id),
  delivery text not null default 'unconfigured' check (delivery in ('unconfigured','scheduled','asynchronous')),
  meetings jsonb not null default '[]'::jsonb,
  primary key (period_id, course_id)
);
create table student_registrations (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  period_id text not null references registration_periods(id),
  revision integer not null default 1,
  selected_courses jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','confirmed')),
  reference_number text unique,
  confirmed_at timestamptz,
  confirmation jsonb,
  unique (student_programme_id, period_id)
);
create table registration_checks (
  id bigint generated always as identity primary key,
  registration_id text not null references student_registrations(id),
  check_type text not null check (check_type in ('academic','financial')),
  outcome text not null check (outcome in ('eligible','blocked')),
  reason text not null,
  evidence_ref text not null,
  expires_on date not null,
  actor_id text not null,
  recorded_at timestamptz not null default now()
);
create index registration_checks_latest on registration_checks(registration_id,check_type,id desc);
create table course_enrolments (
  registration_id text not null references student_registrations(id),
  student_id text not null references students(id),
  academic_period_id text not null references academic_periods(id),
  course_id text not null references courses(id),
  course_snapshot jsonb not null,
  primary key (registration_id, course_id),
  unique (student_id, academic_period_id, course_id)
);
insert into roles (code,name,risk) values ('finance_officer','Finance Officer','high') on conflict do nothing;
insert into permissions (code,description) values
('registry.registration.configure','Configure scoped registration periods and offerings'),
('registry.registration.academic','Record scoped academic registration clearance'),
('registry.registration.financial','Record scoped financial registration clearance') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.registration.configure'),
('system_administrator','registry.registration.academic'),
('system_administrator','registry.registration.financial'),
('academic_registrar','registry.registration.configure'),
('academic_registrar','registry.registration.academic'),
('finance_officer','registry.view'),
('finance_officer','registry.registration.financial') on conflict do nothing;
