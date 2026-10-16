create table if not exists login_failures (
  id text primary key,
  email_normalized text not null,
  ip_address text,
  occurred_at timestamptz not null default now()
);

create index if not exists login_failures_email_idx on login_failures(email_normalized, occurred_at);

create table if not exists password_recovery_tokens (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  token_digest text not null unique,
  status text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_recovery_tokens_account_idx on password_recovery_tokens(account_id, status);
