create table if not exists grading_schemes (
  id text primary key,
  code text not null,
  version integer not null,
  name text not null,
  status text not null,
  bands jsonb not null,
  classifications jsonb not null,
  effective_from date,
  effective_to date,
  created_by text,
  created_at timestamptz not null default now(),
  published_by text,
  published_at timestamptz,
  unique (code, version)
);

create table if not exists gpa_rule_sets (
  id text primary key,
  code text not null,
  version integer not null,
  name text not null,
  status text not null,
  grading_scheme_id text not null references grading_schemes(id),
  rules jsonb not null,
  samples jsonb not null default '[]'::jsonb,
  effective_from date,
  effective_to date,
  created_by text,
  created_at timestamptz not null default now(),
  published_by text,
  published_at timestamptz,
  unique (code, version)
);
