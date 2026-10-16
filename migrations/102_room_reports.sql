insert into permissions(code,description) values ('rooms.triage','Review explicitly disclosed institutional room abuse reports') on conflict do nothing;
insert into roles(code,name,risk) values ('room_safety_reviewer','Room Safety Reviewer','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('room_safety_reviewer','rooms.self'),('room_safety_reviewer','rooms.triage'),('system_administrator','rooms.triage') on conflict do nothing;

create table room_abuse_reports (
  id text primary key,
  room_id text not null references message_rooms(id),
  message_id text not null,
  reporter_id text not null references accounts(id),
  membership_id text not null,
  category text not null check(category in ('harassment','threat','spam','privacy','other')),
  disclosed boolean not null check(disclosed),
  envelope text not null check(length(envelope) between 1 and 40000),
  created_at timestamptz not null default clock_timestamp(),
  unique(message_id,reporter_id),
  foreign key(message_id,room_id) references room_messages(id,room_id),
  foreign key(membership_id,room_id,reporter_id) references message_room_memberships(id,room_id,account_id)
);
create index room_abuse_own_page on room_abuse_reports(reporter_id,created_at desc,id);
create index room_abuse_queue_page on room_abuse_reports(created_at desc,id);
create trigger room_abuse_reports_append_only before update or delete on room_abuse_reports for each row execute function ledger_append_only();
create function room_abuse_report_guard() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||new.room_id,0));
  new.created_at:=clock_timestamp();
  if not exists(select 1 from message_room_memberships m join room_message_preferences p on p.account_id=m.account_id
    join accounts a on a.id=m.account_id join room_messages msg on msg.room_id=m.room_id
    where m.id=new.membership_id and m.account_id=new.reporter_id and m.room_id=new.room_id and m.status='accepted'
    and a.status='active' and p.enabled and p.revision=m.consent_revision and msg.id=new.message_id
    and msg.created_at>=m.accepted_at and msg.author_id<>new.reporter_id
    and not coalesce((select hidden from room_message_moderation where message_id=msg.id order by revision desc limit 1),false)
    and not exists(select 1 from private_contact_blocks b where b.active and
      ((b.account_id=new.reporter_id and b.peer_id=msg.author_id) or (b.peer_id=new.reporter_id and b.account_id=msg.author_id)))
    for share of p,a) then raise exception 'Reports require current participation and a visible peer message'; end if;
  return new;
end $$;
create trigger room_abuse_report_valid before insert on room_abuse_reports for each row execute function room_abuse_report_guard();

create table room_abuse_events (
  report_id text not null references room_abuse_reports(id),
  revision integer not null check(revision>0),
  operation text not null check(operation in ('claim','release','resolve','dismiss','reopen')),
  status text not null check(status in ('open','reviewing','resolved','dismissed')),
  assignee_id text references accounts(id),
  actor_id text not null references accounts(id),
  envelope text not null check(length(envelope) between 1 and 20000),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(report_id,revision),
  check((status='reviewing')=(assignee_id is not null))
);
create trigger room_abuse_events_append_only before update or delete on room_abuse_events for each row execute function ledger_append_only();
create function room_abuse_event_guard() returns trigger language plpgsql as $$
declare report room_abuse_reports; previous room_abuse_events; previous_revision integer; previous_status text;
begin
  select * into report from room_abuse_reports where id=new.report_id;
  if not found then raise exception 'Report was not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('message-room:'||report.room_id,0));
  new.recorded_at:=clock_timestamp();
  if new.actor_id=report.reporter_id or exists(select 1 from room_messages where id=report.message_id and author_id=new.actor_id)
    or exists(select 1 from message_rooms where id=report.room_id and created_by=new.actor_id) then raise exception 'Report review requires an uninvolved reviewer'; end if;
  if not exists(select 1 from accounts a join role_assignments ra on ra.account_id=a.id join roles r on r.code=ra.role_code
    join role_permissions rp on rp.role_code=r.code where a.id=new.actor_id and a.status='active' and r.active
    and ra.ended_at is null and ra.effective_from<=current_date and (ra.effective_to is null or ra.effective_to>=current_date)
    and ra.scope='{}'::jsonb and rp.permission_code='rooms.triage' for share of a,ra,r,rp) then raise exception 'Report review requires current global safety authority'; end if;
  select * into previous from room_abuse_events where report_id=new.report_id order by revision desc limit 1;
  previous_revision:=coalesce(previous.revision,0); previous_status:=coalesce(previous.status,'open');
  if new.revision<>previous_revision+1 then raise exception 'Report revision changed'; end if;
  if not coalesce((
    new.operation='claim' and previous_status='open' and new.status='reviewing' and new.assignee_id=new.actor_id
    or new.operation='release' and previous_status='reviewing' and previous.assignee_id=new.actor_id and new.status='open' and new.assignee_id is null
    or new.operation='resolve' and previous_status='reviewing' and previous.assignee_id=new.actor_id and new.status='resolved' and new.assignee_id is null
    or new.operation='dismiss' and previous_status='reviewing' and previous.assignee_id=new.actor_id and new.status='dismissed' and new.assignee_id is null
    or new.operation='reopen' and previous_status in ('resolved','dismissed') and new.status='open' and new.assignee_id is null
  ),false) then raise exception 'Report transition or ownership changed'; end if;
  return new;
end $$;
create trigger room_abuse_event_valid before insert on room_abuse_events for each row execute function room_abuse_event_guard();
