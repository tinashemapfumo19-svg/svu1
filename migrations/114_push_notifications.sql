-- Push notifications to installed apps and browsers (docs/INSTALLABLE_APP.md). A device subscribes after the person
-- allows notifications; each Inbox message is pushed at most once. Gone subscriptions are removed when the push service
-- reports them expired.
create table push_subscriptions (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 800),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,120}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,40}$'),
  user_agent text not null default '' check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index push_subscriptions_account on push_subscriptions(account_id);

create table push_deliveries (
  notification_id text primary key references notifications(id),
  devices integer not null,
  sent_at timestamptz not null default now()
);
