# Governed Admissions Guidance

Inventory: `COM-11`; Stage 8 knowledge-base/context-help foundation. Migration `064_admissions_guidance.sql`. This is curated guidance publishing, not an AI chatbot, WhatsApp integration or institutional content approval.

## Publication And Scope

Staff use `#admissions` > Guidance publishing. `guidance.manage` grants drafting to admissions officers, managers and administrators. `guidance.publish` grants independent review/publication/withdrawal to managers and administrators. Each action uses only roles granting its permission. Intake-scoped roles cannot create programme-wide or institutional guidance, and unrelated global roles do not widen access. Wrong scope is refused before private version/history reads or decryption.

Articles have immutable institutional/programme/intake custody. Version content, dates, public source reference and private drafting reason are encrypted and immutable. Corrections require a new version. Request keys are author-bound and keyed hashes use canonical payloads; identical retries reuse the saved article/version, changed payloads conflict. Revisions serialize drafting, review and withdrawal. The drafter cannot approve the same version, enforced by the service and database. Only the latest draft may be published. Review/withdrawal reasons remain encrypted in append-only history; metadata-only audits omit guidance text and private reasons.

Withdrawal is terminal. It removes every version of the article from public reads and prevents later drafting/publication. Replacement after withdrawal requires a new independently approved article. Retained article/version/history records cannot be deleted through the workflow.

## Public Reading

Anonymous and signed-in applicants use Admissions guidance at `#apply`. Search, programme/intake filters and 25-item pagination read `/api/guidance/articles` without authentication. No draft, internal reason, staff identity or review history is included. Public markup is escaped; source references are displayed as text, not fetched or trusted HTML. A source reference is a review input, not automated evidence that a policy is approved.

Readers see active articles' highest-version published content whose effective date has started. Future publications do not replace currently started advice. Expiry is checked after selecting that version: an expired replacement does not resurrect older advice. Dates are inclusive UTC calendar dates pending institutional timezone policy (D-24). Programme sources must be published with a published/retired curriculum version covering the intake start date, or current UTC date for programme-wide articles. Intake-specific sources must remain published and their application close timestamp must not have passed. Institutional guidance is explicitly reviewed independently rather than inferred from a programme.

Only already-public published guidance contributes to the PostgreSQL full-text index; drafts and private review reasons are never indexed. Publication is the intentional disclosure boundary. Existing document repository classifications/permissions are unchanged; repository files do not become anonymous knowledge sources. No invented approved institutional articles are seeded.

## API Boundary

- `GET /api/guidance/articles`: public, strict search/scope/offset fields, published effective content only.
- `GET /api/guidance/manage/metadata`: authorized scope choices; manage or publish authority.
- `GET /api/guidance/manage/articles`: scoped staff queue with bounded offset.
- `GET /api/guidance/manage/articles/:id`: freshly authorized private versions and review history.
- `POST /api/guidance/manage/articles`: immutable scoped first draft; manage authority and replay key.
- `POST /api/guidance/manage/articles/:id/versions`: new immutable version; current revision, manage authority and replay key.
- `POST /api/guidance/manage/articles/:id/versions/:versionId/publish`: independent current-version approval; publish authority and reason.
- `POST /api/guidance/manage/articles/:id/withdraw`: terminal withdrawal; publish authority, current revision and reason.

All responses use `no-store`. Private authorization is resolved from the current session, not client-supplied actor or permission fields.

## Browser State

Staff loaders check session/generation between private requests. Revoked or wrong-scope responses clear cached metadata, lists, detail and draft/replay keys. Logout clears shared private staff state. Failed draft submissions retain typed content and their replay key; editing creates a new intent. Successful saves reload the authoritative article. Public errors show a search/retry surface without stale content.

## Verification

Eight focused tests cover bounded canonical payloads, dates, strict filters, exact role custody, expiry, pre-decryption authorization, public SQL safety, departed/revoked sessions and database guard declarations.

Initial isolated run `data/build-admissions-guidance.log` passed migration, seed, units and all 22 smokes but failed both browser cases: the new source check expected programme status `active`, whereas the existing programme lifecycle uses `published`. The guard failed closed. Its server stopped and database `svu_rebuild_it_1791204204171` was dropped. The source check now uses the existing lifecycle and effective curriculum dates; the public intake selector uses catalogue `label`. This failed run is not acceptance evidence.

The corrected `data/build-admissions-guidance-v2.log` passed both desktop/mobile workflows and all 22 smokes; database `svu_rebuild_it_1791204389328` was dropped. Subsequent browser retry hardening is covered by `data/build-admissions-guidance-final.log`, which passed all eight selected guidance/communications browsers and all 22 smokes; database `svu_rebuild_it_1791204648854` was dropped. Source styling changed during that latter run, so it does not establish final visual acceptance. Final-source standalone units pass 261/261 (`data/build-admissions-guidance-unit-final.log`), including the concurrently delivered document-template tests.

The fresh final-source affected-workflow checkpoint `data/build-admissions-guidance-checkpoint.log` passed migrate/seed, units, all 20 selected desktop/mobile guidance, communications, admissions and support browsers and all 22 smokes. The selector was independently listed as exactly 20 checks across four files; browser last-run metadata reports passed with no failed tests. Server stopped and database `svu_rebuild_it_1791204899005` was dropped. All four own completed guidance-test databases were independently confirmed absent, and port 4197 has no listening server. Every finite verification launcher ended. This is affected-workflow coverage, not a full-browser-suite claim; failed provenance remains retained.

Guidance coverage includes actual scoped drafting/review/withdrawal controls, self-approval refusal, author-bound retries and changed-payload conflicts, wrong-scope reads, stale revisions, future/expired replacements, encrypted content/reasons, public/private field separation, safe markup, immutable storage, private-safe audits, responsive widths, departed-session loader suppression, revoked cache erasure and frozen retry payloads after refresh. Final desktop/mobile public/review viewport screenshots were inspected. Article links now use restrained table-link styling and guidance sections have fixed-header scroll offsets. No forced clicks or relaxed assertions were used.

## Local Runtime

Additive migration 064 applied without reseeding. The migration runner also applied the concurrently delivered Claude-owned `065_document_templates.sql`; existing migrations were skipped. Migration 065 adds official-document template tables/permissions and transcript reference/template columns and extends the transcript guard, without issuing documents or replacing existing user records. Its acceptance belongs to the document-template slice.

Previous server PID 13152 stopped and launcher 27306 ended. Matching runtime: PID 20836, launcher 26685, `http://127.0.0.1:4177/#apply`, logs `data/dev-admissions-guidance.log` and `.err.log`. Error log empty at final read. Health/public guidance return 200/no-store (zero articles); staff metadata/queue anonymously return 401/no-store. Final read-only counts retain 188 accounts, 114 applications, 28 student programme records, zero registrations/enrolments/support cases and zero guidance articles/versions or communication preferences/campaigns. No approved guidance or applicant/student state was fabricated locally. The persistent development server remains intentionally running; other agents' work and unrelated databases were preserved.

## Remaining Work

Portal prospective hand-off, consented enquiry capture, assignment/escalation/replies and contact history are covered by the separate [prospective enquiry workflow](PROSPECTIVE_ENQUIRIES.md), with selected development verification recorded. Official WhatsApp account/number, provider credentials, channel delivery/retries, AI policy/provider/model, approved knowledge corpus, citation/abstention evaluation, application-context permissions and admission-decision guardrails remain unimplemented or unapproved. Wider context-help placement, knowledge taxonomy, ownership, review cadence, accessibility acceptance, retention/disposal and content migration remain open. See D-33 and provider/integration gates. Nothing here issues admission decisions or guarantees an offer.
