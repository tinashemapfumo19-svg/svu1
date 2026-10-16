create table student_profiles (
  student_id text primary key references students(id),
  phone text not null default '',
  address jsonb not null default '{}'::jsonb,
  next_of_kin jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

create table student_profile_history (
  id text primary key,
  student_id text not null references students(id),
  revision integer not null,
  snapshot jsonb not null,
  actor_id text not null,
  recorded_at timestamptz not null default now(),
  unique (student_id, revision)
);

create table student_programme_history (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  from_status text,
  to_status text not null,
  reason text not null,
  actor_id text not null,
  effective_at timestamptz not null default now()
);

insert into student_profiles (student_id, phone, address)
select s.id, coalesce(p.phone, ''), coalesce(p.address, '{}'::jsonb)
from students s left join applicant_profiles p on p.account_id = s.account_id;

insert into student_programme_history (id, student_programme_id, to_status, reason, actor_id, effective_at)
select 'initial_' || id, id, status, 'Accepted-offer conversion', 'admissions_conversion', created_at
from student_programmes;

insert into permissions (code, description) values
('registry.self', 'Manage own student onboarding'),
('registry.view', 'View scoped student registry'),
('registry.onboard', 'Approve scoped student onboarding')
on conflict (code) do nothing;

insert into role_permissions (role_code, permission_code) values
('student', 'registry.self'),
('system_administrator', 'registry.view'),
('system_administrator', 'registry.onboard'),
('academic_registrar', 'registry.view'),
('academic_registrar', 'registry.onboard')
on conflict do nothing;
