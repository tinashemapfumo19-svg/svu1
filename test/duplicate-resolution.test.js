import test from "node:test";
import assert from "node:assert/strict";
import { duplicateEvidenceHash, mergeConflicts, validateDuplicateRequest, validateDuplicateReview } from "../server/modules/duplicate-resolution.js";

const student = (id,programmes) => ({id,mergedInto:null,identityRevision:0,profileRevision:1,programmes});
const programme = (id,intakeId,status = "onboarded") => ({id,intakeId,status,statusRevision:0});
const request = () => ({candidateStudentId:"stu_b",survivor:"current",proposal:"merge",evidenceHash:"a".repeat(64),reason:"Same person applied twice",evidenceRef:"SAMPLE-ID"});

test("duplicate requests need a candidate, survivor, proposal, current evidence and reasons",() => {
  assert.doesNotThrow(() => validateDuplicateRequest(request()));
  assert.doesNotThrow(() => validateDuplicateRequest({...request(),survivor:"candidate",proposal:"distinct"}));
  for (const change of [{candidateStudentId:""},{survivor:"both"},{proposal:"delete"},{evidenceHash:"stale"},{reason:" "},{evidenceRef:""},{evidenceRef:"x".repeat(301)},{mergeAccounts:true}]) {
    assert.throws(() => validateDuplicateRequest({...request(),...change}),{statusCode:400});
  }
  assert.doesNotThrow(() => validateDuplicateReview({outcome:"rejected",reason:"Different birth certificates"}));
  for (const invalid of [null,{outcome:"merged",reason:"x"},{outcome:"approved",reason:""},{outcome:"approved",reason:"x",survivor:"candidate"}]) assert.throws(() => validateDuplicateReview(invalid),{statusCode:400});
});

test("the pair hash is order independent and binds identities, profiles and programme states",() => {
  const a = student("stu_a",[programme("sp_2","i1"),programme("sp_1","i2")]),b = student("stu_b",[programme("sp_3","i3")]);
  const hash = duplicateEvidenceHash(a,b);
  assert.equal(duplicateEvidenceHash(b,a),hash);
  assert.equal(duplicateEvidenceHash({...a,programmes:[...a.programmes].reverse()},b),hash);
  for (const alter of [(x) => x.identityRevision++,(x) => x.profileRevision++,(x) => x.mergedInto = "stu_c",(x) => x.programmes[0].statusRevision++,(x) => x.programmes[0].status = "withdrawn",(x) => x.programmes.pop()]) {
    const copy = structuredClone(a); alter(copy); assert.notEqual(duplicateEvidenceHash(copy,b),hash);
  }
});

test("merges fail closed on prior merges, open identity work, shared intakes and shared enrolments",() => {
  const survivor = student("stu_a",[programme("sp_1","i1")]),duplicate = student("stu_b",[programme("sp_2","i2")]);
  assert.deepEqual(mergeConflicts(survivor,duplicate),[]);
  assert.equal(mergeConflicts(survivor,{...duplicate,programmes:[programme("sp_2","i1")]}).length,1);
  assert.deepEqual(mergeConflicts(survivor,{...duplicate,programmes:[programme("sp_2","i1","transferred")]}),[]);
  assert.equal(mergeConflicts({...survivor,mergedInto:"stu_c"},duplicate).length,1);
  assert.equal(mergeConflicts(survivor,duplicate,{openIdentity:true}).length,1);
  assert.equal(mergeConflicts(survivor,duplicate,{sharedEnrolments:1}).length,1);
});
