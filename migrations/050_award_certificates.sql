-- Stage 7 award certificates (EXM-18). A certificate is an official document like a transcript: an immutable snapshot (holder,
-- programme, conferred award) with a content hash and verification code, issued only after an award is conferred,
-- superseded by reissue and revocable. It shares the transcripts table, guard trigger, and public verification.
alter table transcripts drop constraint transcripts_kind_check;
alter table transcripts add constraint transcripts_kind_check check (kind in ('progressive','certificate'));
