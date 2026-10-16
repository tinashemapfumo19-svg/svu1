import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resultsChecksum } from '../server/modules/results.js';
import { todayIso } from '../server/support.js';

const base = new URL(process.env.SVU_BASE_URL || 'http://127.0.0.1:4188');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Walkthrough seeding requires a local server.');
const provision = spawnSync(process.execPath, ['scripts/seed-active-student.js'], { stdio: 'inherit', env: { ...process.env, SVU_BASE_URL: base.origin } });
if (provision.status !== 0) throw new Error('Student provisioning failed.');
const sessions = [], reason = 'Synthetic university walkthrough fixture';
const today = todayIso();
const day = (offset) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
async function api(method, path, body, token, raw = false) {
  const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': raw ? 'application/pdf' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: raw ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload.data || payload;
}
async function login(email, password) {
  const session = await api('POST', '/api/identity/sessions', { email, password });
  sessions.push(session);
  if (session.status !== 'active') throw new Error(`MFA completion required for ${email}.`);
  return session;
}
async function activationToken(email) {
  const dir = process.env.SVU_DEV_OUTBOX || 'data/dev-outbox';
  const messages = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.json')) continue;
    const row = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (row.recipientEmail === email && row.variables?.activationToken) messages.push(row);
  }
  const message = messages.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)).at(-1);
  if (!message) throw new Error(`No local activation for ${email}.`);
  return message.variables.activationToken;
}

try {
  const admin = await login('admin@southvalley.test', 'Phase1-Admin-Password-2026!');
  const registrar = await login('registrar@southvalley.test', 'Kariba-Senate-Approvals-2026!');
  const student = await login('active.student@southvalley.test', 'Active-Student-Demo-2026!');
  const me = await api('GET', '/api/registry/me', null, student.token), programme = me.programmes[0];
  const staffBase = `/api/registry/programmes/${programme.id}`, own = `/api/registry/me/programmes/${programme.id}`;
  const registrarIdentity = await api('GET', '/api/identity/me', null, registrar.token);
  for (const roleCode of ['finance_officer', 'records_manager', 'examinations_officer']) {
    if (!registrarIdentity.roles.some((row) => row.code === roleCode)) await api('POST', '/api/access/role-assignments', { accountId: registrarIdentity.account.id, roleCode, scope: {}, reason }, admin.token);
  }
  let calendars = await api('GET', '/api/master-data/academic-periods', null, admin.token);
  async function calendar(code, input) {
    let row = calendars.find((entry) => entry.code === code);
    if (!row) { row = await api('POST', '/api/master-data/academic-periods', { code, ...input }, admin.token); calendars.push(row); }
    if (['draft', 'planning'].includes(row.lifecycleStatus) || !row.lifecycleStatus) await api('POST', `/api/master-data/academic-periods/${row.id}/transitions`, { toStatus: 'published', reason }, admin.token);
    return row;
  }
  const year = await calendar('DEMO-WALK-2028', { name: 'Demo academic year 2028', periodType: 'academic_year', startsOn: '2028-01-01', endsOn: '2028-12-31' });
  const term = await calendar('DEMO-WALK-S1', { name: 'Demo Semester 1 - 2028', periodType: 'semester', parentId: year.id, startsOn: '2028-02-01', endsOn: '2028-06-30', windows: { registration: [day(-30), day(365)], results_publication: [day(-30), day(365)] } });
  let contexts = await api('GET', `${own}/registrations`, null, student.token);
  let context = contexts.find((row) => row.period.academicPeriodId === term.id);
  if (!context) {
    const period = await api('POST', `${staffBase}/registration-periods`, { academicPeriodId: term.id, yearOfStudy: 1, term: 'S1', creditLimit: 120, reason }, admin.token);
    context = (await api('GET', `${own}/registrations`, null, student.token)).find((row) => row.period.id === period.id);
  }
  const periodId = context.period.id;
  if (context.period.status === 'planning') {
    await api('POST', `${staffBase}/registration-periods/${periodId}`, { offerings: context.offerings.map((row, index) => ({ courseId: row.courseId, delivery: 'scheduled', meetings: [{ day: index % 5 + 1, start: 540 + Math.floor(index / 5) * 120, end: 630 + Math.floor(index / 5) * 120 }] })), reason }, admin.token);
    await api('POST', `${staffBase}/registration-periods/${periodId}`, { toStatus: 'open', reason }, admin.token);
  }
  if (context.registration.status !== 'confirmed') {
    await api('PUT', `${own}/registrations/${periodId}`, { revision: context.registration.revision, courseIds: context.offerings.map((row) => row.courseId) }, student.token);
    context = (await api('GET', `${own}/registrations`, null, student.token)).find((row) => row.period.id === periodId);
    for (const checkType of ['academic', 'financial']) await api('POST', `${staffBase}/registrations/${periodId}/checks`, { revision: context.registration.revision, checkType, outcome: 'eligible', reason, evidenceRef: `DEMO-${checkType}`, expiresOn: day(365) }, admin.token);
    await api('POST', `${own}/registrations/${periodId}/confirm`, { revision: context.registration.revision }, student.token);
  }
  const courses = context.offerings;
  console.log(`Registered ${courses.length} courses for ${me.studentNumber}.`);

  const programmes = await api('GET', '/api/master-data/programmes', null, admin.token);
  const master = programmes.find((row) => row.code === programme.programmeCode);
  const schedules = await api('GET', `/api/finance/fee-schedules?programmeId=${master.id}`, null, admin.token);
  let schedule = schedules.find((row) => row.reason === reason || row.lines?.some((line) => line.description === 'Demo semester tuition'));
  if (!schedule) schedule = await api('POST', '/api/finance/fee-schedules', { programmeId: master.id, yearOfStudy: 1, term: 'S1', currency: 'USD', effectiveFrom: '2027-01-01', dueDays: 30, reason, lines: [{ chargeCode: 'TUITION', description: 'Demo semester tuition', amountMinor: 120000 }, { chargeCode: 'REGISTRATION', description: 'Demo registration fee', amountMinor: 5000 }] }, admin.token);
  if (schedule.status !== 'published') await api('POST', `/api/finance/fee-schedules/${schedule.id}/publish`, { reason }, registrar.token);
  let account = await api('GET', `${own}/account`, null, student.token);
  if (!account.entries.some((row) => row.registrationPeriodId === periodId && row.entryType === 'charge')) {
    await api('POST', '/api/finance/billing-runs', { registrationPeriodId: periodId, reason }, admin.token);
    account = await api('GET', `${own}/account`, null, student.token);
  }
  if (!account.entries.some((row) => row.externalRef === 'DEMO-TARIRO-BANK-001') && !account.entries.some((row) => row.entryType === 'payment')) await api('POST', `${staffBase}/payments`, { currency: 'USD', amountMinor: 75000, method: 'bank', externalRef: 'DEMO-TARIRO-BANK-001', receivedOn: day(-1), reason }, admin.token);
  console.log('Seeded semester charges and a USD 750 payment.');

  let resultContext = await api('GET', `${staffBase}/results`, null, registrar.token);
  let resultPeriod = resultContext.periods.find((row) => row.period.id === periodId);
  let batch = resultPeriod.batches.find((row) => row.sourceRef === 'DEMO-TARIRO-SEMESTER-1');
  if (!batch) {
    const schemes = await api('GET', '/api/master-data/grading-schemes', null, admin.token);
    let scheme = schemes.find((row) => row.code === 'demo_walkthrough');
    if (!scheme) scheme = await api('POST', '/api/master-data/grading-schemes', { code: 'demo_walkthrough', name: 'Demo grade bands', bands: [{ minMark: 0, maxMark: 39, grade: 'F', points: 0, passing: false }, { minMark: 40, maxMark: 69, grade: 'C', points: 2, passing: true }, { minMark: 70, maxMark: 100, grade: 'A', points: 4, passing: true }], classifications: [{ minGpa: 3.5, label: 'Distinction' }, { minGpa: 2, label: 'Pass' }] }, admin.token);
    if (scheme.status !== 'published') await api('POST', `/api/master-data/grading-schemes/${scheme.id}/publish`, { effectiveFrom: '2026-01-01', reason }, registrar.token);
    const policies = await api('GET', '/api/master-data/gpa-rule-sets', null, admin.token);
    let policy = policies.find((row) => row.code === 'demo_walkthrough');
    if (!policy) policy = await api('POST', '/api/master-data/gpa-rule-sets', { code: 'demo_walkthrough', name: 'Demo credit-weighted GPA', gradingSchemeId: scheme.id, rules: { creditWeighted: true, retakePolicy: 'latest', excludeGrades: [], includeFailed: true, rounding: { decimals: 2, mode: 'half_up' } }, samples: [{ name: 'Worked example', results: [{ courseCode: 'DEMO', credits: 15, mark: 75 }], expectedGpa: 4, expectedClassification: 'Distinction' }] }, admin.token);
    if (policy.status !== 'published') await api('POST', `/api/master-data/gpa-rule-sets/${policy.id}/publish`, { effectiveFrom: '2026-01-01', reason }, registrar.token);
    if (context.period.status !== 'closed') await api('POST', `${staffBase}/registration-periods/${periodId}`, { toStatus: 'closed', reason }, admin.token);
    const rows = resultPeriod.roster.map((row, index) => ({ registrationId: row.registrationId, courseId: row.courseId, mark: [78, 65, 82, 71][index % 4] }));
    batch = await api('POST', `${staffBase}/results/${periodId}/batches`, { sourceRef: 'DEMO-TARIRO-SEMESTER-1', rows, expectedRowCount: rows.length, expectedMarkTotal: rows.reduce((sum, row) => sum + row.mark, 0), checksum: resultsChecksum(rows), gpaRuleSetId: policy.id, reason }, registrar.token);
  }
  if (batch.status !== 'published') {
    if (batch.status !== 'reviewed') await api('POST', `${staffBase}/results/${periodId}/batches/${batch.id}/review`, { outcome: 'reviewed', evidenceRef: 'DEMO-MODERATION-001', reason }, admin.token);
    await api('POST', `${staffBase}/results/${periodId}/batches/${batch.id}/publish`, { reason }, admin.token);
  }
  console.log('Published independently reviewed sample results.');

  const notices = await api('GET', '/api/notifications/me?limit=50', null, student.token);
  const identity = await api('GET', '/api/identity/me', null, student.token);
  for (const message of ['Demo: Your campus orientation is on Monday at 09:00 in the Computing faculty.', 'Demo: The library handbook is available under Resources. Contact student services for help.', 'Demo: Your semester statement includes tuition, registration and your bank payment.']) {
    if (!notices.items.some((row) => row.body.includes(message))) await api('POST', '/api/notifications/send', { recipientAccountId: identity.account.id, templateCode: 'admissions.portal_message', channel: 'email', variables: { message }, reason }, admin.token);
  }
  await api('POST', '/api/support/me/cases', { programmeId: programme.id, subject: 'Demo: Finding my timetable', category: 'academic', body: 'Where can I see my courses, published results and examination timetable?', requestKey: 'demo-tariro-timetable' }, student.token);
  console.log('Added orientation messages and an academic support case.');
  const repository = await api('GET', '/api/repository', null, admin.token);
  let collection = repository.collections.find((row) => row.code === 'demo_student_guides');
  if (!collection) collection = await api('POST', '/api/repository/collections', { code: 'demo_student_guides', name: 'Demo student guides', classification: 'internal', viewRoles: ['academic_registrar'], studentAccess: true, allowDownload: true, retentionYears: 5, reason }, admin.token);
  const library = await api('GET', `/api/repository?collectionId=${collection.id}`, null, admin.token);
  for (const [title, lines] of [
    ['Demo Student Handbook', ['South Valley University - DEMO handbook', 'Student services: Computing faculty reception.', 'Library hours: Monday to Friday, 08:00 to 17:00.', 'Academic integrity: cite sources and submit your own work.']],
    ['Introduction to Programming - Study Guide', ['COMP101 - DEMO study guide', 'Week 1: Variables, expressions and input/output.', 'Week 2: Conditions, loops and functions.', 'Practice: build a simple student grade calculator.']]
  ]) {
    let item = library.items.find((row) => row.title === title);
    if (!item) item = (await api('POST', '/api/repository/items', { collectionId: collection.id, title, summary: 'Synthetic reading material for the local walkthrough', resourceType: 'course_notes', keywords: ['demo', 'student'], reason }, admin.token)).item;
    const detail = await api('GET', `/api/repository/items/${item.id}`, null, admin.token);
    if (!detail.versions.length) {
      const stream = `BT /F1 14 Tf 50 750 Td ${lines.map((line, index) => `${index ? '0 -28 Td ' : ''}(${line}) Tj`).join('\n')} ET`;
      const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
      let pdf = '%PDF-1.4\n'; const offsets = [0];
      objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
      const xref = Buffer.byteLength(pdf);
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = Buffer.from(pdf);
      const version = await api('POST', `/api/repository/items/${item.id}/versions`, { fileName: `${title.replaceAll(' ', '-')}.pdf`, contentType: 'application/pdf', sizeBytes: bytes.length, changeNote: reason }, admin.token);
      await api('PUT', version.upload.url, bytes, null, true);
      await api('POST', `/api/documents/${version.documentId}/scan-results`, { result: 'clean' }, admin.token);
      await api('POST', `/api/repository/items/${item.id}/versions/${version.version}/review`, { outcome: 'published', reason }, registrar.token);
    }
  }
  console.log('Published two downloadable student resources.');

  const staffList = await api('GET', '/api/staff?q=demo.lecturer', null, admin.token);
  let lecturer = staffList.items.find((row) => row.email === 'demo.lecturer@southvalley.test');
  if (!lecturer) {
    lecturer = await api('POST', '/api/staff', { email: 'demo.lecturer@southvalley.test', legalName: 'Chipo Demo Ncube', preferredName: 'Chipo', category: 'LECTURER', grade: 'L1', departmentId: 'dept_computing', engagedOn: day(-90), roleCode: 'lecturer', reason }, admin.token);
    await api('POST', '/api/identity/activations', { token: await activationToken('demo.lecturer@southvalley.test'), password: 'Demo-Lecturer-2026!', preferredName: 'Chipo', legalName: 'Chipo Demo Ncube' });
  }
  const lecturerSession = await login('demo.lecturer@southvalley.test', 'Demo-Lecturer-2026!');
  const currentTerm = await calendar('DEMO-WALK-ACTIVE', { name: 'Demo active teaching semester', periodType: 'semester', parentId: year.id, startsOn: '2028-07-01', endsOn: '2028-12-31', windows: { registration: [day(-30), day(365)], teaching: ['2028-07-01', '2028-10-31'], assessment: ['2028-11-01', '2028-11-30'] } });
  let activeContext = (await api('GET', `${own}/registrations`, null, student.token)).find((row) => row.period.academicPeriodId === currentTerm.id);
  if (!activeContext) {
    const created = await api('POST', `${staffBase}/registration-periods`, { academicPeriodId: currentTerm.id, yearOfStudy: 1, term: 'S1', creditLimit: 120, reason }, admin.token);
    activeContext = (await api('GET', `${own}/registrations`, null, student.token)).find((row) => row.period.id === created.id);
  }
  const teachingPeriodId = activeContext.period.id;
  if (activeContext.period.status === 'planning') {
    await api('POST', `${staffBase}/registration-periods/${teachingPeriodId}`, { offerings: activeContext.offerings.map((row, index) => ({ courseId: row.courseId, delivery: 'scheduled', meetings: [{ day: index + 1, start: 540, end: 630 }] })), reason }, admin.token);
    await api('POST', `${staffBase}/registration-periods/${teachingPeriodId}`, { toStatus: 'open', reason }, admin.token);
  }
  if (activeContext.registration.status !== 'confirmed') {
    await api('PUT', `${own}/registrations/${teachingPeriodId}`, { revision: activeContext.registration.revision, courseIds: activeContext.offerings.map((row) => row.courseId) }, student.token);
    activeContext = (await api('GET', `${own}/registrations`, null, student.token)).find((row) => row.period.id === teachingPeriodId);
    for (const checkType of ['academic', 'financial']) await api('POST', `${staffBase}/registrations/${teachingPeriodId}/checks`, { revision: activeContext.registration.revision, checkType, outcome: 'eligible', reason, evidenceRef: `DEMO-ACTIVE-${checkType}`, expiresOn: day(365) }, admin.token);
    if (!activeContext.eligibility.blockers.length) await api('POST', `${own}/registrations/${teachingPeriodId}/confirm`, { revision: activeContext.registration.revision }, student.token);
  }
  for (const course of courses) {
    let teaching = await api('GET', `/api/teaching/periods/${teachingPeriodId}`, null, registrar.token);
    let allocation = teaching.offerings.find((row) => row.courseId === course.courseId).allocations.find((row) => row.staffId === lecturer.id);
    if (!allocation) {
      await api('POST', `/api/teaching/periods/${teachingPeriodId}/allocations`, { courseId: course.courseId, staffId: lecturer.id, role: 'lead', workloadUnits: 3, effectiveFrom: today, reason }, registrar.token);
      teaching = await api('GET', `/api/teaching/periods/${teachingPeriodId}`, null, registrar.token);
      allocation = teaching.offerings.find((row) => row.courseId === course.courseId).allocations.find((row) => row.staffId === lecturer.id);
    }
    if (allocation.status === 'proposed') await api('POST', `/api/teaching/allocations/${allocation.id}/review`, { outcome: 'approved', reason }, admin.token);
  }
  console.log('Created lecturer demo login and approved teaching allocations.');
  const classmateProvision = spawnSync(process.execPath, ['scripts/seed-active-student.js'], { stdio: 'inherit', env: { ...process.env, SVU_BASE_URL: base.origin, SVU_DEMO_STUDENT_EMAIL: 'demo.classmate@southvalley.test', SVU_DEMO_STUDENT_NAME: 'Nyasha' } });
  if (classmateProvision.status !== 0) throw new Error('Classmate provisioning failed.');
  const classmate = await login('demo.classmate@southvalley.test', 'Active-Student-Demo-2026!');
  const classmateRecord = await api('GET', '/api/registry/me', null, classmate.token);
  const classmateProgramme = classmateRecord.programmes[0];
  const classmateOwn = `/api/registry/me/programmes/${classmateProgramme.id}`;
  let classmateContext = (await api('GET', `${classmateOwn}/registrations`, null, classmate.token)).find((row) => row.period.id === teachingPeriodId);
  if (classmateContext.registration.status !== 'confirmed') {
    await api('PUT', `${classmateOwn}/registrations/${teachingPeriodId}`, { revision: classmateContext.registration.revision, courseIds: courses.map((row) => row.courseId) }, classmate.token);
    classmateContext = (await api('GET', `${classmateOwn}/registrations`, null, classmate.token)).find((row) => row.period.id === teachingPeriodId);
    for (const checkType of ['academic', 'financial']) await api('POST', `/api/registry/programmes/${classmateProgramme.id}/registrations/${teachingPeriodId}/checks`, { revision: classmateContext.registration.revision, checkType, outcome: 'eligible', reason, evidenceRef: `DEMO-CLASSMATE-${checkType}`, expiresOn: day(365) }, admin.token);
    await api('POST', `${classmateOwn}/registrations/${teachingPeriodId}/confirm`, { revision: classmateContext.registration.revision }, classmate.token);
  }
  const supportCases = await api('GET', `/api/support/me/cases?programmeId=${programme.id}`, null, student.token);
  const supportCase = supportCases.items.find((row) => row.subject === 'Demo: Finding my timetable');
  const caseDetail = await api('GET', `/api/support/cases/${supportCase.id}`, null, admin.token);
  if (!caseDetail.comments.some((row) => row.body.startsWith('Demo reply:'))) await api('POST', `/api/support/cases/${supportCase.id}/comment`, { revision: caseDetail.revision, body: 'Demo reply: Open My learning for your courses and examination timetable. Your published marks are in the same view; the handbook is under Resources.', visibility: 'public', requestKey: 'demo-timetable-reply' }, admin.token);
  if (!term.windows?.assessment) await api('PATCH', `/api/master-data/academic-periods/${term.id}`, { windows: { ...term.windows, assessment: ['2028-06-01', '2028-06-30'] }, reason }, admin.token);
  let exams = await api('GET', `/api/exams/periods/${periodId}`, null, admin.token);
  for (const [index, course] of courses.entries()) {
    if (!exams.sittings.some((row) => row.courseId === course.courseId && row.status === 'scheduled')) await api('POST', `/api/exams/periods/${periodId}/sittings`, { courseId: course.courseId, paper: 'Demo final examination', startsAt: `2028-06-${String(10 + index).padStart(2, '0')}T09:00:00+02:00`, durationMinutes: 120, venue: 'Demo Computing Hall', reason }, admin.token);
  }
  exams = await api('GET', `/api/exams/periods/${periodId}`, null, admin.token);
  if (exams.timetable.status !== 'published') await api('POST', `/api/exams/periods/${periodId}/publish`, { revision: exams.timetable.revision, reason }, registrar.token);
  console.log('Published two examination sittings.');
  account = await api('GET', `${own}/account`, null, student.token);
  console.log(JSON.stringify({ studentNumber: me.studentNumber, courses: courses.map((row) => row.code), statement: account.currencies, walkthrough: new URL('/#home', base).href }, null, 2));
} finally {
  for (const session of sessions) await api('DELETE', `/api/identity/sessions/${session.id}`, null, session.token).catch((error) => console.error(error.message));
}
