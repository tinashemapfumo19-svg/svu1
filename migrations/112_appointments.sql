-- Appointment booking (docs/APPOINTMENTS.md). Staff publish slots (office hours, advising, finance or support desk);
-- a student books one slot with a short reason. One active booking per slot; either side may cancel with a reason.
insert into permissions (code,description) values
('appointments.host','Publish appointment slots and see bookings with you') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('lecturer','appointments.host'),('support_officer','appointments.host'),('support_manager','appointments.host'),
('academic_registrar','appointments.host'),('finance_officer','appointments.host'),('system_administrator','appointments.host')
on conflict do nothing;

create table appointment_slots (
  id text primary key,
  host_account_id text not null references accounts(id),
  kind text not null check (kind in ('office_hours','academic_advising','finance','support','registry')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null check (length(location) between 1 and 300),
  note text not null default '' check (length(note) <= 500),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '4 hours')
);
create index appointment_slots_upcoming on appointment_slots(starts_at) where cancelled_at is null;
create index appointment_slots_host on appointment_slots(host_account_id,starts_at);

create table appointment_bookings (
  id text primary key,
  slot_id text not null references appointment_slots(id),
  student_account_id text not null references accounts(id),
  reason text not null check (length(reason) between 3 and 500),
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text references accounts(id),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index appointment_one_booking_per_slot on appointment_bookings(slot_id) where status = 'booked';
create index appointment_bookings_student on appointment_bookings(student_account_id,created_at desc);
