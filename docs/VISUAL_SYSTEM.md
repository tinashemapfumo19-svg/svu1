# Visual System: Icons, Status, Dialogs, Dates and Pictures

How the portal keeps one look across screens. Shared helpers live in `src/ui-kit.js` (`window.svuUI`); app-wide fixes
that apply to every screen without editing it live in `src/visuals.js`; styles are in `src/staff.css` under
"Visual system".

## Icons

- One set: `svuUI.icons` (24-px stroke icons). Added for controls that used text symbols or emoji: `arrowLeft`,
  `arrowRight`, `refresh`, `external`, `x`, `thumbUp`, `thumbDown`, `sparkle`, `download`, `send`.
- `visuals.js` replaces any button or icon link whose whole label is a text symbol (↻ ← → × ✕ ✓) with the matching
  icon and keeps an accessible name, so older screens are covered without edits.
- Arrows in written directions ("Settings → Notifications") stay as text.

## Status labels

One shape for every status: 26 px pill, 12 px semibold text, a leading dot and a tone (green done/valid, blue
open/in progress, amber waiting/due, red blocked/failed). `svuUI.status(value)` picks words and tone; legacy `.pill`,
`.status-badge` and early-warning `.ew-chip` now render the same way. Event chips in the calendar and suggestion chips in
Ask SVU are different controls and keep their own look.

## Dialogs

`await svuUI.confirm({ title, text, confirmLabel, danger })` → true/false and `await svuUI.ask({ title, text, label })`
→ text or null replace the browser's `confirm()`/`prompt()` (native `<dialog>`, Escape cancels, focus returns). Used for
withdrawing an application, declining an offer and cancelling appointments. The chat owner's room and tab close
confirmations still use the browser dialog.

## Dates

- Dates: `svuUI.date(x)` ("Oct 12, 2026"). Date and time: `svuUI.dateTime(x)` ("Oct 12, 2026, 07:35 PM"), in the
  reader's locale order. All `new Date(x).toLocaleString()` calls outside the messaging files now use it.
- Official documents (transcripts, letters, verification fingerprints) keep ISO dates (2026-10-12) on purpose.

## Pictures

- **Photos:** only the campus picture on the Home / Study Today welcome card (`src/assets/campus-concept*.jpg`). A set of
  stock photos (sign-in, page header bands, programme and course covers) was tried on 2026-10-12 and removed on
  2026-10-13 at the user's request.
- **Illustrations** (drawn for this app, `src/assets/illustrations/`): empty states pick one from their glyph
  (calendar, inbox, courses, search, documents, people, success; `art:` overrides), and the success illustration marks
  attendance check-in, payment received and evaluation submitted.
- **Seal:** a placeholder SVU seal on the Verify page and on letters (`seal.svg`), not an approved crest.

## Outstanding

- An approved crest (D-42), and real SVU photography if pictures are wanted later.
- Staff and student profile photos (initials avatars today; D-42).
- The chat owner's messaging screens keep their own date format and browser confirmations.
