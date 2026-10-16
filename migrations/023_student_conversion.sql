create sequence if not exists student_number_seq;

-- One student record per person: a returning applicant keeps their student number.
create table if not exists students (
  id text primary key,
  student_number text not null unique,
  person_id text not null unique references people(id),
  account_id text not null references accounts(id),
  created_at timestamptz not null default now()
);

-- One programme record per accepted application: conversion can be retried but never duplicates.
create table if not exists student_programmes (
  id text primary key,
  student_id text not null references students(id),
  application_id text not null unique references applications(id),
  programme_version_id text references programme_versions(id),
  intake_id text not null references intakes(id),
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists student_programmes_student_idx on student_programmes(student_id);
