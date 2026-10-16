# Stage 8 Official Document Templates and Reference Numbers

## Delivered Slice

The wording on official documents (transcripts and award certificates) now comes from versioned templates instead of being fixed in code. A template is drafted by one person, approved by another, and never changes once published. Every document records the template version it was issued under. Each issued document also receives a unique, human-readable reference number alongside its verification code.

This covers the roadmap's "versioned templates and approval workflow" and "unique document/reference numbers" under Stage 8 Documents, and replaces the legacy practice of templates embedded in endpoint scripts (`RPT-09`). It is a development pilot. The approved wording and signatory are a registry decision (D-17 in [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md)), and output is still the printable page rather than a document-service PDF.

## Behaviour

- **Template fields.**
  - Both kinds: institution name, document title, signatory name (optional) and title, and footer text.
  - Transcripts add an explanatory note.
  - Certificates add a preamble and conferral text, which must include `{{programme}}`.

  Fields are trimmed and length-checked, and unknown fields are refused.
- **Built-in defaults.** Until a template is approved for a kind, built-in defaults reproduce the earlier fixed wording. Documents issued before templates existed render with the same defaults.
- **Drafting** (`documents.templates.manage`). There is one draft per kind at a time; versions increase per kind.
- **Review** (`documents.templates.approve`).
  - The reviewer must not be the author.
  - Approving publishes the draft and supersedes the previous version. Rejecting closes the draft without publishing it.
  - A database trigger prevents deleting templates or changing a published or superseded template.
- **Issuing.**
  - Issuing a transcript or certificate records the template in force (`template_id`).
  - It also allocates a reference number from a single sequence: `SVU-TR-<year>-<nnnnnn>` for transcripts and `SVU-CT-<year>-<nnnnnn>` for certificates.
  - The existing immutability trigger is extended so neither value can change after issue.
  - The content hash still covers only the academic record, so a wording change never makes an issued document outdated.
- **Rendering.** Documents show the reference number, the template's institution name, title, signatory, and footer, and, for certificates, its preamble and conferral wording. Previews use the template that an issue would apply now.
- **Verification.** Public verification returns the reference number and the template version.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/document-templates` | `documents.templates.manage` or `documents.templates.approve` | All versions, the built-in defaults, and capabilities. |
| `POST /api/document-templates` | `documents.templates.manage` | `kind` (`progressive`/`certificate`), `content`, `reason`. |
| `POST /api/document-templates/{id}/review` | `documents.templates.approve` | `outcome` `published`/`rejected`, `reason`. |

Transcript and certificate responses now include `referenceNumber` and `template` (`id`, `version`, `content`).

Roles:
- `academic_registrar` drafts.
- `records_manager` approves.
- `system_administrator` holds both, but cannot approve its own draft.

## Interface

The Resources page (`#resources`) has an **Official document templates** section for people with either permission. For each kind it shows:
- the version in force, or "built-in wording";
- a pending draft with approve or reject for an eligible reviewer;
- a prefilled drafting form.

Issued documents and the verify page show the reference number.

## Verification

Migration `065_document_templates.sql`. Unit tests in `test/document-templates.test.js` cover default validity, field limits, trimming, unknown fields, and the `{{programme}}` requirement. The transcript journey (`e2e/transcripts.spec.js`) covers:

- UI drafting by the registrar;
- self-approval, missing-field, and missing-placeholder refusals;
- approval by a records manager, then a repeat review refused;
- the first issued transcript carrying that template version, a `SVU-TR-` reference, and the templated signatory;
- public verification returning the reference and template version.

The graduation-awards journey confirms that certificates still render under the built-in or approved wording.

## Remaining Work

- Templates for further official outputs (completion letters, statements, receipts, offer letters), using the same mechanism with new kinds.
- PDF rendering, digital signatures, and watermarks through a document service once storage and hosting are decided (D-03, D-05).
- Verification lookup by reference number in addition to the verification code.
