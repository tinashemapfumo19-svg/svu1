# Appointment Booking

Students book time with staff; staff publish when they are available.

## Hosts

Anyone with `appointments.host` (lecturers, support officers and managers, academic registrars, finance officers,
system administrators) sees **Office hours** on Home: upcoming bookings with the student's name, number and reason, and
**Publish times** (type, first slot, length, slots in a row, repeat weekly up to 12 weeks, place or meeting link).
Overlapping slots are refused. A host can cancel a booking (the student is told) or withdraw a slot.

Types: Office hours, Academic advising, Finance desk, Student support, Registry desk.

## Students

Student Office → **Appointments**: open times for the next six weeks by type and day, book with a short reason, see and
cancel upcoming bookings. At most 3 upcoming bookings; book at least an hour ahead; one booking per slot.

Confirmations (`appointment.confirmed`, `appointment.booked`) and cancellations (`appointment.cancelled`) are essential
messages. Bookings appear in both people's calendars and the calendar feed.

## Implementation

`server/modules/appointments.js`, migration `112_appointments.sql`, client `src/appointments.js`.

| Endpoint | Who |
| --- | --- |
| `GET /api/appointments/slots?kind=` | Student: open slots and own bookings |
| `POST /api/appointments/slots` | Host: publish |
| `GET /api/appointments/hosting` | Host: own slots and bookings |
| `POST /api/appointments/slots/:id/book {reason}` | Student |
| `POST /api/appointments/slots/:id/cancel`, `POST /api/appointments/bookings/:id/cancel {reason}` | Host / student or host |

## Outstanding

- Cancelling uses the browser's prompt for the reason; replace with an in-page form.
- Reminders before an appointment, and video-meeting links created automatically.
- Group sessions (capacity above one).
