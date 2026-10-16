create table if not exists application_fee_acknowledgements (
  id text primary key,
  application_id text not null unique references applications(id),
  method text not null check (method in ('provider_reference', 'waiver_code')),
  reference text not null,
  status text not null check (status in ('verified', 'waived')),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists application_fee_acknowledgements_application_idx
  on application_fee_acknowledgements(application_id);
