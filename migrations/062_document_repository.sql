-- Stage 8 managed document repository (RPT-12). Collections set who can see their items (named roles, optionally students),
-- whether files may be downloaded or only viewed, a minimum classification, and a retention period. Items carry searchable
-- metadata. Each version is a file in the existing document pipeline (signed upload, signature check, malware scan) and is
-- published by someone other than its uploader. Published versions never change; earlier ones stay available to managers.
-- Retention dates and legal holds feed a disposal queue.
create table repository_collections (
  id text primary key,
  code text not null unique check (code ~ '^[a-z0-9_]{3,40}$'),
  name text not null,
  description text not null default '',
  classification text not null check (classification in ('public','internal','confidential','restricted')),
  view_roles text[] not null default '{}',
  student_access boolean not null default false,
  allow_download boolean not null default true,
  retention_years integer check (retention_years is null or retention_years between 1 and 100),
  status text not null default 'active' check (status in ('active','archived')),
  revision integer not null default 1,
  created_by text not null references accounts(id),
  updated_by text not null references accounts(id),
  updated_at timestamptz not null default now(),
  check (not student_access or classification in ('public','internal'))
);

create table repository_items (
  id text primary key,
  collection_id text not null references repository_collections(id),
  title text not null check (length(title) between 3 and 200),
  description text not null default '',
  summary text not null default '',
  keywords text[] not null default '{}',
  keywords_text text not null default '',
  status text not null default 'draft' check (status in ('draft','published','withdrawn')),
  current_version integer,
  retention_until date,
  legal_hold boolean not null default false,
  revision integer not null default 1,
  created_by text not null references accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', title || ' ' || description || ' ' || summary || ' ' || keywords_text)) stored
);
create index repository_items_search on repository_items using gin(search);
create index repository_items_collection on repository_items(collection_id,status);

create table repository_versions (
  id text primary key,
  item_id text not null references repository_items(id),
  version integer not null check (version > 0),
  document_id text not null unique references documents(id),
  change_note text not null,
  status text not null default 'pending' check (status in ('pending','published','superseded','rejected')),
  uploaded_by text not null references accounts(id),
  uploaded_at timestamptz not null default now(),
  published_by text references accounts(id),
  published_at timestamptz,
  publication_reason text,
  unique (item_id, version),
  check (published_by is null or published_by <> uploaded_by)
);
create unique index repository_one_pending_version on repository_versions(item_id) where status = 'pending';

insert into roles (code,name,risk) values ('records_manager','Records Manager','high') on conflict do nothing;
insert into permissions (code,description) values
('repository.manage','Manage repository collections, legal holds, and retention'),
('repository.contribute','Create repository items and upload versions'),
('repository.publish','Independently publish or withdraw repository versions') on conflict do nothing;
insert into role_permissions (role_code,permission_code) values
('system_administrator','repository.manage'),('system_administrator','repository.contribute'),('system_administrator','repository.publish'),
('records_manager','repository.manage'),('records_manager','repository.contribute'),('records_manager','repository.publish'),
('academic_registrar','repository.contribute') on conflict do nothing;
