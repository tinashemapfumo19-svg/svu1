alter table exam_sittings add column assessment_plan_id text references assessment_plans(id);
alter table exam_sittings add column component_code text;
alter table exam_sittings add check ((assessment_plan_id is null) = (component_code is null));

create table exam_deferred_candidates (
  sitting_id text not null references exam_sittings(id),
  registration_id text not null references student_registrations(id),
  mark_revision integer not null check (mark_revision > 0),
  primary key (sitting_id,registration_id)
);
create trigger exam_deferred_candidates_append_only before update or delete on exam_deferred_candidates
  for each row execute function ledger_append_only();

create table assessment_deferred_completions (
  id bigint generated always as identity primary key,
  sitting_id text not null references exam_sittings(id),
  sitting_revision integer not null check (sitting_revision > 0),
  plan_id text not null references assessment_plans(id),
  marks_hash text not null,
  source_submission_id bigint references assessment_submissions(id),
  entries jsonb not null,
  evidence_ref text not null check (length(trim(evidence_ref)) between 1 and 200),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  status text not null default 'submitted' check (status in ('submitted','returned','approved')),
  submitted_by text not null references accounts(id),
  submitted_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> submitted_by)
);
create unique index deferred_completion_one_live on assessment_deferred_completions(sitting_id) where status in ('submitted','approved');
create function deferred_completion_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'deferred completions cannot be deleted'; end if;
  if old.status <> 'submitted' or new.status not in ('returned','approved')
    or (to_jsonb(new) - array['status','reviewed_by','reviewed_at','review_reason']) is distinct from
       (to_jsonb(old) - array['status','reviewed_by','reviewed_at','review_reason']) then
    raise exception 'deferred completion evidence is immutable';
  end if;
  return new;
end;
$$;
create trigger deferred_completions_guard before update or delete on assessment_deferred_completions
  for each row execute function deferred_completion_guard();
alter table assessment_mark_history add column deferred_completion_id bigint references assessment_deferred_completions(id);
alter table assessment_submissions drop constraint assessment_submissions_status_check;
alter table assessment_submissions add check (status in ('submitted','returned','approved','transferred','superseded'));
create table assessment_submission_supersessions (
  submission_id bigint primary key references assessment_submissions(id),
  completion_id bigint not null references assessment_deferred_completions(id),
  previous_status text not null,
  actor_id text not null references accounts(id),
  reason text not null,
  recorded_at timestamptz not null default now()
);
create trigger assessment_submission_supersessions_append_only before update or delete on assessment_submission_supersessions
  for each row execute function ledger_append_only();
