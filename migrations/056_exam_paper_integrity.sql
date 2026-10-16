create function exam_paper_facts_immutable() returns trigger language plpgsql as $$
begin
  if row(new.id,new.order_id,new.version,new.file_name,new.size_bytes,new.checksum,new.storage_key,new.upload_expires_at,new.created_by,new.created_at,new.reason)
    is distinct from row(old.id,old.order_id,old.version,old.file_name,old.size_bytes,old.checksum,old.storage_key,old.upload_expires_at,old.created_by,old.created_at,old.reason) then
    raise exception 'Exam paper version facts are immutable';
  end if;
  if old.scanned_by is not null and row(new.scan_status,new.scanner_ref,new.scanned_by) is distinct from row(old.scan_status,old.scanner_ref,old.scanned_by) then
    raise exception 'Exam paper scanner evidence is immutable';
  end if;
  if old.reviewed_by is not null and row(new.reviewed_by,new.reviewed_at,new.review_reason) is distinct from row(old.reviewed_by,old.reviewed_at,old.review_reason) then
    raise exception 'Exam paper review evidence is immutable';
  end if;
  if new.revision <> old.revision + 1 then raise exception 'Exam paper updates require the next revision'; end if;
  return new;
end;
$$;
create trigger exam_paper_immutable_facts before update on exam_papers for each row execute function exam_paper_facts_immutable();
create function exam_paper_package_facts_immutable() returns trigger language plpgsql as $$
begin
  if row(new.id,new.paper_id,new.order_id,new.sitting_id,new.sitting_revision,new.published_revision,new.staff_id,new.recipient_account_id,new.available_at,new.expires_at,new.copies,new.package_ref,new.created_by,new.created_at,new.reason)
    is distinct from row(old.id,old.paper_id,old.order_id,old.sitting_id,old.sitting_revision,old.published_revision,old.staff_id,old.recipient_account_id,old.available_at,old.expires_at,old.copies,old.package_ref,old.created_by,old.created_at,old.reason) then
    raise exception 'Exam paper package facts are immutable';
  end if;
  if old.acknowledged_at is not null and row(new.acknowledged_at,new.receipt_ref) is distinct from row(old.acknowledged_at,old.receipt_ref) then
    raise exception 'Exam paper custody receipts are immutable';
  end if;
  if old.revoked_by is not null and row(new.status,new.revoked_by,new.revocation_reason) is distinct from row(old.status,old.revoked_by,old.revocation_reason) then
    raise exception 'Exam paper revocations are immutable';
  end if;
  if new.revision <> old.revision + 1 then raise exception 'Exam paper package updates require the next revision'; end if;
  return new;
end;
$$;
create trigger exam_paper_package_immutable_facts before update on exam_paper_releases for each row execute function exam_paper_package_facts_immutable();
alter table exam_paper_releases add check (revision > 0);
alter table exam_paper_releases add check ((acknowledged_at is null) = (receipt_ref is null));
alter table exam_paper_releases add check ((status = 'active') = (revoked_by is null));
