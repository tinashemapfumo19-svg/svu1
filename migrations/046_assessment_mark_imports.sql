-- Stage 7 batch mark upload (EXM-09). A file of component marks is previewed with a per-row rejection report, then applied
-- only when every row is valid and the marks have not changed since the preview. Each source reference is applied once per
-- plan; replaying it returns the original outcome, and reusing it for different content is refused.
create table assessment_mark_imports (
  id bigint generated always as identity primary key,
  plan_id text not null references assessment_plans(id),
  source_ref text not null,
  checksum text not null,
  row_count integer not null check (row_count > 0),
  applied_count integer not null check (applied_count >= 0),
  unchanged_count integer not null check (unchanged_count >= 0),
  imported_by text not null references accounts(id),
  imported_at timestamptz not null default now(),
  unique (plan_id, source_ref),
  check (applied_count + unchanged_count = row_count)
);
create trigger assessment_mark_imports_append_only before update or delete on assessment_mark_imports for each row execute function ledger_append_only();
