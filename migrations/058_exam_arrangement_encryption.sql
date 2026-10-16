alter table exam_arrangements add column private_notes_encrypted boolean not null default false;
alter table exam_arrangements drop constraint exam_arrangements_request_note_check;
alter table exam_arrangements drop constraint exam_arrangements_evidence_ref_check;
alter table exam_arrangements add constraint exam_arrangements_request_note_check check
  (length(trim(request_note)) between 1 and case when private_notes_encrypted then 12000 else 2000 end);
alter table exam_arrangements add constraint exam_arrangements_evidence_ref_check check
  (length(trim(evidence_ref)) between 1 and case when private_notes_encrypted then 1200 else 200 end);
alter table exam_arrangements add constraint exam_arrangements_private_envelopes check
  (not private_notes_encrypted or (request_note like 'v1.%' and evidence_ref like 'v1.%'
    and (review_note is null or review_note like 'v1.%') and (close_note is null or close_note like 'v1.%')));
