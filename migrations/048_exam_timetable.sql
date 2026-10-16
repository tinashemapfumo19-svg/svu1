-- Stage 7 examination timetable (EXM-03 to EXM-05). Examinations staff schedule sittings (paper, start, duration, venue,
-- optional capacity) for course offerings inside the academic calendar's assessment window. Candidates come from confirmed
-- enrolments, so student clashes and over-capacity venues are computed rather than stored. A period's timetable is
-- published by someone other than its last editor, only when it has no candidate clashes; students see the last published
-- snapshot, and any later change returns the timetable to draft until it is republished.
create table exam_sittings (
  id text primary key,
  period_id text not null,
  course_id text not null,
  paper text not null check (length(paper) between 1 and 60),
  starts_at timestamptz not null,
  local_date date not null,
  duration_minutes integer not null check (duration_minutes between 15 and 480 and duration_minutes % 15 = 0),
  venue text not null check (length(venue) between 1 and 120),
  capacity integer check (capacity is null or capacity between 1 and 5000),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  revision integer not null default 1 check (revision > 0),
  updated_by text not null references accounts(id),
  updated_at timestamptz not null default now(),
  foreign key (period_id, course_id) references registration_offerings(period_id, course_id)
);
create unique index exam_sitting_paper on exam_sittings(period_id,course_id,lower(paper)) where status = 'scheduled';
create index exam_sitting_period on exam_sittings(period_id,starts_at);

create table exam_sitting_history (
  id bigint generated always as identity primary key,
  sitting_id text not null references exam_sittings(id),
  revision integer not null,
  action text not null check (action in ('scheduled','changed','cancelled')),
  snapshot jsonb not null,
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now()
);
create trigger exam_sitting_history_append_only before update or delete on exam_sitting_history for each row execute function ledger_append_only();

create table exam_timetables (
  period_id text primary key references registration_periods(id),
  status text not null default 'draft' check (status in ('draft','published')),
  revision integer not null default 1 check (revision > 0),
  prepared_by text not null references accounts(id),
  prepared_at timestamptz not null default now(),
  published_revision integer,
  published_snapshot jsonb,
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  check (published_by is null or published_by <> prepared_by or status = 'draft'),
  check ((published_snapshot is null) = (published_at is null))
);

insert into permissions (code,description) values
('exams.schedule','Schedule scoped examination sittings'),
('exams.publish','Independently publish scoped examination timetables') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','exams.schedule'),('system_administrator','exams.publish'),
('examinations_officer','exams.schedule'),('examinations_officer','exams.publish'),
('academic_registrar','exams.publish') on conflict do nothing;
