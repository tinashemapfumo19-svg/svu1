(function () {
  // Class attendance (docs/ATTENDANCE.md). Mounts into [data-course-attendance] on a course page, and renders the
  // #attend/<session~code> page a student reaches by scanning the code shown in class.
  const ui = window.svuUI, esc = ui.esc;
  async function api(method, path, body) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Request failed.');
    return payload.data;
  }
  const base = (host) => { const ws = host.closest('[data-course-workspace]'); return `/api/course-workspaces/${encodeURIComponent(ws.dataset.period)}/${encodeURIComponent(ws.dataset.course)}/attendance`; };
  const when = (value) => new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // Lecturer: start attendance, the live register while open, and past sessions.
  function lecturer(host) {
    const state = { list: null, live: null, error: '', fullscreen: false };
    let poll = null;
    const stop = () => { clearTimeout(poll); poll = null; };
    async function refresh() {
      try {
        state.list = await api('GET', base(host));
        const open = state.list.sessions.find((row) => row.open);
        state.live = open ? await api('GET', `${base(host)}/${open.id}/live`) : null;
        state.error = '';
      } catch (error) { state.error = error.message; }
      paint();
      stop();
      if (state.live?.open && host.isConnected) poll = setTimeout(refresh, Math.min(4000, state.live.refreshInSeconds * 1000 + 300));
    }
    function paint() {
      if (!host.isConnected) { stop(); return; }
      const live = state.live;
      host.innerHTML = `<header class="course-attendance-head"><div><h3>Attendance</h3><p class="ui-meta">Students scan the code with their phone, or type it on the course page. It changes every 20 seconds.</p></div></header>
        ${state.error ? ui.alert('error', 'Attendance', state.error) : ''}
        ${live ? `<div class="att-live ${state.fullscreen ? 'is-full' : ''}" data-att-live>
            <div class="att-code-panel"><div class="att-qr" role="img" aria-label="Attendance QR code">${live.qrSvg}</div>
              <p class="att-code" aria-label="Check-in code">${esc(live.code.slice(0, 3))} ${esc(live.code.slice(3))}</p><p class="ui-meta">${esc(live.title)} · closes ${esc(new Date(live.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</p></div>
            <div class="att-register"><div class="att-count">${ui.ring(live.present, live.enrolled, 'present')}<div><strong>${live.present} of ${live.enrolled} present</strong><span class="ui-meta">Updates automatically</span></div></div>
              <ul class="ui-rows att-students">${live.students.map((row) => `<li class="ui-row"><span class="ui-avatar ${row.present ? 'is-present' : ''}" aria-hidden="true">${esc(ui.initials(row.studentName))}</span><div><strong>${esc(row.studentName)}</strong><span class="ui-meta">${esc(row.studentNumber)}${row.present ? ` · ${row.method === 'manual' ? 'marked by you' : 'checked in'}` : ''}</span></div>
                ${row.present ? ui.badge('Present', 'green') : `<button class="button button-secondary" type="button" data-att-mark="${esc(row.studentId)}">Mark present</button>`}</li>`).join('')}</ul>
              <div class="ui-actions"><button class="button button-secondary" type="button" data-att-full>${state.fullscreen ? 'Exit full screen' : 'Full screen for projector'}</button><button class="button button-primary" type="button" data-att-close>Close attendance</button></div></div>
          </div>`
        : `<form class="att-start" data-att-start><label class="field"><span>Session name</span><input class="input" name="title" maxlength="160" placeholder="Class on ${esc(new Date().toISOString().slice(0, 10))}"></label>
            <label class="field"><span>Keep open for</span><select class="input" name="minutes"><option value="10">10 minutes</option><option value="15" selected>15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label>
            <div><button class="button button-primary" type="submit">Take attendance</button></div></form>`}
        ${state.list?.sessions.some((row) => !row.open) ? `<details class="att-history"><summary>Past sessions (${state.list.sessions.filter((row) => !row.open).length})</summary><ul class="ui-rows">${state.list.sessions.filter((row) => !row.open).map((row) => `<li class="ui-row"><div><strong>${esc(row.title)}</strong><span class="ui-meta">${esc(when(row.openedAt))}</span></div><span class="att-rate">${row.present} / ${state.list.enrolled}</span></li>`).join('')}</ul></details>` : ''}`;
      host.querySelector('[data-att-start]')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
        try { await api('POST', base(host), { title: values.title || undefined, minutes: Number(values.minutes) }); } catch (error) { state.error = error.message; }
        refresh();
      });
      host.querySelector('[data-att-close]')?.addEventListener('click', async () => { try { await api('POST', `${base(host)}/${live.id}/close`); } catch (error) { state.error = error.message; } state.fullscreen = false; refresh(); });
      host.querySelector('[data-att-full]')?.addEventListener('click', () => { state.fullscreen = !state.fullscreen; paint(); });
      host.querySelectorAll('[data-att-mark]').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; try { await api('POST', `${base(host)}/${live.id}/marks`, { studentId: button.dataset.attMark }); } catch (error) { state.error = error.message; } refresh(); }));
    }
    paint(); refresh();
  }

  // Student: attendance so far, and a check-in box while a session is open.
  function student(host) {
    let data = null, notice = '', error = '';
    async function refresh() { try { data = await api('GET', base(host)); error = ''; } catch (e) { error = e.message; } paint(); }
    function paint() {
      if (!data && !error) { host.innerHTML = ''; return; }
      if (!data?.total && !data?.openSession && !notice && !error) { host.innerHTML = ''; return; }
      host.innerHTML = `<header class="course-attendance-head"><div><h3>Attendance</h3></div>${data?.total ? `<div class="att-count">${ui.ring(data.attended, data.total, 'classes attended')}<div><strong>${data.rate}% attended</strong><span class="ui-meta">${data.attended} of ${data.total} classes</span></div></div>` : ''}</header>
        ${notice ? `<div class="ui-alert ui-alert-success" role="status"><div><strong>${esc(notice)}</strong></div></div>` : ''}${error ? ui.alert('error', 'Attendance', error) : ''}
        ${data?.openSession ? `<form class="att-checkin" data-att-checkin><label class="field"><span>Attendance is open: ${esc(data.openSession.title)}. Enter the code on the screen</span><input class="input att-code-input" name="code" maxlength="7" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="ABC 123" required></label><div><button class="button button-primary" type="submit">Check in</button></div></form>` : ''}`;
      host.querySelector('[data-att-checkin]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        try { const result = await api('POST', '/api/attendance/check-in', { code: new FormData(event.currentTarget).get('code') }); notice = result.alreadyMarked ? 'You were already checked in.' : `Checked in to ${result.title}.`; error = ''; } catch (e) { error = e.message; notice = ''; }
        refresh();
      });
    }
    refresh();
  }

  async function renderCheckIn(app, param) {
    app.innerHTML = `<section class="registry-workspace attend-page"><div class="staff-body"><article class="ui-panel attend-result" role="status">${ui.ico('clock', 'blue', 'ui-icon-lg')}<h1>Checking you in…</h1></article></div></section>`;
    let html;
    try {
      const result = await api('POST', '/api/attendance/check-in', { token: decodeURIComponent(param || '') });
      html = `${ui.illustration('success')}<h1>${result.alreadyMarked ? 'You are already checked in' : 'You are checked in'}</h1><p>${esc(result.title)} · ${esc(result.course.code)} ${esc(result.course.title)}</p><p class="ui-meta">${esc(window.svuUI.dateTime(result.markedAt))}</p><a class="button button-secondary" href="#study/courses">Go to my courses</a>`;
    } catch (error) {
      html = `${ui.ico('alert', 'amber', 'ui-icon-lg')}<h1>Not checked in</h1><p>${esc(error.message)}</p><p class="ui-meta">You can also type the code on the course page.</p><a class="button button-secondary" href="#study/courses">Go to my courses</a>`;
    }
    app.querySelector('.attend-result').innerHTML = html;
  }
  window.attendanceUI = { renderCheckIn };

  const scan = () => document.querySelectorAll('[data-course-attendance]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; (host.dataset.manage ? lecturer : student)(host); });
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
