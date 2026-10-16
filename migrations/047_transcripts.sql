-- Stage 7 progressive transcripts (EXM-16) with public authenticity verification (RPT-10). A transcript is an immutable
-- snapshot of a programme's official record (published results with approved amendments, and approved recognized credit),
-- bound by a content hash and a random verification code. Issuing again supersedes the previous transcript; revocation keeps
-- the record. Content never changes after issue: a later amendment makes the issued transcript outdated, not different.
create table transcripts (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  kind text not null default 'progressive' check (kind in ('progressive')),
  content jsonb not null,
  content_hash text not null,
  verification_code text not null unique check (verification_code ~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$'),
  status text not null default 'issued' check (status in ('issued','superseded','revoked')),
  reason text not null,
  issued_by text not null references accounts(id),
  issued_at timestamptz not null default now(),
  superseded_by text references transcripts(id) deferrable initially deferred,
  superseded_at timestamptz,
  revoked_by text references accounts(id),
  revoked_at timestamptz,
  revoke_reason text,
  check ((status = 'superseded') = (superseded_by is not null)),
  check ((status = 'revoked') = (revoked_by is not null and revoke_reason is not null))
);
create unique index transcript_one_current on transcripts(student_programme_id,kind) where status = 'issued';
create index transcript_history on transcripts(student_programme_id,issued_at desc);

-- Only the status columns may change, and only forwards from issued; content, hash, code, and issue facts are fixed.
create function transcript_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'transcripts cannot be deleted'; end if;
  if old.status <> 'issued' or new.content is distinct from old.content or new.content_hash <> old.content_hash or new.verification_code <> old.verification_code
    or new.student_programme_id <> old.student_programme_id or new.issued_by <> old.issued_by or new.issued_at <> old.issued_at or new.reason <> old.reason then
    raise exception 'issued transcripts are immutable';
  end if;
  return new;
end $$;
create trigger transcripts_immutable before update or delete on transcripts for each row execute function transcript_guard();

insert into permissions (code,description) values
('registry.transcript.issue','Issue and revoke scoped official transcripts') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','registry.transcript.issue'),('academic_registrar','registry.transcript.issue') on conflict do nothing;
