import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { loadConfig } from '../server/config.js';

const base = new URL(process.env.SVU_BASE_URL || 'http://127.0.0.1:4177');
if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Student demo requires a local server.');
const credentials = { email: process.env.SVU_DEMO_STUDENT_EMAIL || 'active.student@southvalley.test', password: 'Active-Student-Demo-2026!' };
const preferredName = process.env.SVU_DEMO_STUDENT_NAME || 'Tariro';
const legalName = `${preferredName} Demo Moyo`;
const sessions = [];
const reason = 'Create active student demonstration record';

async function api(method, path, body, token, raw = false) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { 'Content-Type': raw ? 'application/pdf' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: raw ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload.data || payload;
}
async function login(values) {
  const session = await api('POST', '/api/identity/sessions', values);
  sessions.push(session);
  if (session.status !== 'active') throw new Error('Complete MFA before using this demo provisioner.');
  return session;
}

try {
  const health = await api('GET', '/api/health');
  if (health.env !== 'development') throw new Error('Student demo requires development mode.');
  const admin = await login({ email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' });
  const config = loadConfig();
  const database = new URL(config.databaseUrl);
  if (config.env !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) throw new Error('Demo account lookup requires a local development database.');
  const db = new pg.Client({ connectionString: config.databaseUrl });
  let exists;
  await db.connect();
  try {
    exists = (await db.query('select 1 from accounts where email = $1', [credentials.email])).rowCount > 0;
  } finally { await db.end(); }
  if (!exists) {
    await api('POST', '/api/admissions/registrations', { email: credentials.email, preferredName, legalName });
    const folder = process.env.SVU_DEV_OUTBOX || 'data/dev-outbox';
    const messages = [];
    for (const file of await readdir(folder)) {
      if (!file.endsWith('.json')) continue;
      const message = JSON.parse(await readFile(join(folder, file), 'utf8'));
      if (message.recipientEmail === credentials.email && message.variables?.activationToken) messages.push(message);
    }
    const activation = messages.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)).at(-1);
    if (!activation) throw new Error('Demo activation was not found in the development outbox.');
    await api('POST', '/api/identity/activations', { token: activation.variables.activationToken, password: credentials.password, preferredName, legalName });
  }
  const student = await login(credentials);
  await api('PUT', '/api/admissions/profile', {
    dateOfBirth: '2004-05-14', nationalityCode: 'ZW', phone: '+263771234567',
    priorLevelCode: 'CERTIFICATE', studyModeCode: 'FULL_TIME',
    address: { line1: '12 Demo Avenue', city: 'Bulawayo', countryCode: 'ZW' }
  }, student.token);
  const applications = await api('GET', '/api/admissions/applications', null, student.token);
  let application = applications.find((row) => row.intakeId === 'intake_2027_feb');
  if (!application) application = await api('POST', '/api/admissions/applications', { intakeId: 'intake_2027_feb' }, student.token);
  application = await api('GET', `/api/admissions/applications/${application.id}`, null, student.token);
  if (!application.workflowInstanceId) {
    for (const documentType of ['prior_transcript', 'national_id']) {
      const bytes = Buffer.from(`%PDF-1.4\n% Synthetic demo ${documentType}\n%%EOF\n`);
      const intent = await api('POST', `/api/admissions/applications/${application.id}/documents`, {
        documentType, fileName: `demo-${documentType}.pdf`, contentType: 'application/pdf', sizeBytes: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex')
      }, student.token);
      await api('PUT', intent.upload.url, bytes, null, true);
      await api('POST', `/api/documents/${intent.document.id}/scan-results`, { result: 'clean' }, admin.token);
    }
    await api('POST', `/api/admissions/applications/${application.id}/fee`, { method: 'waiver_code', reference: 'SVU-WAIVER-2027' }, student.token);
    await api('POST', `/api/admissions/applications/${application.id}/submit`, {}, student.token);
    application = await api('GET', `/api/admissions/applications/${application.id}`, null, student.token);
  }
  const states = ['Submitted', 'Payment verified', 'Completeness review', 'Academic review', 'Decision'];
  const index = states.indexOf(application.workflowState);
  if (index >= 0) {
    for (const toState of states.slice(index + 1)) await api('POST', `/api/workflows/instances/${application.workflowInstanceId}/transitions`, { toState, reason }, admin.token);
    await api('POST', `/api/admissions/review/applications/${application.id}/decision`, { decision: 'offer' }, admin.token);
    application = await api('GET', `/api/admissions/applications/${application.id}`, null, student.token);
  }
  if (application.workflowState === 'Offer issued') await api('POST', `/api/admissions/applications/${application.id}/offer-response`, { response: 'accept' }, student.token);
  let record = await api('GET', '/api/registry/me', null, student.token);
  const programme = record.programmes.find((row) => row.applicationId === application.id);
  if (!programme) throw new Error('Demo student programme is missing.');
  if (programme.status === 'pending_onboarding') {
    await api('PUT', '/api/registry/me', { revision: record.profile.revision, phone: '+263771234567',
      address: { line1: '12 Demo Avenue', city: 'Bulawayo', countryCode: 'ZW' },
      nextOfKin: { name: 'Rudo Demo Moyo', relationship: 'parent', phone: '+263771234568' }
    }, student.token);
    await api('POST', `/api/registry/programmes/${programme.id}/approve`, { identityConfirmed: true, reason }, admin.token);
  }
  record = await api('GET', '/api/registry/me', null, student.token);
  const active = record.programmes.find((row) => row.id === programme.id);
  if (active.status !== 'onboarded' || !record.readiness.complete) throw new Error('Demo student is not fully onboarded.');
  console.log(JSON.stringify({ email: credentials.email, studentNumber: record.studentNumber, programme: active.programmeName, status: active.status, profileComplete: record.readiness.complete, url: new URL('/#signin', base).href }, null, 2));
} finally {
  for (const session of sessions) await api('DELETE', `/api/identity/sessions/${session.id}`, null, session.token).catch((error) => console.error(`Demo probe logout: ${error.message}`));
}
