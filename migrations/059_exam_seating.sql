create table exam_seating_plans (
  sitting_id text primary key references exam_sittings(id),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft','published')),
  published_revision integer not null check (published_revision > 0),
  manifest_digest text not null check (manifest_digest ~ '^[a-f0-9]{64}$'),
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  prepared_by text not null references accounts(id),
  prepared_at timestamptz not null default now(),
  reason text not null,
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  published_snapshot jsonb,
  check (status <> 'published' or (published_by is not null and published_by <> prepared_by and published_snapshot is not null))
);
create table exam_seating_history (
  id bigint generated always as identity primary key,
  sitting_id text not null references exam_seating_plans(sitting_id),
  revision integer not null check (revision > 0),
  action text not null check (action in ('prepared','published')),
  snapshot jsonb not null,
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique (sitting_id,revision,action)
);
create trigger exam_seating_history_append_only before update or delete on exam_seating_history
  for each row execute function ledger_append_only();
create trigger exam_seating_plans_no_delete before delete on exam_seating_plans
  for each row execute function ledger_append_only();
insert into notification_templates (id,code,channel,subject,body,version,status) values
('nt_exam_seating_email_v1','exams.seating','email','Examination seating for {{courseCode}} has been {{action}}',
 'Examination seating for {{courseCode}} has been {{action}} after independent review. Sign in to view your current published examination record. Seat labels and candidate lists are not included in this message.',1,'active')
on conflict do nothing;
