-- Private calendar subscription feeds (docs/CALENDAR.md). One feed per account; only a digest of the token is stored,
-- so the address is shown once and can be reset or turned off.
create table calendar_feeds (
  account_id text primary key references accounts(id) on delete cascade,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
