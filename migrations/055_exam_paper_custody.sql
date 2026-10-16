create table exam_papers (
  id text primary key,
  order_id text not null references exam_orders(id),
  version integer not null check (version > 0),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'upload_requested' check (status in ('upload_requested','uploaded','submitted','approved','returned','quarantined','withdrawn','superseded')),
  file_name text not null,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  storage_key text not null unique,
  upload_expires_at timestamptz not null,
  signature_verified boolean not null default false,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected')),
  scanner_ref text,
  scanned_by text references accounts(id),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  reason text not null,
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  unique (order_id,version),
  unique (id,order_id),
  check (reviewed_by is null or reviewed_by <> created_by),
  check (status <> 'approved' or (signature_verified and scan_status = 'clean' and reviewed_by is not null))
);
create unique index exam_paper_one_pending on exam_papers(order_id) where status in ('upload_requested','uploaded','submitted');
create unique index exam_paper_one_approved on exam_papers(order_id) where status = 'approved';
alter table exam_sittings add unique (id,order_id);
create table exam_paper_releases (
  id text primary key,
  paper_id text not null,
  order_id text not null,
  sitting_id text not null,
  sitting_revision integer not null,
  published_revision integer not null,
  staff_id text not null references staff_members(id),
  recipient_account_id text not null references accounts(id),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  copies integer not null check (copies between 1 and 5000),
  package_ref text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  revision integer not null default 1,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  reason text not null,
  revoked_by text references accounts(id),
  revocation_reason text,
  acknowledged_at timestamptz,
  receipt_ref text,
  foreign key (paper_id,order_id) references exam_papers(id,order_id),
  foreign key (sitting_id,order_id) references exam_sittings(id,order_id),
  check (available_at < expires_at)
);
create unique index exam_paper_one_active_release on exam_paper_releases(sitting_id,staff_id) where status = 'active';
create table exam_paper_events (
  id bigint generated always as identity primary key,
  paper_id text not null references exam_papers(id),
  release_id text references exam_paper_releases(id),
  action text not null,
  actor_id text not null references accounts(id),
  reason text not null,
  metadata jsonb not null,
  recorded_at timestamptz not null default now()
);
create trigger exam_paper_events_append_only before update or delete on exam_paper_events for each row execute function ledger_append_only();
insert into permissions (code,description) values
('exams.papers.manage','Manage confidential examination paper custody'),
('exams.papers.review','Independently review examination paper versions'),
('exams.papers.scan','Record scanner results for confidential exam papers'),
('exams.papers.release','Release approved examination papers to published invigilators') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','exams.papers.manage'),('system_administrator','exams.papers.review'),('system_administrator','exams.papers.scan'),('system_administrator','exams.papers.release'),
('examinations_officer','exams.papers.manage'),('examinations_officer','exams.papers.review'),('examinations_officer','exams.papers.release'),
('academic_registrar','exams.papers.review') on conflict do nothing;
