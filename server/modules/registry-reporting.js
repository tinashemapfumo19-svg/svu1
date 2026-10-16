import { actorCanAccessScope,insertAudit,requestError,withTransaction } from '../support.js';

export const registryMetricVersion = 'registry-enrolment-v1';
export const programmeStates = Object.freeze({pendingOnboarding:'pending_onboarding',onboarded:'onboarded',suspended:'suspended',interrupted:'interrupted',withdrawn:'withdrawn',transferred:'transferred',completed:'completed'});
const definition = (id,label,unit,formula,exclusions,group) => Object.freeze({id,label,unit,formula,exclusions,group,owner:'Registry office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current registry.view programme/intake scope, optional programme/intake; all retained registration periods',refresh:'On request; one repeatable-read snapshot; no historical as-of reconstruction'});
export const registryMetrics = Object.freeze([
  definition('programmeRecords','Programme records','programme records','Count student_programmes in selected intakes','Not unique people; transfers retain source and destination records','programme'),
  ...Object.entries(programmeStates).map(([id,status]) => definition(id,{pendingOnboarding:'Pending onboarding',onboarded:'Onboarded',suspended:'Suspended',interrupted:'Interrupted',withdrawn:'Withdrawn',transferred:'Transferred source records',completed:'Completed programme records'}[id],
    'programme records',`Current student_programmes.status = ${status}`,'Not status-history events, active term registrations, awards or unique students','programme')),
  definition('unclassifiedProgrammes','Unclassified programme states','programme records','Current status outside the seven recognized programme states','Source/definition review condition, not an invented lifecycle outcome','programme'),
  definition('registrationPeriods','Registration periods','periods','Count configured registration_periods in selected intakes','Includes planning/open/closed and past/future periods; not academic calendar periods without registration configuration','registration'),
  ...['planning','open','closed'].map((status) => definition(`${status}Periods`,`${status.charAt(0).toUpperCase()+status.slice(1)} periods`,'periods',`registration_periods.status = ${status}`,'Not a count of students or confirmation eligibility','registration')),
  definition('registrationRecords','Saved registration records','programme-period records','Count student_registrations for selected intake periods','Not unique students across periods; excludes unsaved selections and status/revision history','registration'),
  definition('draftRegistrations','Draft registrations','programme-period records','student_registrations.status = draft','Retained drafts can belong to inactive/transferred programmes; not an eligible-to-register queue','registration'),
  definition('confirmedRegistrations','Confirmed registrations','programme-period records','student_registrations.status = confirmed','Includes retained confirmations after lifecycle changes/transfers; not current active student headcount','registration'),
  definition('courseEnrolments','Retained course enrolments','course-enrolment records','Count course_enrolments bound to confirmed registrations in selected intake periods','Not unique courses or students, attendance, completion or current LMS access','registration')
]);
export function registryReportFilters(input = {}) {
  if (Object.keys(input).some((key) => !['programmeCode','intakeId','format'].includes(key))) throw requestError(400,'Unsupported registry report filter.');
  const out = {};
  for (const key of ['programmeCode','intakeId']) {const value = input[key] ?? '';if (typeof value !== 'string' || value.length > 160 || /[\x00\r\n]/.test(value)) throw requestError(400,'Use bounded registry report filters.');out[key] = value.trim();}
  out.format = input.format ?? 'json';if (!['json','csv'].includes(out.format)) throw requestError(400,'Choose json or csv output.');return out;
}
export function registryReportControls(counts) {
  return {programmesReconcile:Object.keys(programmeStates).reduce((sum,key) => sum+counts[key],counts.unclassifiedProgrammes) === counts.programmeRecords,
    periodsReconcile:counts.planningPeriods+counts.openPeriods+counts.closedPeriods === counts.registrationPeriods,
    registrationsReconcile:counts.draftRegistrations+counts.confirmedRegistrations === counts.registrationRecords};
}
const safeCount = (value) => {const number = Number(value);if (!Number.isSafeInteger(number) || number < 0) throw requestError(409,'Registry report counts exceed supported exact precision.');return number;};
const emptyCounts = () => Object.fromEntries(registryMetrics.map((entry) => [entry.id,0]));
const quote = (value) => {const raw = String(value ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function registryReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_programme','filter_intake','row_type','intake_id','programme_code','intake','metric_id','unit','value','programmes_reconcile','periods_reconcile','registrations_reconcile'];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.programmeCode,report.filters.intakeId];
  const records = [{counts:report.totals,controls:report.controls},...report.rows];
  const rows = records.flatMap((row) => registryMetrics.map((entry) => [...prefix,row.intakeId ? 'intake' : 'total',row.intakeId ?? '',row.programmeCode ?? '',row.label ?? '',entry.id,entry.unit,row.counts[entry.id],row.controls.programmesReconcile,row.controls.periodsReconcile,row.controls.registrationsReconcile]));
  return [header,...rows].map((row) => row.map(quote).join(',')).join('\r\n')+'\r\n';
}
async function visibleIntakes(db,actor) {
  return (await db.query('select i.id as "intakeId",i.label,i.status,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.starts_on desc,i.id')).rows
    .filter((row) => actorCanAccessScope({...actor,authorizingPermission:'registry.view'},row));
}
export function createRegistryReportingModule(pool) {
  function authority(actor) {if (!actor.permissions.includes('registry.view')) throw requestError(403,'Registry reporting authority is required.');}
  return {
    async registryMetricDictionary(actor) {authority(actor);return {definitionVersion:registryMetricVersion,metrics:registryMetrics};},
    async listRegistryReportingIntakes(actor) {
      authority(actor);return withTransaction(pool,async (db) => {const intakes = await visibleIntakes(db,actor);await insertAudit(db,{actorId:actor.accountId,action:'reports.registry.intakes.accessed',subjectType:'RegistryEnrolmentReport',subjectId:registryMetricVersion,reason:'Authorized registry reporting intakes accessed',metadata:{intakeCount:intakes.length}});return intakes;});
    },
    async registryOperationsReport(input,actor) {
      authority(actor);const filters = registryReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const intakes = await visibleIntakes(db,actor),selected = intakes.filter((row) => ['programmeCode','intakeId'].every((key) => !filters[key] || filters[key] === row[key]));
        if (filters.intakeId && !selected.length) throw requestError(404,'Registry reporting intake was not found.');
        const ids = selected.map((row) => row.intakeId);
        // Refuse cross-intake/student/period bindings and incomplete confirmed course sets before counting.
        if (ids.length && (await db.query(`select 1 from student_registrations sr join registration_periods rp on rp.id = sr.period_id join student_programmes sp on sp.id = sr.student_programme_id
          where rp.intake_id = any($1::text[]) and (sp.intake_id <> rp.intake_id
            or exists (select 1 from course_enrolments ce where ce.registration_id = sr.id and (sr.status <> 'confirmed' or ce.student_id <> sp.student_id or ce.academic_period_id <> rp.academic_period_id))
            or (sr.status = 'confirmed' and case when jsonb_typeof(sr.selected_courses) <> 'array' then true else
              jsonb_array_length(sr.selected_courses) <> (select count(*) from course_enrolments ce where ce.registration_id = sr.id)
              or exists (select 1 from course_enrolments ce where ce.registration_id = sr.id and not (sr.selected_courses ? ce.course_id)) end)) limit 1`,[ids])).rows.length) throw requestError(409,'Registry registration/enrolment source bindings require reconciliation.');
        // Independent source counts avoid multiplying programme records by periods or enrolments.
        const aggregates = ids.length ? (await db.query(`select i.id as "intakeId",
          (select count(*)::bigint from student_programmes sp where sp.intake_id = i.id) as "programmeRecords",
          ${Object.entries(programmeStates).map(([key,status]) => `(select count(*)::bigint from student_programmes sp where sp.intake_id = i.id and sp.status = '${status}') as "${key}"`).join(',')},
          (select count(*)::bigint from student_programmes sp where sp.intake_id = i.id and sp.status not in (${Object.values(programmeStates).map((status) => `'${status}'`).join(',')})) as "unclassifiedProgrammes",
          (select count(*)::bigint from registration_periods rp where rp.intake_id = i.id) as "registrationPeriods",
          ${['planning','open','closed'].map((status) => `(select count(*)::bigint from registration_periods rp where rp.intake_id = i.id and rp.status = '${status}') as "${status}Periods"`).join(',')},
          (select count(*)::bigint from student_registrations sr join registration_periods rp on rp.id = sr.period_id where rp.intake_id = i.id) as "registrationRecords",
          ${['draft','confirmed'].map((status) => `(select count(*)::bigint from student_registrations sr join registration_periods rp on rp.id = sr.period_id where rp.intake_id = i.id and sr.status = '${status}') as "${status}Registrations"`).join(',')},
          (select count(*)::bigint from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join registration_periods rp on rp.id = sr.period_id where rp.intake_id = i.id and sr.status = 'confirmed') as "courseEnrolments"
          from intakes i where i.id = any($1::text[])`,[ids])).rows : [];
        const byId = new Map(aggregates.map((row) => [row.intakeId,row]));
        const rows = selected.map((row) => {const counts = Object.fromEntries(registryMetrics.map((entry) => [entry.id,safeCount(byId.get(row.intakeId)?.[entry.id] ?? 0)]));return {...row,counts,controls:registryReportControls(counts)};});
        const totals = rows.reduce((sum,row) => {for (const entry of registryMetrics) sum[entry.id] = safeCount(sum[entry.id]+row.counts[entry.id]);return sum;},emptyCounts());
        const controls = registryReportControls(totals);for (const key of Object.keys(controls)) controls[key] &&= rows.every((row) => row.controls[key]);
        const {format,...selection} = filters,report = {definitionVersion:registryMetricVersion,generatedAt,filters:selection,availableIntakes:intakes,metrics:registryMetrics,rows,totals,controls};
        await insertAudit(db,{actorId:actor.accountId,action:format === 'csv' ? 'reports.registry.exported' : 'reports.registry.accessed',subjectType:'RegistryEnrolmentReport',subjectId:registryMetricVersion,
          reason:format === 'csv' ? 'Registry and enrolment CSV exported' : 'Registry and enrolment report accessed',metadata:{definitionVersion:registryMetricVersion,generatedAt,filters:selection,intakeCount:rows.length,controls}});
        return format === 'csv' ? {csv:registryReportCsv(report),fileName:`registry-enrolment-${generatedAt.slice(0,10)}.csv`,definitionVersion:registryMetricVersion,generatedAt} : report;
      });
    }
  };
}
