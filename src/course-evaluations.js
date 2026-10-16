(function () {
  // Anonymous course evaluations (docs/COURSE_EVALUATIONS.md). Course page: students answer while open; lecturers see
  // results once enough students have answered. Staff → Teaching: open evaluations for a semester and follow progress.
  const ui = window.svuUI, esc = ui.esc;
  async function api(method, path, body) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.svuSession.get()?.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Request failed.');
    return payload.data;
  }
  const scale = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
  const path = (host) => { const ws = host.closest('[data-course-workspace]'); return `/api/course-workspaces/${encodeURIComponent(ws.dataset.period)}/${encodeURIComponent(ws.dataset.course)}/evaluation`; };

  function bars(question) {
    const total = question.distribution.reduce((sum, value) => sum + value, 0) || 1;
    return `<div class="eval-q"><div class="eval-q-head"><span>${esc(question.text)}</span><strong>${question.average.toFixed(1)}</strong></div>
      <div class="eval-bar" role="img" aria-label="${question.distribution.map((count, index) => `${count} ${scale[index].toLowerCase()}`).join(', ')}">${question.distribution.map((count, index) => count ? `<span class="s${index + 1}" style="width:${(count / total) * 100}%"></span>` : '').join('')}</div></div>`;
  }

  async function course(host) {
    let data;
    try { data = await api('GET', path(host)); } catch { host.innerHTML = ''; return; }
    if (!data.exists) { host.innerHTML = ''; return; }
    if (host.dataset.manage) {
      host.innerHTML = `<header class="eval-head"><div><h3>Course evaluation</h3><p class="ui-meta">${data.open ? `Open until ${esc(ui.date(data.closesOn))}` : 'Closed'} · ${data.responses} of ${data.enrolled} students answered${data.responseRate !== null ? ` (${data.responseRate}%)` : ''}</p></div></header>
        ${data.visible ? `<div class="eval-results">${data.questions.map(bars).join('')}</div>
          ${data.wentWell.length || data.toChange.length ? `<div class="eval-comments"><div><h4>What worked well</h4>${data.wentWell.length ? `<ul>${data.wentWell.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : '<p class="ui-meta">No comments.</p>'}</div><div><h4>What should change</h4>${data.toChange.length ? `<ul>${data.toChange.map((text) => `<li>${esc(text)}</li>`).join('')}</ul>` : '<p class="ui-meta">No comments.</p>'}</div></div>` : ''}`
          : `<p class="ui-meta">Results appear once ${data.minimumResponses} students have answered, so no one can be identified.</p>`}`;
      return;
    }
    if (data.answered) { host.innerHTML = `<p class="eval-thanks">${ui.illustration('success', { cls: 'eval-art' })}<span><strong>Thank you.</strong> Your course evaluation is recorded anonymously.</span></p>`; return; }
    if (!data.open) { host.innerHTML = ''; return; }
    host.innerHTML = `<form class="eval-form" data-eval-form><header class="eval-head"><div><h3>Course evaluation</h3><p class="ui-meta">Anonymous, about two minutes, open until ${esc(ui.date(data.closesOn))}. Your lecturer sees results only once enough students have answered, and never who said what.</p></div></header>
      ${data.questions.map((text, index) => `<fieldset class="eval-likert"><legend>${index + 1}. ${esc(text)}</legend><div class="eval-scale">${scale.map((label, score) => `<label><input type="radio" name="q${index}" value="${score + 1}" required><span>${score + 1}</span><small>${esc(label)}</small></label>`).join('')}</div></fieldset>`).join('')}
      <label class="field"><span>What worked well? (optional)</span><textarea class="input" name="wentWell" maxlength="2000" rows="3"></textarea></label>
      <label class="field"><span>What should change? (optional)</span><textarea class="input" name="toChange" maxlength="2000" rows="3"></textarea></label>
      <p class="ui-meta">Please avoid names or details that identify you.</p><div data-eval-error></div><div><button class="button button-primary" type="submit">Submit evaluation</button></div></form>`;
    host.querySelector('[data-eval-form]').addEventListener('submit', async (event) => {
      event.preventDefault(); const form = event.currentTarget, values = new FormData(form), button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await api('POST', path(host), { ratings: [0, 1, 2, 3, 4].map((index) => Number(values.get(`q${index}`))), wentWell: values.get('wentWell'), toChange: values.get('toChange') });
        course(host);
      } catch (error) { form.querySelector('[data-eval-error]').innerHTML = ui.alert('error', 'Not submitted', error.message); button.disabled = false; }
    });
  }

  // Staff → Teaching: open evaluations for a semester, and see response rates.
  function staffPanel(root) {
    const body = root.querySelector('[data-staff-body="teaching"]');
    if (!body || body.querySelector('[data-evaluations-admin]') || !window.svuSession.can('evaluations.manage')) return;
    body.insertAdjacentHTML('beforeend', `<section class="ui-panel" data-evaluations-admin>${ui.head('Course evaluations', { desc: 'Open anonymous end-of-semester evaluations for every course in a semester. Students are notified; lecturers see results once enough have answered.' })}<div data-eval-admin-body><p class="ui-meta">Loading…</p></div></section>`);
    const host = body.querySelector('[data-eval-admin-body]');
    let periods = [], selected = '', items = null, notice = '', error = '';
    const today = new Date().toISOString().slice(0, 10), inTwoWeeks = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const paint = () => {
      const period = periods.find((row) => row.id === selected);
      host.innerHTML = `${notice ? `<div class="ui-alert ui-alert-success" role="status"><div><strong>${esc(notice)}</strong></div></div>` : ''}${error ? ui.alert('error', 'Course evaluations', error) : ''}
        <form class="eval-admin-form" data-eval-open><label class="field"><span>Semester</span><select class="input" name="periodId" data-eval-period>${periods.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row.name)} · ${row.offerings} courses${row.evaluations ? ` · ${row.evaluations} evaluations` : ''}</option>`).join('')}</select></label>
          <label class="field"><span>Opens</span><input class="input" type="date" name="opensOn" value="${today}" required></label><label class="field"><span>Closes</span><input class="input" type="date" name="closesOn" value="${inTwoWeeks}" required></label>
          <div><button class="button button-primary" type="submit" ${period?.offerings ? '' : 'disabled'}>Open evaluations</button></div></form>
        ${items?.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Course</th><th>Status</th><th>Responses</th><th>Overall</th><th></th></tr></thead><tbody>${items.map((row) => `<tr><td>${esc(row.code)} ${esc(row.title)}</td><td>${ui.status(row.open ? 'open' : 'closed')}</td><td>${row.responses} / ${row.enrolled}${row.responseRate !== null ? ` (${row.responseRate}%)` : ''}</td><td>${row.overall !== null ? row.overall.toFixed(1) : '<span class="ui-meta">Hidden until 5</span>'}</td><td>${row.open ? `<button class="button button-secondary" type="button" data-eval-close="${esc(row.id)}">Close</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : items ? '<p class="ui-meta">No evaluations for this semester yet.</p>' : ''}`;
      host.querySelector('[data-eval-period]')?.addEventListener('change', (event) => { selected = event.target.value; loadItems(); });
      host.querySelector('[data-eval-open]')?.addEventListener('submit', async (event) => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
        try { const result = await api('POST', '/api/evaluations', values); notice = `Opened ${result.opened} evaluations${result.alreadyOpen ? ` (${result.alreadyOpen} were already open)` : ''}; ${result.notified} students notified.`; error = ''; } catch (e) { error = e.message; notice = ''; }
        await loadPeriods(); loadItems();
      });
      host.querySelectorAll('[data-eval-close]').forEach((button) => button.addEventListener('click', async () => { try { await api('POST', `/api/evaluations/${button.dataset.evalClose}/close`); } catch (e) { error = e.message; } loadItems(); }));
      window.svuUI.enhance?.(host);
    };
    const loadPeriods = async () => { try { periods = (await api('GET', '/api/evaluations')).periods; selected = selected || periods.find((row) => row.offerings)?.id || periods[0]?.id || ''; } catch (e) { error = e.message; } };
    const loadItems = async () => { if (!selected) { paint(); return; } try { items = (await api('GET', `/api/evaluations?period=${encodeURIComponent(selected)}`)).items; } catch (e) { error = e.message; } paint(); };
    loadPeriods().then(loadItems);
  }

  const scan = () => {
    const app = document.querySelector('#app');
    document.querySelectorAll('[data-course-evaluation]:not([data-mounted])').forEach((host) => { host.dataset.mounted = '1'; course(host); });
    if (app) staffPanel(app);
  };
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
