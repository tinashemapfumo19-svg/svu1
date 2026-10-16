create table exam_venues (
  id text primary key,
  code text not null unique,
  name text not null check (length(trim(name)) between 1 and 90),
  campus text not null check (length(trim(campus)) between 1 and 80),
  location text not null check (length(trim(location)) between 1 and 120),
  capacity integer not null check (capacity between 1 and 5000),
  status text not null default 'active' check (status in ('active','inactive')),
  revision integer not null default 1 check (revision > 0),
  updated_by text not null references accounts(id),
  updated_at timestamptz not null default now()
);
create table exam_venue_history (
  id bigint generated always as identity primary key,
  venue_id text not null references exam_venues(id),
  revision integer not null,
  snapshot jsonb not null,
  reason text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique (venue_id,revision)
);
create trigger exam_venue_history_append_only before update or delete on exam_venue_history
  for each row execute function ledger_append_only();
alter table exam_sittings add column venue_id text references exam_venues(id);
alter table exam_sittings add column venue_revision integer;
alter table exam_sittings add column venue_location text;
alter table exam_sittings add check ((venue_id is null) = (venue_revision is null));
create table exam_sitting_invigilators (
  sitting_id text not null references exam_sittings(id),
  staff_id text not null references staff_members(id),
  role text not null check (role in ('lead','invigilator')),
  primary key (sitting_id,staff_id)
);
create unique index exam_sitting_one_lead_invigilator on exam_sitting_invigilators(sitting_id) where role = 'lead';
alter table exam_timetables add column published_staff_snapshot jsonb;
insert into permissions (code,description) values
('exams.venues.manage','Manage the global examination venue catalogue'),
('exams.duties.self','Read own published invigilation duties') on conflict do nothing;
insert into roles (code,name,risk) values ('exam_invigilator','Exam Invigilator','medium') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','exams.venues.manage'),('system_administrator','exams.duties.self'),
('examinations_officer','exams.venues.manage'),('examinations_officer','exams.duties.self'),
('academic_registrar','exams.duties.self'),('lecturer','exams.duties.self'),('exam_invigilator','exams.duties.self') on conflict do nothing;
