import test from "node:test";
import assert from "node:assert/strict";
import { statementChecksum, studentNumbersIn, validateStatement } from "../server/modules/payment-imports.js";

const lines = () => [{externalRef:"FT1",amountMinor:5000,receivedOn:"2026-10-01",payerReference:"Fees S26000001"},{externalRef:"FT2",amountMinor:2500,receivedOn:"2026-10-02",payerReference:"unknown payer"}];
const statement = (overrides = {}) => {const rows = overrides.lines || lines();return {source:"bank",sourceRef:"STMT-1",currency:"USD",reason:"Daily statement",expectedLineCount:rows.length,expectedTotalMinor:rows.reduce((sum,row) => sum + row.amountMinor,0),checksum:statementChecksum(rows),lines:rows,...overrides};};

test("statements reconcile line count, total and checksum before anything posts",() => {
  assert.equal(validateStatement(statement(),"2026-10-03").total,7500);
  assert.throws(() => validateStatement(statement({expectedLineCount:3}),"2026-10-03"),{statusCode:409});
  assert.throws(() => validateStatement(statement({expectedTotalMinor:7501}),"2026-10-03"),{statusCode:409});
  const tampered = statement(); tampered.lines = [{...tampered.lines[0],payerReference:"Fees S26000002"},tampered.lines[1]];
  assert.throws(() => validateStatement(tampered,"2026-10-03"),{statusCode:409});
});

test("statement lines need positive whole amounts, references and past dates",() => {
  for (const change of [{amountMinor:0},{amountMinor:1.5},{externalRef:" "},{receivedOn:"2026-10-04"},{receivedOn:"2026-02-30"},{payerReference:7},{account:"x"}]) {
    const rows = [{...lines()[0],...change}];
    assert.throws(() => validateStatement(statement({lines:rows}),"2026-10-03"),{statusCode:400});
  }
  for (const change of [{source:"cash"},{currency:"usd"},{lines:[]},{sourceRef:""}]) assert.throws(() => validateStatement({...statement(),...change},"2026-10-03"),{statusCode:400});
});

test("student numbers are extracted exactly once and never guessed",() => {
  assert.deepEqual(studentNumbersIn("fees s26000001 for S26000001"),["S26000001"]);
  assert.deepEqual(studentNumbersIn("S26000001 and S26000002"),["S26000001","S26000002"]);
  assert.deepEqual(studentNumbersIn("S2600000 / XS260000011 / 26000001"),[]);
});
