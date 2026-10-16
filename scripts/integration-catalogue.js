// Baseline integration catalogue: the connections the rebuild already depends on or has decided to need. Each stays
// planned until its provider and data-sharing agreement are approved. Loaded idempotently by `npm run reference:load`
// and the dev seed; operators change status and details through the integrations API afterwards.
export const integrationCatalogue = [
  {id:"icon_lms",code:"lms_connector",name:"Learning management system",direction:"both",counterparty:"LMS product to be selected (ADR-008, D-11)",
    purpose:"Course provisioning manifest out; course outcomes back for review",owner:"Academic IT",classification:"confidential",authMethod:"Service account bearer token (lms.sync)",
    agreementRef:null,retention:"Outcome batches retained with results evidence",rateLimitPerMinute:600,timeoutMs:10000,maxAttempts:5,adapter:"none",status:"planned"},
  {id:"icon_email",code:"email_provider",name:"Email delivery",direction:"outbound",counterparty:"Email provider to be selected (ADR-005, D-06)",
    purpose:"Notifications, activation and recovery messages",owner:"Communications",classification:"confidential",authMethod:"Provider API key",
    agreementRef:null,retention:"Delivery records per notification policy",rateLimitPerMinute:1200,timeoutMs:10000,maxAttempts:5,adapter:"development",status:"planned"},
  {id:"icon_sms",code:"sms_provider",name:"SMS delivery",direction:"outbound",counterparty:"SMS provider to be selected (D-06)",
    purpose:"Short operational messages where consented",owner:"Communications",classification:"confidential",authMethod:"Provider API key",
    agreementRef:null,retention:"Delivery records per notification policy",rateLimitPerMinute:300,timeoutMs:10000,maxAttempts:5,adapter:"development",status:"planned"},
  {id:"icon_payments",code:"payment_gateway",name:"Payment gateway",direction:"both",counterparty:"Payment provider to be selected (D-06)",
    purpose:"Student fee payments and confirmations",owner:"Finance",classification:"restricted",authMethod:"Provider credentials and signed callbacks",
    agreementRef:null,retention:"Per finance retention policy",rateLimitPerMinute:600,timeoutMs:15000,maxAttempts:3,adapter:"none",status:"planned"},
  {id:"icon_scanner",code:"malware_scanner",name:"Malware scanning",direction:"outbound",counterparty:"Scanner to be selected (ADR-004, D-05)",
    purpose:"Scan every uploaded document before it is available",owner:"IT Security",classification:"restricted",authMethod:"Service credentials",
    agreementRef:null,retention:"Scan results retained with the document",rateLimitPerMinute:300,timeoutMs:30000,maxAttempts:3,adapter:"none",status:"planned"},
  {id:"icon_bank",code:"bank_statements",name:"Bank statement import",direction:"inbound",counterparty:"University bank",
    purpose:"Payment reconciliation imports",owner:"Finance",classification:"restricted",authMethod:"Manual authenticated file import",
    agreementRef:"Existing banking agreement (to be referenced by Finance)",retention:"Per finance retention policy",rateLimitPerMinute:null,timeoutMs:10000,maxAttempts:1,adapter:"none",status:"active"}
];

export async function loadIntegrationCatalogue(db) {
  let inserted = 0;
  for (const row of integrationCatalogue) {
    const result = await db.query(`insert into integration_connections (id,code,name,direction,counterparty,purpose,owner,classification,auth_method,agreement_ref,retention,rate_limit_per_minute,timeout_ms,max_attempts,adapter,status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (id) do nothing`,
      [row.id,row.code,row.name,row.direction,row.counterparty,row.purpose,row.owner,row.classification,row.authMethod,row.agreementRef,row.retention,row.rateLimitPerMinute,row.timeoutMs,row.maxAttempts,row.adapter,row.status]);
    inserted += result.rowCount;
  }
  return inserted;
}
