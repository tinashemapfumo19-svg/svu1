-- Self-service letters (docs/STUDENT_LETTERS.md): a student issues a confirmation of enrolment or proof of registration
-- from the official record. Like transcripts, each letter is an immutable snapshot bound by a content hash and a public
-- verification code; it states the record as of its issue date. Only status may change (issued -> revoked).
create table student_letters (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  kind text not null check (kind in ('enrolment','registration')),
  period_id text references registration_periods(id),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  verification_code text not null unique check (verification_code ~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$'),
  status text not null default 'issued' check (status in ('issued','revoked')),
  issued_by text not null references accounts(id),
  issued_at timestamptz not null default now(),
  revoked_by text references accounts(id),
  revoked_at timestamptz,
  revoke_reason text,
  check ((kind = 'registration') = (period_id is not null)),
  check ((status = 'revoked') = (revoked_by is not null and revoke_reason is not null))
);
create index student_letter_history on student_letters(student_programme_id,issued_at desc);

create function student_letter_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'student letters cannot be deleted'; end if;
  if old.status <> 'issued' or new.content is distinct from old.content or new.content_hash <> old.content_hash or new.verification_code <> old.verification_code
    or new.student_programme_id <> old.student_programme_id or new.kind <> old.kind or new.issued_by <> old.issued_by or new.issued_at <> old.issued_at then
    raise exception 'issued letters are immutable';
  end if;
  return new;
end $$;
create trigger student_letters_immutable before update or delete on student_letters for each row execute function student_letter_guard();
