import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';

export const examinationReportPermissions = ['exams.schedule','exams.publish'];
export const examinationMetricVersion = 'exam-operations-v1';
export const examinationMetrics = Object.freeze([
  {id:'ordersSubmitted',label:'Orders awaiting review',unit:'orders',formula:"Count exam_orders with status = submitted",exclusions:'Approved and returned orders'},
  {id:'ordersReturned',label:'Returned orders',unit:'orders',formula:"Count exam_orders with status = returned",exclusions:'Submitted and approved orders; returned records may remain after a replacement order'},
  {id:'draftTimetables',label:'Draft timetables',unit:'periods',formula:"Count exam_timetables with status = draft",exclusions:'Published timetables and periods without a timetable'},
  {id:'scheduledSittings',label:'Scheduled sittings',unit:'sittings',formula:"Count exam_sittings with status = scheduled, regardless of start time",exclusions:'Cancelled sittings; this is not an upcoming-sittings or attendance count'},
  {id:'publicationEditions',label:'Retained publication editions',unit:'editions',formula:'Count immutable exam_publications, including published and retained origins',exclusions:'Unpublished drafts and overwritten editions unavailable before migration 060'}
].map((metric) => Object.freeze({...metric,owner:'Examinations office (proposed)',approval:'Development definition; owner approval pending',filters:'Current authorized programme/intake scope and optional programme, intake or registration period',refresh:'On request; one repeatable-read database snapshot; no historical as-of reconstruction'})));

export function examinationReportFilters(input = {}) {
  if (Object.keys(input).some((key) => !['programmeCode','intakeId','periodId','format'].includes(key))) throw requestError(400,'Unsupported examination report filter.');
  const filters = {};
  for (const key of ['programmeCode','intakeId','periodId']) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 160 || /[\r\n\x00]/.test(value)) throw requestError(400,'Use bounded examination report filters.');
    filters[key] = value.trim();
  }
  const format = input.format ?? 'json';
  if (!['json','csv'].includes(format)) throw requestError(400,'Choose json or csv report output.');
  return {...filters,format};
}
const mayRead = (actor,row) => examinationReportPermissions.some((permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},row));
const zeroCounts = () => Object.fromEntries(examinationMetrics.map((metric) => [metric.id,0]));
export function examinationReportControls(source) {
  const keys = [...examinationMetrics.map((metric) => metric.id),'ordersTotal','ordersApproved','timetablesTotal','timetablesPublished','sittingsTotal','sittingsCancelled','sourceFaults'];
  if (!source || keys.some((key) => !Number.isSafeInteger(source[key]) || source[key] < 0)) throw requestError(409,'Examination report sources require reconciliation.');
  const controls = {
    ordersReconcile:source.ordersTotal === source.ordersSubmitted + source.ordersReturned + source.ordersApproved,
    timetablesReconcile:source.timetablesTotal === source.draftTimetables + source.timetablesPublished && source.timetablesTotal <= 1,
    sittingsReconcile:source.sittingsTotal === source.scheduledSittings + source.sittingsCancelled,
    publicationOriginsReconcile:source.sourceFaults === 0
  };
  if (!Object.values(controls).every(Boolean)) throw requestError(409,'Examination report sources require reconciliation.');
  return controls;
}
const csvCell = (value) => {
  const raw = String(value ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
};
export function examinationReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_programme','filter_intake','filter_period','row_type','period_id','programme_code','intake','period','metric_id','unit','value'];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.programmeCode,report.filters.intakeId,report.filters.periodId];
  const rows = examinationMetrics.map((metric) => [...prefix,'total','','','','',metric.id,metric.unit,report.totals[metric.id]]);
  for (const row of report.rows) for (const metric of examinationMetrics) rows.push([...prefix,'period',row.periodId,row.programmeCode,row.intakeLabel,row.name,metric.id,metric.unit,row.counts[metric.id]]);
  for (const [key,value] of Object.entries(report.controls ?? {})) rows.push([...prefix,'control_total','','','','',key,'boolean',value]);
  for (const row of report.rows) for (const [key,value] of Object.entries(row.controls ?? {})) rows.push([...prefix,'control_period',row.periodId,row.programmeCode,row.intakeLabel,row.name,key,'boolean',value]);
  return [[...header,'controls_version'],...rows.map((row) => [...row,report.controlsVersion ?? ''])].map((row) => row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function createExaminationReportingModule(pool) {
  return {
    async examinationMetricDictionary(actor) {
      if (!examinationReportPermissions.some((permission) => actor.permissions.includes(permission))) throw requestError(403,'Examination office authority is required.');
      return {definitionVersion:examinationMetricVersion,metrics:examinationMetrics};
    },
    async examinationOperationsReport(input,actor) {
      const filters = examinationReportFilters(input);
      if (!examinationReportPermissions.some((permission) => actor.permissions.includes(permission))) throw requestError(403,'Examination office authority is required.');
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const periods = (await db.query(`select rp.id as "periodId",ap.name,p.code as "programmeCode",i.id as "intakeId",i.label as "intakeLabel"
          from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id
          join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id
          order by p.code,i.label,ap.name,rp.id`)).rows.filter((row) => mayRead(actor,row));
        const selected = periods.filter((row) => ['programmeCode','intakeId','periodId'].every((key) => !filters[key] || row[key] === filters[key]));
        if (filters.periodId && !selected.length) throw requestError(404,'Examination reporting period was not found.');
        // Count each source independently: joining orders, sittings and editions would multiply rows.
        const counts = selected.length ? (await db.query(`select rp.id as "periodId",
          (select count(*)::integer from exam_orders eo where eo.period_id = rp.id and eo.status = 'submitted') as "ordersSubmitted",
          (select count(*)::integer from exam_orders eo where eo.period_id = rp.id and eo.status = 'returned') as "ordersReturned",
          (select count(*)::integer from exam_timetables et where et.period_id = rp.id and et.status = 'draft') as "draftTimetables",
          (select count(*)::integer from exam_sittings es where es.period_id = rp.id and es.status = 'scheduled') as "scheduledSittings",
          (select count(*)::integer from exam_publications ep where ep.period_id = rp.id) as "publicationEditions",
          (select count(*)::integer from exam_orders eo where eo.period_id = rp.id) as "ordersTotal",
          (select count(*)::integer from exam_orders eo where eo.period_id = rp.id and eo.status = 'approved') as "ordersApproved",
          (select count(*)::integer from exam_timetables et where et.period_id = rp.id) as "timetablesTotal",
          (select count(*)::integer from exam_timetables et where et.period_id = rp.id and et.status = 'published') as "timetablesPublished",
          (select count(*)::integer from exam_sittings es where es.period_id = rp.id) as "sittingsTotal",
          (select count(*)::integer from exam_sittings es where es.period_id = rp.id and es.status = 'cancelled') as "sittingsCancelled",
          ((select count(*) from exam_orders eo where eo.period_id = rp.id and
            (not exists(select 1 from registration_offerings ro where ro.period_id = eo.period_id and ro.course_id = eo.course_id)
             or (eo.status = 'submitted' and (eo.reviewed_by is not null or eo.reviewed_at is not null))
             or (eo.status in ('approved','returned') and (eo.reviewed_by is null or eo.reviewed_at is null or eo.reviewed_by = eo.submitted_by))))
           + (select count(*) from exam_sittings es where es.period_id = rp.id and
            (not exists(select 1 from registration_offerings ro where ro.period_id = es.period_id and ro.course_id = es.course_id)
             or (es.order_id is not null and not exists(select 1 from exam_orders eo where eo.id = es.order_id and eo.period_id = es.period_id and eo.course_id = es.course_id and eo.status = 'approved'))))
           + (select count(*) from exam_timetables et where et.period_id = rp.id and
            ((et.status = 'published' and (et.published_revision is distinct from et.revision or et.published_by is null or et.published_by = et.prepared_by))
             or (et.published_snapshot is null and (et.published_revision is not null or et.published_at is not null or et.published_by is not null))
             or (et.published_snapshot is not null and not exists(select 1 from exam_publications ep where ep.period_id = et.period_id and ep.revision = et.published_revision
               and ep.revision <= et.revision and ep.snapshot = et.published_snapshot and ep.staff_snapshot is not distinct from et.published_staff_snapshot
               and ep.published_by = et.published_by and ep.published_at = et.published_at))))
           + (select count(*) from exam_publications ep where ep.period_id = rp.id and
            (ep.origin not in ('published','retained') or jsonb_typeof(ep.snapshot) is distinct from 'object'
             or ep.snapshot->>'revision' is distinct from ep.revision::text or jsonb_typeof(ep.snapshot->'sittings') is distinct from 'array'
             or (ep.origin = 'published' and (ep.prepared_by is null or ep.prepared_by = ep.published_by)))))::integer as "sourceFaults"
          from registration_periods rp where rp.id = any($1::text[])`,[selected.map((row) => row.periodId)])).rows : [];
        const byId = new Map(counts.map((row) => [row.periodId,row]));
        if (byId.size !== selected.length || counts.length !== selected.length || counts.some((row) => !selected.some((period) => period.periodId === row.periodId))) throw requestError(409,'Examination report sources require reconciliation.');
        const rows = selected.map((row) => {
          const source = byId.get(row.periodId),controls = examinationReportControls(source);
          return {...row,counts:Object.fromEntries(examinationMetrics.map((metric) => [metric.id,source[metric.id]])),controls};
        });
        const totals = rows.reduce((sum,row) => {for (const metric of examinationMetrics) sum[metric.id] += row.counts[metric.id];return sum;},zeroCounts());
        const {format,...selection} = filters;
        const controls = Object.fromEntries(['ordersReconcile','timetablesReconcile','sittingsReconcile','publicationOriginsReconcile'].map((key) => [key,rows.every((row) => row.controls[key])]));
        const report = {definitionVersion:examinationMetricVersion,controlsVersion:'exam-source-controls-v1',generatedAt,filters:selection,availablePeriods:periods,metrics:examinationMetrics,rows,totals,controls};
        await insertAudit(db,{actorId:actor.accountId,action:format === 'csv' ? 'reports.examinations.exported' : 'reports.examinations.accessed',subjectType:'ExaminationOperationsReport',subjectId:examinationMetricVersion,
          reason:format === 'csv' ? 'Examination workload CSV exported' : 'Examination workload report accessed',metadata:{definitionVersion:examinationMetricVersion,controlsVersion:report.controlsVersion,controls,generatedAt,periodCount:rows.length,filters:selection}});
        return format === 'csv' ? {csv:examinationReportCsv(report),fileName:`examination-operations-${generatedAt.slice(0,10)}.csv`,generatedAt,definitionVersion:examinationMetricVersion} : report;
      });
    }
  };
}
