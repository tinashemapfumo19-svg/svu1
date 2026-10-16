-- SMS for urgent notices (docs/SMS_NOTIFICATIONS.md, D-06, D-45). Opt-in only, to a mobile number the person verified
-- with a code. Only an allow-listed set of urgent message types is texted, at most a few a day.
create table sms_settings (
  account_id text primary key references accounts(id) on delete cascade,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz,
  enabled boolean not null default false,
  code_digest text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  codes_sent_today integer not null default 0,
  codes_day date,
  updated_at timestamptz not null default now(),
  check (not enabled or verified_at is not null)
);

create table sms_deliveries (
  notification_id text primary key references notifications(id),
  account_id text not null references accounts(id),
  status text not null check (status in ('sent','failed','skipped')),
  detail text,
  sent_at timestamptz not null default now()
);
create index sms_deliveries_daily on sms_deliveries(account_id,sent_at);
