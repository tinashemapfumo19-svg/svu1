alter table accounts
  add column if not exists password_hash text,
  add column if not exists password_salt text,
  add column if not exists password_set_at timestamptz,
  add column if not exists last_login_at timestamptz;

create table if not exists account_activation_tokens (
  id text primary key,
  invitation_id text references invitations(id),
  email text not null,
  token_hash text not null,
  token_salt text not null,
  status text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists account_activation_tokens_email_idx on account_activation_tokens(email);
create index if not exists account_activation_tokens_status_idx on account_activation_tokens(status);

create table if not exists sessions (
  id text primary key,
  account_id text not null references accounts(id),
  token_hash text not null,
  token_salt text not null,
  status text not null,
  ip_address text,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_account_idx on sessions(account_id);
create index if not exists sessions_status_idx on sessions(status);
