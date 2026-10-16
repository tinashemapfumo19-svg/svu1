alter table applicant_communication_recipients drop constraint applicant_communication_recipients_status_check;
alter table applicant_communication_recipients drop constraint applicant_communication_recipients_check;
alter table applicant_communication_recipients add constraint applicant_recipient_channel_state check (
  (channel = 'in_app' and status = 'available' and recipient_encrypted is null)
  or (channel = 'email' and status in ('queued','cancelled','accepted','delivered','bounced','complained','failed','dead') and recipient_encrypted is not null and read_at is null)
);
create or replace function applicant_recipient_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Communication recipients cannot be deleted'; end if;
  if (to_jsonb(new) - 'status' - 'read_at') is distinct from (to_jsonb(old) - 'status' - 'read_at')
    or not (new.status = old.status
      or old.status = 'queued' and new.status in ('cancelled','dead','accepted','delivered','bounced','complained','failed')
      or old.status = 'dead' and new.status in ('queued','cancelled')
      or old.status = 'accepted' and new.status in ('delivered','bounced','complained','failed')
      or old.status = 'failed' and new.status in ('delivered','bounced','complained')
      or old.status = 'delivered' and new.status in ('bounced','complained')
      or old.status = 'bounced' and new.status = 'complained')
    or old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'Communication recipient origin and history are immutable';
  end if;
  return new;
end;
$$;
create table applicant_communication_email_links (
  recipient_id text primary key references applicant_communication_recipients(id),
  notification_id text not null unique references notifications(id),
  created_at timestamptz not null default now()
);
create trigger applicant_email_link_append_only before update or delete on applicant_communication_email_links for each row execute function ledger_append_only();
create function applicant_email_link_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from applicant_communication_recipients r
    join applicant_communication_campaigns c on c.id = r.campaign_id
    join notifications n on n.id = new.notification_id
    where r.id = new.recipient_id and r.channel = 'email' and r.status = 'queued'
      and c.status = 'published' and n.channel = 'email' and n.status = 'queued'
      and n.recipient_account_id = r.account_id and n.payload->>'sensitive' = 'true'
      and exists(select 1 from notification_delivery_content s where s.notification_id = n.id)) then
    raise exception 'Campaign email requires a published recipient and encrypted delivery source';
  end if;
  return new;
end;
$$;
create trigger applicant_email_link_valid before insert on applicant_communication_email_links for each row execute function applicant_email_link_guard();
