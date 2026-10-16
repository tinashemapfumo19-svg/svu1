-- Stage 8 integration governance. Every connection to an outside system is catalogued with an accountable owner, purpose,
-- data classification, authentication method, data-sharing agreement, retention, rate limit, timeout, and retry budget.
-- Outbound calls go through a queue keyed by an idempotency key per connection: delivery attempts back off exponentially,
-- exhausted messages become dead letters for an operator to retry or cancel with a reason, and connection health is
-- derived from the queue. Real providers are pending (ADR-005, D-05, D-06); development uses a recording adapter.
create table integration_connections (
  id text primary key,
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name text not null,
  direction text not null check (direction in ('inbound','outbound','both')),
  counterparty text not null,
  purpose text not null,
  owner text not null,
  classification text not null check (classification in ('public','internal','confidential','restricted')),
  auth_method text not null,
  agreement_ref text,
  retention text,
  rate_limit_per_minute integer check (rate_limit_per_minute is null or rate_limit_per_minute between 1 and 100000),
  timeout_ms integer not null default 10000 check (timeout_ms between 100 and 120000),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  adapter text not null default 'none' check (adapter in ('none','development')),
  status text not null default 'planned' check (status in ('planned','active','suspended','retired')),
  revision integer not null default 1,
  updated_by text references accounts(id),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or agreement_ref is not null or classification = 'public')
);

create table integration_outbox (
  id bigint generated always as identity primary key,
  connection_id text not null references integration_connections(id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  operation text not null check (length(operation) between 1 and 80),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','dead','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  response jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (connection_id, idempotency_key)
);
create index integration_outbox_due on integration_outbox(status,next_attempt_at);

create table integration_attempts (
  id bigint generated always as identity primary key,
  outbox_id bigint not null references integration_outbox(id),
  attempt integer not null,
  outcome text not null check (outcome in ('delivered','failed','timeout')),
  detail text,
  duration_ms integer not null,
  attempted_at timestamptz not null default now()
);
create trigger integration_attempts_append_only before update or delete on integration_attempts for each row execute function ledger_append_only();

-- Baseline connections are loaded by scripts/integration-catalogue.js (reference:load and the seed), so a reseed restores them.

insert into permissions (code,description) values
('integrations.view','View the integration catalogue, queue, and health'),
('integrations.manage','Manage integration connections and operate the delivery queue') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','integrations.view'),('system_administrator','integrations.manage'),('auditor','integrations.view') on conflict do nothing;
