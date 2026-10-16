alter table notifications add column if not exists read_at timestamptz;
create index if not exists notifications_recipient_page_idx on notifications (recipient_account_id,created_at desc,id desc);
