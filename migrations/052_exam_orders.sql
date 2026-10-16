create table exam_orders (
  id text primary key,
  period_id text not null,
  course_id text not null,
  paper text not null check (length(trim(paper)) between 1 and 60),
  duration_minutes integer not null check (duration_minutes between 15 and 480 and duration_minutes % 15 = 0),
  paper_reference text not null check (length(trim(paper_reference)) between 1 and 200),
  materials_allowed text not null check (length(trim(materials_allowed)) between 1 and 500),
  requirements text not null check (length(requirements) <= 1000),
  reason text not null,
  status text not null default 'submitted' check (status in ('submitted','approved','returned')),
  submitted_by text not null references accounts(id),
  submitted_at timestamptz not null default now(),
  reviewed_by text references accounts(id),
  reviewed_at timestamptz,
  review_reason text,
  foreign key (period_id,course_id) references registration_offerings(period_id,course_id),
  unique (id,period_id,course_id),
  check (reviewed_by is null or reviewed_by <> submitted_by),
  check ((status = 'submitted') = (reviewed_by is null))
);
create unique index exam_order_live_paper on exam_orders(period_id,course_id,lower(paper)) where status in ('submitted','approved');
alter table exam_sittings add column order_id text;
alter table exam_sittings add foreign key (order_id,period_id,course_id) references exam_orders(id,period_id,course_id);
create unique index exam_order_one_sitting on exam_sittings(order_id) where status = 'scheduled';
