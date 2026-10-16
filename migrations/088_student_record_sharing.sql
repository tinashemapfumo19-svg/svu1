create table student_record_shares (
  id text primary key,
  student_programme_id text not null references student_programmes(id),
  owner_id text not null references accounts(id),
  recipient_email text not null,
  recipient_id text references accounts(id),
  student_label jsonb not null default '{}' check(jsonb_typeof(student_label)='object'),
  categories jsonb not null check(jsonb_typeof(categories)='array' and jsonb_array_length(categories) between 1 and 4 and categories <@ '["programme_status","confirmed_registration","published_results","fee_summary"]'::jsonb),
  expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','accepted','revoked','declined')),
  revision integer not null default 1 check(revision>0),
  challenge_hash text not null unique,
  challenge_expires_at timestamptz not null,
  invitation_count integer not null default 1 check(invitation_count between 1 and 5),
  accepted_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check(recipient_id is null or recipient_id<>owner_id),
  check(status<>'accepted' or (recipient_id is not null and accepted_at is not null)),
  check(challenge_expires_at<=expires_at)
);
create index student_shares_owner on student_record_shares(owner_id,created_at desc,id);
create index student_shares_recipient on student_record_shares(recipient_id,created_at desc,id);
create table student_share_history (
  id bigint generated always as identity primary key,
  share_id text not null references student_record_shares(id),
  revision integer not null,
  action text not null,
  actor_id text not null references accounts(id),
  recorded_at timestamptz not null default now(),
  unique(share_id,revision)
);
create table student_share_access (
  id bigint generated always as identity primary key,
  share_id text not null references student_record_shares(id),
  revision integer not null,
  category text not null,
  actor_id text not null references accounts(id),
  accessed_at timestamptz not null default now()
);
create table student_share_commands (
  actor_id text not null references accounts(id),
  request_key text not null,
  input_hash text not null,
  share_id text not null references student_record_shares(id),
  created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
create index student_share_access_history on student_share_access(share_id,id desc);
create trigger student_share_history_retained before update or delete on student_share_history for each row execute function ledger_append_only();
create trigger student_share_access_retained before update or delete on student_share_access for each row execute function ledger_append_only();
create trigger student_share_commands_retained before update or delete on student_share_commands for each row execute function ledger_append_only();
create function protect_student_share() returns trigger language plpgsql as $$
begin
  if TG_OP='DELETE' then raise exception 'Sharing history is retained'; end if;
  if (to_jsonb(NEW)-array['status','revision','challenge_hash','challenge_expires_at','invitation_count','recipient_id','accepted_at','closed_at']) <>
    (to_jsonb(OLD)-array['status','revision','challenge_hash','challenge_expires_at','invitation_count','recipient_id','accepted_at','closed_at']) or
    NEW.revision<>OLD.revision+1 or OLD.status in ('revoked','declined') or
    not ((OLD.status='pending' and NEW.status in ('pending','accepted','revoked','declined')) or (OLD.status='accepted' and NEW.status in ('revoked','declined'))) or
    (OLD.recipient_id is not null and NEW.recipient_id is distinct from OLD.recipient_id) or
    (OLD.accepted_at is not null and NEW.accepted_at is distinct from OLD.accepted_at) then
    raise exception 'Sharing definitions are immutable and lifecycle is bounded';
  end if;
  return NEW;
end $$;
create trigger student_share_immutable before update or delete on student_record_shares for each row execute function protect_student_share();
insert into roles(code,name,risk) values('record_recipient','Shared Records Recipient','medium') on conflict do nothing;
insert into permissions(code,description) values('sharing.read','View only student-authorized shared records bound to this verified recipient') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values('record_recipient','sharing.read') on conflict do nothing;
insert into notification_templates(id,code,channel,subject,body,version,status) values
('nt_student_sharing_invitation_v1','student.sharing_invitation','email','Student record sharing invitation','A student has invited you to view selected university records. Invitation: {{invitationLink}}. Email verification expires {{challengeExpiresAt}}. Access expires {{expiresAt}}. This invitation does not grant permission until you accept.',1,'active') on conflict do nothing;
