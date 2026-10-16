create table exam_arrangements (
  id text primary key,
  sitting_id text not null references exam_sittings(id),
  registration_id text not null references student_registrations(id),
  sitting_hash text not null,
  extra_minutes integer not null check (extra_minutes between 0 and 240 and extra_minutes % 15 = 0),
  separate_room boolean not null,
  request_note text not null check (length(trim(request_note)) between 1 and 2000),
  evidence_ref text not null check (length(trim(evidence_ref)) between 1 and 200),
  status text not null default 'requested' check (status in ('requested','approved','returned','withdrawn','revoked')),
  revision integer not null default 1,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_note text,
  instruction text,
  venue_id text references exam_venues(id),
  venue_revision integer,
  venue text,
  venue_location text,
  capacity integer,
  invigilator_staff_id text references staff_members(id),
  closed_by text references accounts(id),
  close_note text,
  check (reviewed_by is null or reviewed_by <> requested_by),
  check (status <> 'approved' or (reviewed_by is not null and instruction is not null)),
  check (status <> 'approved' or separate_room = (venue_id is not null)),
  check ((venue_id is null) = (invigilator_staff_id is null)),
  check ((venue_id is null) = (venue_revision is null))
);
create unique index exam_arrangement_one_live on exam_arrangements(sitting_id,registration_id) where status in ('requested','approved');
create function exam_arrangement_evidence_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Exam arrangement evidence cannot be deleted'; end if;
  if (to_jsonb(new) - array['status','revision','reviewed_by','reviewed_at','review_note','instruction','venue_id','venue_revision','venue','venue_location','capacity','invigilator_staff_id','closed_by','close_note'])
    is distinct from (to_jsonb(old) - array['status','revision','reviewed_by','reviewed_at','review_note','instruction','venue_id','venue_revision','venue','venue_location','capacity','invigilator_staff_id','closed_by','close_note']) then
    raise exception 'Exam arrangement request evidence is immutable';
  end if;
  if old.reviewed_by is not null and row(new.reviewed_by,new.reviewed_at,new.review_note,new.instruction,new.venue_id,new.venue_revision,new.venue,new.venue_location,new.capacity,new.invigilator_staff_id)
    is distinct from row(old.reviewed_by,old.reviewed_at,old.review_note,old.instruction,old.venue_id,old.venue_revision,old.venue,old.venue_location,old.capacity,old.invigilator_staff_id) then
    raise exception 'Exam arrangement review evidence is immutable';
  end if;
  if new.revision <> old.revision + 1 or not ((old.status = 'requested' and new.status in ('approved','returned','withdrawn')) or (old.status = 'approved' and new.status = 'revoked')) then
    raise exception 'Invalid exam arrangement transition';
  end if;
  return new;
end;
$$;
create trigger exam_arrangement_immutable before update or delete on exam_arrangements for each row execute function exam_arrangement_evidence_immutable();
create table exam_arrangement_history (
  id bigint generated always as identity primary key,
  arrangement_id text not null references exam_arrangements(id),
  revision integer not null,
  snapshot jsonb not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique (arrangement_id,revision)
);
create trigger exam_arrangement_history_append_only before update or delete on exam_arrangement_history for each row execute function ledger_append_only();
insert into roles (code,name,risk) values ('exam_arrangements_officer','Exam Arrangements Officer','high') on conflict do nothing;
insert into permissions (code,description) values ('exams.arrangements.manage','Manage confidential candidate arrangement requests'),('exams.arrangements.review','Independently review confidential candidate arrangements') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','exams.arrangements.manage'),('system_administrator','exams.arrangements.review'),
('exam_arrangements_officer','exams.arrangements.manage'),('exam_arrangements_officer','exams.arrangements.review') on conflict do nothing;
