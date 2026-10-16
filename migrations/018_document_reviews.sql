create table if not exists document_reviews (
  id text primary key,
  document_id text not null references documents(id),
  decision text not null check (decision in ('verified', 'rejected')),
  reason text not null,
  reviewer_account_id text not null,
  reviewed_at timestamptz not null default now()
);

create index if not exists document_reviews_document_idx on document_reviews(document_id);

insert into permissions (code, description)
values ('document.review', 'Verify or reject submitted documents')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_code, permission_code) values
  ('system_administrator', 'document.review'),
  ('admissions_manager', 'document.review'),
  ('admissions_officer', 'document.review')
on conflict do nothing;
