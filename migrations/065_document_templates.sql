-- Stage 8 official-document templates (RPT-09) and document reference numbers. The wording, signatory, and footer of
-- transcripts and certificates come from versioned templates: drafted, independently approved, and immutable once
-- published, so every issued document can name the exact template it used. Each issued document also gets a unique,
-- human-readable reference number (SVU-TR-2026-000001, SVU-CT-2026-000001) alongside its verification code.
create table document_templates (
  id text primary key,
  kind text not null check (kind in ('progressive','certificate')),
  version integer not null check (version > 0),
  content jsonb not null,
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  reason text not null,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  unique (kind, version),
  check (published_by is null or published_by <> created_by)
);
create unique index document_templates_one_published on document_templates(kind) where status = 'published';
create unique index document_templates_one_draft on document_templates(kind) where status = 'draft';
-- Published and superseded templates never change, so a document's template reference stays meaningful.
create function document_template_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'document templates cannot be deleted'; end if;
  if old.status <> 'draft' and (new.content is distinct from old.content or new.kind <> old.kind or new.version <> old.version) then
    raise exception 'published document templates are immutable';
  end if;
  return new;
end $$;
create trigger document_templates_immutable before update or delete on document_templates for each row execute function document_template_guard();

create sequence document_reference_seq;
alter table transcripts add column template_id text references document_templates(id);
alter table transcripts add column reference_number text unique;

-- The transcript guard predates these columns; extend it so they are fixed once issued as well.
create or replace function transcript_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'transcripts cannot be deleted'; end if;
  if old.status <> 'issued' or new.content is distinct from old.content or new.content_hash <> old.content_hash or new.verification_code <> old.verification_code
    or new.student_programme_id <> old.student_programme_id or new.issued_by <> old.issued_by or new.issued_at <> old.issued_at or new.reason <> old.reason
    or new.template_id is distinct from old.template_id or new.reference_number is distinct from old.reference_number then
    raise exception 'issued transcripts are immutable';
  end if;
  return new;
end $$;

insert into permissions (code,description) values
('documents.templates.manage','Draft official-document templates'),
('documents.templates.approve','Independently approve official-document templates') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','documents.templates.manage'),('system_administrator','documents.templates.approve'),
('academic_registrar','documents.templates.manage'),('records_manager','documents.templates.approve') on conflict do nothing;
