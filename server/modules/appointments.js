import { randomUUID } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';
import { queueNotification } from '../notification-queue.js';

// Appointment booking (docs/APPOINTMENTS.md). Hosts publish slots; students book one with a reason. Confirmations and
// cancellations are essential messages. Bookings show in both people's calendars.
export const appointmentKinds = { office_hours: 'Office hours', academic_advising: 'Academic advising', finance: 'Finance desk', support: 'Student support', registry: 'Registry desk' };
export const maxActiveBookings = 3;
const minuteMs = 60000;
const when = (value) => new Date(value).toISOString().slice(0, 16).replace('T', ' ');

// Slots for one request: `count` back-to-back slots, repeated weekly for `weeks` weeks.
export function slotTimes({ startsAt, durationMinutes, count = 1, weeks = 1 }) {
  const start = new Date(startsAt).getTime();
  const out = [];
  for (let week = 0; week < weeks; week++) for (let index = 0; index < count; index++) {
    const begins = start + week * 7 * 24 * 60 * minuteMs + index * durationMinutes * minuteMs;
    out.push({ startsAt: new Date(begins).toISOString(), endsAt: new Date(begins + durationMinutes * minuteMs).toISOString() });
  }
  return out;
}

export function createAppointmentsModule(pool) {
  const host = (actor) => { if (!actor.permissions.includes('appointments.host')) throw requestError(403, 'Permission required: appointments.host'); };
  const student = (actor) => { if (!actor.permissions.includes('registry.self')) throw requestError(403, 'Permission required: registry.self'); };
  const nameOf = `(select coalesce(pe.preferred_name,pe.legal_name) from accounts a join people pe on pe.id=a.person_id where a.id=%s)`;
  const slotSelect = `select s.id,s.kind,s.starts_at as "startsAt",s.ends_at as "endsAt",s.location,s.note,s.cancelled_at as "cancelledAt",s.host_account_id as "hostAccountId",
    ${nameOf.replace('%s', 's.host_account_id')} as "hostName" from appointment_slots s`;
  const reasonText = (value, min = 3) => { const text = typeof value === 'string' ? value.trim() : ''; if (text.length < min || text.length > 500) throw requestError(400, min ? 'Give a short reason (3 to 500 characters).' : 'Keep the reason under 500 characters.'); return text; };

  return {
    appointmentKinds() { return appointmentKinds; },

    async createAppointmentSlots(input, actor) {
      host(actor);
      const { kind, startsAt, durationMinutes, count = 1, weeks = 1 } = input || {};
      const location = typeof input?.location === 'string' ? input.location.trim() : '';
      if (!appointmentKinds[kind] || !Number.isFinite(Date.parse(startsAt)) || !Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 240
        || !Number.isInteger(count) || count < 1 || count > 16 || !Number.isInteger(weeks) || weeks < 1 || weeks > 12 || !location || location.length > 300)
        throw requestError(400, 'Choose a type, start time, length (10-240 minutes), number of slots (1-16), weeks (1-12) and a place or link.');
      if (Date.parse(startsAt) < Date.now()) throw requestError(400, 'Choose a start time in the future.');
      const times = slotTimes({ startsAt, durationMinutes, count, weeks });
      if (times.length > 60) throw requestError(400, 'Create at most 60 slots at a time.');
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
      return withTransaction(pool, async (db) => {
        const clash = (await db.query(`select 1 from appointment_slots where host_account_id=$1 and cancelled_at is null and tstzrange(starts_at,ends_at) && any(array(select tstzrange(x.s,x.e) from unnest($2::timestamptz[],$3::timestamptz[]) as x(s,e)))`,
          [actor.accountId, times.map((row) => row.startsAt), times.map((row) => row.endsAt)])).rowCount;
        if (clash) throw requestError(409, 'Some of these times overlap slots you already published.');
        for (const row of times) await db.query('insert into appointment_slots(id,host_account_id,kind,starts_at,ends_at,location,note) values($1,$2,$3,$4,$5,$6,$7)', [`apt_${randomUUID()}`, actor.accountId, kind, row.startsAt, row.endsAt, location, note]);
        await insertAudit(db, { actorId: actor.accountId, action: 'appointments.slots_created', subjectType: 'Account', subjectId: actor.accountId, reason: 'Appointment slots published', metadata: { count: times.length, kind } });
        return { created: times.length };
      });
    },

    // Host view: upcoming slots with who booked them and why.
    async listMyAppointmentSlots(actor) {
      host(actor);
      const rows = (await pool.query(`${slotSelect.replace(' from appointment_slots s', `,b.id as "bookingId",b.reason,${nameOf.replace('%s', 'b.student_account_id')} as "studentName",
          (select st.student_number from students st where st.account_id=b.student_account_id limit 1) as "studentNumber" from appointment_slots s
          left join appointment_bookings b on b.slot_id=s.id and b.status='booked'`)} where s.host_account_id=$1 and s.ends_at>now()-interval '1 day' and s.cancelled_at is null order by s.starts_at limit 200`, [actor.accountId])).rows;
      return { slots: rows.map(({ hostAccountId, ...row }) => row), kinds: appointmentKinds };
    },

    async cancelAppointmentSlot(slotId, input, actor) {
      host(actor);
      const reason = reasonText(input?.reason ?? 'Slot withdrawn', 0) || 'Slot withdrawn';
      return withTransaction(pool, async (db) => {
        const slot = (await db.query(`${slotSelect} where s.id=$1 and s.host_account_id=$2 for update of s`, [slotId, actor.accountId])).rows[0];
        if (!slot || slot.cancelledAt) throw requestError(404, 'Slot was not found.');
        await db.query('update appointment_slots set cancelled_at=now() where id=$1', [slotId]);
        const booking = (await db.query(`update appointment_bookings set status='cancelled',cancelled_at=now(),cancelled_by=$2,cancel_reason=$3 where slot_id=$1 and status='booked' returning student_account_id as "studentAccountId"`, [slotId, actor.accountId, reason])).rows[0];
        if (booking) await queueNotification(db, booking.studentAccountId, 'appointment.cancelled', { kind: appointmentKinds[slot.kind], when: when(slot.startsAt), by: slot.hostName, reason }, { activeOnly: true, link: '#office/appointments' });
        await insertAudit(db, { actorId: actor.accountId, action: 'appointments.slot_cancelled', subjectType: 'AppointmentSlot', subjectId: slotId, reason });
        return { id: slotId, cancelled: true, studentNotified: Boolean(booking) };
      });
    },

    // Student view: open slots in the next six weeks, and their own bookings.
    async listOpenAppointmentSlots(actor, { kind = '' } = {}) {
      student(actor);
      if (kind && !appointmentKinds[kind]) throw requestError(400, 'Unknown appointment type.');
      const slots = (await pool.query(`${slotSelect} where s.cancelled_at is null and s.starts_at>now()+interval '1 hour' and s.starts_at<now()+interval '42 days'
          and ($1='' or s.kind=$1) and not exists (select 1 from appointment_bookings b where b.slot_id=s.id and b.status='booked') order by s.starts_at limit 300`, [kind])).rows
        .map(({ hostAccountId, ...row }) => row);
      return { slots, kinds: appointmentKinds, bookings: await this.myAppointmentBookings(actor) };
    },

    async myAppointmentBookings(actor) {
      return (await pool.query(`select b.id,b.reason,b.status,b.cancel_reason as "cancelReason",s.kind,s.starts_at as "startsAt",s.ends_at as "endsAt",s.location,
          ${nameOf.replace('%s', 's.host_account_id')} as "hostName" from appointment_bookings b join appointment_slots s on s.id=b.slot_id
        where b.student_account_id=$1 and s.ends_at>now()-interval '30 days' order by s.starts_at desc limit 50`, [actor.accountId])).rows;
    },

    async bookAppointment(slotId, input, actor) {
      student(actor);
      const reason = reasonText(input?.reason);
      return withTransaction(pool, async (db) => {
        const slot = (await db.query(`${slotSelect} where s.id=$1 for update of s`, [slotId])).rows[0];
        if (!slot || slot.cancelledAt) throw requestError(404, 'That time is no longer available.');
        if (new Date(slot.startsAt).getTime() < Date.now() + 60 * minuteMs) throw requestError(409, 'Book at least an hour ahead.');
        const active = (await db.query(`select count(*)::int as n from appointment_bookings b join appointment_slots s on s.id=b.slot_id where b.student_account_id=$1 and b.status='booked' and s.starts_at>now()`, [actor.accountId])).rows[0].n;
        if (active >= maxActiveBookings) throw requestError(409, `You can hold up to ${maxActiveBookings} upcoming appointments. Cancel one to book another.`);
        const id = `apb_${randomUUID()}`;
        try { await db.query('insert into appointment_bookings(id,slot_id,student_account_id,reason) values($1,$2,$3,$4)', [id, slotId, actor.accountId, reason]); }
        catch (error) { if (error.code === '23505') throw requestError(409, 'Someone has just booked that time. Choose another.'); throw error; }
        const studentName = (await db.query('select coalesce(pe.preferred_name,pe.legal_name) as name from accounts a join people pe on pe.id=a.person_id where a.id=$1', [actor.accountId])).rows[0]?.name || 'A student';
        await queueNotification(db, actor.accountId, 'appointment.confirmed', { kind: appointmentKinds[slot.kind], when: when(slot.startsAt), with: slot.hostName, location: slot.location }, { activeOnly: true, link: '#office/appointments' });
        await queueNotification(db, slot.hostAccountId, 'appointment.booked', { kind: appointmentKinds[slot.kind], when: when(slot.startsAt), student: studentName, reason }, { activeOnly: true, link: '#home' });
        await insertAudit(db, { actorId: actor.accountId, action: 'appointments.booked', subjectType: 'AppointmentSlot', subjectId: slotId, reason: 'Appointment booked', metadata: { bookingId: id } });
        return { id, slotId, startsAt: slot.startsAt, hostName: slot.hostName };
      });
    },

    // Either the student or the host cancels; the other side is told.
    async cancelAppointmentBooking(bookingId, input, actor) {
      const reason = reasonText(input?.reason ?? '', 0);
      return withTransaction(pool, async (db) => {
        const row = (await db.query(`select b.id,b.student_account_id as "studentAccountId",b.status,s.host_account_id as "hostAccountId",s.kind,s.starts_at as "startsAt",
            ${nameOf.replace('%s', 's.host_account_id')} as "hostName",${nameOf.replace('%s', 'b.student_account_id')} as "studentName"
          from appointment_bookings b join appointment_slots s on s.id=b.slot_id where b.id=$1 for update of b`, [bookingId])).rows[0];
        if (!row || ![row.studentAccountId, row.hostAccountId].includes(actor.accountId)) throw requestError(404, 'Booking was not found.');
        if (row.status !== 'booked') throw requestError(409, 'This booking is already cancelled.');
        await db.query(`update appointment_bookings set status='cancelled',cancelled_at=now(),cancelled_by=$2,cancel_reason=$3 where id=$1`, [bookingId, actor.accountId, reason || null]);
        const byStudent = actor.accountId === row.studentAccountId;
        await queueNotification(db, byStudent ? row.hostAccountId : row.studentAccountId, 'appointment.cancelled',
          { kind: appointmentKinds[row.kind], when: when(row.startsAt), by: byStudent ? row.studentName : row.hostName, reason: reason || 'No reason given' }, { activeOnly: true, link: byStudent ? '#home' : '#office/appointments' });
        await insertAudit(db, { actorId: actor.accountId, action: 'appointments.booking_cancelled', subjectType: 'AppointmentBooking', subjectId: bookingId, reason: reason || 'Cancelled' });
        return { id: bookingId, cancelled: true };
      });
    },

    // Calendar events for whoever is asking: bookings as a student, and booked or open slots as a host.
    async appointmentCalendarEvents(actor, range) {
      const events = [];
      const mine = (await pool.query(`select b.id,s.kind,s.starts_at as "startsAt",s.ends_at as "endsAt",s.location,${nameOf.replace('%s', 's.host_account_id')} as "hostName"
        from appointment_bookings b join appointment_slots s on s.id=b.slot_id where b.student_account_id=$1 and b.status='booked' and s.starts_at>=$2 and s.starts_at<$3`, [actor.accountId, range.from, range.to])).rows;
      for (const row of mine) events.push({ id: `appointment:${row.id}`, type: 'appointment', title: `${appointmentKinds[row.kind]} with ${row.hostName}`, subtitle: row.location, start: row.startsAt, end: row.endsAt, allDay: false, status: 'scheduled', href: '#office/appointments' });
      if (actor.permissions.includes('appointments.host')) {
        const hosted = (await pool.query(`select s.id,s.kind,s.starts_at as "startsAt",s.ends_at as "endsAt",s.location,${nameOf.replace('%s', 'b.student_account_id')} as "studentName"
          from appointment_slots s join appointment_bookings b on b.slot_id=s.id and b.status='booked' where s.host_account_id=$1 and s.cancelled_at is null and s.starts_at>=$2 and s.starts_at<$3`, [actor.accountId, range.from, range.to])).rows;
        for (const row of hosted) events.push({ id: `hosting:${row.id}`, type: 'appointment', title: `${appointmentKinds[row.kind]}: ${row.studentName}`, subtitle: row.location, start: row.startsAt, end: row.endsAt, allDay: false, status: 'scheduled', href: '#home' });
      }
      return events;
    }
  };
}
