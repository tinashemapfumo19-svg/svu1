-- AI-similarity checks for assignment uploads (docs/AI_SIMILARITY_CHECK.md).
-- A check records the provider's score for one exact file (by SHA-256) before the student submits it. Scores are
-- advisory: the student is warned above the allowable threshold and may still submit, which is recorded.
alter table course_resources add column ai_threshold numeric(5,2)
  check (ai_threshold is null or (ai_threshold >= 0 and ai_threshold <= 100));

create table course_ai_checks (
  id text primary key,
  resource_id text not null references course_resources(id),
  student_id text not null references students(id),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  file_name text not null check (length(file_name) between 1 and 255),
  provider text not null check (provider in ('gptzero','simulated')),
  status text not null check (status in ('completed','unavailable')),
  ai_score numeric(5,2) check (ai_score is null or (ai_score >= 0 and ai_score <= 100)),
  mixed_score numeric(5,2) check (mixed_score is null or (mixed_score >= 0 and mixed_score <= 100)),
  human_score numeric(5,2) check (human_score is null or (human_score >= 0 and human_score <= 100)),
  predicted_class text check (predicted_class is null or predicted_class in ('ai','human','mixed')),
  provider_version text,
  threshold numeric(5,2) not null check (threshold >= 0 and threshold <= 100),
  above_threshold boolean not null,
  failure_code text,
  checked_by text not null references accounts(id),
  checked_at timestamptz not null default now(),
  check ((status = 'completed') = (ai_score is not null)),
  check (status = 'completed' or (failure_code is not null and above_threshold = false))
);
create index course_ai_checks_lookup on course_ai_checks(resource_id, student_id, checked_at desc);

alter table course_assignment_uploads
  add column ai_check_id text references course_ai_checks(id),
  add column ai_warning_acknowledged boolean not null default false;
