create table if not exists courses (
  id text primary key,
  code text not null unique,
  title text not null,
  credits numeric(5, 1) not null check (credits > 0),
  level integer not null check (level between 1 and 8),
  department_id text not null references organization_units(id),
  status text not null,
  effective_from date not null,
  effective_to date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_prerequisites (
  course_id text not null references courses(id),
  prerequisite_course_id text not null references courses(id),
  primary key (course_id, prerequisite_course_id),
  check (course_id <> prerequisite_course_id)
);

create table if not exists curriculum_entries (
  id text primary key,
  programme_version_id text not null references programme_versions(id),
  course_id text not null references courses(id),
  year_of_study integer not null check (year_of_study between 1 and 8),
  term text not null check (term in ('S1', 'S2', 'S3', 'ANY')),
  requirement_type text not null check (requirement_type in ('core', 'elective')),
  created_at timestamptz not null default now(),
  unique (programme_version_id, course_id)
);

create index if not exists curriculum_entries_course_idx on curriculum_entries(course_id);
