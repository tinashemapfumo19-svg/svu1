(function () {
  // Self-service letters on Student Office → Documents (docs/STUDENT_LETTERS.md). Mounts into [data-student-letters].
  // A letter opens as a printable page with its verification code and a QR code to the Verify page.
  const ui = window.svuUI, esc = ui.esc;
  const token = () => window.svuSession.get()?.token;
  async function api(method, path, body) {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || 'Request failed.');
    return payload.data;
  }
  const kindIcon = { enrolment: 'cap', registration: 'book' };

  function letterPage(letter) {
    const c = letter.content;
    const courses = c.courses?.length ? `<table><thead><tr><th>Code</th><th>Course</th><th>Credits</th></tr></thead><tbody>${c.courses.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.title)}</td><td>${esc(row.credits)}</td></tr>`).join('')}</tbody><tfoot><tr><td></td><td>Total credits</td><td>${esc(c.totalCredits)}</td></tr></tfoot></table>` : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} · ${esc(c.student.studentNumber)}</title>
      <style>body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:0;background:#f1f5f9}main{max-width:720px;margin:24px auto;background:#fff;padding:48px;border-radius:12px;box-shadow:0 4px 24px rgba(15,23,42,.08)}
      header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2563eb;padding-bottom:16px;margin-bottom:28px}header strong{font-size:20px}header span{display:block;color:#64748b;font-size:13px}
      h1{font-size:22px;margin:0 0 20px}p{line-height:1.6}dl{display:grid;grid-template-columns:160px 1fr;gap:6px 16px;margin:20px 0}dt{color:#64748b}dd{margin:0}
      table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}tfoot td{font-weight:600}
      .verify{display:flex;gap:20px;align-items:center;margin-top:32px;padding:16px;border:1px solid #e2e8f0;border-radius:10px}.verify svg{width:112px;height:112px;flex:none}.code{font-family:ui-monospace,Consolas,monospace;font-size:18px;font-weight:700;letter-spacing:.05em}
      .hash{font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#64748b;word-break:break-all}.revoked{background:#fef2f2;color:#b91c1c;padding:12px;border-radius:8px;font-weight:600}
      .bar{max-width:720px;margin:16px auto 0;display:flex;justify-content:flex-end}.bar button{font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
      @media print{body{background:#fff}main{box-shadow:none;margin:0;padding:24px}.bar{display:none}}@media (max-width:600px){main{padding:24px;margin:0;border-radius:0}dl{grid-template-columns:1fr}}</style></head>
      <body><div class="bar"><button onclick="window.print()">Print or save as PDF</button></div><main>
      <header><div style="display:flex;gap:14px;align-items:center"><img src="${location.origin}/src/assets/illustrations/seal.svg" alt="" width="56" height="56"><div><strong>${esc(c.institution)}</strong><span>Office of the Registrar</span></div></div><div style="text-align:right"><span>Issued ${esc(c.asOf)}</span>${c.reference ? `<span>Registration ${esc(c.reference)}</span>` : ''}</div></header>
      ${letter.status === 'revoked' ? '<p class="revoked">This letter has been revoked and is no longer valid.</p>' : ''}
      <h1>${esc(c.title)}</h1><p>To whom it may concern,</p><p>${esc(c.statement)}</p>
      <dl><dt>Student</dt><dd>${esc(c.student.legalName)}</dd><dt>Student number</dt><dd>${esc(c.student.studentNumber)}</dd><dt>Programme</dt><dd>${esc(c.programme.name)} (${esc(c.programme.code)})</dd>${c.programme.faculty ? `<dt>Faculty</dt><dd>${esc(c.programme.faculty)}</dd>` : ''}<dt>Intake</dt><dd>${esc(c.intake)}</dd>${c.period ? `<dt>Semester</dt><dd>${esc(c.period.name)}${c.period.startsOn ? ` (${esc(c.period.startsOn)} to ${esc(c.period.endsOn)})` : ''}</dd>` : ''}</dl>
      ${courses}
      <p>This letter was generated from the university's official record on the date shown. It does not replace a transcript.</p>
      <div class="verify">${letter.qrSvg}<div><p style="margin:0 0 4px">Check this letter at <strong>${esc(letter.verifyUrl.replace(/#.*/, ''))}</strong> → Verify a document, or scan the code.</p><p class="code" style="margin:0 0 8px">${esc(letter.verificationCode)}</p><p class="hash" style="margin:0">Fingerprint ${esc(letter.contentHash)}</p></div></div>
      </main></body></html>`;
  }

  function mount(host) {
    if (host.dataset.mounted === host.dataset.programme) return;
    host.dataset.mounted = host.dataset.programme;
    const programme = host.dataset.programme;
    const state = { data: null, error: '', busy: false, notice: '' };
    const paint = () => {
      const d = state.data;
      host.innerHTML = `${ui.head('Letters', { desc: 'Issue a letter from your official record. Anyone you give it to can check it on the Verify page with its code.' })}
        ${state.notice ? `<div class="ui-alert ui-alert-success" role="status"><div><strong>${esc(state.notice)}</strong></div></div>` : ''}
        ${state.error ? ui.alert('error', 'Letters', state.error) : ''}
        ${!d ? (state.error ? '' : '<p class="ui-meta" role="status">Loading letters…</p>') : `
        <div class="letter-options">
          <article class="letter-option">${ui.ico('cap', 'blue')}<div><strong>Confirmation of enrolment</strong><span class="ui-meta">Confirms you are a current student on your programme. Often asked for by banks, embassies and employers.</span></div>
            <button class="button button-primary" type="button" data-letter-issue="enrolment" ${!d.available.enrolment || state.busy ? 'disabled' : ''}>Issue letter</button></article>
          <article class="letter-option">${ui.ico('book', 'green')}<div><strong>Proof of registration</strong><span class="ui-meta">Lists the courses you are registered for in a semester.</span>
            ${d.available.registrations.length ? `<label class="field"><span class="visually-hidden">Semester</span><select class="input" data-letter-period>${d.available.registrations.map((row) => `<option value="${esc(row.periodId)}">${esc(row.periodName)}</option>`).join('')}</select></label>` : '<span class="ui-meta">Available once a semester registration is confirmed.</span>'}</div>
            <button class="button button-primary" type="button" data-letter-issue="registration" ${!d.available.registrations.length || state.busy ? 'disabled' : ''}>Issue letter</button></article>
        </div>
        ${!d.available.enrolment ? '<p class="ui-meta">Letters are available while you are a current student. The registry can help with other letters.</p>' : ''}
        ${d.letters.length ? `<h3 class="letter-list-title">Your letters</h3><div class="ui-rows">${d.letters.map((row) => `<div class="ui-row letter-row">${ui.ico(kindIcon[row.kind] || 'file', row.status === 'revoked' ? 'red' : 'blue', 'ui-icon-sm')}<div><strong>${esc(row.title)}${row.periodName ? ` · ${esc(row.periodName)}` : ''}</strong><span class="ui-meta">${esc(ui.date(row.issuedAt))} · <span class="letter-code">${esc(row.verificationCode)}</span></span></div>${ui.status(row.status)}<button class="button button-secondary" type="button" data-letter-view="${esc(row.id)}">View</button></div>`).join('')}</div>` : ''}`}`;
      host.querySelectorAll('[data-letter-issue]').forEach((button) => button.addEventListener('click', () => issue(button.dataset.letterIssue)));
      host.querySelectorAll('[data-letter-view]').forEach((button) => button.addEventListener('click', () => view(button.dataset.letterView)));
    };
    async function load() {
      try { state.data = await api('GET', `/api/registry/me/programmes/${encodeURIComponent(programme)}/letters`); state.error = ''; } catch (error) { state.error = error.message; }
      paint();
    }
    async function issue(kind) {
      state.busy = true; state.notice = ''; paint();
      const win = window.open('', '_blank');
      try {
        const created = await api('POST', `/api/registry/me/programmes/${encodeURIComponent(programme)}/letters`, { kind, periodId: kind === 'registration' ? host.querySelector('[data-letter-period]')?.value : undefined });
        state.notice = `${created.title} issued. Verification code ${created.verificationCode}.`;
        await show(created.id, win);
        await load();
      } catch (error) { win?.close(); state.error = error.message; }
      state.busy = false; paint();
    }
    async function view(id) { const win = window.open('', '_blank'); try { await show(id, win); } catch (error) { win?.close(); state.error = error.message; paint(); } }
    // Opened synchronously on the click so pop-up blockers allow it, then filled in.
    async function show(id, win) {
      const letter = await api('GET', `/api/registry/me/letters/${encodeURIComponent(id)}`);
      const html = letterPage(letter);
      if (win) { win.document.open(); win.document.write(html); win.document.close(); }
      else { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); location.assign(url); }
    }
    paint(); load();
  }

  const scan = () => document.querySelectorAll('[data-student-letters]').forEach(mount);
  new MutationObserver(() => requestAnimationFrame(scan)).observe(document.querySelector('#app'), { childList: true, subtree: true });
})();
