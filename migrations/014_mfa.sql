create table if not exists mfa_factors (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  factor_type text not null,
  secret_ciphertext text not null,
  status text not null,
  last_used_step bigint,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create unique index if not exists mfa_factors_one_active_idx
  on mfa_factors(account_id, factor_type)
  where status = 'active';

create table if not exists mfa_recovery_codes (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  code_digest text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_recovery_codes_account_idx on mfa_recovery_codes(account_id);

-- 'password' sessions passed the password check only; 'mfa' sessions also passed a second factor.
alter table sessions add column if not exists assurance text not null default 'password';
alter table sessions add column if not exists mfa_failed_attempts integer not null default 0;
alter table sessions add column if not exists mfa_verified_at timestamptz;
