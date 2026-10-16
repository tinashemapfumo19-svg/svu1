import { createHash } from "node:crypto";
import { assertSeparateApprover, insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { assertActiveReference, paymentReferenceExists, postPayment } from "./student-finance.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function statementChecksum(lines) {
  return createHash("sha256").update(JSON.stringify(lines.map((line) => [line.externalRef,line.amountMinor,line.receivedOn,line.payerReference]))).digest("hex");
}

export function validateStatement(input,today = todayIso()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["source","sourceRef","currency","reason","expectedLineCount","expectedTotalMinor","checksum","lines"].includes(key))
    || !["bank","mobile_money"].includes(input.source) || !text(input.sourceRef,120) || !/^[A-Z]{3}$/.test(input.currency ?? "") || !text(input.reason,2000)
    || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 2000 || !Number.isInteger(input.expectedLineCount) || !Number.isSafeInteger(input.expectedTotalMinor)
    || typeof input.checksum !== "string") throw requestError(400,"Provide source, statement reference, currency, reason, 1-2000 lines, and control totals with checksum.");
  const lines = input.lines.map((line,index) => {
    if (!line || Object.keys(line).some((key) => !["externalRef","amountMinor","receivedOn","payerReference"].includes(key)) || !text(line.externalRef,120)
      || !Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0 || line.amountMinor > 10_000_000_000 || typeof line.payerReference !== "string" || line.payerReference.length > 300 || !line.receivedOn) {
      throw requestError(400,`Line ${index + 1} needs a reference, positive whole minor-unit amount, received date, and payer reference.`);
    }
    const receivedOn = parseEffectiveDate(line.receivedOn);
    if (receivedOn > today) throw requestError(400,`Line ${index + 1} is dated in the future.`);
    return {externalRef:line.externalRef.trim(),amountMinor:line.amountMinor,receivedOn,payerReference:line.payerReference.trim()};
  });
  const total = lines.reduce((sum,line) => sum + line.amountMinor,0);
  if (lines.length !== input.expectedLineCount || total !== input.expectedTotalMinor || statementChecksum(input.lines) !== input.checksum) {
    throw requestError(409,`The statement does not reconcile: ${lines.length} line(s) totalling ${total} against expected ${input.expectedLineCount} totalling ${input.expectedTotalMinor}, or the checksum differs.`);
  }
  return {lines,total};
}

export function studentNumbersIn(payerReference) {
  return [...new Set((payerReference.toUpperCase().match(/\bS\d{8}\b/g) || []))];
}

function requireGlobalImport(actor) {
  const roles = actor.roles.filter((role) => (role.permissions || []).includes("finance.import"));
  if (!roles.some((role) => role.code === "system_administrator" || isGlobalScope(role.scope))) throw requestError(403,"Statement imports and the unmatched queue need institution-wide finance scope.");
}

// A merged duplicate resolves to its surviving record; withdrawn and transferred programmes do not take payments automatically.
async function activeProgrammesFor(db,studentNumber) {
  const student = (await db.query(`select coalesce(m.id,s.id) as id,coalesce(m.student_number,s.student_number) as "studentNumber" from students s
    left join students m on m.id = s.merged_into_student_id where s.student_number = $1`,[studentNumber])).rows[0];
  if (!student) return {student:null,programmes:[]};
  const programmes = (await db.query(`select sp.id,sp.status,p.code as "programmeCode",i.label as "intakeLabel" from student_programmes sp join intakes i on i.id = sp.intake_id
    join programmes p on p.id = i.programme_id where sp.student_id = $1 and sp.status not in ('transferred','withdrawn') order by sp.created_at`,[student.id])).rows;
  return {student,programmes};
}

async function matchLine(db,line) {
  const numbers = studentNumbersIn(line.payerReference);
  if (numbers.length !== 1) return {status:"unmatched",note:numbers.length ? "Several student numbers in the payer reference." : "No student number in the payer reference."};
  const {student,programmes} = await activeProgrammesFor(db,numbers[0]);
  if (!student) return {status:"unmatched",note:`Student number ${numbers[0]} was not found.`};
  if (programmes.length !== 1) return {status:"unmatched",note:programmes.length ? `${student.studentNumber} has several active programme records.` : `${student.studentNumber} has no active programme record.`};
  return {status:"matched",note:`Matched ${student.studentNumber}.`,programme:{id:programmes[0].id,studentNumber:student.studentNumber}};
}

const lineSelect = `select l.id::int,l.import_id::int as "importId",l.line_no as "lineNo",l.external_ref as "externalRef",l.amount_minor as "amountMinor",to_char(l.received_on,'YYYY-MM-DD') as "receivedOn",
  l.payer_reference as "payerReference",l.status,l.match_note as "matchNote",l.student_programme_id as "programmeId",l.payment_id::int as "paymentId",l.resolution_reason as "resolutionReason",
  i.source,i.source_ref as "sourceRef",i.currency,i.imported_by as "importedBy" from payment_import_lines l join payment_imports i on i.id = l.import_id`;
const numeric = (row) => ({...row,amountMinor:Number(row.amountMinor)});

export function createPaymentImportsModule(pool) {
  return {
    async listPaymentImports(actor) {
      requireGlobalImport(actor);
      return withTransaction(pool,async (db) => {
        const imports = (await db.query(`select i.id::int,i.source,i.source_ref as "sourceRef",i.currency,i.line_count as "lineCount",i.total_minor as "totalMinor",i.imported_by as "importedBy",i.imported_at as "importedAt",
          coalesce((select json_object_agg(status,count) from (select status,count(*) from payment_import_lines where import_id = i.id group by status) c),'{}'::json) as counts
          from payment_imports i order by i.id desc limit 20`)).rows.map((row) => ({...row,totalMinor:Number(row.totalMinor)}));
        const queue = (await db.query(`${lineSelect} where l.status = 'unmatched' order by l.id limit 100`)).rows.map(numeric);
        return {imports,queue,accountId:actor.accountId};
      });
    },
    async importPaymentStatement(input,actor) {
      requireGlobalImport(actor);
      const {lines,total} = validateStatement(input);
      return withTransaction(pool,async (db) => {
        await assertActiveReference(db,"currency",input.currency,"Select an active currency.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`statement:${input.source}:${input.sourceRef.trim()}`]);
        if ((await db.query("select 1 from payment_imports where source = $1 and source_ref = $2",[input.source,input.sourceRef.trim()])).rowCount) throw requestError(409,"This statement has already been imported.");
        const statement = (await db.query(`insert into payment_imports (source,source_ref,currency,line_count,total_minor,checksum,reason,imported_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [input.source,input.sourceRef.trim(),input.currency,lines.length,total,input.checksum,input.reason.trim(),actor.accountId])).rows[0];
        const counts = {matched:0,duplicate:0,unmatched:0};
        const seen = new Set();
        for (const [index,line] of lines.entries()) {
          const repeated = seen.has(line.externalRef); seen.add(line.externalRef);
          const result = repeated || await paymentReferenceExists(db,input.source,line.externalRef) ? {status:"duplicate",note:"This payment reference has already been recorded."} : await matchLine(db,line);
          const posted = result.status === "matched" ? await postPayment(db,result.programme,{currency:input.currency,amountMinor:line.amountMinor,method:input.source,externalRef:line.externalRef,receivedOn:line.receivedOn,
            reason:`Statement ${input.sourceRef.trim()} line ${index + 1}`,importRef:`${statement.id}:${index + 1}`},actor.accountId) : null;
          await db.query(`insert into payment_import_lines (import_id,line_no,external_ref,amount_minor,received_on,payer_reference,status,match_note,student_programme_id,payment_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [statement.id,index + 1,line.externalRef,line.amountMinor,line.receivedOn,line.payerReference,result.status,result.note,result.programme?.id ?? null,posted?.id ?? null]);
          counts[result.status]++;
        }
        await insertAudit(db,{actorId:actor.accountId,action:"finance.statement.imported",subjectType:"PaymentImport",subjectId:String(statement.id),reason:input.reason,
          metadata:{source:input.source,sourceRef:input.sourceRef.trim(),currency:input.currency,lineCount:lines.length,totalMinor:total,checksum:input.checksum,...counts}});
        return {id:statement.id,lineCount:lines.length,totalMinor:total,...counts};
      });
    },
    async resolvePaymentImportLine(lineId,input,actor) {
      requireGlobalImport(actor);
      if (!input || Object.keys(input).some((key) => !["action","studentNumber","programmeId","reason"].includes(key)) || !["assign","return"].includes(input.action) || !text(input.reason,2000)
        || input.action === "assign" && !/^S\d{8}$/.test(input.studentNumber ?? "") || input.action === "return" && (input.studentNumber || input.programmeId)) throw requestError(400,"Assign to a student number or mark as returned, with a reason.");
      return withTransaction(pool,async (db) => {
        const line = (await db.query(`${lineSelect} where l.id = $1 for update of l`,[lineId])).rows.map(numeric)[0];
        if (!line) throw requestError(404,"Statement line was not found.");
        if (line.status !== "unmatched") throw requestError(409,"Only unmatched statement lines can be resolved.");
        assertSeparateApprover(line.importedBy,actor);
        let programme = null,paymentId = null;
        if (input.action === "assign") {
          const {student,programmes} = await activeProgrammesFor(db,input.studentNumber);
          if (!student) throw requestError(404,"Student number was not found.");
          programme = input.programmeId ? programmes.find((row) => row.id === input.programmeId) : programmes.length === 1 ? programmes[0] : null;
          if (!programme) throw requestError(409,programmes.length ? "Choose which active programme record receives this payment." : "This student has no active programme record.");
          if (await paymentReferenceExists(db,line.source,line.externalRef)) throw requestError(409,"This payment reference has already been recorded.");
          paymentId = (await postPayment(db,{id:programme.id,studentNumber:student.studentNumber},{currency:line.currency,amountMinor:line.amountMinor,method:line.source,externalRef:line.externalRef,
            receivedOn:line.receivedOn,reason:`Statement ${line.sourceRef} line ${line.lineNo}: ${input.reason.trim()}`,importRef:`${line.importId}:${line.lineNo}`},actor.accountId)).id;
        }
        await db.query(`update payment_import_lines set status = $2,student_programme_id = $3,payment_id = $4,resolved_by = $5,resolved_at = now(),resolution_reason = $6 where id = $1`,
          [line.id,input.action === "assign" ? "assigned" : "returned",programme?.id ?? null,paymentId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`finance.statement.line_${input.action === "assign" ? "assigned" : "returned"}`,subjectType:"PaymentImportLine",subjectId:String(line.id),reason:input.reason,
          metadata:{importId:line.importId,lineNo:line.lineNo,externalRef:line.externalRef,amountMinor:line.amountMinor,programmeId:programme?.id ?? null,paymentId}});
        return {id:line.id,status:input.action === "assign" ? "assigned" : "returned",programmeId:programme?.id ?? null,paymentId};
      });
    }
  };
}
