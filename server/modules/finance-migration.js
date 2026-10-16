import { createHash } from "node:crypto";
import { insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { allocateProgramme, assertActiveReference } from "./student-finance.js";
import { createFinanceReportingModule } from './finance-reporting.js';

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function openingBalanceChecksum(balances) {
  return createHash("sha256").update(JSON.stringify(balances.map((row) => [row.legacyRef,row.studentNumber,row.programmeId ?? null,row.amountMinor]))).digest("hex");
}

// Positive amounts are owed by the student; negative amounts are credit the student holds.
export function validateOpeningBalances(input,today = todayIso()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["source","sourceRef","currency","asOf","reason","dryRun","expectedLineCount","expectedDebitMinor","expectedCreditMinor","checksum","balances"].includes(key))
    || !text(input.source,120) || !text(input.sourceRef,120) || !/^[A-Z]{3}$/.test(input.currency ?? "") || !text(input.reason,2000) || !input.asOf
    || input.dryRun !== undefined && typeof input.dryRun !== "boolean" || !Array.isArray(input.balances) || !input.balances.length || input.balances.length > 5000
    || ![input.expectedLineCount,input.expectedDebitMinor,input.expectedCreditMinor].every(Number.isSafeInteger) || typeof input.checksum !== "string") {
    throw requestError(400,"Provide source, statement reference, currency, as-of date, reason, 1-5000 balances, and control totals with checksum.");
  }
  const asOf = parseEffectiveDate(input.asOf);
  if (asOf > today) throw requestError(400,"Opening balances cannot be dated in the future.");
  const seen = new Set();
  const balances = input.balances.map((row,index) => {
    if (!row || Object.keys(row).some((key) => !["legacyRef","studentNumber","programmeId","amountMinor"].includes(key)) || !text(row.legacyRef,120) || !/^S\d{8}$/.test(row.studentNumber ?? "")
      || row.programmeId !== undefined && !text(row.programmeId,100) || !Number.isSafeInteger(row.amountMinor) || row.amountMinor === 0 || Math.abs(row.amountMinor) > 10_000_000_000) {
      throw requestError(400,`Balance ${index + 1} needs a legacy reference, student number, non-zero whole minor-unit amount, and optional programme.`);
    }
    if (seen.has(row.legacyRef)) throw requestError(400,`Legacy reference ${row.legacyRef} appears more than once.`);
    seen.add(row.legacyRef);
    return {...row,legacyRef:row.legacyRef.trim()};
  });
  const debit = balances.filter((row) => row.amountMinor > 0).reduce((sum,row) => sum + row.amountMinor,0);
  const credit = -balances.filter((row) => row.amountMinor < 0).reduce((sum,row) => sum + row.amountMinor,0);
  if (balances.length !== input.expectedLineCount || debit !== input.expectedDebitMinor || credit !== input.expectedCreditMinor || openingBalanceChecksum(input.balances) !== input.checksum) {
    throw requestError(409,`Opening balances do not reconcile: ${balances.length} line(s), debit ${debit}, credit ${credit} against expected ${input.expectedLineCount}, ${input.expectedDebitMinor}, ${input.expectedCreditMinor}, or the checksum differs.`);
  }
  return {asOf,balances,debit,credit};
}

function requireGlobal(actor,permission) {
  const roles = actor.roles.filter((role) => (role.permissions || []).includes(permission));
  if (!roles.some((role) => role.code === "system_administrator" || isGlobalScope(role.scope))) throw requestError(403,"This finance action needs institution-wide scope.");
}

async function resolveLine(db,row,currency) {
  const student = (await db.query(`select coalesce(m.id,s.id) as id from students s left join students m on m.id = s.merged_into_student_id where s.student_number = $1`,[row.studentNumber])).rows[0];
  if (!student) return {problem:`Student number ${row.studentNumber} was not found.`};
  const programmes = (await db.query("select id from student_programmes where student_id = $1 and status <> 'transferred' order by created_at",[student.id])).rows;
  const programme = row.programmeId ? programmes.find((entry) => entry.id === row.programmeId) : programmes.length === 1 ? programmes[0] : null;
  if (!programme) return {problem:row.programmeId ? `Programme ${row.programmeId} does not belong to ${row.studentNumber}.` : `${row.studentNumber} has ${programmes.length ? "several programme records; name the programme" : "no programme record"}.`};
  if ((await db.query("select 1 from ledger_entries where student_programme_id = $1 and currency = $2 and opening_line_id is not null",[programme.id,currency])).rowCount) return {problem:`${row.studentNumber} already has a ${currency} opening balance.`};
  return {programmeId:programme.id};
}

export function createFinanceMigrationModule(pool) {
  return {
    async importOpeningBalances(input,actor) {
      requireGlobal(actor,"finance.migrate");
      const {asOf,balances,debit,credit} = validateOpeningBalances(input);
      return withTransaction(pool,async (db) => {
        await assertActiveReference(db,"currency",input.currency,"Select an active currency.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`opening:${input.source}:${input.sourceRef.trim()}`]);
        if ((await db.query("select 1 from finance_migrations where source = $1 and source_ref = $2",[input.source.trim(),input.sourceRef.trim()])).rowCount) throw requestError(409,"These opening balances have already been imported.");
        const resolved = [];
        for (const [index,row] of balances.entries()) resolved.push({...row,lineNo:index + 1,...await resolveLine(db,row,input.currency)});
        const byProgramme = new Map();
        for (const row of resolved.filter((entry) => entry.programmeId)) {
          if (byProgramme.has(row.programmeId)) row.problem = `${row.studentNumber} has more than one balance for the same programme in this file.`;
          byProgramme.set(row.programmeId,true);
        }
        const problems = resolved.filter((row) => row.problem).map(({lineNo,legacyRef,problem}) => ({lineNo,legacyRef,message:problem}));
        const report = {lineCount:balances.length,debitMinor:debit,creditMinor:credit,netMinor:debit - credit,ready:!problems.length,problems};
        if (input.dryRun) return {...report,applied:false};
        if (problems.length) throw requestError(409,`Opening balances were not imported: ${problems.slice(0,5).map((row) => `line ${row.lineNo} ${row.message}`).join(" ")}${problems.length > 5 ? ` (${problems.length} problems)` : ""}`);
        const migration = (await db.query(`insert into finance_migrations (source,source_ref,currency,as_of,line_count,debit_minor,credit_minor,checksum,reason,imported_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [input.source.trim(),input.sourceRef.trim(),input.currency,asOf,balances.length,debit,credit,input.checksum,input.reason.trim(),actor.accountId])).rows[0];
        for (const row of resolved) {
          const line = (await db.query("insert into finance_migration_lines (migration_id,line_no,legacy_ref,student_number,student_programme_id,amount_minor) values ($1,$2,$3,$4,$5,$6) returning id",
            [migration.id,row.lineNo,row.legacyRef,row.studentNumber,row.programmeId,row.amountMinor])).rows[0];
          const description = `Opening balance ${row.legacyRef} as of ${asOf}`;
          if (row.amountMinor > 0) await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,charge_code,description,due_on,opening_line_id,actor_id) values ($1,'charge',$2,$3,'OPENING_BALANCE',$4,$5,$6,$7)`,
            [row.programmeId,input.currency,row.amountMinor,description,asOf,line.id,actor.accountId]);
          else await db.query(`insert into ledger_entries (student_programme_id,entry_type,currency,amount_minor,description,opening_line_id,actor_id) values ($1,'credit',$2,$3,$4,$5,$6)`,
            [row.programmeId,input.currency,-row.amountMinor,description,line.id,actor.accountId]);
          await allocateProgramme(db,row.programmeId);
        }
        await insertAudit(db,{actorId:actor.accountId,action:"finance.opening_balances.imported",subjectType:"FinanceMigration",subjectId:String(migration.id),reason:input.reason,
          metadata:{source:input.source.trim(),sourceRef:input.sourceRef.trim(),currency:input.currency,asOf,lineCount:balances.length,debitMinor:debit,creditMinor:credit,checksum:input.checksum}});
        return {...report,id:migration.id,applied:true};
      });
    },
    ...createFinanceReportingModule(pool)
  };
}
