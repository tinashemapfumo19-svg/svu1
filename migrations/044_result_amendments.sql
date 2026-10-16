-- Stage 7 post-publication result amendments. A published result changes only through an evidenced request and an
-- independent approval. The official record (academic_results) is updated with a revision bump; the published batch keeps
-- the original publication and the amendment keeps both before and after snapshots.
alter table academic_results add column revision integer not null default 0 check (revision >= 0);
alter table academic_results add column amended_at timestamptz;

create table result_amendments (
  id bigint generated always as identity primary key,
  batch_id text not null references result_batches(id),
  registration_id text not null,
  course_id text not null,
  result_revision integer not null,
  category text not null check (category in ('marking_error','transcription_error','moderation','appeal','academic_misconduct')),
  from_snapshot jsonb not null,
  to_snapshot jsonb not null,
  reason text not null,
  evidence_ref text not null,
  requested_by text not null references accounts(id),
  requested_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  foreign key (registration_id, course_id) references academic_results(registration_id, course_id),
  check (reviewed_by is null or reviewed_by <> requested_by)
);
create unique index result_amendment_open on result_amendments(registration_id,course_id) where status = 'requested';
create index result_amendment_batch on result_amendments(batch_id,id desc);

create or replace function result_amendment_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'requested' or new.from_snapshot <> old.from_snapshot or new.to_snapshot <> old.to_snapshot or new.requested_by <> old.requested_by then
    raise exception 'reviewed result amendments are immutable';
  end if;
  return new;
end $$;
create trigger result_amendments_guard before update on result_amendments for each row execute function result_amendment_guard();
create trigger result_amendments_no_delete before delete on result_amendments for each row execute function ledger_append_only();

insert into permissions (code,description) values
('results.amend.request','Request scoped amendments to published results'),
('results.amend.approve','Independently approve scoped amendments to published results') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','results.amend.request'),('system_administrator','results.amend.approve'),
('academic_registrar','results.amend.request'),('examinations_officer','results.amend.request'),
('examinations_officer','results.amend.approve'),('academic_approver','results.amend.approve') on conflict do nothing;
