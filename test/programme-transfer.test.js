import test from "node:test";
import assert from "node:assert/strict";
import { transferBlockers, transferEvidenceHash, validateTransferRequest } from "../server/modules/programme-transfer.js";
import { lifecycleTargets } from "../server/modules/programme-lifecycle.js";
const source = () => ({programme:{id:"sp",status:"onboarded",revision:1,intakeId:"i1",programmeVersionId:"v1"},profileRevision:1,profileComplete:true,registrations:[{id:"b",status:"draft",revision:1},{id:"a",status:"confirmed",endsOn:"2025-12-31"}],recognitions:[{id:"2",status:"approved"},{id:"1",status:"revoked"}]});
const target = () => ({intakeId:"i2",programmeVersionId:"v2",intakeStatus:"published",versionStatus:"published",programmeStatus:"active",effectiveFrom:"2024-01-01",courseCount:1});
test("transfer requests require an explicit destination, bounded evidence and current expiry",() => {
  const input = {intakeId:"i2",programmeVersionId:"v2",revision:1,evidenceHash:"a".repeat(64),reason:"Synthetic transfer",evidenceRef:"SAMPLE",expiresOn:"2026-10-30"};
  assert.equal(validateTransferRequest(input,"2026-10-02"),"2026-10-30");
  for (const changes of [{intakeId:""},{programmeVersionId:12},{revision:-1},{evidenceHash:"stale"},{reason:""},{evidenceRef:""},{expiresOn:"2026-10-01"},{effectiveOn:"2025-01-01"},{copyGrades:true}]) assert.throws(() => validateTransferRequest({...input,...changes},"2026-10-02"),{statusCode:400});
  for (const input of [null,[],{},"x"]) assert.throws(() => validateTransferRequest(input),{statusCode:400});
});
test("transfer eligibility never bypasses inactive status, profile or unresolved confirmed enrolment",() => {
  assert.deepEqual(transferBlockers(source(),target(),"2026-10-02"),[]);
  for (const status of ["pending_onboarding","suspended","interrupted","withdrawn","transferred","completed"]) assert.ok(transferBlockers({...source(),programme:{...source().programme,status}},target(),"2026-10-02").length);
  assert.deepEqual(lifecycleTargets("transferred"),[]);
  assert.ok(transferBlockers({...source(),profileComplete:false},target(),"2026-10-02").length);
  for (const endsOn of [null,"2026-10-02","2027-01-01"]) assert.ok(transferBlockers({...source(),registrations:[{id:"a",status:"confirmed",endsOn}]},target(),"2026-10-02").length);
  for (const changes of [{intakeId:"i1",programmeVersionId:"v1"},{intakeStatus:"draft"},{versionStatus:"retired"},{programmeStatus:"retired"},{effectiveFrom:"2027-01-01"},{effectiveTo:"2026-09-01"},{courseCount:0}]) assert.ok(transferBlockers(source(),{...target(),...changes},"2026-10-02").length);
  assert.deepEqual(transferBlockers(source(),{...target(),intakeId:"i1"},"2026-10-02"),[]);
});
test("transfer evidence binds profile, drafts, awards and destination independently of JSONB ordering",() => {
  const initial = source(),destination = target(),hash = transferEvidenceHash(initial,destination);
  initial.registrations.reverse(); initial.recognitions.reverse();
  assert.equal(transferEvidenceHash(initial,Object.fromEntries(Object.entries(destination).reverse())),hash);
  for (const change of [(s) => s.profileRevision++, (s) => s.programme.revision++, (s) => s.registrations[0].revision++, (s) => s.recognitions[0].status = "revoked"]) {const copy = source();change(copy);assert.notEqual(transferEvidenceHash(copy,destination),hash);}
  assert.notEqual(transferEvidenceHash(source(),{...destination,versionStatus:"retired"}),hash);
  assert.notEqual(transferEvidenceHash(source()),hash);
});
