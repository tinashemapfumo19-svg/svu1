import { randomUUID } from "node:crypto";
import { insertAudit, requestError, withTransaction } from "../support.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const classifications = ["public","internal","confidential","restricted"];

// Exponential back-off: 30s, 1m, 2m, 4m ... capped at one hour.
export function backoffDelayMs(attempt) {
  return Math.min(30_000 * 2 ** Math.max(attempt - 1,0),3_600_000);
}

export function validateConnection(input,{partial = false} = {}) {
  const out = {};
  const has = (key) => (!partial && ["code","name","direction","counterparty","purpose","owner","classification","authMethod"].includes(key)) || input[key] !== undefined;
  const textField = (key,max) => { if (has(key)) { if (!text(input[key],max)) throw requestError(400,`${key} is required (up to ${max} characters).`); out[key] = input[key].trim(); } };
  if (!partial) {
    if (typeof input.code !== "string" || !/^[a-z0-9_]{3,40}$/.test(input.code)) throw requestError(400,"A connection code of 3-40 lower-case letters, digits, or underscores is required.");
    out.code = input.code;
  }
  textField("name",120); textField("counterparty",200); textField("purpose",1000); textField("owner",120); textField("authMethod",200);
  if (has("direction")) { if (!["inbound","outbound","both"].includes(input.direction)) throw requestError(400,"Direction must be inbound, outbound, or both."); out.direction = input.direction; }
  if (has("classification")) { if (!classifications.includes(input.classification)) throw requestError(400,"Unknown classification."); out.classification = input.classification; }
  for (const key of ["agreementRef","retention"]) if (input[key] !== undefined) {
    if (input[key] !== null && (typeof input[key] !== "string" || input[key].length > 500)) throw requestError(400,`${key} must be text up to 500 characters, or null.`);
    out[key] = input[key] === null || !input[key].trim() ? null : input[key].trim();
  }
  const bounded = (key,min,max,nullable) => { if (input[key] !== undefined) {
    if (!(nullable && input[key] === null) && (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)) throw requestError(400,`${key} must be a whole number from ${min}-${max}${nullable ? ", or null" : ""}.`);
    out[key] = input[key];
  } };
  bounded("rateLimitPerMinute",1,100000,true); bounded("timeoutMs",100,120000,false); bounded("maxAttempts",1,20,false);
  if (input.adapter !== undefined) { if (!["none","development"].includes(input.adapter)) throw requestError(400,"Adapter must be none or development until a provider is approved."); out.adapter = input.adapter; }
  return out;
}

// Restricted payloads are never shown in the queue; only their field names are.
export function presentPayload(classification,payload) {
  return classification === "restricted" ? {redacted:true,fields:Object.keys(payload || {}).sort()} : payload;
}

// Development stand-in for real providers: delivers unless the payload asks it to fail or hang, so retry, back-off,
// timeout, and dead-letter handling can be exercised before any provider exists.
export async function developmentAdapter(message) {
  if (message.payload?.simulate === "fail") throw new Error("Simulated provider rejection");
  if (message.payload?.simulate === "timeout") await new Promise(() => {});
  return {receipt:`dev-${message.id}-${message.attempts + 1}`};
}

const connectionSelect = `select id,code,name,direction,counterparty,purpose,owner,classification,auth_method as "authMethod",agreement_ref as "agreementRef",retention,
  rate_limit_per_minute as "rateLimitPerMinute",timeout_ms as "timeoutMs",max_attempts as "maxAttempts",adapter,status,revision,updated_by as "updatedBy",updated_at as "updatedAt" from integration_connections`;
const outboxSelect = `select o.id::int,o.connection_id as "connectionId",c.code as "connectionCode",c.classification,o.idempotency_key as "idempotencyKey",o.operation,o.payload,o.status,o.attempts,
  o.next_attempt_at as "nextAttemptAt",o.last_error as "lastError",o.response,o.created_by as "createdBy",o.created_at as "createdAt",o.delivered_at as "deliveredAt"
  from integration_outbox o join integration_connections c on c.id = o.connection_id`;

// Other modules call this inside their own transaction, so a message is queued exactly when its business change commits.
// Repeating the same idempotency key returns the original message instead of queueing a duplicate.
export async function enqueueIntegration(db,{connectionCode,idempotencyKey,operation,payload,createdBy}) {
  const connection = (await db.query(`${connectionSelect} where code = $1`,[connectionCode])).rows[0];
  if (!connection) throw requestError(404,"Integration connection was not found.");
  if (connection.status === "retired") throw requestError(409,"This connection is retired.");
  if (!direction(connection,"outbound")) throw requestError(409,"This connection does not accept outbound messages.");
  const inserted = await db.query(`insert into integration_outbox (connection_id,idempotency_key,operation,payload,created_by) values ($1,$2,$3,$4,$5)
    on conflict (connection_id,idempotency_key) do nothing returning id::int`,[connection.id,idempotencyKey,operation,JSON.stringify(payload ?? {}),createdBy]);
  const row = (await db.query(`${outboxSelect} where o.connection_id = $1 and o.idempotency_key = $2`,[connection.id,idempotencyKey])).rows[0];
  if (!inserted.rowCount && (row.operation !== operation || JSON.stringify(row.payload) !== JSON.stringify(payload ?? {}))) throw requestError(409,"This idempotency key was already used for a different message.");
  return {...row,replayed:!inserted.rowCount};
}
const direction = (connection,want) => connection.direction === "both" || connection.direction === want;

export function createIntegrationsModule(pool,{adapters = {development:developmentAdapter}} = {}) {
  async function health(db) {
    return Object.fromEntries((await db.query(`select connection_id as id,
      count(*) filter (where status = 'pending')::int as pending,count(*) filter (where status = 'dead')::int as dead,
      count(*) filter (where status = 'delivered' and delivered_at > now() - interval '1 day')::int as "deliveredLastDay",
      max(delivered_at) as "lastDeliveredAt" from integration_outbox group by connection_id`)).rows.map((row) => [row.id,row]));
  }
  async function failures(db) {
    return Object.fromEntries((await db.query(`select o.connection_id as id,count(*) filter (where a.outcome <> 'delivered' and a.attempted_at > now() - interval '1 day')::int as "failedLastDay",
      max(a.attempted_at) filter (where a.outcome <> 'delivered') as "lastFailureAt" from integration_attempts a join integration_outbox o on o.id = a.outbox_id group by o.connection_id`)).rows.map((row) => [row.id,row]));
  }
  // One delivery attempt for a locked message: the adapter runs under the connection timeout, every attempt is recorded,
  // and the message is delivered, rescheduled with back-off, or moved to the dead letters when its retry budget is spent.
  async function attempt(db,message,connection) {
    const adapter = adapters[connection.adapter];
    const started = Date.now();
    let outcome = "delivered",detail = null,response = null;
    try {
      let timer;
      response = await Promise.race([adapter(message),new Promise((_,reject) => {timer = setTimeout(() => reject(Object.assign(new Error(`Timed out after ${connection.timeoutMs} ms`),{timeout:true})),connection.timeoutMs);})])
        .finally(() => clearTimeout(timer));
    } catch (error) { outcome = error.timeout ? "timeout" : "failed"; detail = String(error.message).slice(0,500); }
    const attempts = message.attempts + 1;
    await db.query("insert into integration_attempts (outbox_id,attempt,outcome,detail,duration_ms) values ($1,$2,$3,$4,$5)",[message.id,attempts,outcome,detail,Date.now() - started]);
    if (outcome === "delivered") {
      await db.query("update integration_outbox set status = 'delivered',attempts = $2,response = $3,delivered_at = now(),last_error = null where id = $1",[message.id,attempts,JSON.stringify(response ?? {})]);
    } else {
      const dead = attempts >= connection.maxAttempts;
      await db.query("update integration_outbox set status = $2,attempts = $3,last_error = $4,next_attempt_at = now() + make_interval(secs => $5) where id = $1",
        [message.id,dead ? "dead" : "pending",attempts,detail,dead ? 0 : backoffDelayMs(attempts) / 1000]);
    }
    return {id:message.id,outcome,attempts};
  }
  return {
    async listIntegrations(actor) {
      return withTransaction(pool,async (db) => {
        const [h,f] = [await health(db),await failures(db)];
        const connections = (await db.query(`${connectionSelect} order by status,name`)).rows.map((row) => ({...row,health:{pending:0,dead:0,deliveredLastDay:0,lastDeliveredAt:null,failedLastDay:0,lastFailureAt:null,...h[row.id],...f[row.id],id:undefined}}));
        return {connections,capabilities:{manage:actor.permissions.includes("integrations.manage")}};
      });
    },
    async createConnection(input,actor) {
      if (!input || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      const {reason,...rest} = input;
      const fields = validateConnection(rest);
      return withTransaction(pool,async (db) => {
        if ((await db.query("select 1 from integration_connections where code = $1",[fields.code])).rowCount) throw requestError(409,"That connection code is already used.");
        const id = `icon_${randomUUID()}`;
        await db.query(`insert into integration_connections (id,code,name,direction,counterparty,purpose,owner,classification,auth_method,agreement_ref,retention,rate_limit_per_minute,timeout_ms,max_attempts,adapter,updated_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[id,fields.code,fields.name,fields.direction,fields.counterparty,fields.purpose,fields.owner,fields.classification,fields.authMethod,
          fields.agreementRef ?? null,fields.retention ?? null,fields.rateLimitPerMinute ?? null,fields.timeoutMs ?? 10000,fields.maxAttempts ?? 5,fields.adapter ?? "none",actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"integrations.connection.created",subjectType:"IntegrationConnection",subjectId:id,reason,metadata:fields});
        return (await db.query(`${connectionSelect} where id = $1`,[id])).rows[0];
      });
    },
    // Activation needs a referenced data-sharing agreement unless the data is public; retirement is final.
    async updateConnection(id,input,actor) {
      if (!input || !Number.isInteger(input.revision) || !text(input.reason,2000) || (input.status !== undefined && !["planned","active","suspended","retired"].includes(input.status))) throw requestError(400,"Provide the revision, changes or a status, and a reason.");
      const {revision,reason,status,code,...rest} = input;
      if (code !== undefined) throw requestError(400,"A connection code cannot change.");
      const fields = validateConnection(rest,{partial:true});
      return withTransaction(pool,async (db) => {
        const current = (await db.query(`${connectionSelect} where id = $1 for update`,[id])).rows[0];
        if (!current) throw requestError(404,"Connection was not found.");
        if (current.revision !== revision) throw requestError(409,"This connection changed since you loaded it.");
        if (current.status === "retired") throw requestError(409,"Retired connections cannot change.");
        const next = {...current,...fields,status:status || current.status};
        if (next.status === "active" && !next.agreementRef && next.classification !== "public") throw requestError(409,"Record the data-sharing agreement before activating a connection that carries non-public data.");
        await db.query(`update integration_connections set name = $2,direction = $3,counterparty = $4,purpose = $5,owner = $6,classification = $7,auth_method = $8,agreement_ref = $9,retention = $10,
          rate_limit_per_minute = $11,timeout_ms = $12,max_attempts = $13,adapter = $14,status = $15,revision = revision + 1,updated_by = $16,updated_at = now() where id = $1`,
          [id,next.name,next.direction,next.counterparty,next.purpose,next.owner,next.classification,next.authMethod,next.agreementRef,next.retention,next.rateLimitPerMinute,next.timeoutMs,next.maxAttempts,next.adapter,next.status,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:status && status !== current.status ? `integrations.connection.${status}` : "integrations.connection.updated",subjectType:"IntegrationConnection",subjectId:id,reason,
          metadata:{changes:Object.keys(fields),fromStatus:current.status,toStatus:next.status}});
        return (await db.query(`${connectionSelect} where id = $1`,[id])).rows[0];
      });
    },
    async listOutbox(filters = {}) {
      const values = [],conditions = [];
      if (filters.status) {values.push(filters.status); conditions.push(`o.status = $${values.length}`);}
      if (filters.connection) {values.push(filters.connection); conditions.push(`c.code = $${values.length}`);}
      const rows = (await pool.query(`${outboxSelect} ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by o.id desc limit 200`,values)).rows;
      return rows.map(({classification,payload,...row}) => ({...row,payload:presentPayload(classification,payload)}));
    },
    async enqueueManual(input,actor) {
      if (!input || Object.keys(input).some((key) => !["connectionCode","idempotencyKey","operation","payload","reason"].includes(key)) || !text(input.connectionCode,40) || !text(input.idempotencyKey,200)
        || input.idempotencyKey.length < 8 || !text(input.operation,80) || (input.payload !== undefined && (typeof input.payload !== "object" || Array.isArray(input.payload) || input.payload === null)) || !text(input.reason,2000)) {
        throw requestError(400,"Provide the connection, an idempotency key of 8-200 characters, an operation, an optional payload object, and a reason.");
      }
      return withTransaction(pool,async (db) => {
        const message = await enqueueIntegration(db,{connectionCode:input.connectionCode,idempotencyKey:input.idempotencyKey,operation:input.operation,payload:input.payload,createdBy:actor.accountId});
        if (!message.replayed) await insertAudit(db,{actorId:actor.accountId,action:"integrations.message.queued",subjectType:"IntegrationMessage",subjectId:String(message.id),reason:input.reason,metadata:{connection:input.connectionCode,operation:input.operation}});
        const {classification,payload,...row} = message;
        return {...row,payload:presentPayload(classification,payload)};
      });
    },
    // Runs one pass of the delivery worker over due messages. Suspended or retired connections and connections without an
    // adapter are skipped; a connection's per-minute limit caps how many attempts it gets.
    async processOutbox(input = {},actor = null) {
      const limit = Math.min(Math.max(Number(input.limit) || 25,1),100);
      const results = [];
      const due = (await pool.query(`select o.id::int from integration_outbox o join integration_connections c on c.id = o.connection_id
        where o.status = 'pending' and o.next_attempt_at <= now() and c.adapter <> 'none' and c.status in ('planned','active') ${input.connectionCode ? "and c.code = $2" : ""}
        order by o.next_attempt_at,o.id limit $1`,input.connectionCode ? [limit,input.connectionCode] : [limit])).rows;
      for (const {id} of due) {
        const result = await withTransaction(pool,async (db) => {
          const message = (await db.query(`select id::int,connection_id as "connectionId",operation,payload,attempts,status from integration_outbox where id = $1 and status = 'pending' and next_attempt_at <= now() for update skip locked`,[id])).rows[0];
          if (!message) return null;
          const connection = (await db.query(`${connectionSelect} where id = $1`,[message.connectionId])).rows[0];
          if (connection.rateLimitPerMinute) {
            const recent = (await db.query(`select count(*)::int as count from integration_attempts a join integration_outbox o on o.id = a.outbox_id where o.connection_id = $1 and a.attempted_at > now() - interval '1 minute'`,[connection.id])).rows[0].count;
            if (recent >= connection.rateLimitPerMinute) return {id,outcome:"rate_limited",attempts:message.attempts};
          }
          return attempt(db,message,connection);
        });
        if (result) results.push(result);
      }
      if (actor) await insertAudit(pool,{actorId:actor.accountId,action:"integrations.queue.processed",subjectType:"IntegrationQueue",subjectId:input.connectionCode || "all",reason:"Delivery worker run",metadata:{processed:results.length}});
      return {processed:results.length,results};
    },
    async retryMessage(id,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      return withTransaction(pool,async (db) => {
        const row = (await db.query("select status from integration_outbox where id = $1 for update",[id])).rows[0];
        if (!row) throw requestError(404,"Message was not found.");
        if (row.status !== "dead") throw requestError(409,"Only dead letters can be retried.");
        // A retry grants a fresh retry budget; the earlier attempts stay in the attempt history.
        await db.query("update integration_outbox set status = 'pending',attempts = 0,next_attempt_at = now() where id = $1",[id]);
        await insertAudit(db,{actorId:actor.accountId,action:"integrations.message.retried",subjectType:"IntegrationMessage",subjectId:String(id),reason:input.reason});
        return (await db.query(`${outboxSelect} where o.id = $1`,[id])).rows.map(({classification,payload,...r}) => ({...r,payload:presentPayload(classification,payload)}))[0];
      });
    },
    async cancelMessage(id,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      return withTransaction(pool,async (db) => {
        const row = (await db.query("select status from integration_outbox where id = $1 for update",[id])).rows[0];
        if (!row) throw requestError(404,"Message was not found.");
        if (!["pending","dead"].includes(row.status)) throw requestError(409,"Only pending or dead messages can be cancelled.");
        await db.query("update integration_outbox set status = 'cancelled' where id = $1",[id]);
        await insertAudit(db,{actorId:actor.accountId,action:"integrations.message.cancelled",subjectType:"IntegrationMessage",subjectId:String(id),reason:input.reason});
        return (await db.query(`${outboxSelect} where o.id = $1`,[id])).rows.map(({classification,payload,...r}) => ({...r,payload:presentPayload(classification,payload)}))[0];
      });
    },
    async listAttempts(id) {
      return (await pool.query(`select attempt,outcome,detail,duration_ms as "durationMs",attempted_at as "attemptedAt" from integration_attempts where outbox_id = $1 order by id`,[id])).rows;
    },
    // A contract check sends one ping through the real delivery path and reports the outcome straight away.
    async checkConnection(code,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      const message = await withTransaction(pool,async (db) => enqueueIntegration(db,{connectionCode:code,idempotencyKey:`contract-check-${randomUUID()}`,operation:"contract.ping",payload:{check:true},createdBy:actor.accountId}));
      const connection = (await pool.query(`${connectionSelect} where code = $1`,[code])).rows[0];
      if (connection.adapter === "none") {
        await pool.query("update integration_outbox set status = 'cancelled',last_error = 'No adapter is configured for this connection' where id = $1",[message.id]);
        return {connection:code,outcome:"not_configured",detail:"No adapter is configured until the provider is approved."};
      }
      await this.processOutbox({connectionCode:code,limit:100},null);
      const after = (await pool.query("select status,last_error as \"lastError\",attempts from integration_outbox where id = $1",[message.id])).rows[0];
      await insertAudit(pool,{actorId:actor.accountId,action:"integrations.connection.checked",subjectType:"IntegrationConnection",subjectId:connection.id,reason:input.reason,metadata:{outcome:after.status}});
      return {connection:code,outcome:after.status === "delivered" ? "passed" : "failed",detail:after.lastError,attempts:after.attempts};
    }
  };
}
