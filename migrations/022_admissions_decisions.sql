create table if not exists application_decisions (
  id text primary key,
  application_id text not null references applications(id),
  decision text not null check (decision in ('offer', 'reject')),
  reason_code text,
  conditions jsonb not null default '[]'::jsonb,
  offer_expires_at timestamptz,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  response text check (response in ('accepted', 'declined', 'expired')),
  responded_at timestamptz
);

create index if not exists application_decisions_application_idx on application_decisions(application_id, decided_at);

insert into reference_lists (code, name, owner, sensitivity, lawful_purpose, status, value_pattern)
values ('decision_reason', 'Admissions decision reasons', 'Admissions', 'standard', null, 'active', null)
on conflict (code) do nothing;
