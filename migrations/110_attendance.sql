-- Class attendance by QR code (docs/ATTENDANCE.md). A lecturer opens a short session for a course; students check in by
-- scanning a code that changes every 20 seconds, or by typing it. One mark per student per session; marks are kept.
create table attendance_sessions (
  id text primary key,
  period_id text not null,
  course_id text not null references courses(id),
  title text not null check (length(title) between 1 and 160),
  opened_by text not null references accounts(id),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  check (closes_at > opened_at and closes_at <= opened_at + interval '3 hours')
);
create index attendance_sessions_course on attendance_sessions(period_id,course_id,opened_at desc);

create table attendance_marks (
  session_id text not null references attendance_sessions(id),
  student_id text not null references students(id),
  method text not null check (method in ('qr','code','manual')),
  marked_by text not null references accounts(id),
  marked_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create function attendance_mark_guard() returns trigger language plpgsql as $$
begin raise exception 'attendance marks cannot be changed or removed'; end $$;
create trigger attendance_marks_fixed before update or delete on attendance_marks for each row execute function attendance_mark_guard();
