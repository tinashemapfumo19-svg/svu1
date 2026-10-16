import {insertAudit,parseEffectiveDate,requestError,withTransaction} from '../support.js';
import {communicationsCan} from './applicant-communications.js';

export const communicationMetricVersion = 'applicant-campaign-operations-v2';
const metric = (id,label,formula,exclusions,group = 'campaigns',unit = 'campaigns') => Object.freeze({id,label,formula,exclusions,group,unit,
  owner:'Admissions communications office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current admissions.communicate intake scope; published campaigns and caller-owned previews only; optional intake/status and inclusive UTC campaign-created cohort',
  refresh:'On request; repeatable-read current-record snapshot, including retained provider outcomes. No historical status reconstruction.'});
export const communicationMetrics = Object.freeze([
  metric('campaignsTotal','Visible campaigns','Retained published campaigns plus caller-owned previews','Other staff previews are private'),
  metric('publishedCampaigns','Published campaigns','Current status published','Not externally delivered campaigns'),
  metric('ownPreviews','Own previews','Current preview created by caller','Other staff previews, including expired ones'),
  metric('liveOwnPreviews','Unexpired own previews','Own preview expires after snapshot time','Not authorization to publish a changed audience'),
  metric('expiredOwnPreviews','Expired own previews','Own preview expires at/before snapshot time','Retained records, not discarded messages'),
  metric('publishedApplications','Captured application opportunities','Sum published audience application counts','Repeated campaigns count the same application again; not current application counts','audience','opportunities'),
  metric('publishedAccountOpportunities','Captured account opportunities','Sum published matched-account counts','Includes unconsented/excluded accounts; repeated campaigns are not unique people','audience','opportunities'),
  metric('publishedRecipientChannels','Captured eligible recipient channels','Sum published consented audience channel counts','One account may have two channels; not delivered recipients','audience','recipient channels'),
  metric('excludedInApp','Captured in-app exclusions','Sum published snapshot excludedInApp counts','Zero when channel not requested; not current opt-out counts','audience','opportunities'),
  metric('excludedEmail','Captured email exclusions','Sum published snapshot excludedEmail counts','Includes inactive accounts/invalid address/unconsented channel; not current opt-out counts','audience','opportunities'),
  metric('recipientChannels','Retained recipient channels','Published campaign recipient records','Not unique recipients or provider deliveries','recipients','recipient channels'),
  metric('recipientAccounts','Distinct recipient accounts','Direct distinct account IDs across published recipient records','Not unique people; intake counts are not additive','recipients','accounts'),
  metric('inAppAvailable','Available in-app messages','In-app recipient records with status available','Read messages remain available; not verified viewing/comprehension','recipients','messages'),
  metric('inAppRead','Recorded in-app reads','Available in-app records with read_at','Explicit portal read action, not comprehension or provider receipt','recipients','messages'),
  metric('inAppUnread','Without a recorded read','Available in-app records with no read_at','Absence of evidence, not proof of non-viewing','recipients','messages'),
  metric('emailQueued','Queued email records','Email recipient records with status queued','Includes pending retries or unenrolled records; not sent email','recipients','messages'),
  metric('emailCancelled','Cancelled email records','Email recipient records with status cancelled','Retained original recipients; no cancellation timestamp or current-consent inference','recipients','messages'),
  metric('emailAccepted','Provider-accepted email','Email recipient records with current status accepted','Not delivered mail; later callback outcomes counted separately','recipients','messages'),
  metric('emailDelivered','Provider-reported delivery','Email recipient records with current status delivered','Signed retained callback, not proof of reading; later bounce/complaint counted separately','recipients','messages'),
  metric('emailBounced','Provider-reported bounces','Email recipient records with current status bounced','Signed retained callback; later complaint counted separately','recipients','messages'),
  metric('emailComplained','Provider-reported complaints','Email recipient records with current status complained','Signed retained callback, not an institutional complaint investigation','recipients','messages'),
  metric('emailFailed','Provider-reported failure','Email recipient records with current status failed','Signed callback after provider acceptance; not local dead letters','recipients','messages'),
  metric('emailDead','Email requiring reconciliation','Email recipient records with current status dead','Source/mailbox faults, permanent rejection or retry exhaustion; not verified non-delivery','recipients','messages'),
  metric('publishedInAppCampaigns','Published in-app campaigns','Published campaigns requesting in_app','May contain zero eligible in-app recipients'),
  metric('publishedEmailCampaigns','Published email campaigns','Published campaigns requesting email','May contain zero eligible email recipients; not dispatched campaigns'),
  metric('publishSamples','Publication timing samples','Published campaigns with publication timestamp','Caller-owned previews','timing'),
  metric('meanPublishMinutes','Mean preview-to-publication time','Mean elapsed UTC minutes from campaign creation to publication','Not handling/business-hours time or approved SLA','timing','minutes'),
  metric('readSamples','Read timing samples','In-app recipient records with recorded read timestamp','Unread records and all email records','timing','messages'),
  metric('meanReadMinutes','Mean availability-to-recorded-read time','Mean elapsed UTC minutes from recipient creation to first retained read_at','Answered/read subset only; not time-to-delivery or comprehension','timing','minutes')
]);
export function communicationReportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['intakeId','status','from','to','format'].includes(k))) throw requestError(400,'Unsupported campaign report filter.');
  const {intakeId = '',status = '',from = '',to = '',format = 'json'} = input;
  if (typeof intakeId !== 'string' || intakeId.length > 160 || /[\r\n\0]/.test(intakeId) || typeof from !== 'string' || typeof to !== 'string' || !['json','csv'].includes(format) || !['','preview','published'].includes(status)) throw requestError(400,'Use bounded campaign report filters.');
  if (Boolean(from) !== Boolean(to)) throw requestError(400,'Choose both campaign-created date bounds or leave both empty.');
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < '0001-01-01') throw requestError(400,'Use valid UTC calendar dates.');
    parseEffectiveDate(from);parseEffectiveDate(to);const days = (Date.parse(to)-Date.parse(from))/86400000;
    if (days < 0 || days > 365) throw requestError(400,'Choose an inclusive campaign-created range of at most 366 days.');
  }
  return {intakeId:intakeId.trim(),status,from,to,format};
}
const empty = () => Object.fromEntries(communicationMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
export function communicationReportControls(c) {
  const sample = (count,value) => count === 0 ? value === null : Number.isFinite(value) && value >= 0;
  return {
    campaignsReconcile:c.campaignsTotal === c.publishedCampaigns+c.ownPreviews && c.ownPreviews === c.liveOwnPreviews+c.expiredOwnPreviews,
    audienceReconciles:c.publishedAccountOpportunities <= c.publishedApplications && c.publishedRecipientChannels === c.recipientChannels,
    channelsReconcile:c.recipientChannels === c.inAppAvailable+c.emailQueued+c.emailCancelled+c.emailAccepted+c.emailDelivered+c.emailBounced+c.emailComplained+c.emailFailed+c.emailDead && c.recipientAccounts <= c.recipientChannels && c.publishedInAppCampaigns <= c.publishedCampaigns && c.publishedEmailCampaigns <= c.publishedCampaigns,
    readsReconcile:c.inAppAvailable === c.inAppRead+c.inAppUnread && c.readSamples === c.inAppRead,
    timingReconciles:c.publishSamples === c.publishedCampaigns && sample(c.publishSamples,c.meanPublishMinutes) && sample(c.readSamples,c.meanReadMinutes)
  };
}
const csvCell = (v) => {const raw = String(v ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function communicationReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_intake','filter_campaign_status','campaign_created_from_utc','campaign_created_to_utc','provider_delivery_evidence_available','row_type','intake_id','programme_code','intake','metric_id','unit','value',...Object.keys(report.controls)];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.intakeId,report.filters.status,report.filters.from,report.filters.to,report.providerDeliveryEvidenceAvailable ?? false];
  const rows = [];
  for (const row of [{type:'total',counts:report.totals,controls:report.controls},...report.rows.map((r) => ({...r,type:'intake'}))]) for (const m of communicationMetrics) rows.push([...prefix,row.type,row.intakeId || '',row.programmeCode || '',row.label || '',m.id,m.unit,row.counts[m.id],...Object.values(row.controls)]);
  return [header,...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
const authority = (actor) => {if (!actor.permissions.includes('admissions.communicate')) throw requestError(403,'Campaign communication authority is required.');};
async function visibleIntakes(db,actor) {
  return (await db.query('select i.id as "intakeId",i.label,i.status,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code,i.id')).rows.filter((r) => communicationsCan(actor,r));
}
const countKeys = ['applications','accounts','recipientChannels','inApp','email','excludedInApp','excludedEmail'];
export function createCommunicationReportingModule(pool) {
  const audit = (db,actor,action,metadata) => insertAudit(db,{actorId:actor.accountId,action:`reports.communications.${action}`,subjectType:'ApplicantCampaignOperationsReport',subjectId:communicationMetricVersion,reason:'Scoped applicant campaign operations report',metadata});
  return {
    async communicationMetricDictionary(actor) {authority(actor);return {definitionVersion:communicationMetricVersion,metrics:communicationMetrics,providerDeliveryEvidenceAvailable:false};},
    async listCommunicationReportingIntakes(actor) {authority(actor);return withTransaction(pool,async (db) => {const rows = await visibleIntakes(db,actor);await audit(db,actor,'intakes.accessed',{intakeCount:rows.length});return rows;});},
    async communicationOperationsReport(input,actor) {
      authority(actor);const filters = communicationReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        if (filters.to && filters.to > generatedAt.slice(0,10)) throw requestError(400,'Campaign-created bounds cannot extend beyond the current UTC date.');
        const availableIntakes = await visibleIntakes(db,actor),selected = availableIntakes.filter((r) => !filters.intakeId || r.intakeId === filters.intakeId);
        if (filters.intakeId && !selected.length) throw requestError(404,'Campaign reporting intake was not found.');
        const ids = selected.map((r) => r.intakeId),bounds = [ids,actor.accountId,filters.from ? `${filters.from}T00:00:00.000Z` : null,filters.to ? new Date(Date.parse(filters.to)+86400000).toISOString() : null,filters.status];
        const cohort = `c.intake_id = any($1::text[]) and (c.status = 'published' or c.created_by = $2) and ($3::timestamptz is null or c.created_at >= $3) and ($4::timestamptz is null or c.created_at < $4) and ($5::text = '' or c.status = $5)`;
        // Guard each publication independently so missing and surplus recipients cannot cancel in totals.
        if (ids.length && (await db.query(`with sources as (
          select c.id,c.status,c.intake_id,c.counts,c.channels,c.filters,c.created_at,c.expires_at,c.published_at,
            ${countKeys.map((k) => `case when jsonb_typeof(c.counts->'${k}') = 'number' then (c.counts->>'${k}')::numeric end as "${k}"`).join(',')},
            case when jsonb_typeof(c.channels) = 'array' then c.channels else '[]'::jsonb end as safe_channels
          from applicant_communication_campaigns c where ${cohort}
        ) select 1 from sources c where
          jsonb_typeof(c.counts) is distinct from 'object' or exists(select 1 from unnest(array[${countKeys.map((k) => `'${k}'`).join(',')}]) k where jsonb_typeof(c.counts->k) is distinct from 'number')
          or ${countKeys.map((k) => `(c."${k}" < 0 or c."${k}" > ${['applications','accounts'].includes(k) ? 10000 : ['excludedInApp','excludedEmail'].includes(k) ? 10000 : 500} or c."${k}" <> trunc(c."${k}"))`).join(' or ')}
          or c."accounts" > c."applications" or c."recipientChannels" <> c."inApp"+c."email"
          or c."inApp" > c."accounts" or c."email" > c."accounts"
          or jsonb_typeof(c.channels) is distinct from 'array' or jsonb_array_length(c.safe_channels) not between 1 and 2
          or exists(select 1 from jsonb_array_elements(c.safe_channels) v where v not in ('"in_app"'::jsonb,'"email"'::jsonb))
          or (select count(distinct v) from jsonb_array_elements(c.safe_channels) v) <> jsonb_array_length(c.safe_channels)
          or c."excludedInApp" <> case when c.safe_channels ? 'in_app' then c."accounts"-c."inApp" else 0 end
          or c."excludedEmail" <> case when c.safe_channels ? 'email' then c."accounts"-c."email" else 0 end
          or not (c.safe_channels ? 'in_app') and c."inApp" <> 0 or not (c.safe_channels ? 'email') and c."email" <> 0
          or not coalesce(jsonb_typeof(c.filters) = 'object' and c.filters->>'intakeId' = c.intake_id and c.filters->>'status' in ('draft','submitted','withdrawn')
            and jsonb_typeof(c.filters->'workflowState') = 'string' and (c.filters->>'status' = 'submitted' or c.filters->>'workflowState' = ''),false)
          or c.created_at > transaction_timestamp() or c.expires_at <= c.created_at or c.published_at < c.created_at or c.published_at > transaction_timestamp()
          or c.status = 'published' and (c."recipientChannels" = 0 or c.published_at >= c.expires_at)
          or c.status = 'preview' and exists(select 1 from applicant_communication_recipients r where r.campaign_id = c.id)
          or c.status = 'published' and ((select count(*) from applicant_communication_recipients r where r.campaign_id = c.id) <> c."recipientChannels"
            or (select count(*) from applicant_communication_recipients r where r.campaign_id = c.id and r.channel = 'in_app') <> c."inApp"
            or (select count(*) from applicant_communication_recipients r where r.campaign_id = c.id and r.channel = 'email') <> c."email")
          or exists(select 1 from applicant_communication_recipients r where r.campaign_id = c.id and (
            not (c.safe_channels ? r.channel) or r.created_at < c.published_at or r.created_at > transaction_timestamp() or r.read_at < r.created_at or r.read_at > transaction_timestamp()
            or not exists(select 1 from applicant_communication_preference_history h where h.account_id = r.account_id and h.revision = r.preference_revision and h.recorded_at <= r.created_at and case when r.channel = 'in_app' then h.in_app else h.email end)
            or r.status in ('accepted','delivered','bounced','complained','failed') and not exists (
              select 1 from applicant_communication_email_links l join email_deliveries d on d.notification_id=l.notification_id
              where l.recipient_id=r.id and d.status=r.status and d.provider_message_id is not null and d.accepted_at is not null)
          )) limit 1`,bounds)).rows.length) throw requestError(409,'Campaign audience, recipient or consent records require reconciliation before reporting.');
        const campaignAggregates = ids.length ? (await db.query(`select c.intake_id as "intakeId",count(*)::integer as "campaignsTotal",count(*) filter(where c.status = 'published')::integer as "publishedCampaigns",
          count(*) filter(where c.status = 'preview')::integer as "ownPreviews",count(*) filter(where c.status = 'preview' and c.expires_at > transaction_timestamp())::integer as "liveOwnPreviews",
          count(*) filter(where c.status = 'preview' and c.expires_at <= transaction_timestamp())::integer as "expiredOwnPreviews",
          coalesce(sum((c.counts->>'applications')::numeric) filter(where c.status = 'published'),0)::double precision as "publishedApplications",
          coalesce(sum((c.counts->>'accounts')::numeric) filter(where c.status = 'published'),0)::double precision as "publishedAccountOpportunities",
          coalesce(sum((c.counts->>'recipientChannels')::numeric) filter(where c.status = 'published'),0)::double precision as "publishedRecipientChannels",
          coalesce(sum((c.counts->>'excludedInApp')::numeric) filter(where c.status = 'published'),0)::double precision as "excludedInApp",
          coalesce(sum((c.counts->>'excludedEmail')::numeric) filter(where c.status = 'published'),0)::double precision as "excludedEmail",
          count(*) filter(where c.status = 'published' and c.channels ? 'in_app')::integer as "publishedInAppCampaigns",
          count(*) filter(where c.status = 'published' and c.channels ? 'email')::integer as "publishedEmailCampaigns",
          count(c.published_at)::integer as "publishSamples",avg(extract(epoch from c.published_at-c.created_at)/60)::double precision as "meanPublishMinutes"
          from applicant_communication_campaigns c where ${cohort} group by grouping sets ((c.intake_id),())`,bounds)).rows : [];
        const recipientAggregates = ids.length ? (await db.query(`select c.intake_id as "intakeId",count(*)::integer as "recipientChannels",count(distinct r.account_id)::integer as "recipientAccounts",
          count(*) filter(where r.channel = 'in_app')::integer as "inAppAvailable",count(r.read_at)::integer as "inAppRead",count(*) filter(where r.channel = 'in_app' and r.read_at is null)::integer as "inAppUnread",
          count(*) filter(where r.status = 'queued')::integer as "emailQueued",count(*) filter(where r.status = 'cancelled')::integer as "emailCancelled",
          count(*) filter(where r.status = 'accepted')::integer as "emailAccepted",count(*) filter(where r.status = 'delivered')::integer as "emailDelivered",
          count(*) filter(where r.status = 'bounced')::integer as "emailBounced",count(*) filter(where r.status = 'complained')::integer as "emailComplained",
          count(*) filter(where r.status = 'failed')::integer as "emailFailed",count(*) filter(where r.status = 'dead')::integer as "emailDead",
          count(r.read_at)::integer as "readSamples",avg(extract(epoch from r.read_at-r.created_at)/60)::double precision as "meanReadMinutes"
          from applicant_communication_campaigns c join applicant_communication_recipients r on r.campaign_id = c.id where ${cohort} and c.status = 'published' group by grouping sets ((c.intake_id),())`,bounds)).rows : [];
        const byId = new Map();
        for (const {intakeId,...counts} of [...campaignAggregates,...recipientAggregates]) byId.set(intakeId,{...empty(),...byId.get(intakeId),...counts});
        const totals = byId.get(null) || empty(),rows = selected.map((r) => {const counts = byId.get(r.intakeId) || empty();return {...r,counts,controls:communicationReportControls(counts)};});
        const controls = Object.fromEntries(Object.entries(communicationReportControls(totals)).map(([k,v]) => [k,v && rows.every((r) => r.controls[k])]));
        const report = {definitionVersion:communicationMetricVersion,generatedAt,filters,availableIntakes,metrics:communicationMetrics,totals,rows,controls,
          providerDeliveryEvidenceAvailable:totals.emailDelivered+totals.emailBounced+totals.emailComplained+totals.emailFailed>0};
        await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{definitionVersion:communicationMetricVersion,intakeCount:rows.length,campaignCount:totals.campaignsTotal,recipientChannelCount:totals.recipientChannels,status:filters.status,from:filters.from,to:filters.to,controls});
        return filters.format === 'csv' ? {filename:'applicant-campaign-operations.csv',csv:communicationReportCsv(report),definitionVersion:communicationMetricVersion,generatedAt} : report;
      });
    }
  };
}
