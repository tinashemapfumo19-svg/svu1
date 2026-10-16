# Ask SVU

A floating help guide in the portal. People ask how to do something ("Where do I see my fees?", "How do I mark and
release feedback?") and get a short answer with buttons that take them to the right page. This is **phase 1**:
help and navigation only. It cannot see anyone's records and never takes actions. Open policy questions are D-41 in
[OUTSTANDING_DECISIONS.md](OUTSTANDING_DECISIONS.md).

## How it answers

- **Pages.** `server/help-map.js` lists the portal's pages, what each is for, and who can open it (public, visitors
  only, any signed-in person, or a permission list with `area.*` wildcards). The server sends Claude only the pages
  the asker can open, ordered by keyword overlap with the question.
- **Guidance.** Up to 25 published guidance articles (the same ones the Apply page shows), each trimmed to 1,500
  characters.
- **Conversation.** The last six turns, so follow-up questions make sense, and the page the person is on.
- **Claude.** Task `help` in `server/ai-assist.js` (`claude-opus-5-5`, structured output, low effort). It returns an
  answer of at most 120 words, page ids, article ids and up to three follow-up questions. If the pages and articles
  do not cover the question it says so (`answered: false`) instead of guessing.
- **Checks after the answer.** Page ids not on the asker's list and article ids not supplied are dropped, so a link
  can never point somewhere the person cannot open. External sites come only from `helpExternalLinks` in
  `server/help-map.js` (empty until D-41 approves a list) and open in a new tab.

## API

| Endpoint | Who | Notes |
| --- | --- | --- |
| `POST /api/help/ask` `{question, history?, path?}` | Anyone; a bearer token, if sent, must be valid | Returns `{answered, answer, links[{id,title,href,external}], articles[{id,title}], followUps[]}`. 409 when AI assistance is off; 429 over the limit |
| `POST /api/help/feedback` `{helpful}` | Signed in | Records only whether the answer helped |

Limits: visitors 10 questions an hour per connection; signed-in people 30 an hour per account (in memory, per server).

## On screen

`src/ask-svu.js`, styles in `src/staff.css` (`.ask-*`). Loaded on every page and shown only when `/api/ai/status`
reports assistance on.

- **Launcher:** an "Ask SVU" pill bottom-right; on phones it sits above the bottom bar.
- **Panel:** a 400px card on desktop, a full-screen sheet on phones. It opens with a greeting and three starter
  questions for the person's role (visitor, student, applicant, lecturer, staff). Answers use the lavender AI style
  with page buttons, "From:" sources, follow-up chips and 👍/👎 (signed in). Unanswered questions offer "Open a
  request" (students), "Go to Inbox" (other signed-in people) or "Send an enquiry" (visitors).
- **Behaviour:** Enter sends, Shift+Enter adds a line, Escape closes and returns focus to the launcher. Following a
  link on a phone closes the panel. **New chat** clears the conversation.
- **Storage:** the conversation is kept in `sessionStorage` for this tab, tied to the session token, so it survives
  a reload but is dropped on sign-out or when someone else signs in. Nothing is stored on the server.

## Privacy and audit

- Questions may contain personal details people type themselves; they are sent to Claude for that one answer and
  not stored by SVU. No records are added to the prompt.
- Signed-in use is audited as `ai.help_asked` (answered or not, which pages were linked) and feedback as
  `ai.help_feedback` (helpful or not). Neither stores the question or answer. Visitor use is not audited.

## Evidence

- `test/ask-svu.test.js` (8 tests): page ids unique; visitor, student, applicant and wildcard permission filtering;
  ranking; links to pages the asker cannot open are dropped; only supplied articles are cited; history is limited
  to user/assistant turns; validation and the visitor rate limit; signed-in audit without the question text.
- Preview 4211 with the simulated assistant: student (desktop), visitor and lecturer (390px) walkthroughs covering
  role starters, answers, link navigation, feedback, conversation kept on reload, Escape and focus, no horizontal
  overflow and no page errors.

## Phase 2: personal answers (built, off by default)

With `SVU_ASK_SVU_PERSONAL=enabled` (and AI assistance on), a signed-in person's question also carries a short,
read-only "Your information" block built from reads their own screens make: the next three weeks of their calendar
(deadlines with status, classes, exams, fees, appointments), for students their programme, balance, amount due and hold
status, and for staff their unmarked, support and task counts (at most 25 lines). Claude may answer from it only, quoting
dates and amounts as written. The panel says so in its note, shows personal starter questions, and labels such answers
"From your portal record". Visitors never get it. `/api/ai/status` reports `askSvuPersonal`. Pending D-41 and D-38.

## Later phases

- **Phase 2 extensions:** "What's due this week?", "Why is my registration blocked?". Claude calls read-only
  tools that reuse existing endpoints (`/api/calendar/me`, Today's attention items, the account statement,
  `/api/me/work-summary`) under the person's own permissions. Needs D-41 and D-38.
- **Phase 3, hand-off:** turn an unhelpful conversation into a support case with the transcript attached.
- **Content:** keep `helpPages` in step with new screens; anonymised question logs (if D-41 allows) would show
  which guidance articles are missing.
- **Production:** a shared rate limiter if more than one server runs; a live check with real questions before
  enabling.
