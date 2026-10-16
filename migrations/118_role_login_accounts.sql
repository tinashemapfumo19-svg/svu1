-- Explicitly requested role logins are distinct from imported legacy identities.
alter table accounts add column provisioning_source text;
alter table accounts drop constraint accounts_email_or_legacy;
alter table accounts add constraint accounts_email_or_legacy check(
  email is not null or legacy_source_ref is not null or coalesce(provisioning_source = 'role_login',false)
);
create table role_login_accounts (
  role_code text primary key references roles(code),
  account_id text not null unique references accounts(id),
  login_alias text not null unique,
  created_at timestamptz not null default now()
);
