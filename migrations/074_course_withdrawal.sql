-- Stage 3 course withdrawal. A student withdraws from one confirmed course enrolment through a reasoned request that a
-- different person approves. The enrolment row stays (receipts, confirmations, and history are never rewritten); it is
-- marked withdrawn, and active rosters exclude it through the shared predicate `withdrawn_at is null`. Withdrawal is
-- refused once the course has any result evidence (an official result or a row in a non-rejected batch), until a
-- governed rule for that exists (D-18). Fee consequences stay separate approved finance adjustments.
create table course_withdrawal_requests (
  id bigint generated always as identity primary key,
  registration_id text not null,
  course_id text not null,
  student_programme_id text not null references student_programmes(id),
  reason text not null,
  evidence_ref text,
  status text not null default 'requested' check (status in ('requested','approved','rejected','cancelled')),
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  foreign key (registration_id, course_id) references course_enrolments(registration_id, course_id),
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create unique index course_withdrawal_one_live on course_withdrawal_requests(registration_id,course_id) where status in ('requested','approved');
create trigger course_withdrawal_requests_no_delete before delete on course_withdrawal_requests for each row execute function ledger_append_only();

alter table course_enrolments add column withdrawn_at timestamptz;
alter table course_enrolments add column withdrawal_request_id bigint unique references course_withdrawal_requests(id);
alter table course_enrolments add constraint course_enrolment_withdrawal_shape check ((withdrawn_at is null) = (withdrawal_request_id is null));
