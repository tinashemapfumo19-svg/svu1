-- Worker-only source content. Ordinary notification APIs select the redacted payload, never this envelope.
create table notification_delivery_content (
  notification_id text primary key references notifications(id),
  envelope text not null check (envelope like 'v1.%'),
  created_at timestamptz not null default now()
);
create trigger notification_delivery_content_append_only
  before update or delete on notification_delivery_content
  for each row execute function ledger_append_only();
