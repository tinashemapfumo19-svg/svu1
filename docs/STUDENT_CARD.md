# Digital Student ID Card

Student Office → **ID Card** shows a card with the student's name, number, programme, intake, a "Current student" badge
and a QR code. Staff scan the QR to see, on the university's own site, whether the holder is a current student now.

## How it works

- `server/modules/student-card.js`; no database table. The QR encodes `#verify/card-<payload>.<signature>`: the payload
  holds the student-programme id and an expiry 15 minutes ahead, signed with HMAC-SHA-256 using a key derived from
  `SVU_DATA_KEY` (`server/derived-keys.js`, purpose `student-card`).
- The card refreshes its code every 10 minutes while open. A live clock, a moving shine and the code countdown make a
  screenshot easy to tell apart. An expired code shows "Code expired" on scan; a forged one shows "Not recognised".
- A scan (`GET /api/verify/card/:token`, public) shows only what the card shows, plus whether the student is current now
  (programme status onboarded or active). Nothing is logged per scan.
- `GET /api/registry/me/card` (student) returns the card and QR.

## Outstanding

- Student photographs: there is no approved photo source yet, so the card shows initials (D-42).
- Wallet passes (Apple/Google) and NFC are not built.
- Whether libraries, exam halls or campus security will accept the digital card (D-42).
