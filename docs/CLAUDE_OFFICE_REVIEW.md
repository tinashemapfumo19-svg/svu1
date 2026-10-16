# Student Office: Claude Review and Patch Requests

Date: 2026-10-07
From: Claude. To: Codex, the Office owner by the user's decision of 2026-10-07.
Scope: Office pages in `src/student.js`, as read at about 21:50, while Codex was still editing.
Claude does not edit `student.js`. Each item is a request, so take it, change it or decline it.

## Findings

| # | Severity | Location | Issue | Requested change |
| --- | --- | --- | --- | --- |
| R1 | Medium | `load()`, country list | `await api(... reference-lists/country)` has no `catch`. If the list fails, the whole My Details page shows "Unable to load this page", including the identity record. | Read it like the other reads (push to `data.errors`). Render the current country as the only option when the list is missing. |
| R2 | Medium | `load()`, `sitting` / `support` query | Fetching the detail for `?sitting=` or `?support=` has no `catch`. An old link (sitting rescheduled, case not found) breaks the whole Requests page. | Catch the error, add it to `data.errors`, and still render the list. |
| R3 | Medium | `bind().run` | Failures go into `notice` and render as `<p class="notice" role="status">`, the same as success, so screen readers don't announce errors as alerts. | Store `{tone, text}`. Render errors as `notice-error role="alert"`, success as `notice-success role="status"`. |
| R4 | Low | `bind().run` | `notice = message \|\| adapter.notice?.text \|\| 'Updated.'` never clears `adapter.notice`. After an arrangement request, a later support reply shows "Arrangement requested.", and a no-op shows a vague "Updated.". | Read and delete `adapter.notice` in each run. Show nothing when no outcome message exists. |
| R5 | Medium (design) | `requestQueue()` | Requests repeats the identity-correction form and the withdrawal form, which already live on My Details and Registration. The design says "duplicate awareness, not functionality". The same form in two places can also hold diverging drafts. | Keep forms on their owning pages. In Requests, link identity rows to `#office/details` and withdrawal rows to `#office/registration`. |
| R6 | Low | `requestQueue()` filter | The "Open" filter is `!terminal`, so `waiting_student`/`returned` rows appear under both Open and Awaiting you. There's no next-actor column. | Use the explicit per-type mapping below, so each row belongs to exactly one group and shows who acts next. |
| R7 | Low | `remember()`/`restore()` | Drafts are keyed by form index and field index. If the form set changes between save and restore (a case closes, a request form appears), input can be restored into the wrong form. | Key forms by stable attributes (`data-form`, `data-period`, `data-support-action`) and fields by `name`. |
| R8 | Low (UX) | Registration | If checkboxes change without "Save course selection", "Confirm registration" confirms the previously saved courses. The old portal had the same behaviour. | On any change in a `course-selection` form, disable that period's confirm button and show "Save your selection before confirming". |
| R9 | Low (UX) | Fees | Plans show currency and status only. The account already gives `standing.paid`, `standing.arrears` and `standing.nextInstalment`, and there's no statement that online payment isn't available (D-06). | Show paid, arrears and the next instalment (amount and date). Add one sentence: "Online payment is not available in the portal yet. Payments appear here once the Finance office records them." |
| R10 | Info | Overview attention | Shows only one item: hold, open registration or onboarding. Missing: `due > 0` without a hold, plans in arrears, support `waiting_student`, arrangements `returned`. | Use the attention mapping below, which UX-07 can share. |

| R11 | Low (visual) | Requests at 390px, exam table | `overflow-wrap: anywhere` in the narrow exam table splits codes and words mid-token ("COMP1 01", "examinat ion"). Also, Requests repeats the whole exam timetable (see R5), which makes the mobile page about 2,900px tall. | On Requests, show only arrangement cases and link to Study / Timetable. For narrow tables, use labelled rows or `overflow-wrap: break-word` with a scroll region. |

Evidence: `test-results/office-claude/.../office-requests-mobile.png` (isolated run, 2026-10-07).

Already handled by Codex (checked): clearing drafts, notices and context on session change; validating programme and period context; keeping applicant history at `#apply?history=1`.

## Request status mapping (for R6 and R10)

Each status is in exactly one group. The next actor is shown only when the source states it.

| Type | Open (next actor) | Awaiting you | Completed |
| --- | --- | --- | --- |
| Support case | `open`, `in_progress` (Support team) | `waiting_student` | `resolved`, `closed` |
| Identity correction | `requested` (Registry) | none | `approved`, `rejected` |
| Course withdrawal | `requested` (Registry) | none | `approved`, `rejected`, `cancelled` |
| Exam arrangement | `requested` (Examinations office) | `returned` | `approved`, `withdrawn`, `revoked` |
| Programme transfer | `requested` (Registry) | none | `approved`, `rejected` |
| Admissions enquiry | `open`, `in_progress` (Admissions) | `waiting_applicant` | `resolved`, `withdrawn` |

An unknown status falls in Open with next actor "Not stated". Last update: support uses `updatedAt`; identity, withdrawal and transfer use `reviewedAt ?? requestedAt`; the arrangement history list has no timestamp (show the sitting date). Support lists one page of results, so use `support.counts` for totals.

## Office attention mapping (for R10 and UX-07)

In order: incomplete `student.readiness` → My Details. `account.hold.held` → Fees. Otherwise, for each currency with `due > 0` → Fees. Each plan with `standing.status === "in_arrears"` → Fees. For each open period that isn't confirmed (programme `onboarded`): revision 0 gives "Choose your courses", `eligibility.ready` gives "Confirm registration", otherwise "Registration blocked (n issues)" → Registration. Each request in the Awaiting you group → its request link.

## Capability gaps (unchanged from the planning review)

- G-O1 Sponsorships are staff-only.
- G-O2 There's no receipt number or statement document for students. The ledger has `paymentId`, and receipts are numbered server-side as `RCT-<id>`. A server field would be needed; don't format it in the client.
- G-O3 Students see approved plans only.
- G-O4 Students can't start a programme transfer.
- G-O5 The only issued documents are transcripts and certificates.
- G-O6 There's no shared request-list endpoint, and arrangement list rows have no timestamp.

## Tests

`e2e/student-office.spec.js` (Claude) now targets Codex's Office markup. It checks:
- the fee statement and that no payment action exists;
- input kept after a failed profile save, then a successful retry;
- an identity request tracked under Open, not Completed or Awaiting you;
- the support row count;
- an account read failure with retry;
- unsaved input and context dropped when the account switches.

The check that the Open and Awaiting you filters don't overlap stays out until R6 lands.
