# AI Assistance and Early Warning

User request, 2026-10-12. Five assistive features use Claude (`claude-opus-5-5`, official `@anthropic-ai/sdk`), plus a
rules-based early-warning list that uses no AI. Assistance only suggests: a person reviews every result, and nothing
is written to a record by the assistant.

| Feature | Who | Where | What is sent to Claude |
| --- | --- | --- | --- |
| Feedback draft | Lecturer on the offering | Mark / feedback form: **Draft feedback with AI** | Assignment title and brief, the mark, the lecturer's notes, and the submission if it is a PDF or text file |
| Support triage | Staff who can read the case | Staff support case: **Suggest triage and reply** | Category, priority, subject, the non-private conversation, published guidance |
| Admissions question | Anyone | Admissions guidance on the Apply page: **Ask a question** | The question and published guidance articles |
| Document check | The applicant | Before an upload on their own application (PDF, PNG, JPG) | The file and the requested document type |
| Results explanation | The student | Study → Results & Progress: **Explain in plain language** | The student's own academic context and published results |
| Early warning (no AI) | Staff with `registry.view`, within their scope | Staff workspace → Students: **Show list** | Nothing |

## Safeguards

- Each feature first performs the same authorised read a person would make; a user who cannot read the record
  cannot get assistance on it (verified: 403/404 for students, other applicants and other students).
- Fixed system prompts restrict answers to the supplied material; admissions answers cite the articles used and
  say so when guidance does not cover the question. Outputs are schema-checked JSON (`output_config.format`).
- Refusals and truncated answers are reported as failures, never shown as answers. Requests opt into Anthropic's
  server-side refusal fallback (`fallbacks: "default"`).
- Audit events (`ai.feedback_drafted`, `ai.support_triaged`, `ai.document_checked`, `ai.record_explained`,
  `registry.early_warning.viewed`) record that assistance was used, never its content.
- Public questions are limited to 10 per hour per connection and 500 characters.
- The document check never blocks an upload: on a mismatch the applicant is asked whether to upload anyway, and if
  the check is unavailable the upload continues.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SVU_AI_ASSIST` | `disabled` | `disabled`, `anthropic`, or `simulated` (development only; fixed, labelled output). |
| `ANTHROPIC_API_KEY` | none | Read by the Anthropic SDK when `SVU_AI_ASSIST=anthropic`. |

## Early-warning rules

A student appears when any of these hold: two or more assignments past due in the last 60 days without a submission;
released coursework marks averaging below 50%; a financial hold; a support case waiting for the student; no confirmed
registration for an open registration period. The list is advisory and sorted by number of reasons.

## Evidence

- Unit: `test/ai-assist.test.js` (configuration, closed schemas, request shape with model, system prompt, structured
  output and fallback beta, refusal / truncation / invalid output / provider error handling, simulated outputs,
  early-warning rules, public rate limit, disabled behaviour).
- Preview (port 4211, simulated provider): every endpoint and its permission refusals; browser flows for the feedback
  draft (fills the feedback box), support triage ("Use this reply" fills the reply), public question, results
  explanation, early-warning list and the applicant document check (check runs first, then exactly one upload).
- Not verified: live Claude output quality, which needs an API key and the decisions in D-38.

Open decisions: D-38 and D-39 in [OUTSTANDING_DECISIONS.md](OUTSTANDING_DECISIONS.md).

## Frontend provision

| Feature | On screen | Gap |
| --- | --- | --- |
| Feedback draft | **Draft feedback with AI** in the Mark / feedback form; the suggestion appears beside the lecturer's own notes and fills the box only on **Use this** | No indication on the saved review that a draft was AI-assisted |
| Support triage | **Suggest triage and reply**, **Use this reply** | The suggested category and priority are shown, not applied; staff change them in Assignment and status |
| Admissions question | **Ask a question about applying** above admissions guidance on the Apply page | Not on the public Home page; no WhatsApp channel (D-33) |
| Document check | Runs automatically before a PDF/PNG/JPG upload; a mismatch shows an in-row prompt with **Choose another file** / **Upload anyway** | None known |
| Results explanation | **Explain in plain language** on Results & Progress | Not offered on the older `#apply` record view |
| Early warning | **Students who may need support** → **Show list** in Staff → Students, with colour-coded reason chips, sort (most reasons / name) and **Open record** | No export; no follow-up notes |
| Look | Every suggestion uses one lavender card with a sparkle icon, a loading shimmer, and **Use this** / **Dismiss** | — |
| Ask SVU | Floating **Ask SVU** help guide on every page: how-to answers with links to pages the person can open (see [ASK_SVU.md](ASK_SVU.md)) | Phase 1 only: no personal answers or hand-off yet (D-41) |
| All AI controls | Appear only when `/api/ai/status` is enabled | Staff see nothing when disabled, so there is no "ask your administrator" hint |

## Outstanding requirements

- Early-warning scoped CSV export and optional follow-up notes (after D-39).
- Record "AI-assisted" on reviews and support replies that started from a suggestion, if D-38 requires disclosure.
- Ask-a-question on the public Home page, and the WhatsApp channel once D-33 is decided.
- Usage and cost reporting per feature (counts from the audit events, token spend from the API account).
- A live check with a real `ANTHROPIC_API_KEY` against a sample of real cases before enabling each feature, with staff review of quality.
- Privacy notice wording shown next to each student- and applicant-facing AI control (D-38).
