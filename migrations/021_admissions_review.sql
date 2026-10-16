create table if not exists application_notes (
  id text primary key,
  application_id text not null references applications(id),
  author_account_id text not null,
  category text not null check (category in ('completeness', 'academic', 'general')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists application_notes_application_idx on application_notes(application_id, created_at);

insert into permissions (code, description)
values ('admissions.review', 'Work admissions review queues and vet submitted applications')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_code, permission_code) values
  ('system_administrator', 'admissions.review'),
  ('admissions_manager', 'admissions.review'),
  ('admissions_officer', 'admissions.review')
on conflict do nothing;
