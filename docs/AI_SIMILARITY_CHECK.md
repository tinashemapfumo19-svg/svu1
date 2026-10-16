# AI Similarity Check for Assignment Submissions

User decision, 2026-10-12: students can check an assignment file for AI similarity before submitting it. GPTZero
is the provider. A score above the allowable threshold shows a warning; the student may still submit, and that
choice is recorded. Lecturers see each submission's score.

## Behaviour

1. A student chooses a PDF, DOCX or TXT file and presses Upload. The browser first sends the file to
   `POST /api/course-workspaces/{period}/{course}/resources/{assignment}/ai-check`.
2. The server confirms enrolment and an open, published assignment, then sends the bytes to the provider. The file
   is not stored at this step. The result is stored in `course_ai_checks` by the file's SHA-256: score, provider,
   provider version, threshold in force, and whether the score is above it.
3. At or below the threshold the submission proceeds at once. Above it, the student sees the score and threshold,
   then chooses Submit anyway or Choose a different file.
4. `submit` must carry the id of a check of the same bytes from the last 24 hours. Above the threshold it also needs
   `acknowledgeAiWarning: true`. The attempt stores `ai_check_id` and `ai_warning_acknowledged`.
5. If the provider fails, the check is stored as `unavailable` with a failure code, and the student can submit.
   Other file types (images, slides, spreadsheets, ZIP) are not checked and submit as before.
6. Lecturers see an "AI similarity" column (score, and whether it is above or within the threshold). Students see
   the score on their receipt.

The score is GPTZero's `class_probabilities.ai` as a percentage. `mixed` and `human` are stored alongside it. A score
equal to the threshold is within it. Each student can run 10 checks per assignment in 24 hours, to bound cost.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SVU_AI_CHECK_PROVIDER` | `disabled` | `disabled`, `gptzero`, or `simulated` (development only). |
| `SVU_GPTZERO_API_KEY` | none | Required for `gptzero`. Sent only as `x-api-key` to the fixed endpoint `https://api.gptzero.me/v2/predict/files`. |
| `SVU_AI_CHECK_THRESHOLD` | `20` | Institutional allowable score (0–100, two decimals). Lecturers can override it per assignment ("Allowable AI similarity (%)"). |

When disabled, nothing is sent anywhere and submissions behave as before. The `simulated` provider never leaves the
server: a text file containing `[[ai-score:NN]]` scores NN, anything else scores from its checksum. It is refused
outside `SVU_ENV=development`.

## Evidence

- Unit: `test/ai-checker.test.js` (configuration, scoring boundary, GPTZero request shape and response parsing, error
  mapping, simulated provider, resource threshold validation, no provider or database call for disabled and
  unsupported files).
- Preview (port 4211, simulated provider): submit without a check is refused (409); a check cannot be reused for a
  different file (409); above-threshold submission without acknowledgement is refused (409) and accepted with it;
  lecturers cannot run checks (403); the per-assignment threshold (30) overrides the default (20). Desktop and mobile
  browser runs show the warning, the receipt score and the lecturer column, with no page errors or overflow.
- Not verified: a live GPTZero call. The request and response shape follow GPTZero's published API; confirm with a
  real key before enabling.

## Open decisions

See D-37 in [OUTSTANDING_DECISIONS.md](OUTSTANDING_DECISIONS.md).

## Frontend provision and outstanding requirements

- On screen: the allowable score note and check-before-submit on the student's course page, the above-threshold
  warning with **Submit anyway** / **Choose a different file**, the score on the receipt, the lecturer's
  **AI similarity** column, and **Allowable AI similarity (%)** in the assignment editor (only when checking is on).
- Gaps: no institutional threshold screen (it is the `SVU_AI_CHECK_THRESHOLD` setting); no report of scores across
  an assignment; the student is not told how many checks remain today; the lecturer cannot open the stored
  `mixed` / `human` probabilities.
- Requirements: a live GPTZero call with a real key before enabling; the D-37 decisions; apply migration 104 on each
  server before restarting it.
