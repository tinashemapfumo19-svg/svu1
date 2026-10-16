create table email_deliveries (
  notification_id text primary key references notifications(id),
  provider text not null check (provider = 'resend'),
  status text not null default 'pending' check (status in ('pending','accepted','delivered','bounced','complained','failed','dead','cancelled')),
  request_envelope text,
  first_attempt_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  extra_attempts integer not null default 0 check (extra_attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text unique,
  last_error text,
  revision integer not null default 1,
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((request_envelope is null) = (first_attempt_at is null)),
  check (status not in ('accepted','delivered','bounced','complained','failed') or (provider_message_id is not null and accepted_at is not null))
);
create index email_deliveries_due on email_deliveries(status,next_attempt_at);
create table email_delivery_attempts (
  id bigint generated always as identity primary key,
  notification_id text not null references email_deliveries(notification_id),
  attempt integer not null,
  outcome text not null check (outcome in ('accepted','retry','dead')),
  error_code text,
  attempted_at timestamptz not null default now(),
  unique(notification_id,attempt)
);
create trigger email_delivery_attempts_append_only before update or delete on email_delivery_attempts for each row execute function ledger_append_only();
create table email_delivery_events (
  event_id text primary key,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload_digest text not null,
  received_at timestamptz not null default now()
);
create index email_delivery_events_message on email_delivery_events(provider_message_id);
create trigger email_delivery_events_append_only before update or delete on email_delivery_events for each row execute function ledger_append_only();
create function protect_email_delivery() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Email delivery history is retained'; end if;
  if new.notification_id is distinct from old.notification_id or new.provider is distinct from old.provider
    or (old.request_envelope is not null and new.request_envelope is distinct from old.request_envelope)
    or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at)
    or (old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id)
    or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
    or new.attempts < old.attempts or new.extra_attempts < old.extra_attempts or new.revision <> old.revision + 1
    or (old.status in ('accepted','delivered','bounced','complained','failed') and new.status in ('pending','dead','cancelled'))
    then raise exception 'Email delivery definitions and revisions are protected'; end if;
  return new;
end $$;
create trigger email_delivery_protected before update or delete on email_deliveries for each row execute function protect_email_delivery();
