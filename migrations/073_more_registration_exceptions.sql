-- Stage 3 registration exceptions. A prerequisite waiver joins the credit-load and timetable-clash exceptions: requested
-- with evidence, bound to the registration revision and evidence hash, independently approved, and expiring. Late
-- registration is different in kind: a student who missed the window has no draft to bind to, so it is a dated window
-- extension for one student and one period, independently approved. While in force, the closed calendar window does not
-- block saving, exceptions, or confirmation; the period itself must still be open.
alter table registration_exceptions drop constraint registration_exceptions_kind_check;
alter table registration_exceptions add constraint registration_exceptions_kind_check check (kind in ('credit_limit','timetable_clash','prerequisite_waiver'));

create table registration_window_extensions (
  id bigint generated always as identity primary key,
  student_programme_id text not null references student_programmes(id),
  period_id text not null references registration_periods(id),
  until date not null,
  reason text not null,
  evidence_ref text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','revoked')),
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create unique index registration_window_extension_live on registration_window_extensions(student_programme_id,period_id) where status in ('requested','approved');
