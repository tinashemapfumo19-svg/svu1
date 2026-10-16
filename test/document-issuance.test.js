import test from "node:test";
import assert from "node:assert/strict";
import { issuanceCsv, validateIssuanceFilters } from "../server/modules/document-issuance.js";

test("issuance filters accept known kinds, statuses, real date ranges, and bounded search",() => {
  assert.deepEqual(validateIssuanceFilters({kind:"certificate",status:"revoked",from:"2026-01-01",to:"2026-12-31",q:" SVU-CT ",format:"csv"}),
    {kind:"certificate",status:"revoked",from:"2026-01-01",to:"2026-12-31",q:"SVU-CT",format:"csv"});
  assert.deepEqual(validateIssuanceFilters({}),{format:"json"});
  for (const bad of [{kind:"diploma"},{status:"lost"},{from:"2026-02-30"},{from:"2026-03-01",to:"2026-02-01"},{q:"x".repeat(101)}]) assert.throws(() => validateIssuanceFilters(bad),{statusCode:400});
});

test("the issuance CSV quotes values that contain separators",() => {
  const csv = issuanceCsv([{referenceNumber:"SVU-TR-2026-000001",kind:"progressive",status:"revoked",studentNumber:"S1",studentName:"Moyo, Tariro",programmeCode:"BSC",issuedAt:"2026-10-05T10:00:00.000Z",
    issuedBy:"acct_1",supersededAt:null,revokedAt:"2026-10-06T10:00:00.000Z",revokeReason:"Issued in \"error\"",templateVersion:2,verificationCode:"AAAA-BBBB-CCCC-DDDD"}]);
  const [header,line] = csv.trim().split("\r\n");
  assert.equal(header.split(",")[0],"reference_number");
  assert.equal(line,'SVU-TR-2026-000001,progressive,revoked,S1,"Moyo, Tariro",BSC,2026-10-05T10:00:00.000Z,acct_1,,2026-10-06T10:00:00.000Z,"Issued in ""error""",2,AAAA-BBBB-CCCC-DDDD');
});
