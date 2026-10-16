create table guidance_articles (
  id text primary key,
  programme_id text references programmes(id),
  intake_id text references intakes(id),
  created_by text not null references accounts(id),
  request_key text not null,
  request_hash text not null,
  status text not null default 'active' check (status in ('active','withdrawn')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by,request_key),
  check (intake_id is null or programme_id is not null)
);
create table guidance_versions (
  id text primary key,
  article_id text not null references guidance_articles(id),
  version integer not null check (version > 0),
  title_encrypted text not null,
  body_encrypted text not null,
  source_ref_encrypted text not null,
  reason_encrypted text not null,
  effective_from date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','published')),
  created_by text not null references accounts(id),
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  published_by text references accounts(id),
  published_at timestamptz,
  review_reason_encrypted text,
  search_document tsvector,
  unique(article_id,version),
  unique(article_id,created_by,request_key),
  check (valid_until is null or valid_until >= effective_from),
  check ((status = 'published') = (published_at is not null)),
  check ((status = 'published') = (published_by is not null)),
  check ((status = 'published') = (review_reason_encrypted is not null)),
  check ((status = 'published') = (search_document is not null)),
  check (published_by is null or published_by <> created_by)
);
create index guidance_search_idx on guidance_versions using gin(search_document) where status = 'published';
create index guidance_scope_idx on guidance_articles(programme_id,intake_id,status);
create table guidance_history (
  id bigint generated always as identity primary key,
  article_id text not null references guidance_articles(id),
  revision integer not null,
  action text not null,
  version integer,
  actor_id text not null references accounts(id),
  reason_encrypted text not null,
  recorded_at timestamptz not null default now(),
  unique(article_id,revision)
);
create trigger guidance_history_append_only before update or delete on guidance_history for each row execute function ledger_append_only();
create function guidance_article_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.intake_id is not null and not exists(select 1 from intakes where id = new.intake_id and programme_id = new.programme_id) then
      raise exception 'Guidance intake must belong to its programme';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'Guidance articles cannot be deleted'; end if;
  if row(new.id,new.programme_id,new.intake_id,new.created_by,new.request_key,new.request_hash,new.created_at)
    is distinct from row(old.id,old.programme_id,old.intake_id,old.created_by,old.request_key,old.request_hash,old.created_at)
    or new.revision <> old.revision + 1 or old.status = 'withdrawn' then
    raise exception 'Guidance origin is immutable and revisions must advance';
  end if;
  return new;
end;
$$;
create trigger guidance_article_immutable before insert or update or delete on guidance_articles for each row execute function guidance_article_guard();
create function guidance_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Guidance versions cannot be deleted'; end if;
  if old.status <> 'draft' or new.status <> 'published'
    or (to_jsonb(new) - 'status' - 'published_by' - 'published_at' - 'review_reason_encrypted' - 'search_document')
      is distinct from (to_jsonb(old) - 'status' - 'published_by' - 'published_at' - 'review_reason_encrypted' - 'search_document') then
    raise exception 'Guidance version content is immutable';
  end if;
  return new;
end;
$$;
create trigger guidance_version_immutable before update or delete on guidance_versions for each row execute function guidance_version_guard();
insert into permissions(code,description) values ('guidance.manage','Draft scoped public admissions guidance'),('guidance.publish','Independently publish or withdraw scoped admissions guidance') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('admissions_officer','guidance.manage'),('admissions_manager','guidance.manage'),('admissions_manager','guidance.publish'),
('system_administrator','guidance.manage'),('system_administrator','guidance.publish') on conflict do nothing;
