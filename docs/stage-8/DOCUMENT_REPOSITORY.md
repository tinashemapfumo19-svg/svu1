# Stage 8 Document Repository

## Delivered Slice

A managed repository for institutional documents (policies, handbooks, forms, minutes), reachable from **Resources** in the main navigation. Records managers organise documents into collections. Each collection sets who may see its documents, whether they may be downloaded or only viewed, a classification, and a retention period. Contributors create document records with searchable metadata and upload files. A different person publishes each file version after the malware scan. Every view and download is issued through an audited, short-lived link.

This covers `RPT-12`: metadata, keyword search, permissions, a read-only viewer, download controls, versioning, retention, and audit logs. It replaces files scattered across the legacy upload folders. It is a development pilot. Ownership of collections and the retention schedule are open decisions (D-31 in [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md)), and disposal awaits the retention policy (D-08).

## Behaviour

- **Collections** (`repository.manage`). Each collection has:
  - a code and name;
  - a classification (`public`, `internal`, `confidential`, or `restricted`);
  - view roles, an optional opening to students, whether downloads are allowed or view-only, and an optional retention period in years.

  Only public or internal collections can be opened to students (enforced in code and by a database check). Collections are revisioned and can be archived; archived collections are visible only to managers and take no new items.
- **Visibility.**
  - Managers see everything.
  - Others see an active collection if they hold one of its view roles, or if it is open to students and they hold the student role.
  - Viewers see only published items.
  - Contributors and publishers also see drafts in collections they can see.
  - Withdrawn items are visible to managers only.
  - Anything out of reach returns `404`, so its existence is not revealed.
- **Items** (`repository.contribute`). Each item has a title, description, summary, and up to 20 keywords (lower-cased and de-duplicated). Metadata edits are revisioned and audited.
- **Search.**
  - Full-text search over title, description, summary, and keywords uses a PostgreSQL `tsvector` index with web-style queries.
  - A literal title match catches partial words. `%`, `_`, and `\` in a query are matched literally, not as wildcards.
  - Results can be filtered by keyword and collection, are paged, and are ranked by relevance when searching.
- **Versions.** A version is a file in the existing document pipeline:
  - a signed upload link;
  - a size limit and file-signature check (PDF, JPEG, or PNG up to 10 MB);
  - the malware scan through the existing scan-results API.

  Rules:
  - One version may be pending at a time.
  - Publishing (`repository.publish`) needs a clean scan and a publisher other than the uploader. It supersedes the previous version and sets the retention date from the collection.
  - A version can be rejected instead.
  - Published versions never change; superseded versions stay available to managers.
- **Access.** View and download links last five minutes and are audited with their purpose.
  - Views are served inline; downloads as attachments. Both use `nosniff` and `no-store`.
  - View-only collections refuse download links except to managers.
  - Earlier versions are for managers only.
  - Links are bound to their operation, so changing `view` to `download` in a link invalidates its signature.
- **Containment.** Repository files are hidden from the generic document endpoints, both the document list and the reads. The only exception is the malware scan, so collection permissions cannot be bypassed.
- **Withdrawal, holds, and retention.**
  - Publishers can withdraw a published item with a reason.
  - Managers place or release legal holds with a reason.
  - The retention review lists items past their retention date and not on hold, and counts held items. Actual disposal awaits the retention policy.
- **Audit.** Collection, item, version, access, withdrawal, and hold events are audited. Managers see each item's access and change log.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/repository?q=&keyword=&collectionId=&limit=&offset=` | Signed in | Visible collections, matching items, total, and capabilities. |
| `POST /api/repository/collections` | `repository.manage` | `code`, `name`, `classification`, optional `description`, `viewRoles`, `studentAccess`, `allowDownload`, `retentionYears`; `reason`. |
| `POST /api/repository/collections/{id}` | `repository.manage` | `revision`, `reason`, and changed fields or `status`. |
| `POST /api/repository/items` | `repository.contribute` | `collectionId`, `title`, optional `description`, `summary`, `keywords`; `reason`. |
| `GET /api/repository/items/{id}` | Signed in, visible | Item, versions, the access log for managers, and capabilities. |
| `POST /api/repository/items/{id}` | `repository.contribute` | `revision`, `reason`, and metadata changes. |
| `POST /api/repository/items/{id}/versions` | `repository.contribute` | `fileName`, `contentType`, `sizeBytes`, optional `checksum`, `changeNote`. Returns the signed upload. |
| `POST /api/repository/items/{id}/versions/{n}/review` | `repository.publish` | `outcome` `published`/`rejected`, `reason`. |
| `POST /api/repository/items/{id}/access` | Signed in, visible | `mode` `view`/`download`, optional `version` and `reason`. Returns a signed link. |
| `POST /api/repository/items/{id}/withdraw` | `repository.publish` | `reason`. |
| `POST /api/repository/items/{id}/hold` | `repository.manage` | `legalHold`, `reason`. |
| `GET /api/repository/retention` | `repository.manage` | Items past retention, and the count on hold. |

Roles:
- The new `records_manager` role manages, contributes, and publishes.
- `academic_registrar` contributes.
- `system_administrator` holds all three.

## Interface

- `#resources` (desktop top navigation, and now the mobile bottom navigation) works with the staff registry session or the student portal session.
- It offers search, collection, and keyword filters, with clickable keyword chips.
- Item detail has an inline viewer and a download button, or "View only" where downloads are off.
- Staff forms cover creating items, uploading versions, publishing or rejecting, withdrawal, legal holds, collection management, and the retention review.

## Verification

Migration `062_document_repository.sql`. Unit tests in `test/document-repository.test.js` cover collection validation and defaults, keyword normalisation, visibility rules, and wildcard escaping. The desktop and mobile journey is in `e2e/document-repository.spec.js`. It covers:

- collection authority, the confidential-for-students refusal, and duplicate codes;
- UI creation of a view-only HR collection;
- a contributor unable to see or use the HR collection;
- UI item creation and PDF upload;
- publishing refused before the scan, without authority, and by the uploader;
- repository files hidden from the generic document endpoints;
- UI publication and the retention date;
- an HR policy published by a second manager, viewed inline (headers checked), and refused for download, including through a tampered link;
- students and contributors refused the HR item;
- student keyword search, inline view, and download in the UI;
- literal wildcard search;
- version supersession, with earlier versions for managers only;
- the manager-only access log;
- withdrawal hiding the item;
- legal holds and the retention review;
- no horizontal overflow.

## Remaining Work

- Text extraction from file contents for full-text search (needs a text-extraction service alongside the scanner, D-05).
- Disposal after retention, with independent approval and byte deletion, once the retention schedule is decided (D-08, D-31).
- Office document formats, previews or thumbnails, and watermarking of view-only documents.
- Bulk import of existing legacy files with metadata mapping (Stage 9 migration).

## Library Catalogue (Stage 6, LIB-01 to LIB-04)

Migration `075_library_catalogue.sql` gives repository items optional catalogue fields, so a collection opened to students can serve as the library:

- author (searchable with the title);
- publication year (1000-2100);
- resource type (`book`, `journal_article`, `thesis`, `past_paper`, `course_notes`, `video`, `dataset`, or `other`);
- the programme codes the material serves.

This covers:
- `LIB-01`: upload, through the repository's versioned and scanned files;
- `LIB-02`: categorise by programme, type, author, and year;
- `LIB-03`: publish, withdraw, and counts, through independent publication and the totals in search;
- `LIB-04`: browse and download, under each collection's view and download rules, with access history.

`GET /api/repository` accepts `resourceType` and `programme` filters. Items carry `author`, `publicationYear`, `resourceType`, and `programmeCodes`; null clears a field on update. The Resources page has type and programme filters, catalogue fields on the add form, and shows author, year, type, and programmes on results and items.

Unit tests cover catalogue validation. The repository journey covers a catalogued book: invalid year refused, author search, type and programme filters, and the catalogue line in the student's UI.

Remaining: the library scope decision itself (D-11), shelf and loan management for physical stock, and external e-library integration (`LIB-05`, `LIB-06`).

## Loading And Session Isolation

The Resources renderer binds its cached listing, collection choices, details, template configuration, viewer, retention data, filters and notices to the selected staff/student session token and generation. Renderer/action/API entry points detect token changes and clear that state. Late responses from a departed session cannot restore old details or create a viewer/download. This is frontend isolation in addition to the backend's independent authorization; it does not claim immediate memory erasure while another page is active.

Busy actions disable repository controls in place and expose `aria-busy`, retaining captured form values and file objects. Controls become actionable after completion, so a filter reset or keyword click cannot silently race an earlier search. A repository API 401/403/404 clears private state and leaves an explicit authorized refresh action. A forbidden optional template-list request still hides templates without removing an otherwise authorized document listing.

`e2e/resources-state.spec.js` adds six desktop/mobile synthetic-response checks for disabled controls and serialized searches, token changes without reload, clearing details/viewers/choices, delayed departed responses, preventing stale attachment requests/downloads, sign-out and authority-refused refresh. The initial six-check probe passed before the attachment-request assertion was strengthened. Native repository/transcript/award/transfer recovery plus the final strengthened probes PASSED all 14 independently listed checks in `data/build-repository-recovery.log` (launcher 93370 exit 0), with all units and 22 smokes. The source guard passed unchanged 354-file digest `a9437c4585ba7c1537b480808cac5ffd4223fb04967a8bd270c54487d67d0c04`. Database `svu_rebuild_it_1791244306693` is independently absent, 4197 released and last-run passed/no failures. Desktop/mobile busy and native repository layouts were inspected; the blank test PDF is not populated preview-rendering evidence. Local development data was not reseeded or populated. The prior frozen full run remains FAILED 143/146, including two native repository loading failures and a programme-transfer GET `ECONNRESET`; selected recovery does not establish new full-suite acceptance. Native transfers passed unchanged without retries.

Subsequently, the complete configured 152-check desktop/mobile suite PASSED with all units and 22 smokes (`data/build-full-recovery.log`, launcher 13365 exit 0). Native repository, template/official-document and session-state journeys pass within that full checkpoint; source guard passed unchanged 356-file digest `80446a199be00c5784b5d70af486d1fdac6dd9be62485ec05e0d1f0b065b3ad0`, database `svu_rebuild_it_1791246126211` independently absent and 4197 released. Earlier failures stay failed provenance. This is development evidence, not storage/scanner/retention/policy/owner or production acceptance; populated PDF-preview rendering was not tested by that checkpoint.

## Populated Preview Verification

`scripts/probe-repository-preview.js` generates a real PDF with Chromium's PDF engine and a PNG with visible text and a distinctive green marker, then serves synthetic inline routes under the same content type/disposition/no-store/nosniff contract. It does not authenticate against the server or mutate university records. It counts marker pixels in actual viewer screenshots using browser canvas image decoding, rather than treating an iframe URL as proof of rendering. Evidence is under `data/repository-preview-probe`; separate channel directories preserve comparative results.

The initial default headless-shell diagnostic exited 1: both PDF viewers were blank, while both PNG viewers contained 36,000 marker pixels. Those observations are retained, not relabelled as passing. Full Chromium (`SVU_BROWSER_CHANNEL=chromium`) exited 0: PDF desktop/mobile contained 37,886/12,508 marker pixels; PNG contained 36,000 in each viewport. All four had no page horizontal overflow. Playwright's [browser documentation](https://playwright.dev/docs/browsers) distinguishes its headless shell from the full Chromium channel. No repository renderer or authorization changes were needed for this comparison.

`e2e/repository-preview.spec.js` explicitly requires full Chromium and asserts populated PDF and PNG pixels on both configured viewports through actual upload, scan, independent publication and student view-only access. It also checks served bytes/headers, absence of the application's Download button, download-grant refusal and refusal to change a view signature into a download signature. Use the isolated integration runner, not the working database; the test requires its disposable outbox. Native checkpoint acceptance is recorded separately in `docs/BUILD_VERIFICATION.md`.

Scope: Chromium mobile emulation is not real Android/iOS or Safari/Firefox acceptance. Browser-native viewing sends authorized bytes to the browser; view-only controls deny the application's download operation, not screenshots, printing or saving already viewed content. This is not DRM or byte-copy prevention. Office formats, watermarks, full-text extraction and storage/scanner/owner decisions remain open. Native PNG viewing can require scrolling inside the viewer for images wider than the mobile frame.
