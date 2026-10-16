alter table sessions add column if not exists token_digest text;
alter table sessions alter column token_hash drop not null;
alter table sessions alter column token_salt drop not null;
create unique index if not exists sessions_token_digest_idx on sessions(token_digest);
create index if not exists sessions_account_status_idx on sessions(account_id, status);

alter table account_activation_tokens add column if not exists token_digest text;
alter table account_activation_tokens alter column token_hash drop not null;
alter table account_activation_tokens alter column token_salt drop not null;
create unique index if not exists account_activation_tokens_digest_idx on account_activation_tokens(token_digest);

-- Tokens issued before digests existed can no longer be looked up; retire them explicitly.
update sessions set status = 'expired' where token_digest is null and status = 'active';
update account_activation_tokens set status = 'expired' where token_digest is null and status = 'active';
