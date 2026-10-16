-- Stage 5 teaching allocation (STF-07 to STF-09): accountable staff on period-specific course offerings. Allocations are
-- proposed, independently approved, and ended with a reason; they are never deleted. Lecturer access to class lists derives
-- from an approved allocation that is in force.
create table teaching_allocations (
  id bigint generated always as identity primary key,
  period_id text not null,
  course_id text not null,
  staff_id text not null references staff_members(id),
  role text not null check (role in ('lead','co_lecturer','tutor','moderator','examiner')),
  workload_units numeric(6,2) not null check (workload_units >= 0 and workload_units <= 1000),
  effective_from date not null,
  effective_to date,
  status text not null default 'proposed' check (status in ('proposed','active','rejected','ended')),
  reason text not null,
  proposed_by text not null references accounts(id),
  proposed_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  ended_by text references accounts(id),
  ended_at timestamptz,
  end_reason text,
  replaces_allocation_id bigint references teaching_allocations(id),
  foreign key (period_id, course_id) references registration_offerings(period_id, course_id),
  check (reviewed_by is null or reviewed_by <> proposed_by),
  check (effective_to is null or effective_to >= effective_from),
  check ((status = 'ended') = (end_reason is not null))
);
create index teaching_allocations_offering on teaching_allocations(period_id,course_id,status);
create index teaching_allocations_staff on teaching_allocations(staff_id,status);
create unique index teaching_one_open_role on teaching_allocations(period_id,course_id,staff_id,role) where status in ('proposed','active');

insert into permissions (code,description) values
('teaching.view','View scoped course offerings, allocations, coverage and workload'),
('teaching.allocate','Propose and end scoped teaching allocations'),
('teaching.approve','Independently approve scoped teaching allocations'),
('teaching.self','View own teaching allocations and class lists') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','teaching.view'),('system_administrator','teaching.allocate'),('system_administrator','teaching.approve'),
('academic_registrar','teaching.view'),('academic_registrar','teaching.allocate'),
('academic_approver','teaching.view'),('academic_approver','teaching.approve'),
('lecturer','teaching.self') on conflict do nothing;
