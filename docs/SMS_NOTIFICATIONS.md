# Text Messages for Urgent Notices

Opt-in texts for a short list of urgent notices, to a mobile number the person has verified.

## For people

Settings → Notifications → **Text messages**: enter a number in international form, receive a 6-digit code (valid 10
minutes; 5 codes a day; 5 attempts per code), confirm it, then switch texts on or off, change or remove the number.

## What is texted

Only these message types, and only those created after the number was verified: assignment deadline reminders,
offer-expiry reminders, financial hold notices, appointment cancellations, examination timetable notices. At most
**5 texts per person per day**; muted groups are never queued. Text: `SVU: <subject>. <body>`, up to 300 characters.

## Implementation

`server/sms.js`, migration `115_sms_notifications.sql`, client `src/sms-settings.js`. A background dispatcher (every
30 s) claims each message once in `sms_deliveries` (sent, failed or skipped at the daily limit).

| Variable | Meaning |
| --- | --- |
| `SVU_SMS` | `disabled` (default), `africastalking`, or `simulated` (development only; writes to `SVU_DEV_SMS_OUTBOX`/outbox.log) |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | Africa's Talking account (sender ID optional) |

The Africa's Talking adapter follows its published messaging API and **has not been tested against the service**.

| Endpoint | Purpose |
| --- | --- |
| `GET/PUT/DELETE /api/me/sms` | Status, on/off, remove number |
| `POST /api/me/sms/code {phone}`, `POST /api/me/sms/verify {code}` | Verify a number |

## Outstanding (D-06, D-45)

- Provider choice and cost; sender ID registration; which notices justify a text; consent wording.
- Delivery receipts from the provider (only the send result is recorded today).
