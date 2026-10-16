-- Anonymous course evaluations (docs/COURSE_EVALUATIONS.md, D-43). One evaluation per course offering and period with a
-- fixed question set. Responses carry no student reference and no time; a separate participation row only prevents a
-- second response. Results are shown once enough students have answered (the threshold is held by the server).
insert into permissions (code,description) values
('evaluations.manage','Open and close course evaluations and see results for every course') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('system_administrator','evaluations.manage'),('academic_registrar','evaluations.manage') on conflict do nothing;

create table course_evaluations (
  id text primary key,
  period_id text not null references registration_periods(id),
  course_id text not null references courses(id),
  questions_version integer not null default 1,
  opens_on date not null,
  closes_on date not null,
  opened_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (period_id, course_id),
  check (closes_on >= opens_on and closes_on <= opens_on + 60)
);

create table course_evaluation_participants (
  evaluation_id text not null references course_evaluations(id),
  student_id text not null references students(id),
  primary key (evaluation_id, student_id)
);

-- No student id and no timestamp: a response cannot be traced back to the participant row by time.
create table course_evaluation_responses (
  id text primary key,
  evaluation_id text not null references course_evaluations(id),
  ratings smallint[] not null check (array_length(ratings,1) = 5 and 1 <= all(ratings) and 5 >= all(ratings)),
  went_well text not null default '' check (length(went_well) <= 2000),
  to_change text not null default '' check (length(to_change) <= 2000)
);
create index course_evaluation_responses_by_evaluation on course_evaluation_responses(evaluation_id);
create function course_evaluation_response_guard() returns trigger language plpgsql as $$
begin raise exception 'evaluation responses cannot be changed'; end $$;
create trigger course_evaluation_responses_fixed before update or delete on course_evaluation_responses for each row execute function course_evaluation_response_guard();
