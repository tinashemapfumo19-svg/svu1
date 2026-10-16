import test from "node:test";
import assert from "node:assert/strict";
import { sameIdentity, validateIdentityRequest, validateIdentityReview } from "../server/modules/identity-corrections.js";

const current = {legalName:"Tendai Moyo",preferredName:"Tendai",dateOfBirth:"2004-05-06",nationalityCode:"ZW"};
const input = (changes) => ({revision:0,changes,reason:"Birth certificate shows a different spelling",evidenceRef:"SAMPLE-ID-1"});

test("identity corrections accept only governed fields and drop unchanged values",() => {
  assert.deepEqual(validateIdentityRequest(input({legalName:"  Tendai   Moyo-Chikore ",preferredName:"Tendai"}),current,"2026-10-03"),{legalName:"Tendai Moyo-Chikore"});
  assert.deepEqual(validateIdentityRequest(input({dateOfBirth:"2004-06-05",nationalityCode:"ZA"}),current,"2026-10-03"),{dateOfBirth:"2004-06-05",nationalityCode:"ZA"});
  for (const changes of [{legalName:"Tendai Moyo"},{},{email:"other@example.com"},{nationalId:"63-123456A12"},{religion:"private"}]) {
    assert.throws(() => validateIdentityRequest(input(changes),current,"2026-10-03"),{statusCode:400});
  }
});
test("identity corrections reject invalid values and incomplete evidence",() => {
  for (const changes of [{legalName:"A"},{legalName:"x".repeat(201)},{legalName:"Bad\u0000Name"},{preferredName:"   "},{dateOfBirth:"2004-02-30"},{dateOfBirth:"2020-01-01"},{dateOfBirth:"1900-01-01"},{nationalityCode:"zw"},{legalName:42}]) {
    assert.throws(() => validateIdentityRequest(input(changes),current,"2026-10-03"),{statusCode:400});
  }
  for (const other of [{reason:""},{evidenceRef:""},{evidenceRef:"x".repeat(301)},{revision:-1},{revision:"0"},{changes:[]},{effectiveOn:"2026-01-01"}]) {
    assert.throws(() => validateIdentityRequest({...input({legalName:"Tendai Chikore"}),...other},current,"2026-10-03"),{statusCode:400});
  }
});
test("identity reviews need an outcome and reason, and stale snapshots are detected",() => {
  assert.doesNotThrow(() => validateIdentityReview({outcome:"approved",reason:"Original certificate inspected"}));
  for (const invalid of [null,{},{outcome:"approved",reason:" "},{outcome:"merged",reason:"x"},{outcome:"rejected",reason:"x",changes:{}}]) assert.throws(() => validateIdentityReview(invalid),{statusCode:400});
  assert.equal(sameIdentity(current,{...current}),true);
  assert.equal(sameIdentity(current,{...current,dateOfBirth:null}),false);
  assert.equal(sameIdentity({...current,nationalityCode:undefined},{...current,nationalityCode:null}),true);
});
