(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const human = value => String(value ?? '').replaceAll('_', ' ');
  const date = value => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const money = (currency, minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  const pages = {
    study: [['today', 'Today'], ['courses', 'Courses'], ['timetable', 'Calendar'], ['results', 'Results & Progress'], ['resources', 'Resources']],
    office: [['overview', 'Overview'], ['registration', 'Registration'], ['fees', 'Fees & Payments'], ['details', 'My Details'], ['card', 'ID Card'], ['documents', 'Documents'], ['appointments', 'Appointments'], ['requests', 'Requests'], ['sharing','Record Sharing']]
  };
  let context = { programme: '', period: '' }, last = {}, generation = 0, current = null;
  let adapter = {}, drafts = new Map(), notice = null, busy = false;
  let searchData = null;
  const sharedReads = new Map(), sharedReadTTL = 15000;
  const invalidateReads = () => sharedReads.clear();
  const navigationFor = (space, page) => `<nav class="student-local-nav" aria-label="${space === 'study' ? 'Study' : 'Student Office'}">${pages[space].map(([id, label]) => `<a href="${esc(link(space, id))}" ${id === page ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
  const link = (space, page, extra = {}) => {
    const query = new URLSearchParams(Object.entries({ ...context, ...extra }).filter(([, v]) => v !== '' && v != null));
    return `#${space}/${page}${query.size ? `?${query}` : ''}`;
  };
  const spaceLink = space => link(space, last[space] || (space === 'study' ? 'today' : 'overview'));
  // SVU UI Standard components (docs/SVU_UI_STANDARD.md). Markup only; behaviour lives in load/bind below.
  const svg = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons = window.svuIcons || {
    calendar: svg('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'),
    book: svg('M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z'),
    alert: svg('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01'),
    chevron: svg('m9 18 6-6-6-6'),
    back: svg('m15 18-6-6 6-6'),
    check: svg('M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3'),
    clock: svg('M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'),
    wallet: svg('M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'),
    file: svg('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M16 13H8M16 17H8M10 9H8'),
    user: svg('M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'),
    cap: svg('M22 10 12 5 2 10l10 5 10-5ZM6 12v5c3 3 9 3 12 0v-5'),
    inbox: svg('M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z'),
    grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
    shield: svg('M12 3 4 7v5c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7ZM9 12l2 2 4-4'),
    info: svg('M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'),
    list: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
    history: svg('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2')
  };
  const icon = name => window.svuShell.glyphs[name] || icons[name] || window.svuShell.glyphs.learning;
  const ico = (name, tone = '', size = '') => `<span class="ui-icon ${size} ${tone ? `ui-icon-${tone}` : ''}">${icons[name] || icon(name)}</span>`;
  const chevron = `<span class="ui-chevron">${icons.chevron}</span>`;
  const badge = (text, tone = '') => `<span class="ui-badge ${tone ? `ui-badge-${tone}` : ''}">${esc(text)}</span>`;
  const statusTone = { onboarded: 'green', active: 'green', confirmed: 'green', approved: 'green', completed: 'green', resolved: 'green', issued: 'green', open: 'blue', in_progress: 'blue', scheduled: 'blue', draft: 'blue', requested: 'amber', waiting_student: 'amber', waiting_applicant: 'amber', returned: 'amber', pending_onboarding: 'amber', blocked: 'red', rejected: 'red', revoked: 'red', suspended: 'red', withdrawn: '', closed: '', cancelled: '', superseded: '' };
  const statusLabel = { onboarded: 'Active student', pending_onboarding: 'Onboarding', waiting_student: 'Waiting for you', waiting_applicant: 'Waiting for you', in_progress: 'In progress' };
  const status = value => badge(statusLabel[value] || human(value).replace(/^\w/, c => c.toUpperCase()), statusTone[value] ?? '');
  const action = (href, text, primary = false) => `<a class="button ${primary ? 'button-primary' : 'button-secondary'}" href="${esc(href)}">${esc(text)}</a>`;
  const head = (title, href, label = 'View all', desc = '') => `<header class="ui-section-head student-section-head"><div><h2 class="ui-section-title">${esc(title)}</h2>${desc ? `<p class="ui-meta">${esc(desc)}</p>` : ''}</div>${href ? `<a class="ui-link student-text-link" href="${esc(href)}">${esc(label)}</a>` : ''}</header>`;
  const section = (title, body, href, label = 'View all', opts = {}) => `<section class="student-section ui-section ${opts.cls || ''}">${head(title, href, label, opts.desc)}${body}</section>`;
  const emptyState = ({ glyph = 'info', title = '', text = '', act = '', compact = false }) => `<div class="student-empty ui-empty ${compact ? 'ui-empty-compact' : ''}">${ico(glyph, 'blue', 'ui-icon-lg')}${title ? `<p class="ui-card-title">${esc(title)}</p>` : ''}${text ? `<p class="ui-meta">${esc(text)}</p>` : ''}${act}</div>`;
  const empty = text => emptyState({ text, compact: true });
  const row = ({ href, glyph, tone = '', title, meta = '', lead = '', trail = '', cls = '' }) => `<${href ? `a href="${esc(href)}"` : 'div'} class="ui-row ${cls}">${lead || (glyph ? ico(glyph, tone, 'ui-icon-sm') : '')}<div><strong>${esc(title)}</strong>${meta ? `<span class="ui-meta">${meta}</span>` : ''}</div>${trail}${href ? chevron : ''}</${href ? 'a' : 'div'}>`;
  const tints = ['', 'tint-green', 'tint-lavender'];
  const tintFor = key => tints[[...String(key)].reduce((sum, c) => sum + c.charCodeAt(0), 0) % tints.length];
  const pageInfo = {
    'study/courses': 'Courses you are enrolled in, grouped by semester.',
    'study/timetable': 'Deadlines, classes, examinations and fees, with your published examination timetable.',
    'study/results': 'Published marks, GPA, academic decisions and completion progress.',
    'study/resources': 'Search the university repository and library catalogue.',
    'office/overview': 'Registration, account, requests and documents at a glance.',
    'office/fees': 'Your statement, balances, holds and payment plans.',
    'office/details': 'Contact details, next of kin, identity and programme record.',
    'office/appointments': 'Book time with a lecturer, adviser, or the finance, support or registry desks.',
    'office/card': 'Your digital student ID. Its QR code proves you are a current student.',
    'office/documents': 'Letters you can issue yourself, and official transcripts and certificates from the registry.',
    'office/requests': 'Track support cases and requests across the university.'
  };
  const focusPeriod = data => {
    const entries = (data.registrations || []).filter(row => !context.period || row.period.id === context.period);
    return entries.find(row => row.period.status === 'open' && row.registration?.status !== 'confirmed') || entries[entries.length - 1];
  };
  function pageDescription(space, page, data) {
    const focus = page === 'registration' && data.programme ? focusPeriod(data) : null;
    const text = page === 'registration' ? `Choose and confirm your courses${focus ? ` for ${focus.period.name}` : ''}.` : pageInfo[`${space}/${page}`];
    return text ? `<p class="ui-meta ui-page-description">${esc(text)}</p>` : '';
  }
  function pageStatus(space, page, data) {
    if (page !== 'registration' || !data.programme) return '';
    const focus = focusPeriod(data);
    if (!focus) return '';
    if (focus.registration?.status === 'confirmed') return status('confirmed');
    if (focus.period.status !== 'open') return badge(`Registration ${human(focus.period.status)}`);
    return focus.registration?.revision && !focus.eligibility.ready ? badge('Blocked', 'red') : badge('Open', 'blue');
  }
  const selectedRegs = data => (data.registrations || []).filter(row => !context.period || row.period.id === context.period);
  const exams = data => (data.exams || []).filter(row => !context.period || row.periodId === context.period);
  const results = data => (data.results || []).filter(batch => !context.period || batch.results.some(row => (data.registrations || []).some(entry => entry.period.id === context.period && entry.registration?.id === row.registrationId)));
  // Fee due dates as a timeline: paid, due and overdue charges in date order, with today marked between them.
  function feeTimeline(account) {
    const today = new Date().toISOString().slice(0, 10);
    const charges = (account.entries || []).filter(row => row.entryType === 'charge' && row.dueOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    if (!charges.length) return '';
    const state = row => row.outstanding <= 0 ? 'paid' : row.dueOn < today ? 'overdue' : 'due';
    const label = { paid: 'Paid', overdue: 'Overdue', due: 'Due' };
    const items = charges.map(row => ({ date: row.dueOn, html: `<li class="fee-step is-${state(row)}" data-fee-step="${esc(row.id)}"><span class="fee-dot" aria-hidden="true"></span><span class="fee-date">${esc(window.svuUI.date(row.dueOn))}</span><strong>${esc(row.description)}</strong><span class="ui-meta">${esc(money(row.currency, row.outstanding > 0 ? row.outstanding : row.amountMinor))} · ${label[state(row)]}</span></li>` }));
    const at = items.findIndex(item => item.date > today);
    items.splice(at < 0 ? items.length : at, 0, { html: '<li class="fee-step is-today"><span class="fee-dot" aria-hidden="true"></span><span class="fee-date">Today</span></li>' });
    return section('Payment timeline', `<ol class="fee-timeline" data-fee-timeline>${items.map(item => item.html).join('')}</ol>`, '', '', { desc: 'When each charge falls due and whether it has been paid.' });
  }
  function paymentPlans(account) {
    if (!account.plans?.length) return '';
    const standing = { current: ['Up to date', 'green'], in_arrears: ['In arrears', 'red'], completed: ['Completed', ''] };
    return section('Payment plans', `<div class="ui-stack">${account.plans.map(plan => {
      const [label, tone] = standing[plan.standing?.status] || [human(plan.standing?.status), ''];
      return `<div class="ui-plan"><div class="ui-section-head"><p class="ui-card-title">${esc(money(plan.currency, plan.coveredAmount || 0))} plan</p>${badge(label, tone)}</div>
        <dl class="ui-facts ui-facts-3"><div><dt>Paid</dt><dd>${esc(money(plan.currency, plan.standing?.paid || 0))}</dd></div><div><dt>Arrears</dt><dd>${esc(money(plan.currency, plan.standing?.arrears || 0))}</dd></div>${plan.standing?.nextInstalment ? `<div><dt>Next instalment</dt><dd>${esc(money(plan.currency, plan.standing.nextInstalment.amountMinor))} · ${esc(date(plan.standing.nextInstalment.dueOn))}</dd></div>` : ''}</dl>
        <ul class="ui-rows">${(plan.instalments || []).map(item => `<li class="ui-row"><div><strong>${esc(date(item.dueOn))}</strong></div><span class="ui-num">${esc(money(plan.currency, item.amountMinor))}</span></li>`).join('')}</ul></div>`;
    }).join('')}</div>`, '', '', { desc: 'Approved instalment plans and how they stand.' });
  }

  async function api(method, path, body) {
    const token = window.svuSession.get()?.token, epoch = generation;
    const write = method !== 'GET';
    const shared = !write && (path === '/api/registry/me' || /^\/api\/registry\/me\/programmes\/[^/]+\/registrations$/.test(path) || path === '/api/master-data/reference-lists/country' || path === '/api/admissions/catalogue');
    if (write) invalidateReads();
    const request = async () => {
      const response = await fetch(path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (token !== window.svuSession.get()?.token) throw new Error('The student context changed.');
      if (response.status === 401) { window.svuSession.clear(); location.hash = '#signin'; }
      if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
      return payload.data;
    };
    let entry = shared && sharedReads.get(path);
    if (shared && (!entry || entry.token !== token || entry.expires <= Date.now())) {
      entry = { token, expires: Infinity };
      entry.promise = request().then(data => { entry.expires = Date.now() + sharedReadTTL; return data; }).catch(error => {
        if (sharedReads.get(path) === entry) sharedReads.delete(path);
        throw error;
      });
      sharedReads.set(path, entry);
    }
    try {
      const data = await (shared ? entry.promise : request());
      if (token !== window.svuSession.get()?.token || epoch !== generation) throw new Error('The student context changed.');
      // Adapters may edit their copy; never expose the cached record itself.
      return shared ? structuredClone(data) : data;
    } finally { if (write) invalidateReads(); }
  }

  async function load(space, page) {
    const epoch = generation;
    const student = await api('GET', '/api/registry/me');
    const programmes = student.programmes || [];
    const requested = new URLSearchParams(location.hash.split('?')[1] || '');
    const wanted = requested.get('programme') || context.programme;
    const programme = programmes.find(row => row.id === wanted) || programmes.find(row => ['onboarded', 'active'].includes(row.status)) || programmes[0];
    if (requested.has('programme') && !programmes.some(row => row.id === requested.get('programme'))) throw new Error('This programme is not available to your account.');
    if (programme?.id !== context.programme) { adapter = {}; context.period = ''; }
    context.programme = programme?.id || '';
    const data = { student, programme, errors: [] };
    if (!programme) return data;
    const base = `/api/registry/me/programmes/${encodeURIComponent(programme.id)}`;
    const read = async (key, path) => { try { data[key] = await api('GET', path); } catch (error) { data.errors.push({ key, text: error.message }); } };
    await read('registrations', `${base}/registrations`);
    if (epoch !== generation) throw new Error('The student context changed.');
    const period = requested.has('period') ? requested.get('period') : context.period;
    if (period && !(data.registrations || []).some(row => row.period.id === period)) {
      if (requested.has('period') && data.registrations) throw new Error('This semester is not available for the selected programme.');
      context.period = '';
    } else context.period = period || '';
    const resources = {
      'study/today': ['account', 'exams', 'results', 'award'],
      'study/courses': ['withdrawals', 'results', 'exams'],
      'study/timetable': ['exams'],
      'study/results': ['results', 'academic', 'credits', 'award'],
      'office/overview': ['account', 'transcripts', 'withdrawals'],
      'office/registration': ['credits', 'withdrawals'],
      'office/fees': ['account'],
      'office/details': ['lifecycle', 'transfers'],
      'office/documents': ['transcripts'],
      'office/requests': ['withdrawals', 'transfers', 'exams']
    }[`${space}/${page}`] || [];
    const tasks = resources.map(resource => read(resource, `${base}/${resource}`));
    if(space==='office' && page==='sharing')tasks.push(read('sharing',`/api/registry/me/sharing/${encodeURIComponent(programme.id)}?offset=${adapter.sharingOffset || 0}`));
    if (space === 'study' && page === 'courses') tasks.push(read('courseSummaries',`/api/course-workspaces/summaries?programme=${encodeURIComponent(programme.id)}`));
    if (space === 'study' && page === 'today') tasks.push(read('messages', '/api/notifications/me?limit=4'));
    if (space === 'study' && ['today', 'courses'].includes(page)) tasks.push(read('calendar', '/api/calendar/me'));
    if (space === 'office' && ['details', 'requests'].includes(page)) tasks.push(read('identity', '/api/registry/me/identity'));
    if (space === 'office' && page === 'details') {
      tasks.push(read('restricted',`/api/registry/me/restricted/${encodeURIComponent(programme.id)}`));
      tasks.push(read('countries', '/api/master-data/reference-lists/country').then(() => {
        data.countries = data.countries?.values || (student.profile.address.countryCode ? [{ valueCode: student.profile.address.countryCode, label: student.profile.address.countryCode, status: 'active' }] : []);
      }));
    }
    let supportTask, arrangementsTask;
    if (space === 'office' && ['requests', 'overview'].includes(page) || space === 'study' && page === 'today') {
      supportTask = window.supportCasesUI.loadStudent(adapter, api, programme.id, () => window.svuSession.get()?.token).then(() => {
        data.support = adapter.supportStudentList;
        if (adapter.supportStudentError) data.errors.push({ key: 'support', text: adapter.supportStudentError });
      });
      arrangementsTask = window.registryExamArrangementsUI.loadStudent(adapter, api, programme.id).catch(error => {
        data.errors.push({ key: 'arrangements', text: error.message });
      });
      tasks.push(supportTask, arrangementsTask);
    }
    if (space === 'office' && page === 'requests') {
      tasks.push(api('GET', '/api/admissions/catalogue').then(value => { if (epoch === generation) adapter.catalogue = value; }).catch(() => { if (epoch === generation) adapter.catalogue = []; }));
      if (requested.has('enquiry')) adapter.enquiryOwnSelectedId = requested.get('enquiry');
      if (window.svuSession.can('admissions.apply')) tasks.push(window.prospectiveEnquiriesUI.loadOwn(adapter, api, () => window.svuSession.get()?.token));
      const sitting = requested.get('sitting');
      if (sitting) {
        tasks.push(arrangementsTask.then(async () => {
          if (epoch !== generation) return;
          try { adapter.studentArrangement = await api('GET', `/api/exams/me/sittings/${encodeURIComponent(sitting)}/arrangements`); }
          catch (error) { if (epoch === generation) adapter.studentArrangement = null; data.errors.push({ key: 'arrangement detail', text: error.message }); }
        }));
      }
      const support = requested.get('support');
      if (support) {
        tasks.push(supportTask.then(async () => {
          if (epoch !== generation) return;
          try { adapter.supportStudentDetail = await api('GET', `/api/support/me/cases/${encodeURIComponent(support)}`); }
          catch (error) { if (epoch === generation) adapter.supportStudentDetail = null; data.errors.push({ key: 'support detail', text: error.message }); }
        }));
      }
    }
    await Promise.all(tasks);
    return data;
  }

  function courses(data, limit) {
    const withdrawn = new Set((data.withdrawals?.requests || []).filter(row => row.status === 'approved').map(row => `${row.periodId}|${row.courseId}`));
    let registrations = selectedRegs(data);
    if (limit && !context.period) {
      const relevant = [...(data.programme.studyYear?.currentPeriods || []), ...(data.programme.studyYear?.upcoming || [])].map(row => row.periodId);
      if (relevant.length && registrations.some(row => relevant.includes(row.period.id))) registrations = registrations.filter(row => relevant.includes(row.period.id));
    }
    const completed = new Set((data.results || []).flatMap(batch => batch.results.map(row => `${row.registrationId}|${row.courseId}`)));
    const rows = registrations.filter(row => row.registration?.status === 'confirmed').slice().reverse().flatMap(row => row.registration.confirmation.courses.map(course => ({ ...row.offerings?.find(offering => offering.courseId === course.courseId), ...course, period: row.period, registrationId: row.registration.id })));
    const card = course => {
      const state = withdrawn.has(`${course.period.id}|${course.courseId}`) ? ['Withdrawn', ''] : completed.has(`${course.registrationId}|${course.courseId}`) ? ['Completed', 'green'] : ['Registered', 'blue'];
      const next = exams(data).filter(entry => entry.periodId === course.period.id).flatMap(entry => entry.sittings || []).filter(event => (event.courseId === course.courseId || event.code === course.code) && Date.parse(event.startsAt) > Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
      return `<a class="student-course ui-course ${tintFor(course.courseId)}" href="${esc(link('study', `courses/${encodeURIComponent(course.period.id)}/${encodeURIComponent(course.courseId)}`))}">
        <div class="ui-course-top"><span class="ui-course-code">${esc(course.code)}</span>${badge(state[0], state[1])}</div>
        <h3 class="ui-card-title">${esc(course.title)}</h3><p class="ui-meta">${esc(course.period.name)}</p>
        ${next ? `<p class="ui-course-event">${ico('calendar', 'lavender', 'ui-icon-sm')}<span>Exam ${esc(date(next.startsAt))}</span></p>` : ''}
        ${(() => { const due = (data.calendar?.events || []).find(event => event.type === 'assignment' && ['due', 'due_soon', 'overdue'].includes(event.status) && event.href === `#study/courses/${encodeURIComponent(course.period.id)}/${encodeURIComponent(course.courseId)}`); return due ? `<p class="ui-course-event ui-countdown is-${esc(due.status)}">${ico('clock', due.status === 'due' ? 'blue' : due.status === 'overdue' ? 'red' : 'amber', 'ui-icon-sm')}<span>${esc(due.title)} ${due.status === 'overdue' ? 'overdue' : 'due ' + esc(window.svuCalendar.countdown(due.start))}</span></p>` : ''; })()}
        <div class="ui-course-foot"><span class="ui-meta ui-num">${course.credits} credits${course.requirementType ? ` / ${esc(human(course.requirementType))}` : ''}</span><span class="ui-link">View course ${icons.chevron}</span></div></a>`;
    };
    if (!rows.length) return '';
    if (limit) return `<div class="student-course-grid ui-course-grid">${rows.slice(0, limit).map(card).join('')}</div>`;
    const groups = [];
    for (const course of rows) { const group = groups.find(entry => entry.period.id === course.period.id); if (group) group.rows.push(course); else groups.push({ period: course.period, rows: [course] }); }
    const expandable = course => {
      if (withdrawn.has(`${course.period.id}|${course.courseId}`)) return row({ title: `${course.code} / ${course.title}`, meta: 'Withdrawn', glyph: 'book' });
      const summary = data.courseSummaries?.find(item=>item.periodId===course.period.id && item.courseId===course.courseId);
      return window.courseWorkspaceUI.accordion(course,course.period.id,`${course.credits} credits`,false,summary);
    };
    return groups.map(group => section(group.period.name, `<div class="student-course-accordion">${group.rows.map(expandable).join('')}</div>`, '', '', { desc: `${group.rows.length} ${group.rows.length === 1 ? 'course' : 'courses'} / ${group.rows.reduce((sum, row) => sum + Number(row.credits || 0), 0)} credits` })).join('');
  }

  function attention(data) {
    const items = [];
    if (data.student.readiness?.complete === false || data.programme.status === 'pending_onboarding') items.push({ tone: 'warning', glyph: 'user', title: 'Complete your student details', text: 'Contact and next-of-kin information needs attention.', href: link('office', 'details'), label: 'Update details' });
    if (data.account?.hold?.held) items.push({ tone: 'blocked', glyph: 'wallet', title: 'Financial clearance needs attention', text: data.account.hold.reasons.map(row => row.message).join(' '), href: link('office', 'fees'), label: 'View account' });
    else for (const row of data.account?.currencies || []) if (row.due > 0) items.push({ tone: 'warning', glyph: 'wallet', title: 'Payment is due', text: `${money(row.currency, row.due)} due now`, href: link('office', 'fees'), label: 'View account' });
    for (const plan of data.account?.plans || []) if (plan.standing?.status === 'in_arrears') items.push({ tone: 'blocked', glyph: 'wallet', title: 'Payment plan needs attention', text: `${money(plan.currency, plan.standing.arrears)} in arrears`, href: link('office', 'fees'), label: 'View plan' });
    if (data.programme.status === 'onboarded') for (const row of selectedRegs(data)) {
      if (row.period.status !== 'open' || row.registration?.status === 'confirmed') continue;
      const saved = row.registration.revision > 0, ready = row.eligibility.ready;
      items.push({ tone: saved && !ready ? 'blocked' : saved && ready ? 'success' : 'info', glyph: saved && !ready ? 'alert' : saved && ready ? 'check' : 'book', title: !saved ? 'Choose your courses' : ready ? 'You can now confirm your registration' : 'Registration is blocked', text: `${row.period.name} · ${row.registration.selectedCourses?.length || 0} selected${saved && !ready ? ` · ${row.eligibility.blockers.length} ${row.eligibility.blockers.length === 1 ? 'requirement needs' : 'requirements need'} attention` : ''}`, href: link('office', 'registration', { period: row.period.id }), label: saved && !ready ? 'View requirements' : saved && ready ? 'Confirm registration' : 'Continue registration' });
    }
    for (const event of data.calendar?.events || []) if (event.type === 'assignment' && event.status === 'due_soon') items.push({ tone: 'warning', glyph: 'clock', title: `${event.title} is due ${window.svuCalendar.countdown(event.start)}`, text: `${event.subtitle}. You have not submitted it yet.`, href: event.href, label: 'Open course' });
    for (const row of data.support?.items || []) if (row.status === 'waiting_student') items.push({ tone: 'warning', glyph: 'inbox', title: 'Support needs your reply', text: row.subject, href: link('office', 'requests', { support: row.id }), label: 'Reply' });
    for (const row of adapter.studentArrangementHistory?.items || []) if (row.status === 'returned') items.push({ tone: 'warning', glyph: 'calendar', title: 'Examination arrangement returned', text: row.code, href: link('office', 'requests', { sitting: row.sittingId }), label: 'View request' });
    const tone = { blocked: ['is-blocked', 'red'], warning: ['', 'amber'], info: ['is-info', 'blue'], success: ['is-success', 'green'] };
    return items.length ? `<div class="student-attention ui-attention-list" aria-label="Your attention">${items.map((item, index) => `<div class="student-attention-item ui-attention ${tone[item.tone][0]}">${ico(item.glyph, tone[item.tone][1], 'ui-icon-lg')}<div><p class="ui-eyebrow">Your attention</p><h2 class="ui-card-title">${esc(item.title)}</h2><p class="ui-meta">${esc(item.text)}</p></div>${action(item.href, item.label, !index)}</div>`).join('')}</div>` : '';
  }

  function requestState(row) {
    const map = {
      support: { open: ['open', 'in_progress'], awaiting: ['waiting_student'], completed: ['resolved', 'closed'], actor: 'Support team' },
      identity: { open: ['requested'], awaiting: [], completed: ['approved', 'rejected'], actor: 'Registry' },
      withdrawal: { open: ['requested'], awaiting: [], completed: ['approved', 'rejected', 'cancelled'], actor: 'Registry' },
      arrangement: { open: ['requested'], awaiting: ['returned'], completed: ['approved', 'withdrawn', 'revoked'], actor: 'Examinations office' },
      transfer: { open: ['requested'], awaiting: [], completed: ['approved', 'rejected'], actor: 'Registry' },
      enquiry: { open: ['open', 'in_progress'], awaiting: ['waiting_applicant'], completed: ['resolved', 'withdrawn'], actor: 'Admissions' }
    }[row.destination];
    if (map.awaiting.includes(row.status)) return { group: 'awaiting', actor: 'You' };
    if (map.completed.includes(row.status)) return { group: 'completed', actor: 'Complete' };
    return { group: 'open', actor: map.open.includes(row.status) ? map.actor : 'Not stated' };
  }

  function today(data) {
    const upcoming = exams(data).flatMap(row => row.sittings || []).filter(row => Date.parse(row.startsAt) > Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const next = upcoming[0], me = window.svuSession.cached();
    const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const updates = data.messages?.items || [];
    const when = value => `${date(value)} · ${new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const nextExam = next ? `<div class="student-next ui-next">${ico('calendar', 'lavender', 'ui-icon-lg')}<div><p class="ui-eyebrow">${esc(when(next.startsAt))}</p><h3 class="ui-card-title">${esc(next.code)} · ${esc(next.paper)}</h3><p class="ui-meta">${esc(next.venue)}${next.seat ? ` · Seat ${esc(next.seat)}` : ''}</p></div>${action(link('study', 'timetable'), 'View timetable')}</div>`
      : emptyState({ glyph: 'calendar', title: 'No upcoming examinations', text: 'You have no published exam sittings in this semester.', act: action(link('study', 'timetable'), 'View timetable'), compact: true });
    const audit = data.award?.audit, done = audit ? audit.courses.filter(row => row.satisfied).length : 0, total = audit ? audit.courses.length : 0;
    const progress = audit && total ? `<p class="ui-progress-number">${audit.creditsEarned}<span> credits earned</span></p><p class="ui-meta">${done} / ${total} curriculum courses satisfied</p><div class="ui-bar" role="img" aria-label="${done} of ${total} curriculum courses satisfied"><span class="is-done" style="width:${Math.round(done / total * 100)}%"></span></div>
        <ul class="ui-legend"><li><i class="is-done"></i>Completed ${done}</li><li><i></i>Remaining ${total - done}</li></ul><a class="ui-link student-text-link" href="${esc(link('study', 'results'))}">View progress ${icons.chevron}</a>`
      : `<p class="ui-meta">Progress appears here once completion requirements are published for your programme.</p><a class="ui-link student-text-link" href="${esc(link('study', 'results'))}">View results ${icons.chevron}</a>`;
    const quick = [['registration', 'Course registration', 'book'], ['fees', 'Account statement', 'wallet'], ['requests', 'Student requests', 'grid'], ['documents', 'Official documents', 'shield']];
    const day = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const facts = [['Student number', data.student.studentNumber], ...(data.programme.studyYear?.yearOfStudy ? [['Study year', `Year ${data.programme.studyYear.yearOfStudy}`]] : []), ['Intake', data.programme.intakeLabel], ['Status', status(data.programme.status)], ...(data.programme.versionLabel ? [['Curriculum version', data.programme.versionLabel]] : [])];
    const notifications = { results: ['cap', 'green'], exams: ['calendar', 'lavender'], finance: ['wallet', 'green'], support: ['inbox', 'amber'], registration: ['book', 'blue'] };
    return `<div class="student-today-grid"><div class="student-main-column">
      <header class="student-greeting"><div class="student-greeting-content"><p class="ui-eyebrow">Your academic day</p><h1 class="ui-display">${greeting}, ${esc(window.svuShell.displayName(me))}.</h1><p class="ui-body">${esc(data.programme.programmeName)}</p><p class="ui-meta">${data.programme.studyYear?.yearOfStudy ? `Year ${data.programme.studyYear.yearOfStudy} / ` : ''}${esc(data.programme.intakeLabel)} / ${esc(statusLabel[data.programme.status] || human(data.programme.status))}</p></div><time class="student-date-widget" datetime="${new Date().toISOString().slice(0, 10)}">${ico('calendar', 'blue', 'ui-icon-sm')}<span>${esc(day)}</span></time></header>
      ${attention(data)}
      <section class="student-section ui-section student-week-section" data-calendar-week></section>
      <div class="student-events-grid">${section('Next examination', nextExam, link('study', 'timetable'), 'Timetable', { cls: 'student-next-section' })}
      ${section('Upcoming', upcoming.length ? `<div class="ui-rows">${upcoming.slice(0, 3).map(item => row({ href: link('study', 'timetable'), glyph: 'calendar', tone: 'lavender', title: `${item.code} · ${item.paper}`, meta: `${esc(date(item.startsAt))} · ${esc(item.venue)}`, trail: badge(date(item.startsAt), 'blue'), cls: 'student-update' })).join('')}</div>` : emptyState({ glyph: 'clock', text: 'No upcoming academic events available.', compact: true }))}</div>
      ${section('My courses', courses(data, 4) || emptyState({ glyph: 'book', title: 'No current courses', text: 'Courses appear here after your registration is confirmed.', act: action(link('office', 'registration'), 'Go to registration'), compact: true }), link('study', 'courses'), 'View all', { cls: 'student-courses-section' })}
      ${section('Recent updates', updates.length ? `<div class="ui-rows">${updates.slice(0, 4).map(item => { const [glyph, tone] = notifications[String(item.templateCode || item.code || '').split('.')[0]] || ['inbox', 'blue']; return row({ href: window.svuUI.inAppLink(item.link), glyph, tone, title: item.subject, meta: esc(date(item.createdAt)), trail: item.readAt ? '' : '<span class="ui-dot is-unread" aria-label="Unread"></span>', cls: 'student-update' }); }).join('')}</div>` : emptyState({ glyph: 'inbox', text: 'No recent updates.', compact: true }), '#messages', 'Open inbox', { cls: 'student-recent-section' })}
      </div><aside class="student-side-column ui-rail">
      ${section('Your programme', `<div class="ui-programme"><p class="ui-eyebrow">${esc(data.programme.programmeCode || '')}</p><p class="ui-card-title">${esc(data.programme.programmeName)}</p></div><dl class="ui-facts student-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${label === 'Status' ? value : esc(value)}</dd></div>`).join('')}</dl>`, '', '', { cls: 'student-programme-section' })}
      ${section('Degree progress', progress, '', '', { cls: 'student-progress-section' })}
      ${section('Quick actions', `<div class="ui-rows student-quick-links">${quick.map(([page, label, glyph]) => row({ href: link('office', page), glyph, tone: 'blue', title: label })).join('')}</div>`, '', '', { cls: 'student-quick-section' })}
      </aside></div>`;
  }

  function requestQueue(data) {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    const filter = params.get('filter') || 'all';
    const all = [
      ...(data.identity?.requests || []).map(row => ({ ...row, type: 'Identity correction', destination: 'identity' })),
      ...(data.withdrawals?.requests || []).map(row => ({ ...row, type: `Course withdrawal / ${row.code}`, destination: 'withdrawal' })),
      ...(data.transfers?.requests || []).map(row => ({ ...row, type: 'Programme transfer', destination: 'transfer' })),
      ...(data.support?.items || []).map(row => ({ ...row, type: 'Support case', destination: 'support' })),
      ...(adapter.studentArrangementHistory?.items || []).map(row => ({ ...row, type: `Exam arrangement / ${row.code}`, destination: 'arrangement' })),
      ...(adapter.enquiryOwnList?.items || []).map(row => ({ ...row, type: 'Admissions enquiry', destination: 'enquiry' }))
    ];
    const rows = all.filter(row => filter === 'all' || requestState(row).group === filter);
    const count = value => value === 'all' ? all.length : all.filter(row => requestState(row).group === value).length;
    const destination = row => row.destination === 'identity' ? link('office', 'details', { type: 'identity', id: row.id }) : row.destination === 'withdrawal' ? link('office', 'registration', { type: 'withdrawal', id: row.id, period: row.periodId }) : link('office', 'requests', { type: row.destination, id: row.id, support: row.destination === 'support' ? row.id : '', enquiry: row.destination === 'enquiry' ? row.id : '', sitting: row.destination === 'arrangement' ? row.sittingId : '' });
    const glyphs = { identity: 'user', withdrawal: 'book', transfer: 'cap', support: 'inbox', arrangement: 'calendar', enquiry: 'info' };
    const tabs = `<nav class="student-filter-links ui-segmented" aria-label="Filter requests">${[['all', 'All'], ['open', 'Open'], ['awaiting', 'Awaiting you'], ['completed', 'Completed']].map(([value, label]) => `<a ${filter === value ? 'aria-current="page"' : ''} href="${esc(link('office', 'requests', { filter: value }))}">${label}<span class="ui-count" aria-hidden="true">${count(value)}</span></a>`).join('')}</nav>`;
    const list = rows.length ? `<div class="ui-rows">${rows.map(row => {
      const state = requestState(row), when = row.updatedAt || row.reviewedAt || row.requestedAt || row.createdAt;
      return `<a class="student-update ui-row" href="${esc(destination(row))}">${ico(glyphs[row.destination], state.group === 'awaiting' ? 'amber' : 'blue', 'ui-icon-sm')}<div><strong>${esc(row.subject || row.type)}</strong><span class="ui-meta">${esc(row.type)} / ${esc(human(row.status))}${when ? ` / ${esc(date(when))}` : ''}</span><span class="ui-meta">Next: ${esc(state.actor)}</span></div>${status(row.status)}${chevron}</a>`;
    }).join('')}</div>` : emptyState({ glyph: 'list', text: 'No requests match this view.', compact: true });
    return `${section('Your requests', `${tabs}${list}`, '', '', { desc: 'Each request keeps its own form and history below.' })}
      <div class="ui-card ui-adapter">${window.supportCasesUI.studentView(adapter)}</div>
      ${section('Examination arrangements', `${window.registryExamArrangementsUI.studentView(adapter) || ''}<div class="ui-actions">${action(link('study', 'timetable'), 'Examination timetable')}</div>`, '', '', { desc: 'Start an arrangement request from a published examination sitting.' })}
      ${data.transfers?.requests?.length ? section('Programme transfers', `<ul class="ui-rows">${data.transfers.requests.map(row => `<li class="ui-row">${ico('cap', 'blue', 'ui-icon-sm')}<div><strong>${esc(row.programmeCode)} · ${esc(row.intakeLabel)}</strong><span class="ui-meta">${esc(row.reviewReason || row.reason)}</span></div>${status(row.status)}</li>`).join('')}</ul>`) : ''}
      ${window.svuSession.can('admissions.apply') ? `<div class="ui-card ui-adapter">${window.prospectiveEnquiriesUI.ownView(adapter)}</div>` : window.prospectiveEnquiriesUI.ownView(adapter)}`;
  }

  // Office / Registration: selection rows, requirement rows and a summary card. Same form contract as before:
  // form[data-form="course-selection"] + hidden revision + courseIds, [data-confirm-registration], server checks authoritative.
  const requirementTitles = { FINANCIAL_HOLD: 'Financial clearance required', REPEAT_EVIDENCE: 'Repeat approval required', PREREQUISITE_EVIDENCE: 'Prerequisite not met', CREDIT_LIMIT: 'Credit limit exceeded', CORE_COURSE: 'Core course not selected', COURSE_SELECTION: 'Course selection needed', COURSE_STATUS: 'Course not available', ALREADY_ENROLLED: 'Already enrolled', RECOGNISED_COURSE: 'Already recognised', PROGRESSION_APPROVAL: 'Progression approval required', CURRICULUM_VERSION: 'Curriculum version mismatch', TRANSFER_CHRONOLOGY: 'Transfer timing conflict' };
  function requirementAction(code) {
    if (code === 'FINANCIAL_HOLD') return `<a class="ui-link" href="${esc(link('office', 'fees'))}">View account ${icons.chevron}</a>`;
    if (['REPEAT_EVIDENCE', 'PROGRESSION_APPROVAL', 'PREREQUISITE_EVIDENCE'].includes(code)) return `<a class="ui-link" href="${esc(link('study', 'results'))}">View academic decisions ${icons.chevron}</a>`;
    return '';
  }
  function registrationView(data) {
    const programme = data.programme, recognized = (data.credits?.recognitions || []).filter(row => row.status === 'approved').map(row => row.courseId);
    const entries = selectedRegs(data);
    if (!entries.length) return emptyState({ glyph: 'book', title: 'No registration periods yet', text: 'Registration periods for your programme appear here when the registry opens them.' });
    return `<div class="course-registration ui-stack">${entries.map(entry => {
      const { period, registration, offerings, eligibility } = entry;
      const confirmed = registration.status === 'confirmed';
      const editable = registration.status === 'draft' && period.status === 'open' && programme.status === 'onboarded';
      const canConfirm = !confirmed && eligibility.ready && registration.revision > 0;
      const state = confirmed ? status('confirmed') : period.status === 'open' ? (registration.revision && !eligibility.ready ? badge('Blocked', 'red') : badge(registration.revision ? 'Draft saved' : 'Open', 'blue')) : badge(`Registration ${human(period.status)}`);
      const facts = `<dl class="ui-facts ui-facts-4"><div><dt>Semester</dt><dd>${esc(period.name)}</dd></div><div><dt>Year</dt><dd>Year ${period.yearOfStudy} · ${esc(period.term)}</dd></div><div><dt>Selected credits</dt><dd class="ui-num">${confirmed ? registration.confirmation.credits : eligibility.credits}</dd></div><div><dt>Maximum credits</dt><dd class="ui-num">${period.creditLimit}</dd></div></dl>`;
      const header = `<section class="ui-card registration-period" data-registration-period-view="${esc(period.id)}"><div class="ui-section-head"><div><p class="ui-eyebrow">Registration</p><h2 class="ui-section-title">${esc(period.name)}</h2></div>${state}</div>${facts}</section>`;
      if (confirmed) {
        const receipt = registration.confirmation;
        return `${header}${section('Confirmed courses', `<dl class="ui-facts ui-facts-3"><div><dt>Reference</dt><dd>${esc(registration.referenceNumber)}</dd></div><div><dt>Credits</dt><dd class="ui-num">${receipt.credits}</dd></div><div><dt>Confirmed</dt><dd>${esc(date(receipt.confirmedAt))}</dd></div></dl>
          <ul class="ui-rows">${receipt.courses.map(course => `<li class="ui-row">${ico('book', 'blue', 'ui-icon-sm')}<div><strong>${esc(course.code)} · ${esc(course.title)}</strong></div><span class="ui-meta ui-num">${course.credits} credits</span></li>`).join('')}</ul>
          ${(receipt.exceptions || []).map(row => `<div class="ui-alert ui-alert-info">${icons.info}<div><strong>Approved ${row.kind === 'credit_limit' ? `credit ceiling: ${row.parameters.maxCredits}` : row.kind === 'prerequisite_waiver' ? 'prerequisite waiver' : `timetable exception: ${row.parameters.courseIds.map(id => receipt.courses.find(course => course.courseId === id)?.code || id).map(esc).join(' / ')}`}</strong><span>${esc(row.reason)} · expires ${esc(date(row.expiresOn))}</span></div></div>`).join('')}`, '', '', { desc: 'Your registration receipt for this semester.' })}`;
      }
      const formId = `registration-${String(period.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
      const selected = offerings.filter(course => registration.selectedCourses.includes(course.courseId));
      const choices = `<form id="${esc(formId)}" class="ui-registration-form" data-form="course-selection" data-programme="${esc(programme.id)}" data-period="${esc(period.id)}"><input type="hidden" name="revision" value="${registration.revision}">
        <fieldset class="ui-fieldset" ${editable ? '' : 'disabled'}><legend class="visually-hidden">Courses for ${esc(period.name)}</legend><ul class="ui-choice-list">${offerings.map(course => {
          const isRecognized = recognized.includes(course.courseId);
          return `<li><label class="ui-choice course-choice"><input type="checkbox" name="courseIds" value="${esc(course.courseId)}" ${isRecognized ? 'disabled' : registration.selectedCourses.includes(course.courseId) ? 'checked' : ''}>
            <span><strong>${esc(course.code)} · ${esc(course.title)}</strong><span class="ui-meta">${esc(human(isRecognized ? 'recognized credit' : course.requirementType))} · ${esc(human(course.delivery))}</span></span>
            <span class="ui-choice-side"><span class="ui-num ui-card-title">${course.credits}</span><span class="ui-meta">credits</span></span></label></li>`;
        }).join('')}</ul></fieldset></form>`;
      const requirements = eligibility.blockers.length ? section('Eligibility', `<ul class="registration-blockers ui-stack-tight">${eligibility.blockers.map(blocker => `<li class="ui-requirement" data-blocker="${esc(blocker.code)}">${ico('alert', 'amber', 'ui-icon-sm')}<div><strong>${esc(requirementTitles[blocker.code] || human(blocker.code).toLowerCase().replace(/^\w/, c => c.toUpperCase()))}</strong><span class="ui-meta">${esc(blocker.message)}</span>${requirementAction(blocker.code)}</div></li>`).join('')}</ul>`, '', '', { cls: 'ui-card-warning', desc: `${eligibility.blockers.length} ${eligibility.blockers.length === 1 ? 'requirement needs' : 'requirements need'} resolving before you can confirm.` })
        : registration.revision ? `<div class="ui-alert ui-alert-success">${icons.check}<div><strong>Eligible to confirm</strong><span>Your saved selection meets the registration checks.</span></div></div>` : '';
      const percent = Math.min(100, Math.round(eligibility.credits / Math.max(1, period.creditLimit) * 100));
      const summary = `<aside class="ui-card ui-sticky ui-registration-summary" aria-label="Registration summary"><div class="ui-section-head"><h2 class="ui-section-title">Summary</h2>${state}</div>
        <div class="ui-summary-figure"><span class="ui-progress-number">${selected.length}<span> ${selected.length === 1 ? 'course' : 'courses'} saved</span></span></div>
        <div><div class="ui-summary-figure"><span class="ui-meta">Credits</span><span class="ui-num ui-card-title">${eligibility.credits} / ${period.creditLimit}</span></div><div class="ui-bar" role="img" aria-label="${eligibility.credits} of ${period.creditLimit} credits"><span class="is-progress" style="width:${percent}%"></span></div></div>
        ${eligibility.blockers.length ? `<p class="ui-meta">${eligibility.blockers.length} ${eligibility.blockers.length === 1 ? 'requirement' : 'requirements'} outstanding</p>` : ''}
        ${editable || canConfirm ? `<div class="ui-actions-stack"><button class="button button-secondary" type="submit" form="${esc(formId)}" ${editable ? '' : 'disabled'}>Save course selection</button>
          <button class="button button-primary" type="button" data-confirm-registration data-programme="${esc(programme.id)}" data-period="${esc(period.id)}" data-revision="${registration.revision}" ${canConfirm ? '' : 'disabled'}>Confirm registration</button></div>
          <p class="ui-meta">${canConfirm ? 'Confirming records your courses. Later changes need a withdrawal request.' : 'Save an eligible selection to confirm.'}</p>` : `<p class="ui-meta">This registration period is not open for changes.</p>`}</aside>`;
      return `${header}<div class="ui-split"><div class="ui-stack">${section('Available courses', choices, '', '', { desc: `Choose up to ${period.creditLimit} credits. Saved selections can still change until you confirm.` })}${requirements}</div>${summary}</div>`;
    }).join('')}</div>`;
  }

  const card = (inner, cls = '') => inner ? `<div class="ui-card ui-adapter ${cls}">${inner}</div>` : '';
  function content(space, page, data, parts) {
    if (!data.programme) return `${emptyState({ glyph: 'cap', title: 'No student programme', text: 'Your account does not have a linked student programme.', act: action('#apply?history=1', 'View application') })}`;
    if (space === 'study') {
      if (page === 'today') return today(data);
      if (page === 'courses' && parts.length > 2) {
        const period = (data.registrations || []).find(row => row.period.id === decodeURIComponent(parts[2]));
        const course = period?.registration?.confirmation?.courses.find(row => row.courseId === decodeURIComponent(parts[3] || ''));
        if (!course) return emptyState({ glyph: 'book', title: 'Course unavailable', text: 'This course is not part of your confirmed registration.', act: action(link('study', 'courses'), 'All courses') });
        const withdrawn = data.withdrawals?.requests?.some(row => row.periodId === period.period.id && row.courseId === course.courseId && row.status === 'approved');
        return `<a class="ui-link student-text-link" href="${esc(link('study', 'courses'))}">${icons.back} Courses</a>
          <header class="student-page-head ui-card ui-card-lg ui-feature ${tintFor(course.courseId)}"><p class="ui-eyebrow">${esc(course.code)}</p><h1 class="ui-title">${esc(course.title)}</h1><p class="ui-meta">${esc(period.period.name)} · ${course.credits} credits</p></header>
          ${withdrawn ? '' : window.courseWorkspaceUI.host(period.period.id,course.courseId)}
          ${section('Overview', `<dl class="ui-facts ui-facts-3 student-facts"><div><dt>Registration</dt><dd>${esc(period.registration.referenceNumber)}</dd></div><div><dt>Status</dt><dd>${withdrawn ? badge('Withdrawn') : status('confirmed')}</dd></div><div><dt>Credits</dt><dd class="ui-num">${course.credits}</dd></div></dl>
          <div class="ui-actions">${action(link('study', 'timetable', { period: period.period.id }), 'Examination timetable')}${action(link('study', 'results', { period: period.period.id }), 'Published results')}</div>`)}`;
      }
      if (page === 'courses') return courses(data) || emptyState({ glyph: 'book', title: 'No enrolled courses yet', text: 'Your course list will appear here after registration is confirmed.', act: action(link('office', 'registration'), 'Go to registration', true) });
      if (page === 'timetable') { const view = window.registryExamsUI.studentView(exams(data)); return `<div class="ui-stack"><section class="ui-card ui-adapter cal-panel" data-calendar-full></section>${view ? card(view) : emptyState({ glyph: 'calendar', title: 'No examination timetable yet', text: 'No examination timetable has been published for this semester.' })}</div>`; }
      if (page === 'results') {
        const published = results(data);
        const view = published.length ? card(window.studentFormsUI.publishedResultsView(published.map(batch => ({ ...batch, sourceRef: (data.registrations || []).find(entry => batch.results.some(row => row.registrationId === entry.registration?.id))?.period.name || 'Published results' })))) : `<div class="student-results">${emptyState({ glyph: 'cap', title: 'No published results yet', text: 'Results appear here once the university publishes them for your courses.' })}</div>`;
        return `<div class="ui-stack">${view}${data.academic ? card(window.studentFormsUI.studentAcademicView({ ...data.academic, contexts: data.academic.contexts.filter(row => !context.period || row.period.id === context.period) })) : ''}${data.credits?.recognitions?.some(row => row.status === 'approved') ? section('Recognized credits', `<ul class="ui-rows">${data.credits.recognitions.filter(row => row.status === 'approved').map(row => `<li class="ui-row">${ico('check', 'green', 'ui-icon-sm')}<div><strong>${esc(data.credits.curriculum.find(course => course.courseId === row.courseId)?.code || row.courseId)}</strong><span class="ui-meta">${esc(human(row.kind))}</span></div><span class="ui-meta ui-num">${row.credits} credits</span></li>`).join('')}</ul>`) : ''}${card(window.registryAwardsUI.studentView(data.award))}<div class="ui-actions">${action(link('office', 'documents'), 'Official documents')}</div></div>`;
      }
    }
    if (page === 'overview') return `<div class="ui-stack">${attention(data)}<div class="ui-overview-grid">
      ${section('Your programme', window.studyYearUI.render(data.programme) || `<p class="ui-meta">${esc(data.programme.programmeName)}</p>`, link('office', 'details'), 'My details')}
      ${section('Account summary', data.account ? window.registryFinanceUI.summary({ ...data.account, entries: [] }) : empty('Account information is unavailable.'), link('office', 'fees'), 'Full statement')}
      ${section('Support cases', `<p class="ui-progress-number">${data.support?.total ?? '—'}<span> ${data.support ? 'cases' : 'unavailable'}</span></p><div class="ui-actions">${action(link('office', 'requests'), 'View requests')}</div>`)}
      ${section('Documents', `<p class="ui-progress-number">${data.transcripts ? data.transcripts.transcripts.length : '—'}<span> ${data.transcripts ? 'issued documents' : 'unavailable'}</span></p><div class="ui-actions">${action(link('office', 'documents'), 'View documents')}</div>`)}
      </div></div>`;
    if (page === 'registration') return `<div class="ui-stack">${card(window.studyYearUI.render(data.programme), 'ui-card-sm')}${registrationView(data)}${card(window.courseWithdrawalsUI.render(data.withdrawals, selectedRegs(data)))}</div>`;
    if (page === 'fees') return data.account ? `<div class="ui-stack">${section('Account statement', window.registryFinanceUI.summary(data.account), '', '', { desc: 'Balances, holds and every recorded charge and payment.' })}${feeTimeline(data.account)}<section class="student-section ui-section" data-online-payments data-programme="${esc(context.programme)}"></section>${paymentPlans(data.account)}<div class="ui-alert ui-alert-info" data-pay-unavailable>${icons.info}<div><strong>Paying your fees</strong><span>Online payment is not available in the portal yet. Payments appear here once Finance records them.</span></div></div></div>` : emptyState({ glyph: 'wallet', title: 'Statement unavailable', text: 'Your account statement could not be loaded.' });
    if (page === 'details') return `<div class="ui-stack">${card(window.studyYearUI.render(data.programme), 'ui-card-sm')}${card(window.studentFormsUI.studentOnboarding(data.student, data.countries || []))}${data.identity ? card(window.studentFormsUI.studentIdentity(data.identity)) : ''}${data.lifecycle?.history?.length ? section('Programme status history', `<ul class="ui-rows">${data.lifecycle.history.map(row => `<li class="ui-row">${ico('history', 'blue', 'ui-icon-sm')}<div><strong>${esc(human(row.fromStatus || 'Created'))} → ${esc(human(row.toStatus))}</strong><span class="ui-meta">${esc(date(row.effectiveAt))} · ${esc(row.reason)}</span></div></li>`).join('')}</ul>`) : ''}<div class="ui-actions">${action('#apply?history=1', 'Application history')}</div></div>`;
    if (page === 'documents') { const letters = `<section class="student-section ui-section" data-student-letters data-programme="${esc(context.programme)}"></section>`; const view = window.transcriptsUI.studentView(data.transcripts, adapter.openTranscriptId); return `<div class="ui-stack">${letters}${view ? card(view) : emptyState({ glyph: 'file', title: data.transcripts ? 'No documents issued yet' : 'Documents unavailable', text: data.transcripts ? 'No official transcripts or certificates have been issued yet. They appear here once the registry issues them.' : 'Official documents could not be loaded.', act: data.transcripts ? action('#verify', 'Verify a document') : '' })}</div>`; }
    if (page === 'requests') return requestQueue(data);
    if (page === 'appointments') return '<section class="student-section ui-section" data-student-appointments></section>';
    if (page === 'card') return '<section class="student-section ui-section" data-student-card></section>';
    if (page === 'sharing') return window.studentSharingUI.ownRender(data.sharing);
    return empty('This page is unavailable.');
  }

  const formKey = form => Array.from(form.attributes).filter(attr => attr.name.startsWith('data-')).sort((a, b) => a.name.localeCompare(b.name)).map(attr => `${attr.name}=${attr.value}`).join('|');
  const fieldKey = input => `${input.name}:${['checkbox', 'radio'].includes(input.type) ? input.value : ''}`;
  function remember(root, key) {
    key = `${key.split('?')[0]}:${context.programme}:${context.period}`;
    const values = [];
    root.querySelectorAll('form:not([data-restricted-self])').forEach(form => form.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.name && input.type !== 'file' && input.type !== 'hidden') values.push({ form: formKey(form), field: fieldKey(input), value: input.value, checked: input.checked });
    }));
    drafts.set(key, values);
  }
  function restore(root, key) {
    key = `${key.split('?')[0]}:${context.programme}:${context.period}`;
    for (const item of drafts.get(key) || []) {
      const form = Array.from(root.querySelectorAll('form')).find(node => formKey(node) === item.form);
      const input = form && Array.from(form.querySelectorAll('input,select,textarea')).find(node => fieldKey(node) === item.field);
      if (input) { input.value = item.value; if (['checkbox', 'radio'].includes(input.type)) input.checked = item.checked; }
    }
  }

  function bind(root, data, renderPage, routeKey) {
    window.courseWorkspaceUI.bind(root);
    const run = async work => {
      if (busy) return;
      const epoch = generation, token = window.svuSession.get()?.token;
      let repaintHash = routeKey;
      remember(root, routeKey); busy = true; notice = null; delete adapter.notice;
      root.querySelector('[data-student-controls]')?.setAttribute('inert', '');
      root.querySelector('[data-student-controls]')?.setAttribute('aria-busy', 'true');
      try { const message = await work(); if (epoch === generation) {
        const text = message || adapter.notice?.text || (typeof adapter.notice === 'string' ? adapter.notice : '');
        notice = text ? { tone: 'success', text } : null; delete adapter.notice; drafts.delete(`${routeKey.split('?')[0]}:${context.programme}:${context.period}`);
        const query = new URLSearchParams(routeKey.split('?')[1]);
        if (query.has('sitting') && adapter.studentArrangement === null) {
          query.delete('sitting'); query.delete('type'); query.delete('id');
          repaintHash = `${routeKey.split('?')[0]}${query.size ? `?${query}` : ''}`;
          history.replaceState(null, '', repaintHash);
        }
      } }
      catch (error) { if (epoch === generation) { notice = { tone: 'error', text: error.message }; delete adapter.notice; } }
      finally { if (epoch === generation && token === window.svuSession.get()?.token) { busy = false; if (location.hash === repaintHash) await renderPage(); } }
    };
    const base = `/api/registry/me/programmes/${encodeURIComponent(data.programme.id)}`;
    root.querySelector('[data-student-programme-context]')?.addEventListener('change', event => {
      remember(root, routeKey); context.programme = event.target.value; context.period = ''; adapter = {};
      location.hash = link(current.space, current.page);
    });
    root.querySelector('[data-student-period-context]')?.addEventListener('change', event => {
      remember(root, routeKey); context.period = event.target.value; location.hash = link(current.space, current.page);
    });
    root.querySelector('[data-student-retry]')?.addEventListener('click', () => { invalidateReads(); renderPage(); });
    window.transcriptsUI.bindPrint(root);
    window.restrictedProfilesUI.ownBind(root,data.restricted,{api,run});
    window.studentSharingUI.ownBind(root,data.sharing,{api,run,setOffset:value => {adapter.sharingOffset=value;}});
    root.querySelectorAll('[data-student-transcript]').forEach(button => button.addEventListener('click', () => { adapter.openTranscriptId = adapter.openTranscriptId === button.dataset.studentTranscript ? null : button.dataset.studentTranscript; renderPage(); }));
    window.courseWithdrawalsUI.bind(root, { api, run, programmeId: data.programme.id, own: true });
    window.registryExamsUI.bindStudent(root, exams(data));
    if (current.space === 'office' && current.page === 'requests') window.registryExamArrangementsUI.studentBind(root, adapter, { api, act: run });
    window.supportCasesUI.studentBind(root, adapter, { api, act: run, getToken: () => window.svuSession.get()?.token });
    window.prospectiveEnquiriesUI.ownBind(root, adapter, { api, act: run, getToken: () => window.svuSession.get()?.token });
    if (current.space === 'study') root.querySelectorAll('[data-arrangements-open]').forEach(button => button.addEventListener('click', () => { location.hash = link('office', 'requests', { sitting: button.dataset.arrangementsOpen }); }));
    root.querySelectorAll('form[data-form="student-profile"],form[data-form="student-identity"],form[data-form="course-selection"]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form)), courseIds = new FormData(form).getAll('courseIds');
      run(async () => {
        if (form.dataset.form === 'student-profile') { await api('PUT', '/api/registry/me', { revision: Number(values.revision), phone: values.phone, address: { line1: values.line1, city: values.city, countryCode: values.countryCode }, nextOfKin: { name: values.kinName, relationship: values.relationship, phone: values.kinPhone } }); return 'Student details saved.'; }
        if (form.dataset.form === 'student-identity') { await api('POST', '/api/registry/me/identity', { revision: Number(values.revision), changes: window.registryIdentityUI.changesFrom(form, data.identity.identity), evidenceRef: values.evidenceRef, reason: values.reason }); return 'Identity correction sent for review.'; }
        await api('PUT', `${base}/registrations/${encodeURIComponent(form.dataset.period)}`, { revision: Number(values.revision), courseIds }); return 'Course selection saved.';
      });
    }));
    root.querySelectorAll('[data-confirm-registration]').forEach(button => button.addEventListener('click', () => run(async () => {
      const result = await api('POST', `${base}/registrations/${encodeURIComponent(button.dataset.period)}/confirm`, { revision: Number(button.dataset.revision) }); return `Registration confirmed. ${result.referenceNumber}`;
    })));
    root.querySelector('[data-student-controls]')?.addEventListener('input', () => remember(root, routeKey));
    root.querySelectorAll('[data-form="course-selection"]').forEach(form => {
      const markDirty = () => {
        root.querySelector(`[data-confirm-registration][data-period="${CSS.escape(form.dataset.period)}"]`)?.setAttribute('disabled', '');
        if (!form.querySelector('[data-selection-unsaved]')) {
          const message = document.createElement('p'); message.dataset.selectionUnsaved = ''; message.className = 'meta'; message.textContent = 'Save your selection before confirming.'; form.append(message);
        }
      };
      form.addEventListener('change', markDirty);
      const saved = data.registrations.find(row => row.period.id === form.dataset.period)?.registration.selectedCourses || [];
      const selected = Array.from(form.querySelectorAll('[name=courseIds]:checked')).map(input => input.value);
      if (JSON.stringify([...saved].sort()) !== JSON.stringify(selected.sort())) markDirty();
    });
  }

  async function render(root) {
    const epoch = ++generation, hash = location.hash, token = window.svuSession.get()?.token;
    busy = false;
    const [path] = hash.slice(1).split('?'), parts = path.split('/'), space = parts[0], page = parts[1] || (space === 'study' ? 'today' : 'overview');
    if (!pages[space]) return;
    if (current && (current.space !== space || current.page !== page)) notice = null;
    last[space] = page; current = { space, page };
    root.innerHTML = `<div class="student-experience">${navigationFor(space, page)}<div class="student-loading" role="status"><span>Loading your student workspace...</span><div></div><div></div></div></div>`;
    const valid = () => epoch === generation && location.hash === hash && token === window.svuSession.get()?.token;
    try {
      await window.svuSession.me();
      if (!valid()) return;
      if (!window.svuSession.can('registry.self')) throw new Error('This area is available to students with a linked student record.');
      if (!pages[space].some(([id]) => id === page)) { location.replace(link(space, space === 'study' ? 'today' : 'overview')); return; }
      const data = await load(space, page);
      if (!valid()) return;
      searchData = {...data,restricted:null};
      window.svuShell.update(space);
      const title = pages[space].find(([id]) => id === page)[1];
      const navigation = navigationFor(space, page);
      const controls = data.programme ? `<div class="student-context ui-context-bar"><label class="ui-context-field"><span>${ico('cap', 'blue', 'ui-icon-sm')} Programme</span><select data-student-programme-context>${data.student.programmes.map(row => `<option value="${esc(row.id)}" ${row.id === data.programme.id ? 'selected' : ''}>${esc(row.programmeName)} · ${esc(row.intakeLabel)}</option>`).join('')}</select></label><label class="ui-context-field"><span>${ico('calendar', 'lavender', 'ui-icon-sm')} Semester</span><select data-student-period-context><option value="">All semesters</option>${(data.registrations || []).map(row => `<option value="${esc(row.period.id)}" ${row.period.id === context.period ? 'selected' : ''}>${esc(row.period.name)}</option>`).join('')}</select></label><span class="student-number"><span>Student number</span><strong>${esc(data.student.studentNumber)}</strong></span></div>` : '';
      root.innerHTML = `<div class="student-experience">${navigation}${controls}${notice ? `<p class="notice notice-${notice.tone}" role="${notice.tone === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</p>` : ''}${data.errors.length ? `<div class="student-load-errors ui-alert ui-alert-error" role="status"><strong>Some information could not be loaded</strong>${data.errors.map(row => `<p>${esc(human(row.key))}: ${esc(row.text)}</p>`).join('')}<button class="button button-secondary" data-student-retry>Try again</button></div>` : ''}${!(space === 'study' && page === 'today') ? `<header class="student-page-head ui-page-head"><div><p class="ui-eyebrow student-overline">${space === 'study' ? 'Study' : 'Student Office'}</p><h1 class="ui-title">${title}</h1>${pageDescription(space, page, data)}</div>${pageStatus(space, page, data)}</header>` : ''}<div class="student-controls" data-student-controls>${content(space, page, data, parts)}</div></div>`;
      if (space === 'office' && page !== 'registration' || space === 'study' && page === 'resources') root.querySelector('[data-student-period-context]')?.closest('label').remove();
      if (page === 'sharing') {
        const nav=root.querySelector('.student-local-nav'),active=nav?.querySelector('[aria-current="page"]');
        if(active)nav.scrollLeft+=active.getBoundingClientRect().left-nav.getBoundingClientRect().left-(nav.clientWidth-active.clientWidth)/2;
      }
      if (space === 'office' && page === 'details') root.querySelector('[data-student-controls]').insertAdjacentHTML('beforeend',window.restrictedProfilesUI.ownRender(data.restricted));
      const contextBar = root.querySelector('.student-context');
      if (contextBar) {
        const disclosure = document.createElement('details'); disclosure.className = 'student-context-disclosure';
        disclosure.open = window.matchMedia('(min-width: 768px)').matches;
        const summary = document.createElement('summary'); summary.textContent = `${data.programme.programmeCode || data.programme.programmeName} / ${contextBar.querySelector('[data-student-period-context]') ? context.period ? (data.registrations || []).find(row => row.period.id === context.period)?.period.name || 'Selected semester' : 'All semesters' : 'Programme records'} / Change`;
        contextBar.before(disclosure); disclosure.append(summary, contextBar);
      }
      if (page === 'resources' && space === 'study') { const host = root.querySelector('[data-student-controls]'); host.innerHTML = ''; window.renderResources(host); }
      else restore(root, hash);
      // Stacked mobile rows keep their column names.
      root.querySelectorAll('.student-controls table').forEach(table => {
        const labels = Array.from(table.querySelectorAll('thead th')).map(cell => cell.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(tableRow => Array.from(tableRow.children).forEach((cell, index) => { if (labels[index] && !cell.dataset.label) cell.dataset.label = labels[index]; }));
      });
      root.querySelectorAll('.result-table-wrap').forEach((table, index) => {
        table.tabIndex = 0; table.setAttribute('role', 'region');
        table.setAttribute('aria-label', `${title} table ${index + 1}`);
      });
      if (data.programme) bind(root, data, () => render(root), hash);
      root.querySelectorAll('form').forEach(form => form.addEventListener('submit', () => window.svuShell.refreshUnread()));
      root.querySelectorAll('[data-arrangements-open]').forEach(button => { if (space === 'study') button.title = 'Request examination arrangement in Student Office'; });
      const requested = new URLSearchParams(hash.split('?')[1]);
      if (requested.has('type')) {
        const id = CSS.escape(requested.get('id') || '');
        const targets = { support: '[data-support-detail]', identity: `[data-identity-decision="${id}"]`, withdrawal: `[data-withdrawal="${id}"]`, arrangement: '[data-arrangement-panel]', enquiry: '[data-enquiry-own-detail]', transfer: '.student-section' };
        root.querySelector(targets[requested.get('type')] || '[data-student-controls]')?.scrollIntoView({ block: 'start' });
      }
    } catch (error) {
      if (!valid()) return;
      root.innerHTML = `<div class="student-experience student-load-errors ui-alert ui-alert-error" role="alert"><h1 class="ui-section-title">Unable to load this page</h1><p>${esc(error.message)}</p><button class="button button-secondary" data-student-retry>Try again</button></div>`;
      root.querySelector('[data-student-retry]').addEventListener('click', () => { invalidateReads(); render(root); });
    }
  }
  window.svuSession.onChange(() => { generation++; invalidateReads(); searchData = null; adapter = {}; context = { programme: '', period: '' }; drafts.clear(); notice = null; last = {}; busy = false; });
  window.matchMedia('(min-width: 768px)').addEventListener('change', event => {
    const disclosure = document.querySelector('.student-context-disclosure');
    if (disclosure) disclosure.open = event.matches;
  });
  const searchItems = () => {
    if (!window.svuSession.can('registry.self')) return [];
    const items = Object.entries(pages).flatMap(([space, entries]) => entries.map(([page, label]) => ({ title: label, detail: space === 'study' ? 'Study' : 'Student Office', href: link(space, page), terms: page === 'fees' ? 'statement account payment balance' : '' })));
    for (const entry of searchData?.registrations || []) for (const course of entry.registration?.confirmation?.courses || []) items.push({ title: `${course.code} / ${course.title}`, detail: entry.period.name, href: link('study', `courses/${encodeURIComponent(entry.period.id)}/${encodeURIComponent(course.courseId)}`, { programme: searchData.programme.id, period: entry.period.id }) });
    return [...items, { title: 'Inbox', detail: 'Account', href: '#messages' }, { title: 'Settings', detail: 'Account', href: '#settings' }];
  };
  window.studentUI = { render, link, spaceLink, searchItems };
})();
