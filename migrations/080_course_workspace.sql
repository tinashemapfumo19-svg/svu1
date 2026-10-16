create table course_resources (
  id text primary key,
  period_id text not null,
  course_id text not null,
  kind text not null check (kind in ('file','link','note','class','assignment')),
  section text not null,
  title text not null,
  description text not null default '',
  url text,
  starts_at timestamptz,
  due_at timestamptz,
  allow_late boolean not null default false,
  pinned boolean not null default false,
  position integer not null default 0,
  section_position integer not null default 0,
  status text not null check (status in ('draft','published','archived')),
  file jsonb,
  revision integer not null default 1,
  created_by text not null references accounts(id),
  updated_at timestamptz not null default now(),
  foreign key (period_id,course_id) references registration_offerings(period_id,course_id)
);
create index course_resources_offering on course_resources(period_id,course_id,status,section_position,position);

create table course_assignment_uploads (
  id text primary key,
  resource_id text not null references course_resources(id),
  student_id text not null references students(id),
  registration_id text not null references student_registrations(id),
  attempt integer not null,
  file jsonb not null,
  submitted_at timestamptz not null default now(),
  late boolean not null,
  unique(resource_id,student_id,attempt)
);
create index course_assignment_uploads_latest on course_assignment_uploads(resource_id,student_id,attempt desc);
