create sequence if not exists application_reference_seq;

create table if not exists applications (
  id text primary key,
  applicant_account_id text not null references accounts(id),
  intake_id text not null references intakes(id),
  programme_version_id text references programme_versions(id),
  study_mode_code text,
  answers jsonb not null default '{}'::jsonb,
  status text not null check (status in ('draft', 'submitted', 'withdrawn')),
  reference_number text unique,
  workflow_instance_id text references workflow_instances(id),
  submitted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live application per applicant per intake; a withdrawn one can be replaced.
create unique index if not exists applications_one_live_per_intake_idx
  on applications(applicant_account_id, intake_id)
  where status <> 'withdrawn';

create index if not exists applications_intake_status_idx on applications(intake_id, status);
