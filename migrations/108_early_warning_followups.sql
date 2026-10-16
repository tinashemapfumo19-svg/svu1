-- Early-warning follow-ups (docs/AI_ASSIST.md, D-39): staff record that they contacted a flagged student. Kept apart
-- from the student record; the outcome list is fixed and the note is short. Rows are append-only.
create table early_warning_followups (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  outcome text not null check (outcome in ('contacted','meeting_booked','referred','no_action')),
  note text not null default '' check (length(note) <= 1000),
  created_by text not null references accounts(id),
  created_at timestamptz not null default now()
);
create index early_warning_followup_latest on early_warning_followups(student_programme_id,created_at desc);
create function early_warning_followup_guard() returns trigger language plpgsql as $$
begin raise exception 'early-warning follow-ups are append-only'; end $$;
create trigger early_warning_followups_append_only before update or delete on early_warning_followups for each row execute function early_warning_followup_guard();
