(function () {
  // Shared calendar (docs/CALENDAR.md): one data source (/api/calendar/me), four presentations — full calendar
  // (month / week / list), a week strip for Today, and a mini month for home rails. Events are real records only.
  const ui = window.svuUI, esc = ui.esc;
  const dayMs = 864e5;
  const typeInfo = {
    assignment: { label: 'Coursework', glyph: 'book', tone: 'blue', filter: 'coursework' },
    class: { label: 'Online class', glyph: 'users', tone: 'green', filter: 'coursework' },
    exam: { label: 'Examination', glyph: 'calendar', tone: 'lavender', filter: 'exams' },
    fee: { label: 'Fee', glyph: 'wallet', tone: 'amber', filter: 'fees' },
    offer: { label: 'Offer', glyph: 'admissions', tone: 'amber', filter: 'all' },
    intake: { label: 'Intake', glyph: 'cap', tone: 'green', filter: 'all' },
    appointment: { label: 'Appointment', glyph: 'users', tone: 'lavender', filter: 'all' }
  };
  const statusInfo = { submitted: ['Submitted', 'green'], overdue: ['Overdue', 'red'], due_soon: ['Due soon', 'amber'], due: ['Due', 'blue'], paid: ['Paid', 'green'], scheduled: ['Scheduled', ''], teaching: ['', ''] };
  const filters = [['all', 'All'], ['coursework', 'Coursework'], ['exams', 'Exams'], ['fees', 'Fees']];
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const localDay = (event) => event.allDay ? event.start.slice(0, 10) : iso(new Date(event.start));
  const time = (event) => event.allDay ? 'All day' : new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayTitle = (date) => date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  // "in 18 hours", "in 3 days", "2 days ago" for deadlines and expiries.
  function countdown(value, now = new Date()) {
    const left = new Date(value).getTime() - now.getTime(), abs = Math.abs(left);
    const unit = abs < 3600000 ? [Math.max(1, Math.round(abs / 60000)), 'minute'] : abs < 2 * dayMs ? [Math.round(abs / 3600000), 'hour'] : [Math.round(abs / dayMs), 'day'];
    const words = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
    return left >= 0 ? `in ${words}` : `${words} ago`;
  }

  const cache = new Map();
  async function load(from, to) {
    const token = window.svuSession.get()?.token, key = `${token}:${iso(from)}:${iso(to)}`, hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.data;
    const response = await fetch(`/api/calendar/me?from=${iso(from)}&to=${iso(to)}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'The calendar could not be loaded.');
    cache.set(key, { at: Date.now(), data: payload.data });
    return payload.data;
  }
  const byDay = (events) => events.reduce((map, event) => { const key = localDay(event); (map[key] ||= []).push(event); return map; }, {});
  const status = (event) => event.progress ? ui.badge(`${event.progress.done}/${event.progress.total} in`, event.progress.done >= event.progress.total ? 'green' : 'blue')
    : statusInfo[event.status]?.[0] ? ui.badge(statusInfo[event.status][0], statusInfo[event.status][1]) : '';
  const eventRow = (event) => `<a class="cal-event cal-${esc(event.type)}" href="${esc(event.href)}" data-calendar-event="${esc(event.id)}">
      ${ui.ico(typeInfo[event.type]?.glyph || 'calendar', typeInfo[event.type]?.tone || 'blue', 'ui-icon-sm')}
      <span class="cal-event-body"><strong>${esc(event.title)}</strong><span class="ui-meta">${esc(time(event))} · ${esc(event.subtitle || typeInfo[event.type]?.label || '')}${['assignment', 'offer'].includes(event.type) && !['submitted', 'paid'].includes(event.status) ? ` · ${esc(countdown(event.start))}` : ''}</span></span>
      ${status(event)}</a>`;
  const agenda = (date, events) => `<div class="cal-agenda"><h3 class="ui-card-title">${esc(dayTitle(date))}</h3>${events.length ? `<div class="ui-rows">${events.map(eventRow).join('')}</div>`
    : ui.emptyState({ glyph: 'calendar', text: 'Nothing due or scheduled on this day.', compact: true })}</div>`;
  const dots = (events) => `<span class="cal-dots" aria-hidden="true">${[...new Set(events.map((event) => event.type))].slice(0, 4).map((type) => `<i class="cal-dot cal-dot-${esc(type)}"></i>`).join('')}</span>`;
  const legend = () => `<ul class="cal-legend" aria-label="Legend">${Object.entries({ assignment: 'Coursework', class: 'Class', exam: 'Exam', fee: 'Fee' }).map(([type, label]) => `<li><i class="cal-dot cal-dot-${type}"></i>${label}</li>`).join('')}</ul>`;

  function ics(events) {
    const t = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const text = (value) => String(value ?? '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
    const lines = events.flatMap((event) => ['BEGIN:VEVENT', `UID:${event.id}@southvalley.calendar`, `DTSTAMP:${t(new Date())}`,
      ...(event.allDay ? [`DTSTART;VALUE=DATE:${event.start.slice(0, 10).replace(/-/g, '')}`] : [`DTSTART:${t(event.start)}`, `DTEND:${t(event.end || new Date(new Date(event.start).getTime() + 30 * 60000))}`]),
      `SUMMARY:${text(event.title)}`, `DESCRIPTION:${text(event.subtitle || '')}`, ...(event.url ? [`URL:${text(event.url)}`] : []),
      ...(event.type === 'assignment' ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(`${event.title} is due tomorrow`)}`, 'TRIGGER:-P1D', 'END:VALARM'] : []), 'END:VEVENT']);
    const url = URL.createObjectURL(new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//South Valley University//Calendar//EN', ...lines, 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' }));
    const a = document.createElement('a'); a.href = url; a.download = 'svu-calendar.ics'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Full calendar: month / week / list with a selected-day agenda.
  function mountFull(host) {
    const narrow = matchMedia('(max-width: 767px)').matches;
    const state = { view: narrow ? 'list' : 'month', filter: 'all', anchor: startOfDay(new Date()), selected: startOfDay(new Date()), data: null, error: '' };
    const range = () => state.view === 'month' ? (() => { const first = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1); const start = addDays(first, -((first.getDay() + 6) % 7)); return [start, addDays(start, 42)]; })()
      : state.view === 'week' ? (() => { const start = addDays(state.anchor, -((state.anchor.getDay() + 6) % 7)); return [start, addDays(start, 7)]; })()
      : [startOfDay(state.anchor), addDays(state.anchor, 30)];
    const visible = () => (state.data?.events || []).filter((event) => state.filter === 'all' || typeInfo[event.type]?.filter === state.filter);
    const heading = () => state.view === 'month' ? state.anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : state.view === 'week' ? `Week of ${range()[0].toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : `Next 30 days from ${state.anchor.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    function body() {
      const [start, end] = range(), days = byDay(visible()), today = iso(new Date());
      if (state.view === 'list') {
        const keys = Object.keys(days).sort();
        return keys.length ? `<div class="cal-list">${keys.map((key) => agenda(new Date(`${key}T00:00:00`), days[key])).join('')}</div>` : ui.emptyState({ glyph: 'calendar', title: 'Nothing scheduled', text: 'No deadlines, classes, exams or fees in the next 30 days.' });
      }
      const cells = [];
      for (let date = start; date < end; date = addDays(date, 1)) {
        const key = iso(date), events = days[key] || [];
        const outside = state.view === 'month' && date.getMonth() !== state.anchor.getMonth();
        cells.push(`<button type="button" class="cal-day ${outside ? 'is-outside' : ''} ${key === today ? 'is-today' : ''} ${key === iso(state.selected) ? 'is-selected' : ''}" data-calendar-day="${key}"
          aria-label="${esc(dayTitle(date))}, ${events.length} ${events.length === 1 ? 'item' : 'items'}" ${key === iso(state.selected) ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
          <span class="cal-day-number">${date.getDate()}</span>${state.view === 'week'
            ? `<span class="cal-day-name">${date.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="cal-week-items">${events.slice(0, 4).map((event) => `<span class="cal-chip cal-${esc(event.type)}">${esc(time(event))} ${esc(event.title)}</span>`).join('')}${events.length > 4 ? `<span class="ui-meta">+${events.length - 4} more</span>` : ''}</span>`
            : `${dots(events)}<span class="cal-month-items">${events.slice(0, 2).map((event) => `<span class="cal-chip cal-${esc(event.type)}">${esc(event.title)}</span>`).join('')}</span>${events.length > 2 ? `<span class="cal-count">+${events.length - 2} more</span>` : ''}`}</button>`);
      }
      const names = [...Array(7)].map((_, index) => addDays(start, index).toLocaleDateString(undefined, { weekday: 'short' }));
      return `<div class="cal-split"><div class="cal-grid-wrap">${state.view === 'month' ? `<div class="cal-weekdays" aria-hidden="true">${names.map((name) => `<span>${esc(name)}</span>`).join('')}</div>` : ''}<div class="cal-grid cal-${state.view}">${cells.join('')}</div>${legend()}</div>
        <aside class="cal-side" aria-live="polite">${agenda(state.selected, days[iso(state.selected)] || [])}</aside></div>`;
    }
    function paint() {
      host.innerHTML = `${ui.head('Calendar', { desc: 'Deadlines, classes, examinations and fees in one place.', actions: `<button class="button button-secondary" type="button" data-calendar-subscribe aria-expanded="${state.feed ? 'true' : 'false'}">Subscribe</button><button class="button button-secondary" type="button" data-calendar-ics ${visible().length ? '' : 'disabled'}>${ui.icons.calendar} Add to calendar</button>` })}
        ${state.feed ? subscribePanel(state.feed) : ''}
        <div class="cal-toolbar"><div class="cal-nav"><button class="icon-button" type="button" data-calendar-move="-1" aria-label="Previous">${ui.icons.arrowLeft}</button><button class="button button-secondary" type="button" data-calendar-today>Today</button><button class="icon-button" type="button" data-calendar-move="1" aria-label="Next">${ui.icons.arrowRight}</button><h3 class="cal-title">${esc(heading())}</h3></div>
          <div class="cal-controls"><nav class="ui-segmented" aria-label="Calendar view">${[['month', 'Month'], ['week', 'Week'], ['list', 'List']].map(([id, label]) => `<a href="#" data-calendar-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
          <nav class="ui-segmented" aria-label="Show">${filters.map(([id, label]) => `<a href="#" data-calendar-filter="${id}" ${state.filter === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav></div></div>
        ${state.error ? ui.alert('error', 'The calendar could not be loaded', state.error) : !state.data ? '<div class="cal-loading" role="status"><span class="visually-hidden">Loading calendar</span></div>' : body()}`;
      host.querySelectorAll('[data-calendar-day]').forEach((button) => button.addEventListener('click', () => { state.selected = new Date(`${button.dataset.calendarDay}T00:00:00`); paint(); host.querySelector(`[data-calendar-day="${button.dataset.calendarDay}"]`)?.focus(); }));
      host.querySelectorAll('[data-calendar-view]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); state.view = link.dataset.calendarView; refresh(); }));
      host.querySelectorAll('[data-calendar-filter]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); state.filter = link.dataset.calendarFilter; paint(); }));
      host.querySelectorAll('[data-calendar-move]').forEach((button) => button.addEventListener('click', () => { const step = Number(button.dataset.calendarMove);
        state.anchor = state.view === 'month' ? new Date(state.anchor.getFullYear(), state.anchor.getMonth() + step, 1) : addDays(state.anchor, step * (state.view === 'week' ? 7 : 30));
        state.selected = state.view === 'month' ? state.anchor : addDays(state.anchor, 0); refresh(); }));
      host.querySelector('[data-calendar-today]')?.addEventListener('click', () => { state.anchor = state.selected = startOfDay(new Date()); refresh(); });
      host.querySelector('[data-calendar-ics]')?.addEventListener('click', () => ics(visible()));
      host.querySelector('[data-calendar-subscribe]')?.addEventListener('click', () => { if (state.feed) { state.feed = null; paint(); return; } feedAction('GET'); });
      host.querySelectorAll('[data-feed-action]').forEach((button) => button.addEventListener('click', () => feedAction(button.dataset.feedAction)));
      host.querySelector('[data-feed-copy]')?.addEventListener('click', async (event) => {
        const input = host.querySelector('[data-feed-url]'); input.select();
        try { await navigator.clipboard.writeText(input.value); event.currentTarget.textContent = 'Copied'; } catch { document.execCommand('copy'); }
      });
    }
    // Subscription address: shown once when created; afterwards only "on" and reset/turn off.
    async function feedAction(method) {
      state.feed = { ...(state.feed || {}), busy: true }; paint();
      try {
        const response = await fetch('/api/calendar/feed', { method, headers: { Authorization: `Bearer ${window.svuSession.get()?.token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || 'The subscription could not be changed.');
        state.feed = { ...payload.data, url: payload.data.token ? `${location.origin}/api/calendar/feed/${payload.data.token}.ics` : '' };
      } catch (error) { state.feed = { error: error.message }; }
      paint();
    }
    function subscribePanel(feed) {
      const steps = '<ol class="cal-feed-steps"><li><strong>Google Calendar:</strong> Other calendars → + → From URL, then paste.</li><li><strong>iPhone / Mac:</strong> Settings → Calendar → Accounts → Add subscribed calendar.</li><li><strong>Outlook:</strong> Add calendar → Subscribe from web.</li></ol>';
      return `<section class="cal-feed" data-calendar-feed aria-live="polite">
        ${feed.busy ? '<p class="ui-meta">Working…</p>' : feed.error ? ui.alert('error', 'Subscription unavailable', feed.error)
          : feed.url ? `<p><strong>Your private calendar address</strong></p><p class="ui-meta">Copy it now: for your security it is shown only once. Anyone with it can see your deadlines and exam times (not amounts or seats).</p>
            <div class="cal-feed-url"><input class="input" readonly data-feed-url value="${esc(feed.url)}" aria-label="Calendar subscription address"><button class="button button-primary" type="button" data-feed-copy>Copy</button></div>${steps}`
          : feed.active ? `<p><strong>Subscription is on.</strong> Your phone or calendar app updates from it about every hour${feed.lastUsedAt ? `; last checked ${esc(window.svuUI.dateTime(feed.lastUsedAt))}` : ''}.</p>
            <p class="ui-meta">Lost the address, or shared it by mistake? Reset it: the old address stops working.</p>
            <div class="ui-actions"><button class="button button-secondary" type="button" data-feed-action="POST">Reset address</button><button class="button button-secondary" type="button" data-feed-action="DELETE">Turn off</button></div>`
          : `<p><strong>Keep your phone calendar up to date.</strong> Subscribe once and new deadlines, classes and exams appear automatically.</p>
            <div class="ui-actions"><button class="button button-primary" type="button" data-feed-action="POST">Create subscription address</button></div>`}
      </section>`;
    }
    async function refresh() { state.data = null; state.error = ''; paint(); const [from, to] = range(); try { state.data = await load(from, to); } catch (error) { state.error = error.message; } if (host.isConnected) paint(); }
    refresh();
  }

  // Week strip for Study / Today: seven days from today, the selected day's items below.
  function mountWeek(host) {
    const start = startOfDay(new Date()), state = { selected: start, data: null };
    function paint() {
      const days = byDay(state.data?.events || []);
      host.innerHTML = `${ui.head('This week', { href: '#study/timetable', label: 'Open calendar' })}<div class="cal-strip" role="group" aria-label="Next seven days">${[...Array(7)].map((_, index) => {
        const date = addDays(start, index), key = iso(date), events = days[key] || [];
        return `<button type="button" class="cal-pill ${key === iso(state.selected) ? 'is-selected' : ''} ${index === 0 ? 'is-today' : ''}" data-calendar-day="${key}" aria-pressed="${key === iso(state.selected)}" aria-label="${esc(dayTitle(date))}, ${events.length} ${events.length === 1 ? 'item' : 'items'}">
          <span class="cal-pill-name">${index === 0 ? 'Today' : esc(date.toLocaleDateString(undefined, { weekday: 'short' }))}</span><span class="cal-pill-date">${date.getDate()}</span>${dots(events)}</button>`;
      }).join('')}</div>${state.data ? agenda(state.selected, days[iso(state.selected)] || []) : '<div class="cal-loading cal-loading-small" role="status"><span class="visually-hidden">Loading this week</span></div>'}`;
      host.querySelectorAll('[data-calendar-day]').forEach((button) => button.addEventListener('click', () => { state.selected = new Date(`${button.dataset.calendarDay}T00:00:00`); paint(); host.querySelector(`[data-calendar-day="${button.dataset.calendarDay}"]`)?.focus(); }));
    }
    paint();
    load(start, addDays(start, 7)).then((data) => { state.data = data; if (host.isConnected) paint(); }).catch(() => { if (host.isConnected) host.innerHTML = `${ui.head('This week')}${ui.emptyState({ glyph: 'calendar', text: 'This week could not be loaded.', compact: true })}`; });
  }

  // Mini month for home rails, with "Due this week" underneath.
  function mountMini(host) {
    const today = startOfDay(new Date()), first = new Date(today.getFullYear(), today.getMonth(), 1), start = addDays(first, -((first.getDay() + 6) % 7));
    const paint = (data) => {
      const days = byDay(data?.events || []), week = (data?.events || []).filter((event) => { const at = new Date(event.start); return at >= today && at < addDays(today, 7); });
      const cells = [...Array(42)].map((_, index) => { const date = addDays(start, index), key = iso(date), events = days[key] || [];
        return `<a class="cal-mini-day ${date.getMonth() !== today.getMonth() ? 'is-outside' : ''} ${key === iso(today) ? 'is-today' : ''}" href="${events[0]?.href || '#'}" aria-label="${esc(dayTitle(date))}, ${events.length} items" ${events.length ? '' : 'tabindex="-1"'}>${date.getDate()}${dots(events)}</a>`; }).join('');
      host.innerHTML = `${ui.head(today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), { eyebrow: 'Calendar' })}<div class="cal-mini" aria-label="This month">${cells}</div>
        <div class="cal-mini-week"><h3 class="ui-card-title">Due this week</h3>${week.length ? `<div class="ui-rows">${week.slice(0, 5).map(eventRow).join('')}</div>` : '<p class="ui-meta">Nothing due in the next seven days.</p>'}</div>`;
    };
    paint(null);
    load(start, addDays(start, 42)).then((data) => { if (host.isConnected) paint(data); }).catch(() => { if (host.isConnected) host.remove(); });
  }

  function mount(root = document) {
    root.querySelectorAll('[data-calendar-full]:not([data-calendar-ready])').forEach((host) => { host.dataset.calendarReady = '1'; mountFull(host); });
    root.querySelectorAll('[data-calendar-week]:not([data-calendar-ready])').forEach((host) => { host.dataset.calendarReady = '1'; mountWeek(host); });
    root.querySelectorAll('[data-calendar-mini]:not([data-calendar-ready])').forEach((host) => { host.dataset.calendarReady = '1'; mountMini(host); });
  }
  window.svuCalendar = { load, mount, countdown, iso };
  // Pages only place a host element; the calendar mounts itself after each render.
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (window.svuSession.get()) mount(document.querySelector('#app')); }); }).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
