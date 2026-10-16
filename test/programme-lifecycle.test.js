import test from "node:test";
import assert from "node:assert/strict";
import { lifecycleEvidenceHash, lifecycleTargets, validateLifecycleRequest, validateLifecycleReview } from "../server/modules/programme-lifecycle.js";
import { academicEvidenceHash } from "../server/modules/academic-evidence.js";
const input = () => ({toStatus:"suspended",revision:1,evidenceHash:"evidence",reason:"Synthetic evidence",evidenceRef:"SAMPLE",expiresOn:"2026-10-30",reviewOn:"2026-11-01"});

test("programme lifecycle transitions do not bypass onboarding or award completion",() => {
  assert.deepEqual(lifecycleTargets("onboarded"),["suspended","interrupted","withdrawn"]);
  for (const status of ["suspended","interrupted","withdrawn"]) assert.ok(lifecycleTargets(status).includes("onboarded"));
  for (const status of ["pending_onboarding","completed","unknown"]) assert.deepEqual(lifecycleTargets(status),[]);
  assert.throws(() => validateLifecycleRequest({...input(),toStatus:"completed"},"onboarded","2026-10-02"),{statusCode:409});
  assert.throws(() => validateLifecycleRequest({...input(),toStatus:"onboarded",reviewOn:null},"pending_onboarding","2026-10-02"),{statusCode:409});
});
test("lifecycle requests require bounded evidence, current expiry and hold follow-up dates",() => {
  assert.deepEqual(validateLifecycleRequest(input(),"onboarded","2026-10-02"),{expiresOn:"2026-10-30",reviewOn:"2026-11-01"});
  for (const changes of [{reason:""},{evidenceRef:""},{revision:-1},{expiresOn:"2026-10-01"},{reviewOn:null},{reviewOn:"2026-10-01"},{effectiveOn:"2025-01-01"}]) assert.throws(() => validateLifecycleRequest({...input(),...changes},"onboarded","2026-10-02"),{statusCode:400});
  assert.deepEqual(validateLifecycleRequest({...input(),toStatus:"onboarded",reviewOn:null},"suspended","2026-10-02"),{expiresOn:"2026-10-30",reviewOn:null});
  assert.doesNotThrow(() => validateLifecycleReview({outcome:"approved",reason:"Independent review"}));
  for (const invalid of [null,[],{}, {outcome:"approved",reason:""},{outcome:"approved",reason:"Valid",effectiveOn:"2025-01-01"}]) assert.throws(() => validateLifecycleReview(invalid),{statusCode:400});
});
test("lifecycle evidence binds status revision, profile and registrations independent of row order",() => {
  const source = {programmeId:"sp",status:"onboarded",revision:1,profileRevision:1,profileComplete:true,registrations:[{id:"b",revision:2},{id:"a",revision:1}]};
  const hash = lifecycleEvidenceHash(source); source.registrations.reverse(); assert.equal(lifecycleEvidenceHash(source),hash);
  for (const alter of [(copy) => copy.revision++, (copy) => copy.status = "suspended",(copy) => copy.profileRevision++, (copy) => copy.registrations[0].revision++]) {
    const copy = structuredClone(source); alter(copy); assert.notEqual(lifecycleEvidenceHash(copy),hash);
  }
});
test("lifecycle status revisions invalidate academic evidence after suspension and re-entry",() => {
  const context = {period:{id:"p",startsOn:"2027-01-01",yearOfStudy:2},policy:null,attempts:[],curriculum:[]};
  const original = academicEvidenceHash(context); context.statusRevision = 0; assert.equal(academicEvidenceHash(context),original);
  context.statusRevision = 1; const active = academicEvidenceHash(context); assert.notEqual(active,original);
  context.statusRevision = 3; assert.notEqual(academicEvidenceHash(context),active);
});
