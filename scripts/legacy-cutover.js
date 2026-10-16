import pg from 'pg';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadConfig } from '../server/config.js';
import { encryptSecret, decryptSecret } from '../server/security.js';
import { previewLegacyDump } from './legacy-dump-reader.js';
import { loadWorkflowDefinitions } from './workflow-definitions.js';
import { loadNotificationTemplates } from './notification-templates.js';

const args = process.argv.slice(2);
if (args.length !== 3 || args[1] !== '--replace-seeded') throw Error('Usage: node scripts/legacy-cutover.js source.sql --replace-seeded exact_database');
const config = loadConfig(), source = readFileSync(args[0]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceHash = sha(source), importId = `legacy_${sourceHash.slice(0, 16)}`;
const boundary = source.indexOf(Buffer.from('-- Stand-in structure for view `v_students_2020`'));
if (boundary < 0 || !source.subarray(boundary).toString('utf8').includes('VIEW `v_students_2020` AS select')) throw Error('Unexpected archive view boundary.');
const preview = previewLegacyDump(source.subarray(0, boundary));
const parsed = spawnSync('python', ['scripts/legacy-export.py', resolve(args[0])], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
if (parsed.status !== 0) throw Error('Literal source extraction failed; no database changes made.');
const tables = JSON.parse(parsed.stdout);
for (const table of preview.tables) if ((tables[table.name] || []).length !== table.rows) throw Error(`Source count mismatch: ${table.name}`);
if (Object.keys(tables).some(name => !preview.tables.some(t => t.name === name))) throw Error('Unexpected extracted table.');
const rows = name => tables[name] || [];
const norm = v => String(v ?? '').trim().toLowerCase();
const text = v => String(v ?? '').replaceAll('\0', '').trim();
const id = (kind, ...parts) => `legacy_${kind}_${sha(JSON.stringify(parts)).slice(0, 24)}`;
const group = (list, key) => { const m = new Map(); for (const r of list) { const k = norm(r[key]); if (k) m.set(k, [...(m.get(k) || []), r]); } return m; };
const date = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') && !value.startsWith('0000') && Number.isFinite(Date.parse(value.slice(0, 10))) ? value.slice(0, 10) : null;
const md5 = value => /^[a-f0-9]{32}$/i.test(value || '');
const plan = new Map(), links = new Map(), issues = [];
const push = (table, row) => { if (!plan.has(table)) plan.set(table, []); plan.get(table).push(row); return row; };
const link = (table, n, target, targetId) => links.set(`${table}:${n}`, { target, targetId });
const issue = (table, row, reason) => issues.push({ sourceTable: table, sourceRow: row, reason });
const accountBySource = new Map(), credentialGroups = group(rows('student_pro'), 'student_id');
const staffCredentials = group(rows('svu_sl'), 'staff_id');
const accountRows = [], aliases = new Map();
function alias(value, accountId) {
  const key = norm(value); if (key) aliases.set(`${key}\0${accountId}`, { alias: key, account_id: accountId });
}
function account(ref, name, email, personas, credential = null, login = null, active = true) {
  const personId = id('person', ref), accountId = id('account', ref);
  push('people', { id: personId, legal_name: text(name) || 'Name not recorded', preferred_name: text(name) || 'Name not recorded', personas: JSON.stringify(personas), status: 'active' });
  const row = { id: accountId, person_id: personId, email: norm(email) || null, legacy_source_ref: ref,
    status: active ? 'active' : 'suspended', mfa_required: false, password_hash: credential?.hash || null,
    password_salt: credential?.scheme || null };
  accountRows.push(row); accountBySource.set(ref, row);
  if (login) alias(login, accountId);
  return row;
}
const registrationByApp = group(rows('students_registration'), 'application_id');
const registrationByNumber = group(rows('students_registration'), 'svu_reg_number');
for (const [n, r] of rows('students_registration').entries()) {
  const credentials = credentialGroups.get(norm(r.svu_reg_number)) || [];
  const hashes = [...new Set(credentials.map(c => c.key_id).filter(md5))];
  const uniqueNumber = (registrationByNumber.get(norm(r.svu_reg_number)) || []).length === 1;
  const credential = uniqueNumber && hashes.length === 1 ? { hash: hashes[0], scheme: 'legacy-md5' } : null;
  if (hashes.length > 1) issue('students_registration', n + 1, 'Conflicting source credentials; retained without choosing a password.');
  const ref = `students_registration:${n + 1}`;
  account(ref, [r.name, r.middle_name, r.surname].map(text).filter(Boolean).join(' ') || r.applicant, r.email,
    text(r.svu_reg_number) ? ['student', 'applicant'] : ['applicant'], credential, r.svu_reg_number);
  link('students_registration', n + 1, 'accounts', accountBySource.get(ref).id);
}
for (const [n, r] of rows('svu_staff_members').entries()) {
  const credentials = staffCredentials.get(norm(r.staff_id)) || [];
  const hashes = [...new Set(credentials.map(c => c.authid).filter(md5))];
  const ref = `svu_staff_members:${n + 1}`;
  const a = account(ref, [r.name, r.surname].map(text).filter(Boolean).join(' '), r.email, ['staff'],
    hashes.length === 1 ? { hash: hashes[0], scheme: 'legacy-md5' } : null, null, r.active === '1');
  for (const c of credentials) alias(c.username, a.id);
  link('svu_staff_members', n + 1, 'staff_members', id('staff', r.staff_id));
}
for (const [n, r] of rows('student_pro').entries()) {
  const registrations = registrationByNumber.get(norm(r.student_id)) || [];
  if (registrations.length === 1) {
    const sourceRow = rows('students_registration').indexOf(registrations[0]) + 1;
    const a = accountBySource.get(`students_registration:${sourceRow}`);
    link('student_pro', n + 1, 'accounts', a.id);
  } else if (!registrations.length) {
    const a = account(`student_pro:${n + 1}`, r.fullname, r.email, ['student'], md5(r.key_id) ? { hash: r.key_id, scheme: 'legacy-md5' } : null, r.student_id, r.authorised === '1');
    link('student_pro', n + 1, 'accounts', a.id);
    issue('student_pro', n + 1, 'Credential retained as a separate identity; registration/programme linkage not present.');
  } else issue('student_pro', n + 1, 'Ambiguous registration identity; credential retained in encrypted source.');
}
const staffById = group(rows('svu_staff_members'), 'staff_id');
for (const [n, r] of rows('svu_sl').entries()) {
  const members = staffById.get(norm(r.staff_id)) || [];
  if (members.length === 1) {
    const a = accountBySource.get(`svu_staff_members:${rows('svu_staff_members').indexOf(members[0]) + 1}`);
    link('svu_sl', n + 1, 'accounts', a.id);
  } else if (!members.length) {
    const a = account(`svu_sl:${n + 1}`, r.username, null, ['staff'], md5(r.authid) ? { hash: r.authid, scheme: 'legacy-md5' } : null, r.username);
    link('svu_sl', n + 1, 'accounts', a.id);
    issue('svu_sl', n + 1, 'Standalone legacy login without an employment record.');
  } else issue('svu_sl', n + 1, 'Ambiguous staff identity.');
}
for (const [n, r] of rows('users').entries()) {
  if (r.uid === '0') continue; // Anonymous Drupal placeholder, not a person.
  const a = account(`users:${n + 1}`, r.name, r.mail, ['legacy_cms_user'], r.pass?.startsWith('$S$') ? { hash: r.pass, scheme: 'legacy-drupal7' } : null, r.name, r.status === '1');
  link('users', n + 1, 'accounts', a.id);
}
// Accounts for historical applications without a unique registration linkage stay separate.
for (const [n, r] of rows('student_applications').entries()) {
  if ((registrationByApp.get(norm(r.autocode)) || []).length !== 1) {
    account(`student_applications:${n + 1}`, r.applicant, r.email, ['applicant']);
  }
}
// Preserve the true contact data in the encrypted source, rather than fabricate unique emails.
const emails = group(accountRows, 'email');
for (const a of accountRows) {
  if (!a.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) || emails.get(a.email).length !== 1) {
    if (a.email) issue('accounts', a.legacy_source_ref, 'Shared or invalid email retained in source; use the individual legacy login.');
    a.email = null;
  }
  push('accounts', a);
}
for (const a of aliases.values()) push('legacy_login_aliases', a);
const departmentId = 'legacy_department_unassigned';
push('organization_units', { id: departmentId, code: 'LEGACY_UNASSIGNED', name: 'Department not recorded', unit_type: 'department', status: 'active' });
const programmeMap = new Map();
for (const [n, r] of rows('courses').entries()) {
  const code = text(r.course_code); if (!code || programmeMap.has(norm(code))) { issue('courses', n + 1, 'Missing or repeated programme code.'); continue; }
  const p = push('programmes', { id: id('programme', code), code, name: text(r.course_name), department_id: departmentId, status: 'active' });
  programmeMap.set(norm(code), p);
  push('programme_versions', { id: id('version', code), programme_id: p.id, version_label: 'Legacy catalogue', status: 'draft', requirements: JSON.stringify({ legacySource: 'courses', legacyProgrammeLevel: r.course_level, missing: ['approved curriculum', 'course credits', 'effective dates', 'department association'] }) });
  link('courses', n + 1, 'programmes', p.id);
}
const moduleCodes = new Map();
for (const [n, r] of rows('svu_course_codes').entries()) {
  const code = text(r.coursecode); if (!code || moduleCodes.has(norm(code))) { issue('svu_course_codes', n + 1, 'Repeated or missing module code.'); continue; }
  const level = Number(r.year_level);
  const c = push('courses', { id: id('module', code), code, title: text(r.coursename), credits: null, level: level >= 1 && level <= 8 ? level : null,
    department_id: departmentId, status: 'draft', effective_from: null, legacy_source_ref: `svu_course_codes:${n + 1}` });
  moduleCodes.set(norm(code), c); link('svu_course_codes', n + 1, 'courses', c.id);
}
const intakes = new Map();
function intake(programme, month, year, vacancy = null) {
  const key = [programme.id, norm(month), text(year)].join('|');
  if (intakes.has(key)) return intakes.get(key);
  const label = [text(month), text(year)].filter(Boolean).join(' ') || 'Intake not recorded';
  const result = push('intakes', { id: id('intake', key), programme_id: programme.id, label,
    capacity: vacancy && Number.isInteger(Number(vacancy.vacancies)) && Number(vacancy.vacancies) >= 0 ? Number(vacancy.vacancies) : null,
    application_opens_at: date(vacancy?.opening_date), application_closes_at: date(vacancy?.closing_date),
    status: 'draft', starts_on: null, legacy_source_ref: key });
  intakes.set(key, result); return result;
}
for (const [n, r] of rows('vacancies').entries()) {
  const p = programmeMap.get(norm(r.prrogramme_code));
  if (!p) { issue('vacancies', n + 1, 'Programme not in source catalogue.'); continue; }
  const i = intake(p, r.intake, r.intake_year, r);
  link('vacancies', n + 1, 'intakes', i.id);
}
const applicationMap = new Map();
function application(ref, a, programme, month, year, sourceStatus, sourceRow) {
  const i = intake(programme, month, year);
  const app = push('applications', { id: id('application', ref), applicant_account_id: a.id, intake_id: i.id,
    programme_version_id: id('version', programme.code), status: 'submitted', reference_number: `LEGACY-${ref}`,
    legacy_source_ref: ref, legacy_source_status: sourceStatus || 'not recorded', answers: JSON.stringify({ migration: { source: sourceRow, historical: true } }), workflow_instance_id: id('workflow', ref) });
  push('workflow_instances', { id: app.workflow_instance_id, definition_id: 'legacy_historical_admissions', subject_type: 'Application', subject_id: app.id,
    state: `Legacy ${sourceStatus || 'status not recorded'}`, status: 'closed' });
  push('resource_scopes', { id: id('scope', app.id), resource_type: 'Application', resource_id: app.id, programme_code: programme.code, intake_id: i.id });
  return app;
}
for (const [n, r] of rows('student_applications').entries()) {
  const registrations = registrationByApp.get(norm(r.autocode)) || [];
  const reg = registrations.length === 1 ? registrations[0] : null;
  const a = reg ? accountBySource.get(`students_registration:${rows('students_registration').indexOf(reg) + 1}`) : accountBySource.get(`student_applications:${n + 1}`);
  const p = programmeMap.get(norm(r.course)) || programmeMap.get(norm(reg?.programme_code));
  if (!p) { issue('student_applications', n + 1, 'Source programme mapping unavailable; full application retained in encrypted source.'); continue; }
  const app = application(`application-${r.autocode}`, a, p, reg?.intake || r.intake, reg?.intake_year || r.intake_year, r.status, `student_applications:${n + 1}`);
  applicationMap.set(norm(r.autocode), app); link('student_applications', n + 1, 'applications', app.id);
}
const countryCodes = new Map([['angola', 'AO'], ['botswana', 'BW'], ['malawi', 'MW'], ['namibia', 'NA'], ['zambia', 'ZM'], ['zimbabwe', 'ZW']]);
const studentIds = new Map();
for (const [n, r] of rows('students_registration').entries()) {
  const a = accountBySource.get(`students_registration:${n + 1}`);
  push('applicant_profiles', { account_id: a.id, date_of_birth: date(r.dob), nationality_code: countryCodes.get(norm(r.country)) || null,
    phone: text(r.mobile || r.phone), address: JSON.stringify({ line1: text(r.address1), line2: text(r.address2), city: text(r.address3), countryCode: countryCodes.get(norm(r.country)) || '' }) });
  const number = text(r.svu_reg_number);
  if (!number || (registrationByNumber.get(norm(number)) || []).length !== 1) { issue('students_registration', n + 1, 'Student number missing or ambiguous; applicant identity retained without inventing a number.'); continue; }
  const s = push('students', { id: id('student', number), student_number: number, person_id: a.person_id, account_id: a.id }); studentIds.set(norm(number), s.id);
  const kin = rows('svu_student_nxtkin').filter(k => norm(k.student_regno) === norm(number));
  push('student_profiles', { student_id: s.id, phone: text(r.mobile || r.phone), address: JSON.stringify({ line1: text(r.address1), line2: text(r.address2), city: text(r.address3), countryCode: countryCodes.get(norm(r.country)) || '' }),
    next_of_kin: JSON.stringify(kin.length === 1 ? { name: text(kin[0].kin_name), phone: text(kin[0].mobile || kin[0].phone), relationship: '' } : {}) });
  const p = programmeMap.get(norm(r.programme_code));
  if (!p) { issue('students_registration', n + 1, 'Student retained; programme code not in source catalogue.'); continue; }
  const sourceApp = applicationMap.get(norm(r.application_id));
  const app = sourceApp?.programme_version_id === id('version', p.code) ? sourceApp : application(`registration-${r.reg_number}`, a, p, r.intake, r.intake_year, r.status, `students_registration:${n + 1}`);
  if (sourceApp && app !== sourceApp) issue('students_registration', n + 1, 'Application and registration programme codes differ; separate registration context retained.');
  const sp = push('student_programmes', { id: id('student_programme', r.reg_number), student_id: s.id, application_id: app.id,
    programme_version_id: app.programme_version_id, intake_id: app.intake_id, status: 'pending_onboarding', legacy_source_status: r.status });
  push('student_programme_history', { id: id('programme_history', r.reg_number), student_programme_id: sp.id, to_status: 'pending_onboarding',
    reason: `Legacy source status: ${text(r.status) || 'not recorded'}; native onboarding and period evidence require reconciliation.`, actor_id: importId });
  link('students_registration', n + 1, 'students', s.id);
}
for (const [n, r] of rows('student_pro').entries()) {
  const a = accountBySource.get(`student_pro:${n + 1}`), number = text(r.student_id);
  if (a && number && !studentIds.has(norm(number))) {
    const s = push('students', { id: id('student', number), student_number: number, person_id: a.person_id, account_id: a.id });
    push('student_profiles', { student_id: s.id }); studentIds.set(norm(number), s.id);
  }
}
const employeeNumbers = group(rows('svu_staff_members'), 'employee_number');
for (const [n, r] of rows('svu_staff_members').entries()) {
  const a = accountBySource.get(`svu_staff_members:${n + 1}`), engaged = date(r.date_of_engagement);
  if (!engaged) { issue('svu_staff_members', n + 1, 'Employment start date invalid; person and credentials retained.'); continue; }
  const invitationId = id('staff_import_context', r.staff_id);
  push('invitations', { id: invitationId, email: a.email || '', role_code: 'legacy_staff', status: 'accepted', expires_at: '2026-10-16T23:59:59Z' });
  push('staff_members', { id: id('staff', r.staff_id), employee_number: text(r.employee_number) && employeeNumbers.get(norm(r.employee_number)).length === 1 ? text(r.employee_number) : null,
    email: a.email, legal_name: text([r.name, r.surname].filter(Boolean).join(' ')), preferred_name: text(r.name), invitation_id: invitationId,
    account_id: a.id, status: r.active === '1' ? 'active' : 'suspended', engaged_on: engaged, created_by: a.id, legacy_source_ref: `svu_staff_members:${n + 1}` });
}
for (const a of accountRows) {
  const person = plan.get('people').find(p => p.id === a.person_id), personas = JSON.parse(person.personas);
  for (const role of personas.includes('staff') ? ['legacy_staff'] : personas.includes('student') ? ['student', 'applicant'] : personas.includes('applicant') ? ['applicant'] : []) {
    push('role_assignments', { id: id('role', a.id, role), account_id: a.id, role_code: role, scope: '{}', effective_from: '2026-10-16', granted_by: importId, reason: 'Legacy identity continuity import' });
  }
}
for (const [n, r] of rows('svu_sl').entries()) {
  const target = links.get(`svu_sl:${n + 1}`);
  if (target && r.access_level === '9') push('role_assignments', { id: id('role', target.targetId, 'system_administrator'), account_id: target.targetId, role_code: 'system_administrator', scope: '{}', effective_from: '2026-10-16', granted_by: importId, reason: 'Preserved explicit legacy Sysadmin access level 9' });
}
// Reference rows use source labels; they do not assert policy approval.
function reference(list, code, label) { push('reference_values', { id: id('reference', list, code), list_code: list, value_code: String(code), label: text(label), status: 'active' }); }
for (const r of rows('country')) if (countryCodes.has(norm(r.country))) reference('country', countryCodes.get(norm(r.country)), r.country);
for (const r of rows('academic_level')) reference('academic_level', r.aca_level, r.aca_level_description);
for (const r of rows('svu_staff_category')) reference('staff_category', text(r.staff_category).toUpperCase().replace(/[^A-Z0-9]+/g, '_'), r.staff_category);
for (const r of rows('students_reject_reasons')) reference('decision_reason', r.code, r.reason);
const report = { sourceHash, sourceRows: preview.totals.rows, sourceTables: preview.tables.length,
  nativeCounts: Object.fromEntries([...plan].map(([table, data]) => [table, data.length])),
  sourceIssues: issues, preservedPasswords: accountRows.filter(a => a.password_hash).length,
  pendingNativeDomains: ['Finance balances/payments require currency and source-ledger reconciliation.', 'Curricula require approved credits, requirements and effective dates.',
    'Legacy enrolment/study-year and result evidence require academic-period and policy mappings.', 'Document/resource/submission metadata retained; actual attachment bytes are a separate source.',
    'Medical/religion/disability history retained privately without fabricating new consent.', 'Legacy statuses are retained; native approvals and published results are not synthesized.'] };
mkdirSync('data/legacy-cutover', { recursive: true });
writeFileSync('data/legacy-cutover/plan.json', JSON.stringify(report, null, 2));
const keyPath = 'data/legacy-cutover/archive-key.bin';
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx' });
const key = readFileSync(keyPath);
if (key.length !== 32) throw Error('Archive key must contain exactly 32 bytes.');
const db = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
let transaction = false, phase = 'connect';
try {
  await db.connect();
  if ((await db.query('select current_database() as name')).rows[0].name !== args[2]) throw Error('Exact database acknowledgement does not match connection.');
  if ((await db.query('select count(*)::int as n from legacy_imports')).rows[0].n) throw Error('Legacy import already exists; refusing to replace imported data.');
  if (args[2] === 'svu_rebuild' && !existsSync('data/legacy-cutover/before-legacy-20261016.dump')) throw Error('Required pre-cutover backup missing.');
  await db.query('begin'); transaction = true;
  await db.query("select pg_advisory_xact_lock(hashtext('svu:legacy-cutover'))");
  phase = 'clear demo operational data';
  const retain = new Set(['schema_migrations', 'roles', 'permissions', 'role_permissions', 'reference_lists', 'workflow_definitions', 'notification_templates']);
  const clear = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r => r.tablename).filter(t => !retain.has(t));
  if (clear.some(t => !/^[a-z_][a-z0-9_]*$/.test(t))) throw Error('Unsupported table identifier.');
  // One atomic TRUNCATE retains the schema and canonical security/workflow configuration.
  await db.query(`truncate ${clear.map(t => `"${t}"`).join(',')} restart identity`);
  await loadWorkflowDefinitions(db); await loadNotificationTemplates(db);
  await db.query("insert into roles(code,name,risk) values('legacy_staff','Staff','low') on conflict do nothing");
  await db.query("insert into role_permissions(role_code,permission_code) values('legacy_staff','foundation.view') on conflict do nothing");
  await db.query(`insert into workflow_definitions(id,code,version,states,transitions,active,initial_state,terminal_states)
    values('legacy_historical_admissions','legacy_historical_admissions',1,$1,'[]',false,'Legacy open',$1)`, [JSON.stringify(['Legacy open', 'Legacy approved', 'Legacy rejected', 'Legacy registered', 'Legacy graduated', 'Legacy status not recorded'])]);
  phase = 'archive original source';
  await db.query('insert into legacy_imports(id,source_sha256,source_bytes,manifest,original_archive_encrypted,report) values($1,$2,$3,$4,$5,$6)',
    [importId, sourceHash, source.length, JSON.stringify(preview), encryptSecret(source.toString('base64'), key), JSON.stringify(report)]);
  for (const [table, data] of Object.entries(tables)) {
    for (let offset = 0; offset < data.length; offset += 250) {
      const batch = data.slice(offset, offset + 250).map((row, i) => {
        const encoded = JSON.stringify(row), mapping = links.get(`${table}:${offset + i + 1}`);
        return { import_id: importId, source_table: table, source_row: offset + i + 1, row_sha256: sha(encoded), payload_encrypted: encryptSecret(encoded, key),
          target_type: mapping?.target || null, target_id: mapping?.targetId || null, disposition: mapping ? 'native_projection_with_original_retained' : 'retained_for_reconciliation' };
      });
      await db.query('insert into legacy_source_rows select * from jsonb_populate_recordset(null::legacy_source_rows,$1::jsonb)', [JSON.stringify(batch)]);
    }
  }
  // Dependency order is explicit; no triggers or constraints are disabled.
  const order = ['people', 'accounts', 'legacy_login_aliases', 'organization_units', 'programmes', 'programme_versions', 'courses', 'intakes',
    'workflow_instances', 'applications', 'resource_scopes', 'applicant_profiles', 'students', 'student_profiles', 'student_programmes', 'student_programme_history', 'invitations', 'staff_members', 'role_assignments', 'reference_values'];
  for (const table of order) {
    phase = `native projection ${table}`;
    const shapes = new Map();
    for (const row of plan.get(table) || []) {
      const shape = JSON.stringify(Object.keys(row));
      if (!shapes.has(shape)) shapes.set(shape, []);
      shapes.get(shape).push(row);
    }
    for (const [shape, data] of shapes) {
      const columns = JSON.parse(shape);
      for (let offset = 0; offset < data.length; offset += 250) {
        const batch = data.slice(offset, offset + 250);
        const values = batch.flatMap(row => columns.map(column => row[column]));
        const placeholders = batch.map((_, n) => `(${columns.map((_, i) => `$${n * columns.length + i + 1}`).join(',')})`).join(',');
        await db.query(`insert into "${table}" (${columns.map(c => `"${c}"`).join(',')}) values ${placeholders}`, values);
      }
    }
    console.log(`Projected ${table}: ${(plan.get(table) || []).length}`);
  }
  phase = 'reconcile source and native projections';
  const counts = (await db.query('select source_table,count(*)::int as n from legacy_source_rows group by source_table')).rows;
  if (counts.some(r => r.n !== rows(r.source_table).length) || counts.reduce((n, r) => n + r.n, 0) !== preview.totals.rows) throw Error('Archived source totals differ.');
  for (const table of order) {
    const count = (await db.query(`select count(*)::int as n from "${table}"`)).rows[0].n;
    if (count !== (plan.get(table) || []).length) throw Error(`Native totals differ: ${table}`);
  }
  if (sha(Buffer.from(decryptSecret((await db.query('select original_archive_encrypted from legacy_imports where id=$1', [importId])).rows[0].original_archive_encrypted, key), 'base64')) !== sourceHash) throw Error('Original archive recovery checksum differs.');
  const archiveRows = (await db.query('select row_sha256,payload_encrypted from legacy_source_rows')).rows;
  for (const row of archiveRows) if (sha(decryptSecret(row.payload_encrypted, key)) !== row.row_sha256) throw Error('Archived row recovery checksum differs.');
  await db.query(`insert into audit_events(id,actor_id,action,subject_type,subject_id,source,reason,metadata) values($1,$2,'legacy.cutover.completed','LegacyImport',$2,'legacy_sql_cutover',$3,$4)`,
    [id('audit', sourceHash), importId, 'User-authorized replacement of seeded data with supplied legacy SQL records; original source and passwords retained.', JSON.stringify({ sourceHash, sourceRows: preview.totals.rows, nativeCounts: report.nativeCounts })]);
  await db.query('commit'); transaction = false;
  report.applied = true; report.database = args[2]; report.reconciled = true;
  writeFileSync(`data/legacy-cutover/result-${args[2]}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ applied: true, database: args[2], sourceRows: report.sourceRows, nativeCounts: report.nativeCounts, preservedPasswords: report.preservedPasswords, reconciliationIssues: issues.length }));
} catch (error) {
  if (transaction) await db.query('rollback');
  // PostgreSQL error details can contain private source values. Persist only phase and code.
  console.error(JSON.stringify({ applied: false, phase, code: error.code || 'validation', reason: error.code ? 'Database constraint/operation refused; transaction rolled back.' : error.message }));
  process.exitCode = 1;
} finally { await db.end(); }
