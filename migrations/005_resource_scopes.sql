create table if not exists resource_scopes (
  id text primary key,
  resource_type text not null,
  resource_id text not null,
  programme_code text,
  intake_id text,
  created_at timestamptz not null default now(),
  unique (resource_type, resource_id)
);

create index if not exists resource_scopes_programme_idx on resource_scopes(programme_code);
create index if not exists resource_scopes_intake_idx on resource_scopes(intake_id);
