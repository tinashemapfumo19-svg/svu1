import test from "node:test";
import assert from "node:assert/strict";
import { offeringVersion, outcomeChecksum, reconcileOutcomeRoster, validateOutcomes } from "../server/modules/lms.js";

const rows = () => [{studentNumber:"S25000002",mark:64},{studentNumber:"S25000001",mark:71}];
const input = (overrides = {}) => ({offeringKey:"regp_1:crs_1",externalRef:"moodle-grade-export-17",rows:rows(),checksum:outcomeChecksum(rows()),...overrides});

test("LMS outcomes need whole marks, unique students and a matching checksum",() => {
  assert.deepEqual(validateOutcomes(input()),{periodId:"regp_1",courseId:"crs_1"});
  assert.equal(outcomeChecksum(rows()),outcomeChecksum([...rows()].reverse()));
  assert.throws(() => validateOutcomes(input({checksum:"0".repeat(64)})),{statusCode:409});
  for (const bad of [[{studentNumber:"S25000001",mark:70.5}],[{studentNumber:"S25000001",mark:101}],[{studentNumber:"25000001",mark:50}],[{studentNumber:"S25000001",mark:50},{studentNumber:"S25000001",mark:60}],[{studentNumber:"S25000001",mark:50,grade:"A"}]]) {
    assert.throws(() => validateOutcomes(input({rows:bad,checksum:outcomeChecksum(bad.filter((row) => row.studentNumber))})),{statusCode:400});
  }
  for (const change of [{offeringKey:"no-separator"},{externalRef:""},{rows:[]},{grades:[]}]) assert.throws(() => validateOutcomes(input(change)),{statusCode:400});
});

test("outcomes must match the confirmed class list exactly",() => {
  const roster = [{studentNumber:"S25000001"},{studentNumber:"S25000002"}];
  assert.doesNotThrow(() => reconcileOutcomeRoster(rows(),roster));
  assert.throws(() => reconcileOutcomeRoster(rows().slice(0,1),roster),/Missing: S25000001/);
  assert.throws(() => reconcileOutcomeRoster([...rows(),{studentNumber:"S25000009",mark:1}],roster),/Not enrolled: S25000009/);
});

test("manifest versions change with membership but not with ordering",() => {
  const offering = {offeringKey:"p:c",teachers:[{employeeNumber:"E2",role:"tutor"},{employeeNumber:"E1",role:"lead"}],students:[{studentNumber:"S2"},{studentNumber:"S1"}]};
  const version = offeringVersion(offering);
  assert.equal(offeringVersion({...offering,teachers:[...offering.teachers].reverse(),students:[...offering.students].reverse()}),version);
  assert.notEqual(offeringVersion({...offering,students:offering.students.slice(1)}),version);
  assert.notEqual(offeringVersion({...offering,teachers:[{employeeNumber:"E1",role:"lead"}]}),version);
});
