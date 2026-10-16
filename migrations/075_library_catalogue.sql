-- Stage 6 library catalogue (LIB-01 to LIB-04) on the document repository. Library material is a repository item with
-- optional catalogue fields: author, publication year, resource type, and the programmes it serves. A collection
-- opened to students acts as the library shelf; upload, independent publication, withdrawal, view-only or download
-- controls, search, and access history are the repository's. The authors are searchable alongside the title.
alter table repository_items add column author text check (author is null or length(author) between 1 and 200);
alter table repository_items add column publication_year integer check (publication_year is null or publication_year between 1000 and 2100);
alter table repository_items add column resource_type text check (resource_type is null or resource_type in ('book','journal_article','thesis','past_paper','course_notes','video','dataset','other'));
alter table repository_items add column programme_codes text[] not null default '{}';
create index repository_items_programmes on repository_items using gin(programme_codes);

-- The search column is generated, so it is rebuilt to include the author.
alter table repository_items drop column search;
alter table repository_items add column search tsvector generated always as (to_tsvector('simple', title || ' ' || description || ' ' || summary || ' ' || keywords_text || ' ' || coalesce(author, ''))) stored;
create index repository_items_search on repository_items using gin(search);
