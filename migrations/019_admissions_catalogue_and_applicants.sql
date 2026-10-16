-- Intakes gain an entry date (which programme version applies) and a publication lifecycle:
-- draft -> published (visible in the public catalogue) -> closed.
alter table intakes add column if not exists starts_on date;
alter table intakes add column if not exists published_at timestamptz;
alter table intakes add column if not exists published_by text;
alter table intakes add column if not exists closed_at timestamptz;

create table if not exists applicant_profiles (
  account_id text primary key references accounts(id) on delete cascade,
  date_of_birth date,
  nationality_code text,
  phone text,
  prior_level_code text,
  study_mode_code text,
  address jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into permissions (code, description)
values ('admissions.apply', 'Manage your own applicant profile and applications')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_code, permission_code)
values ('applicant', 'admissions.apply')
on conflict do nothing;
