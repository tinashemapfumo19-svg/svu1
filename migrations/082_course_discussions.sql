create table course_discussion_threads (
  id text primary key,
  period_id text not null,
  course_id text not null,
  title text not null check(length(title) between 1 and 200),
  created_by text not null references accounts(id),
  locked boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz(3) not null default now(),
  foreign key(period_id,course_id) references registration_offerings(period_id,course_id)
);
create index course_discussion_offering on course_discussion_threads(period_id,course_id,created_at desc,id desc);
create table course_discussion_posts (
  id text primary key,
  thread_id text not null references course_discussion_threads(id),
  author_id text not null references accounts(id),
  body text not null check(length(body) between 1 and 4000),
  hidden boolean not null default false,
  revision integer not null default 1,
  request_key text not null,
  operation text not null check(operation in ('create','reply')),
  created_at timestamptz(3) not null default now(),
  unique(author_id,request_key)
);
create index course_discussion_history on course_discussion_posts(thread_id,created_at desc,id desc);
create function protect_course_discussion_post() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Discussion messages are retained'; end if;
  if (new.id,new.thread_id,new.author_id,new.body,new.request_key,new.operation,new.created_at)
    is distinct from (old.id,old.thread_id,old.author_id,old.body,old.request_key,old.operation,old.created_at)
    then raise exception 'Discussion message content is immutable'; end if;
  return new;
end;
$$;
create trigger course_discussion_post_content before update or delete on course_discussion_posts for each row execute function protect_course_discussion_post();
create table course_discussion_reports (
  post_id text not null references course_discussion_posts(id),
  reporter_id text not null references accounts(id),
  reason text not null check(length(reason) between 1 and 2000),
  created_at timestamptz(3) not null default now(),
  primary key(post_id,reporter_id)
);
create trigger course_discussion_reports_append_only before update or delete on course_discussion_reports for each row execute function ledger_append_only();
