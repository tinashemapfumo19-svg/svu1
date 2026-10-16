import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { admissionsPlacesSql, transferredSeatsSql } from './intake-capacity.js';

export const admissionsMetricVersion = 'admissions-operations-v1';
const metric = (id,label,formula,exclusions,group = 'applications') => Object.freeze({id,label,formula,exclusions,group,unit:group === 'capacity' ? 'places' : 'applications',
  owner:'Admissions office (proposed)',approval:'Development definition; owner approval pending',filters:'Current admissions.review programme/intake scope and optional programme/intake',refresh:'On request; one repeatable-read snapshot; no historical as-of reconstruction'});
export const admissionsMetrics = Object.freeze([
  metric('applicationsTotal','Application records','Count all applications in the selected intakes','Not unique people; includes draft and withdrawn records'),
  metric('draftApplications','Draft applications','Application status = draft','Not withdrawn drafts or submitted applications'),
  metric('underReview','Applications under review','Submitted applications with an active current workflow, excluding offer and terminal states','Old workflows, open offers and terminal outcomes; includes information requests and configured review stages'),
  metric('openOffers','Open offers','Submitted applications whose current workflow is Offer issued','Includes overdue offers until the expiry transition is recorded'),
  metric('acceptedApplications','Accepted applications','Submitted applications whose current workflow is Accepted','Not every historical offer/acceptance; not active student headcount'),
  metric('rejectedApplications','Rejected applications','Submitted applications whose current workflow is Rejected','A reopened application is counted in its new workflow, not its old rejection'),
  metric('deferredApplications','Deferred applications','Submitted applications whose current workflow is Deferred','Counted in the original intake, not a manufactured application in the requested later intake'),
  metric('declinedApplications','Declined applications','Submitted applications whose current workflow is Declined','Superseded decisions and old workflows'),
  metric('expiredApplications','Expired applications','Submitted applications whose current workflow is Expired','Overdue offers whose expiry transition has not been recorded'),
  metric('withdrawnApplications','Withdrawn application records','Application status = withdrawn, whether or not it ever had a workflow','Not unique people; replacement applications are separate records'),
  metric('unclassifiedSubmitted','Unclassified submitted applications','Submitted records with no current workflow or a non-active state outside recognized offer/terminal outcomes','Known current classifications; indicates source reconciliation work, not an invented outcome'),
  metric('acceptedNotConverted','Accepted without conversion','Accepted submitted applications without an original student_programmes application binding','Conversion is a subset of acceptance; not onboarding completion, and transfer arrivals are not conversions'),
  metric('overdueOffers','Offers awaiting expiry','Open offers with an unanswered offer decision whose offer_expires_at is before the snapshot time','A subset of open offers; reporting does not expire them or free places'),
  metric('capacity','Intake capacity','Sum configured intake capacities','Not a vacancy promise or admission authority','capacity'),
  metric('placesTaken','Policy-held places','Existing intake-capacity formula: current Offer issued/Accepted workflows plus policy-held transfer arrivals','Not active enrolled students; an overdue offer still holds its place','capacity'),
  metric('transferPlaces','Policy-held transfer places','Existing distinct transfer-arrival student formula, excluding arrivals already counted through Offer issued/Accepted applications','Retained arrival records follow current capacity policy regardless of later programme status','capacity'),
  metric('placesRemaining','Unreserved places','Sum max(capacity - policy-held places, 0), calculated separately for each intake','Cannot offset one over-capacity intake against spare places in another','capacity'),
  metric('overCapacity','Places above capacity','Sum max(policy-held places - capacity, 0), separately for each intake','A reported source condition; not an authorized capacity override','capacity')
]);
const partition = ['draftApplications','underReview','openOffers','acceptedApplications','rejectedApplications','deferredApplications','declinedApplications','expiredApplications','withdrawnApplications','unclassifiedSubmitted'];
export function admissionsReportFilters(input = {}) {
  if (Object.keys(input).some((key) => !['programmeCode','intakeId','format'].includes(key))) throw requestError(400,'Unsupported admissions report filter.');
  const out = {};
  for (const key of ['programmeCode','intakeId']) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 160 || /[\x00\r\n]/.test(value)) throw requestError(400,'Use bounded admissions report filters.');
    out[key] = value.trim();
  }
  out.format = input.format ?? 'json';
  if (!['json','csv'].includes(out.format)) throw requestError(400,'Choose json or csv report output.');
  return out;
}
export function admissionsReportControls(counts) {
  return {applicationsReconcile:partition.reduce((sum,key) => sum+counts[key],0) === counts.applicationsTotal,
    capacityReconciles:counts.placesTaken === counts.openOffers+counts.acceptedApplications+counts.transferPlaces && counts.capacity+counts.overCapacity === counts.placesTaken+counts.placesRemaining};
}
const zero = () => Object.fromEntries(admissionsMetrics.map((entry) => [entry.id,0]));
const csvCell = (value) => {const raw = String(value ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function admissionsReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_programme','filter_intake','row_type','intake_id','programme_code','intake','metric_id','unit','value','applications_reconcile','capacity_reconciles'];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.programmeCode,report.filters.intakeId];
  const rows = admissionsMetrics.map((entry) => [...prefix,'total','','','',entry.id,entry.unit,report.totals[entry.id],report.controls.applicationsReconcile,report.controls.capacityReconciles]);
  for (const row of report.rows) for (const entry of admissionsMetrics) rows.push([...prefix,'intake',row.intakeId,row.programmeCode,row.label,entry.id,entry.unit,row.counts[entry.id],row.controls.applicationsReconcile,row.controls.capacityReconciles]);
  return [header,...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
async function visibleIntakes(db,actor) {
  return (await db.query(`select i.id as "intakeId",i.label,i.status,i.capacity,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.starts_on desc,i.id`)).rows
    .filter((row) => actorCanAccessScope({...actor,authorizingPermission:'admissions.review'},row));
}
export function createAdmissionsReportingModule(pool) {
  function authority(actor) {if (!actor.permissions.includes('admissions.review')) throw requestError(403,'Admissions review authority is required.');}
  return {
    async admissionsMetricDictionary(actor) {authority(actor);return {definitionVersion:admissionsMetricVersion,metrics:admissionsMetrics};},
    async listAdmissionsReportingIntakes(actor) {
      authority(actor);
      return withTransaction(pool,async (db) => {
        const intakes = await visibleIntakes(db,actor);
        await insertAudit(db,{actorId:actor.accountId,action:'reports.admissions.intakes.accessed',subjectType:'AdmissionsOperationsReport',subjectId:admissionsMetricVersion,reason:'Authorized reporting intakes accessed',metadata:{intakeCount:intakes.length}});
        return intakes;
      });
    },
    async admissionsOperationsReport(input,actor) {
      authority(actor);const filters = admissionsReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const intakes = await visibleIntakes(db,actor);
        const selected = intakes.filter((row) => ['programmeCode','intakeId'].every((key) => !filters[key] || row[key] === filters[key]));
        if (filters.intakeId && !selected.length) throw requestError(404,'Admissions reporting intake was not found.');
        const ids = selected.map((row) => row.intakeId);
        // Intake-wide counts are only valid when every application has its expected authoritative scope binding.
        if (ids.length && (await db.query(`select 1 from applications a join intakes i on i.id = a.intake_id join programmes p on p.id = i.programme_id
          left join resource_scopes rs on rs.resource_type = 'Application' and rs.resource_id = a.id
          where a.intake_id = any($1::text[]) and (rs.resource_id is null or rs.programme_code is distinct from p.code or rs.intake_id is distinct from i.id) limit 1`,[ids])).rows.length) throw requestError(409,'Admissions source scopes require reconciliation before reporting.');
        const aggregates = ids.length ? (await db.query(`select a.intake_id as "intakeId",count(*)::integer as "applicationsTotal",
          count(*) filter (where a.status = 'draft')::integer as "draftApplications",
          count(*) filter (where a.status = 'submitted' and w.status = 'active' and w.state not in ('Offer issued','Accepted','Rejected','Deferred','Declined','Expired'))::integer as "underReview",
          count(*) filter (where a.status = 'submitted' and w.state = 'Offer issued')::integer as "openOffers",
          count(*) filter (where a.status = 'submitted' and w.state = 'Accepted')::integer as "acceptedApplications",
          count(*) filter (where a.status = 'submitted' and w.state = 'Rejected')::integer as "rejectedApplications",
          count(*) filter (where a.status = 'submitted' and w.state = 'Deferred')::integer as "deferredApplications",
          count(*) filter (where a.status = 'submitted' and w.state = 'Declined')::integer as "declinedApplications",
          count(*) filter (where a.status = 'submitted' and w.state = 'Expired')::integer as "expiredApplications",
          count(*) filter (where a.status = 'withdrawn')::integer as "withdrawnApplications",
          count(*) filter (where a.status = 'submitted' and (w.id is null or (w.status <> 'active' and w.state not in ('Offer issued','Accepted','Rejected','Deferred','Declined','Expired'))))::integer as "unclassifiedSubmitted",
          count(*) filter (where a.status = 'submitted' and w.state = 'Accepted' and not exists (select 1 from student_programmes sp where sp.application_id = a.id and sp.origin_programme_id is null))::integer as "acceptedNotConverted",
          count(*) filter (where a.status = 'submitted' and w.state = 'Offer issued' and exists (select 1 from application_decisions ad where ad.application_id = a.id and ad.decision = 'offer' and ad.response is null and ad.offer_expires_at < transaction_timestamp()))::integer as "overdueOffers"
          from applications a left join workflow_instances w on w.id = a.workflow_instance_id where a.intake_id = any($1::text[]) group by a.intake_id`,[ids])).rows : [];
        const seats = ids.length ? (await db.query(`select i.id as "intakeId",${admissionsPlacesSql} + ${transferredSeatsSql} as "placesTaken",${transferredSeatsSql} as "transferPlaces" from intakes i where i.id = any($1::text[])`,[ids])).rows : [];
        const byId = new Map(aggregates.map((row) => [row.intakeId,row])),seatById = new Map(seats.map((row) => [row.intakeId,row]));
        const rows = selected.map((row) => {
          const counts = {...zero(),...byId.get(row.intakeId),...seatById.get(row.intakeId),capacity:row.capacity};delete counts.intakeId;
          counts.placesRemaining = Math.max(counts.capacity-counts.placesTaken,0);counts.overCapacity = Math.max(counts.placesTaken-counts.capacity,0);
          return {...row,counts,controls:admissionsReportControls(counts)};
        });
        const totals = rows.reduce((sum,row) => {for (const entry of admissionsMetrics) sum[entry.id] += row.counts[entry.id];return sum;},zero());
        const controls = admissionsReportControls(totals);
        // Opposing source discrepancies in separate intakes must not cancel in the aggregate check.
        for (const key of Object.keys(controls)) controls[key] &&= rows.every((row) => row.controls[key]);
        const {format,...selection} = filters,report = {definitionVersion:admissionsMetricVersion,generatedAt,filters:selection,availableIntakes:intakes,metrics:admissionsMetrics,rows,totals,controls};
        await insertAudit(db,{actorId:actor.accountId,action:format === 'csv' ? 'reports.admissions.exported' : 'reports.admissions.accessed',subjectType:'AdmissionsOperationsReport',subjectId:admissionsMetricVersion,
          reason:format === 'csv' ? 'Admissions workload CSV exported' : 'Admissions workload report accessed',metadata:{definitionVersion:admissionsMetricVersion,generatedAt,filters:selection,intakeCount:rows.length,controls}});
        return format === 'csv' ? {csv:admissionsReportCsv(report),fileName:`admissions-operations-${generatedAt.slice(0,10)}.csv`,definitionVersion:admissionsMetricVersion,generatedAt} : report;
      });
    }
  };
}
