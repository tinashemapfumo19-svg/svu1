(function () {
  // Appointment booking (docs/APPOINTMENTS.md). Students: Student Office → Appointments ([data-student-appointments]).
  // Hosts: an Office hours panel on staff Home ([data-appointments-host]) to publish slots and see bookings.
  const ui = window.svuUI, esc = ui.esc;
  async function api(method, path, body) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Request failed.');
    return payload.data;
  }
  const day = (value) => new Date(value).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const time = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const span = (row) => `${time(row.startsAt)}–${time(row.endsAt)}`;

  function studentView(host) {
    const state = { data: null, kind: '', picking: null, notice: '', error: '' };
    async function load() { try { state.data = await api('GET', `/api/appointments/slots${state.kind ? `?kind=${state.kind}` : ''}`); state.error = ''; } catch (error) { state.error = error.message; } paint(); }
    function paint() {
      const d = state.data;
      const upcoming = (d?.bookings || []).filter((row) => row.status === 'booked' && new Date(row.endsAt) > new Date());
      const byDay = {};
      for (const slot of d?.slots || []) (byDay[new Date(slot.startsAt).toDateString()] ||= []).push(slot);
      host.innerHTML = `${state.notice ? `<div class="ui-alert ui-alert-success" role="status"><div><strong>${esc(state.notice)}</strong></div></div>` : ''}${state.error ? ui.alert('error', 'Appointments', state.error) : ''}
        ${upcoming.length ? `<section class="appt-mine">${ui.head('Your appointments')}<ul class="ui-rows">${upcoming.map((row) => `<li class="ui-row appt-row">${ui.ico('users', 'lavender', 'ui-icon-sm')}<div><strong>${esc(d.kinds[row.kind])} with ${esc(row.hostName)}</strong><span class="ui-meta">${esc(day(row.startsAt))} · ${esc(span(row))} · ${esc(row.location)}</span><span class="ui-meta">Reason: ${esc(row.reason)}</span></div><button class="button button-secondary" type="button" data-appt-cancel="${esc(row.id)}">Cancel</button></li>`).join('')}</ul></section>` : ''}
        ${ui.head('Book an appointment', { desc: 'Choose a type, then a time. You can hold up to three upcoming appointments.' })}
        ${d ? `<nav class="ui-segmented appt-kinds" aria-label="Appointment type"><a href="#" data-appt-kind="" ${state.kind ? '' : 'aria-current="page"'}>All</a>${Object.entries(d.kinds).map(([id, label]) => `<a href="#" data-appt-kind="${id}" ${state.kind === id ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>
        ${Object.keys(byDay).length ? `<div class="appt-days">${Object.entries(byDay).map(([key, slots]) => `<section class="appt-day"><h4>${esc(day(slots[0].startsAt))}</h4><div class="appt-slots">${slots.map((slot) => `<button type="button" class="appt-slot ${state.picking?.id === slot.id ? 'is-picked' : ''}" data-appt-pick="${esc(slot.id)}"><strong>${esc(time(slot.startsAt))}</strong><span>${esc(slot.hostName)}</span><small>${esc(d.kinds[slot.kind])}</small></button>`).join('')}</div></section>`).join('')}</div>`
          : ui.emptyState({ glyph: 'calendar', title: 'No open times', text: 'No appointment times are published for the next six weeks. Try another type, or contact the office through Requests.', compact: true })}` : '<p class="ui-meta" role="status">Loading…</p>'}
        ${state.picking ? `<form class="appt-book ai-card" data-appt-book><p><strong>${esc(d.kinds[state.picking.kind])} with ${esc(state.picking.hostName)}</strong><br><span class="ui-meta">${esc(day(state.picking.startsAt))} · ${esc(span(state.picking))} · ${esc(state.picking.location)}</span></p>${state.picking.note ? `<p class="ui-meta">${esc(state.picking.note)}</p>` : ''}
          <label class="field"><span>What would you like to discuss?</span><textarea class="input" name="reason" minlength="3" maxlength="500" rows="2" required></textarea></label><div class="ai-card-actions"><button class="button button-primary" type="submit">Book this time</button><button class="button button-secondary" type="button" data-appt-unpick>Cancel</button></div></form>` : ''}`;
      host.querySelectorAll('[data-appt-kind]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); state.kind = link.dataset.apptKind; state.picking = null; load(); }));
      host.querySelectorAll('[data-appt-pick]').forEach((button) => button.addEventListener('click', () => { state.picking = d.slots.find((slot) => slot.id === button.dataset.apptPick); paint(); host.querySelector('[data-appt-book] textarea')?.focus(); }));
      host.querySelector('[data-appt-unpick]')?.addEventListener('click', () => { state.picking = null; paint(); });
      host.querySelector('[data-appt-book]')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const reason = new FormData(event.currentTarget).get('reason');
        try { const booked = await api('POST', `/api/appointments/slots/${state.picking.id}/book`, { reason }); state.notice = `Booked with ${booked.hostName} on ${day(booked.startsAt)} at ${time(booked.startsAt)}. It is in your calendar.`; state.picking = null; state.error = ''; }
        catch (error) { state.error = error.message; }
        load();
      });
      host.querySelectorAll('[data-appt-cancel]').forEach((button) => button.addEventListener('click', async () => {
        const reason = await ui.ask({ title: 'Cancel this appointment?', text: 'The member of staff is told. You can book another time afterwards.', label: 'Reason (optional)', confirmLabel: 'Cancel appointment', cancelLabel: 'Keep it', danger: true });
        if (reason === null) return;
        try { await api('POST', `/api/appointments/bookings/${button.dataset.apptCancel}/cancel`, { reason }); state.notice = 'Appointment cancelled.'; } catch (error) { state.error = error.message; }
        load();
      }));
    }
    paint(); load();
  }

  function hostView(host) {
    const state = { data: null, notice: '', error: '', open: false };
    async function load() { try { state.data = await api('GET', '/api/appointments/hosting'); state.error = ''; } catch (error) { state.error = error.message; } paint(); }
    function paint() {
      const d = state.data, slots = d?.slots || [];
      const booked = slots.filter((row) => row.bookingId), free = slots.length - booked.length;
      const tomorrow = new Date(Date.now() + 864e5); tomorrow.setHours(10, 0, 0, 0);
      const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      host.innerHTML = `${ui.head('Office hours', { desc: `${booked.length} booked · ${free} open in the coming weeks` })}
        ${state.notice ? `<div class="ui-alert ui-alert-success" role="status"><div><strong>${esc(state.notice)}</strong></div></div>` : ''}${state.error ? ui.alert('error', 'Office hours', state.error) : ''}
        ${booked.length ? `<ul class="ui-rows">${booked.slice(0, 8).map((row) => `<li class="ui-row appt-row">${ui.ico('users', 'lavender', 'ui-icon-sm')}<div><strong>${esc(row.studentName)}${row.studentNumber ? ` · ${esc(row.studentNumber)}` : ''}</strong><span class="ui-meta">${esc(day(row.startsAt))} · ${esc(span(row))} · ${esc(row.location)}</span><span class="ui-meta">${esc(row.reason)}</span></div><button class="button button-secondary" type="button" data-host-cancel-booking="${esc(row.bookingId)}">Cancel</button></li>`).join('')}</ul>` : `<p class="ui-meta">No bookings yet.${free ? '' : ' Publish some times so students can book you.'}</p>`}
        <details class="appt-publish" ${state.open ? 'open' : ''}><summary>Publish times</summary>
          <form class="appt-publish-form" data-host-publish>
            <label class="field"><span>Type</span><select class="input" name="kind">${Object.entries(d?.kinds || {}).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>
            <label class="field"><span>First slot starts</span><input class="input" type="datetime-local" name="startsAt" value="${local}" required></label>
            <label class="field"><span>Length</span><select class="input" name="durationMinutes"><option value="15">15 minutes</option><option value="20" selected>20 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label>
            <label class="field"><span>Slots in a row</span><input class="input" type="number" name="count" min="1" max="16" value="3"></label>
            <label class="field"><span>Repeat weekly for</span><select class="input" name="weeks">${[1, 2, 4, 6, 8, 12].map((n) => `<option value="${n}">${n} ${n === 1 ? 'week' : 'weeks'}</option>`).join('')}</select></label>
            <label class="field field-wide"><span>Place or meeting link</span><input class="input" name="location" maxlength="300" required placeholder="Room B12, or an online meeting link"></label>
            <div><button class="button button-primary" type="submit">Publish</button></div></form></details>`;
      host.querySelector('.appt-publish')?.addEventListener('toggle', (event) => { state.open = event.currentTarget.open; });
      host.querySelector('[data-host-publish]')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const v = Object.fromEntries(new FormData(event.currentTarget));
        try { const result = await api('POST', '/api/appointments/slots', { kind: v.kind, startsAt: new Date(v.startsAt).toISOString(), durationMinutes: Number(v.durationMinutes), count: Number(v.count), weeks: Number(v.weeks), location: v.location }); state.notice = `Published ${result.created} times.`; state.open = false; state.error = ''; }
        catch (error) { state.error = error.message; }
        load();
      });
      host.querySelectorAll('[data-host-cancel-booking]').forEach((button) => button.addEventListener('click', async () => {
        const reason = await ui.ask({ title: 'Cancel this booking?', text: 'The student is notified with your reason.', label: 'Reason', confirmLabel: 'Cancel booking', cancelLabel: 'Keep it', danger: true });
        if (reason === null) return;
        try { await api('POST', `/api/appointments/bookings/${button.dataset.hostCancelBooking}/cancel`, { reason }); state.notice = 'Booking cancelled; the student was told.'; } catch (error) { state.error = error.message; }
        load();
      }));
    }
    paint(); load();
  }

  const scan = () => {
    document.querySelectorAll('[data-student-appointments]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; studentView(host); });
    document.querySelectorAll('[data-appointments-host]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; hostView(host); });
  };
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
